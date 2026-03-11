/**
 * Stdio proxy that forwards MCP traffic to the shared daemon.
 *
 * @module daemon/proxy
 */

import { spawn } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { getDaemonSocketPath } from "../config/paths.js";
import {
  type DaemonRegistryEntry,
  loadLiveDaemonRegistry,
} from "./registry.js";
import { SocketClientTransport } from "./transport.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 5000;
const RECONNECT_RETRY_DELAY_MS = 100;
const sharedDaemonStartupPromises = new Map<
  string,
  Promise<DaemonRegistryEntry>
>();

export interface ProxyOptions {
  endpoint?: string;
  timeoutMs?: number;
  noSpawn?: boolean;
  configHash?: string;
  sharedSecret?: string;
}

export interface ProxyBridgeOptions extends ProxyOptions {
  stdioTransport: Transport;
  heartbeatIntervalMs?: number;
  debug?: boolean;
  spawnDaemon?: (sharedSecret?: string) => void;
}

export interface ProxyBridge {
  stop: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDaemon(
  timeoutMs: number,
  configHash?: string,
): Promise<DaemonRegistryEntry | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const entry = await loadLiveDaemonRegistry(configHash);
    if (entry) {
      return entry;
    }
    await sleep(100);
  }
  return null;
}

function spawnDaemonProcess(sharedSecret?: string): void {
  const execPath = process.execPath;
  const scriptPath = process.argv[1];
  const args = scriptPath ? [scriptPath, "daemon"] : ["daemon"];

  const child = spawn(execPath, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...(sharedSecret ? { MCP_SQUARED_DAEMON_SECRET: sharedSecret } : {}),
    },
  });
  child.unref();
}

async function resolveSharedDaemonStartup(
  startupKey: string,
  spawnDaemon: (sharedSecret?: string) => void,
  sharedSecret: string | undefined,
  configHash?: string,
): Promise<DaemonRegistryEntry> {
  const existingPromise = sharedDaemonStartupPromises.get(startupKey);
  if (existingPromise) {
    return existingPromise;
  }

  const startupPromise = (async () => {
    spawnDaemon(sharedSecret);
    const entry = await waitForDaemon(DEFAULT_STARTUP_TIMEOUT_MS, configHash);
    if (!entry) {
      throw new Error("Timed out waiting for daemon to start");
    }
    return entry;
  })();

  sharedDaemonStartupPromises.set(startupKey, startupPromise);

  try {
    return await startupPromise;
  } finally {
    if (sharedDaemonStartupPromises.get(startupKey) === startupPromise) {
      sharedDaemonStartupPromises.delete(startupKey);
    }
  }
}

