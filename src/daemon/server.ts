/**
 * Shared daemon server for MCP².
 *
 * @module daemon/server
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import {
  connect,
  createServer,
  isIPv4,
  isIPv6,
  type Server,
  type Socket,
} from "node:net";
import { dirname } from "node:path";
import { VERSION } from "@/version.js";
import { ensureDaemonDir, getDaemonSocketPath } from "../config/paths.js";
import type { McpSquaredServer } from "../server/index.js";
import type { MonitorClientInfo } from "../server/monitor-server.js";
import { deleteDaemonRegistry, writeDaemonRegistry } from "./registry.js";
import { SocketServerTransport } from "./transport.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 300;

function isTcpEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("tcp://");
}

function parseMappedIpv4Address(normalizedHost: string): string | null {
  if (!normalizedHost.startsWith("::ffff:")) {
    return null;
  }

  const mappedIpv4 = normalizedHost.slice("::ffff:".length);
  if (isIPv4(mappedIpv4)) {
    return mappedIpv4;
  }

  const hextets = mappedIpv4.split(":");
  if (hextets.length !== 2) {
    return null;
  }
  if (!hextets.every((segment) => /^[0-9a-f]{1,4}$/.test(segment))) {
    return null;
  }

  const high = Number.parseInt(hextets[0] ?? "", 16);
  const low = Number.parseInt(hextets[1] ?? "", 16);
  if (
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return null;
  }

  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

function parseTcpEndpoint(endpoint: string): { host: string; port: number } {
  const url = new URL(endpoint);
  if (url.protocol !== "tcp:") {
    throw new Error(`Invalid TCP endpoint protocol: ${url.protocol}`);
  }
  const normalizedHost = normalizeHost(url.hostname);
  const host = parseMappedIpv4Address(normalizedHost) ?? normalizedHost;
  const port = Number.parseInt(url.port, 10);
  if (!host || Number.isNaN(port)) {
    throw new Error(`Invalid TCP endpoint: ${endpoint}`);
  }
  return { host, port };
}

function normalizeHost(host: string): string {
  const lowered = host.toLowerCase();
  if (lowered.startsWith("[") && lowered.endsWith("]")) {
    return lowered.slice(1, -1);
  }
  return lowered;
}

function isMappedIpv4Loopback(normalizedHost: string): boolean {
  const mappedIpv4 = parseMappedIpv4Address(normalizedHost);
  return mappedIpv4 !== null && mappedIpv4.split(".")[0] === "127";
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (normalized === "localhost") {
    return true;
  }
  if (isIPv4(normalized)) {
    return normalized.split(".")[0] === "127";
  }
  if (isMappedIpv4Loopback(normalized)) {
    return true;
  }
  if (isIPv6(normalized)) {
    return normalized === "::1";
  }
  return false;
}

function formatTcpEndpoint(host: string, port: number): string {
  const normalized = normalizeHost(host);
  if (normalized.includes(":")) {
    return `tcp://[${normalized}]:${port}`;
  }
  return `tcp://${normalized}:${port}`;
}

function assertLoopbackTcpEndpoint(endpoint: string): void {
  const { host } = parseTcpEndpoint(endpoint);
  if (!isLoopbackHost(host)) {
    throw new Error(
      `Refusing non-loopback daemon TCP endpoint: ${endpoint}. Use localhost, 127.0.0.1, or ::1.`,
    );
  }
}

async function canConnect(
  endpoint: string,
  timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: Socket | null = null;
    try {
      socket = isTcpEndpoint(endpoint)
        ? connect(parseTcpEndpoint(endpoint))
        : connect(endpoint);
    } catch {
      resolve(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      socket?.destroy();
      resolve(false);
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timeoutId);
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      clearTimeout(timeoutId);
      socket.destroy();
      resolve(false);
    });
  });
}

interface DaemonSession {
  id: string;
  clientId?: string;
  authenticated: boolean;
  connectedAt: number;
  lastSeen: number;
  server: ReturnType<McpSquaredServer["createSessionServer"]>;
  transport: SocketServerTransport;
}

export interface DaemonServerOptions {
  runtime: McpSquaredServer;
  socketPath?: string;
  idleTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
  configHash?: string;
  sharedSecret?: string;
  onIdleShutdown?: () => void | Promise<void>;
}

export class DaemonServer {
  private readonly runtime: McpSquaredServer;
  private readonly socketPath: string;
  private endpoint: string | null = null;
  private readonly idleTimeoutMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly configHash: string | undefined;
  private readonly sharedSecret: string | undefined;
  private readonly onIdleShutdown?: () => void | Promise<void>;
  private server: Server | null = null;
  private sessions = new Map<string, DaemonSession>();
  private ownerSessionId: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DaemonServerOptions) {
    this.runtime = options.runtime;
    this.configHash = options.configHash;
    this.socketPath =
      options.socketPath ?? getDaemonSocketPath(this.configHash);
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 15000;
    const sharedSecret = options.sharedSecret?.trim();
    if (sharedSecret) {
      this.sharedSecret = sharedSecret;
    }
    if (options.onIdleShutdown) {
      this.onIdleShutdown = options.onIdleShutdown;
    }
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    ensureDaemonDir(this.configHash);
    const tcp = isTcpEndpoint(this.socketPath);
    if (tcp) {
      assertLoopbackTcpEndpoint(this.socketPath);
    }
    if (!tcp) {
      mkdirSync(dirname(this.socketPath), { recursive: true });
    }
    if (tcp) {
      const port = parseTcpEndpoint(this.socketPath).port;
      if (port > 0 && (await canConnect(this.socketPath))) {
        throw new Error(
          `Daemon already running at ${this.socketPath}. Refusing to start another.`,
        );
      }
    } else if (existsSync(this.socketPath)) {
      if (await canConnect(this.socketPath)) {
        throw new Error(
          `Daemon already running at ${this.socketPath}. Refusing to start another.`,
        );
      }
      try {
        unlinkSync(this.socketPath);
      } catch {
        // ignore
      }
    }

    await this.runtime.startCore();
    this.runtime.setMonitorClientProvider(() => this.getClientInfo());

    this.server = createServer((socket) => {
      this.handleConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", (error) => reject(error));
      if (tcp) {
        const { host, port } = parseTcpEndpoint(this.socketPath);
        if (!host || Number.isNaN(port)) {
          reject(new Error(`Invalid TCP endpoint: ${this.socketPath}`));
          return;
        }
        this.server?.listen({ host, port }, () => resolve());
      } else {
        this.server?.listen(this.socketPath, () => resolve());
      }
    });

    if (tcp) {
      const address = this.server.address();
      if (address && typeof address !== "string") {
        this.endpoint = formatTcpEndpoint(address.address, address.port);
      } else {
        this.endpoint = this.socketPath;
      }
    } else {
      this.endpoint = this.socketPath;
    }

    const registryEntry = {
      daemonId: randomUUID(),
      endpoint: this.endpoint ?? this.socketPath,
      pid: process.pid,
      startedAt: Date.now(),
      version: VERSION,
      ...(this.configHash ? { configHash: this.configHash } : {}),
      ...(this.sharedSecret ? { sharedSecret: this.sharedSecret } : {}),
    };
    writeDaemonRegistry(registryEntry);

    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        void this.sweepIdleSessions();
      }, this.heartbeatTimeoutMs);
    }
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const session of this.sessions.values()) {
      await session.server.close();
      await session.transport.close();
    }
    this.sessions.clear();

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    this.server = null;
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // ignore
      }
    }
    deleteDaemonRegistry(this.configHash);
    this.runtime.setMonitorClientProvider(undefined);
    await this.runtime.stopCore();
  }

  private handleConnection(socket: Socket): void {
    const sessionId = randomUUID();
    const sessionServer = this.runtime.createSessionServer();
    const transport = new SocketServerTransport(socket);
    transport.sessionId = sessionId;

    const session: DaemonSession = {
      id: sessionId,
      authenticated: false,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      server: sessionServer,
      transport,
    };

    this.sessions.set(sessionId, session);

    let sessionServerConnected = false;
    const connectSessionServer = async (): Promise<void> => {
      if (sessionServerConnected) {
        return;
      }
      sessionServerConnected = true;
      await sessionServer.connect(transport);
      const original = transport.onmessage;
      transport.onmessage = (message, extra) => {
        session.lastSeen = Date.now();
        original?.(message, extra);
      };
    };

    transport.onclose = () => {
      void this.handleDisconnect(sessionId);
    };

    transport.onerror = () => {
      void this.handleDisconnect(sessionId);
    };

    transport.oncontrol = async (message) => {
      switch (message.type) {
        case "hello":
          if (
            this.sharedSecret !== undefined &&
            message.sharedSecret !== this.sharedSecret
          ) {
            try {
              await transport.sendControl({
                type: "error",
                message: "Daemon authentication failed: invalid shared secret.",
              });
            } finally {
              await this.handleDisconnect(sessionId);
            }
            break;
          }
          if (message.clientId !== undefined) {
            session.clientId = message.clientId;
          }
          if (!session.authenticated) {
            session.authenticated = true;
            this.runtime.getStatsCollector().incrementActiveConnections();
            this.assignOwnerIfNeeded();
            this.clearIdleTimer();
          }
          session.lastSeen = Date.now();
          void transport.sendControl({
            type: "helloAck",
            sessionId,
            isOwner: this.ownerSessionId === sessionId,
          });
          void connectSessionServer().catch(() =>
            this.handleDisconnect(sessionId),
          );
          break;
        case "heartbeat":
          if (!session.authenticated) {
            break;
          }
          session.lastSeen = Date.now();
          break;
        case "goodbye":
          void this.handleDisconnect(sessionId);
          break;
      }
    };

    void transport.start().catch(() => this.handleDisconnect(sessionId));
  }

  private async handleDisconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);

    try {
      await session.server.close();
      await session.transport.close();
    } catch {
      // ignore
    }

    if (session.authenticated) {
      this.runtime.getStatsCollector().decrementActiveConnections();
    }

    if (this.ownerSessionId === sessionId) {
      this.ownerSessionId = null;
      this.assignOwnerIfNeeded();
    }

    if (this.sessions.size === 0) {
      this.startIdleTimer();
    }
  }

  private assignOwnerIfNeeded(): void {
    if (this.ownerSessionId) {
      return;
    }
    const next = Array.from(this.sessions.values())
      .filter((session) => session.authenticated)
      .sort((a, b) => a.connectedAt - b.connectedAt)[0];
    if (next) {
      this.ownerSessionId = next.id;
      this.broadcastOwnerChange();
    }
  }

  private broadcastOwnerChange(): void {
    if (!this.ownerSessionId) {
      return;
    }
    for (const session of this.sessions.values()) {
      if (!session.authenticated) {
        continue;
      }
      void session.transport.sendControl({
        type: "ownerChanged",
        ownerSessionId: this.ownerSessionId,
      });
    }
  }

  private startIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      void this.handleIdleTimeout();
    }, this.idleTimeoutMs);
  }

  private async handleIdleTimeout(): Promise<void> {
    if (this.sessions.size > 0 || !this.server) {
      return;
    }
    try {
      await this.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Idle shutdown failed: ${message}`);
    } finally {
      if (this.onIdleShutdown) {
        await this.onIdleShutdown();
      }
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async sweepIdleSessions(): Promise<void> {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (now - session.lastSeen > this.heartbeatTimeoutMs) {
        await this.handleDisconnect(session.id);
      }
    }
  }

  getSocketPath(): string {
    return this.endpoint ?? this.socketPath;
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getOwnerSessionId(): string | null {
    return this.ownerSessionId;
  }

  private getClientInfo(): MonitorClientInfo[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.authenticated)
      .map((session) => {
        const info: MonitorClientInfo = {
          sessionId: session.id,
          connectedAt: session.connectedAt,
          lastSeen: session.lastSeen,
          isOwner: session.id === this.ownerSessionId,
        };
        if (session.clientId !== undefined) {
          info.clientId = session.clientId;
        }
        return info;
      });
  }
}
