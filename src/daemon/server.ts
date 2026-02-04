/**
 * Shared daemon server for MCP².
 *
 * @module daemon/server
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { dirname } from "node:path";
import { ensureDaemonDir, getDaemonSocketPath } from "../config/paths.js";
import { VERSION } from "../index.js";
import type { McpSquaredServer } from "../server/index.js";
import type { MonitorClientInfo } from "../server/monitor-server.js";
import { deleteDaemonRegistry, writeDaemonRegistry } from "./registry.js";
import { SocketServerTransport } from "./transport.js";

interface DaemonSession {
  id: string;
  clientId?: string;
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
}

export class DaemonServer {
  private readonly runtime: McpSquaredServer;
  private readonly socketPath: string;
  private endpoint: string | null = null;
  private readonly idleTimeoutMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly configHash: string | undefined;
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
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    ensureDaemonDir(this.configHash);
    const tcp = this.socketPath.startsWith("tcp://");
    if (!tcp) {
      mkdirSync(dirname(this.socketPath), { recursive: true });
    }
    if (!this.socketPath.startsWith("tcp://") && existsSync(this.socketPath)) {
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
        const url = new URL(this.socketPath);
        const host = url.hostname;
        const port = Number.parseInt(url.port, 10);
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
        this.endpoint = `tcp://${address.address}:${address.port}`;
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
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      server: sessionServer,
      transport,
    };

    this.sessions.set(sessionId, session);
    this.runtime.getStatsCollector().incrementActiveConnections();
    this.assignOwnerIfNeeded();
    this.clearIdleTimer();

    transport.onclose = () => {
      void this.handleDisconnect(sessionId);
    };

    transport.onerror = () => {
      void this.handleDisconnect(sessionId);
    };

    transport.oncontrol = (message) => {
      switch (message.type) {
        case "hello":
          if (message.clientId !== undefined) {
            session.clientId = message.clientId;
          }
          session.lastSeen = Date.now();
          void transport.sendControl({
            type: "helloAck",
            sessionId,
            isOwner: this.ownerSessionId === sessionId,
          });
          break;
        case "heartbeat":
          session.lastSeen = Date.now();
          break;
        case "goodbye":
          void this.handleDisconnect(sessionId);
          break;
      }
    };

    sessionServer
      .connect(transport)
      .then(() => {
        const original = transport.onmessage;
        transport.onmessage = (message, extra) => {
          session.lastSeen = Date.now();
          original?.(message, extra);
        };
      })
      .catch(() => this.handleDisconnect(sessionId));
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

    this.runtime.getStatsCollector().decrementActiveConnections();

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
    const next = Array.from(this.sessions.values()).sort(
      (a, b) => a.connectedAt - b.connectedAt,
    )[0];
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
      void this.stop();
    }, this.idleTimeoutMs);
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
    return Array.from(this.sessions.values()).map((session) => {
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