export async function createProxyBridge(
  options: ProxyBridgeOptions,
): Promise<ProxyBridge> {
  const spawnDaemon = options.spawnDaemon ?? spawnDaemonProcess;
  const configuredEndpoint = options.endpoint;
  let endpoint = configuredEndpoint;
  let sharedSecret = options.sharedSecret?.trim();
  let sessionId: string | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let isOwner = false;
  let daemonClosed = false;
  let stdioClosed = false;
  let stopping = false;
  let stdioClosePromise: Promise<void> | null = null;
  let daemonTransport: SocketClientTransport | null = null;
  let reconnectPromise: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const debug = options.debug ?? process.env["MCP_SQUARED_PROXY_DEBUG"] === "1";
  const launcherHint =
    process.env["MCP_SQUARED_LAUNCHER"] ??
    process.env["MCP_CLIENT_NAME"] ??
    process.env["MCP_SQUARED_AGENT"];
  const clientId = launcherHint
    ? `${launcherHint}-${process.pid}`
    : `proxy-${process.pid}`;

  const canRecoverDaemon = Boolean(options.configHash ?? configuredEndpoint);

  const resolveDaemonTarget = async (allowSpawn: boolean): Promise<string> => {
    if (options.configHash) {
      const registry = await loadLiveDaemonRegistry(options.configHash);
      if (registry) {
        sharedSecret ??= registry.sharedSecret;
        endpoint = registry.endpoint;
        return registry.endpoint;
      }

      if (allowSpawn && !options.noSpawn) {
        const startupKey = options.configHash
          ? `config:${options.configHash}`
          : `endpoint:${configuredEndpoint ?? "default"}:${sharedSecret ?? ""}`;
        const entry = await resolveSharedDaemonStartup(
          startupKey,
          spawnDaemon,
          sharedSecret,
          options.configHash,
        );
        sharedSecret ??= entry.sharedSecret;
        endpoint = entry.endpoint;
        return entry.endpoint;
      }

      if (configuredEndpoint) {
        endpoint = configuredEndpoint;
        return configuredEndpoint;
      }

      const hashedEndpoint = getDaemonSocketPath(options.configHash);
      endpoint = hashedEndpoint;
      return hashedEndpoint;
    }

    if (configuredEndpoint) {
      endpoint = configuredEndpoint;
      return configuredEndpoint;
    }

    throw new Error("Daemon endpoint not available");
  };

  const stdioTransport = options.stdioTransport;

  const closeDaemon = async (sendGoodbye: boolean): Promise<void> => {
    const activeTransport = daemonTransport;
    if (!activeTransport || daemonClosed) {
      return;
    }
    daemonClosed = true;
    if (sendGoodbye && sessionId) {
      await activeTransport
        .sendControl({ type: "goodbye", sessionId })
        .catch(() => {});
    }
    daemonTransport = null;
    sessionId = null;
    await activeTransport.close().catch(() => {});
  };

  const closeStdio = async (): Promise<void> => {
    if (stdioClosed) {
      return;
    }
    if (!stdioClosePromise) {
      stdioClosePromise = stdioTransport.close().finally(() => {
        stdioClosePromise = null;
      });
    }
    await stdioClosePromise;
  };

  const clearReconnectTimer = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (
      reconnectTimer ||
      reconnectPromise ||
      stopping ||
      stdioClosed ||
      !canRecoverDaemon
    ) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void reconnectDaemon();
    }, RECONNECT_RETRY_DELAY_MS);
  };

  const connectDaemon = async (allowSpawn: boolean): Promise<void> => {
    const resolvedEndpoint = allowSpawn
      ? await resolveDaemonTarget(true)
      : (endpoint ?? (await resolveDaemonTarget(false)));
    const transportOptions: { endpoint: string; timeoutMs?: number } = {
      endpoint: resolvedEndpoint,
    };
    if (options.timeoutMs !== undefined) {
      transportOptions.timeoutMs = options.timeoutMs;
    }

    const transport = new SocketClientTransport(transportOptions);
    daemonTransport = transport;
    daemonClosed = false;
    sessionId = null;

    transport.oncontrol = (message) => {
      switch (message.type) {
        case "helloAck":
          sessionId = message.sessionId;
          isOwner = message.isOwner;
          if (debug) {
            console.error(
              `[proxy] session ${message.sessionId} owner=${message.isOwner}`,
            );
          }
          break;
        case "ownerChanged":
          isOwner = message.ownerSessionId === sessionId;
          if (debug) {
            console.error(
              `[proxy] owner changed: ${message.ownerSessionId} (isOwner=${isOwner})`,
            );
          }
          break;
      }
    };

    transport.onmessage = (message) => {
      void stdioTransport.send(message);
    };
    transport.onclose = () => {
      if (daemonTransport !== transport) {
        return;
      }
      daemonTransport = null;
      daemonClosed = true;
      sessionId = null;
      if (stopping || stdioClosed || !canRecoverDaemon) {
        clearReconnectTimer();
        void closeStdio();
        return;
      }
      void reconnectDaemon();
    };
    transport.onerror = (error) => {
      console.error(`Daemon transport error: ${error.message}`);
    };

    await transport.start();
    void transport.sendControl({
      type: "hello",
      clientId,
      ...(sharedSecret ? { sharedSecret } : {}),
    });
  };

  const reconnectDaemon = async (): Promise<void> => {
    if (reconnectPromise) {
      return reconnectPromise;
    }

    clearReconnectTimer();

    reconnectPromise = (async () => {
      try {
        await connectDaemon(true);
      } catch {
        if (stopping || stdioClosed || !canRecoverDaemon) {
          await closeStdio();
          return;
        }
        scheduleReconnect();
      } finally {
        reconnectPromise = null;
      }
    })();

    return reconnectPromise;
  };

  stdioTransport.onmessage = (message) => {
    const activeTransport = daemonTransport;
    if (!activeTransport) {
      if (!stopping && !stdioClosed && canRecoverDaemon) {
        void reconnectDaemon();
      }
      return;
    }
    void activeTransport.send(message).catch(() => {
      if (!stopping && !stdioClosed && canRecoverDaemon) {
        void reconnectDaemon();
      }
    });
  };
  stdioTransport.onclose = () => {
    stopping = true;
    stdioClosed = true;
    clearReconnectTimer();
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    void closeDaemon(true);
  };
  stdioTransport.onerror = (error) => {
    console.error(`Stdio transport error: ${error.message}`);
  };

  await connectDaemon(!configuredEndpoint);

  heartbeatTimer = setInterval(() => {
    const activeTransport = daemonTransport;
    if (!sessionId || !activeTransport) {
      return;
    }
    void activeTransport.sendControl({
      type: "heartbeat",
      sessionId,
    });
  }, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);

  await stdioTransport.start();

  return {
    stop: async () => {
      stopping = true;
      clearReconnectTimer();
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (reconnectPromise) {
        await reconnectPromise.catch(() => {});
      }
      await closeDaemon(true);
      await closeStdio();
    },
  };
}

export async function runProxy(
  options: ProxyOptions = {},
): Promise<ProxyBridge> {
  return createProxyBridge({
    ...options,
    stdioTransport: new StdioServerTransport(),
  });
}
