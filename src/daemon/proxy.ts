/**
 * Stdio proxy that forwards MCP traffic to the shared daemon.
 *
 * @module daemon/proxy
 */

import { spawn } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { getDaemonSocketPath } from "@/config/paths.js";
import {
  type DaemonRegistryEntry,
  loadLiveDaemonRegistry,
} from "@/daemon/registry.js";
import { SocketClientTransport } from "./transport.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 5000;

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
  const baseArgs = scriptPath ? [scriptPath, "daemon"] : ["daemon"];
  const args = sharedSecret
    ? [...baseArgs, `--daemon-secret=${sharedSecret}`]
    : baseArgs;

  const child = spawn(execPath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function createProxyBridge(
  options: ProxyBridgeOptions,
): Promise<ProxyBridge> {
  const spawnDaemon = options.spawnDaemon ?? spawnDaemonProcess;
  let endpoint = options.endpoint;
  let sharedSecret = options.sharedSecret?.trim();
  let sessionId: string | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let isOwner = false;
  let daemonClosed = false;
  let stdioClosed = false;
  const debug = options.debug ?? process.env["MCP_SQUARED_PROXY_DEBUG"] === "1";

  if (!endpoint) {
    const registry = await loadLiveDaemonRegistry(options.configHash);
    if (registry) {
      endpoint = registry.endpoint;
      sharedSecret ??= registry.sharedSecret;
    } else if (!options.noSpawn) {
      spawnDaemon(sharedSecret);
      const entry = await waitForDaemon(
        DEFAULT_STARTUP_TIMEOUT_MS,
        options.configHash,
      );
      if (!entry) {
        throw new Error("Timed out waiting for daemon to start");
      }
      endpoint = entry.endpoint;
      sharedSecret ??= entry.sharedSecret;
    } else if (options.configHash) {
      endpoint = getDaemonSocketPath(options.configHash);
    }
  }

  if (!endpoint) {
    throw new Error("Daemon endpoint not available");
  }

  const transportOptions: { endpoint: string; timeoutMs?: number } = {
    endpoint,
  };
  if (options.timeoutMs !== undefined) {
    transportOptions.timeoutMs = options.timeoutMs;
  }
  const daemonTransport = new SocketClientTransport(transportOptions);
  const stdioTransport = options.stdioTransport;

  const closeDaemon = async (sendGoodbye: boolean): Promise<void> => {
    if (daemonClosed) {
      return;
    }
    daemonClosed = true;
    if (sendGoodbye && sessionId) {
      await daemonTransport
        .sendControl({ type: "goodbye", sessionId })
        .catch(() => {});
    }
    await daemonTransport.close().catch(() => {});
  };

  daemonTransport.oncontrol = (message) => {
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

  daemonTransport.onmessage = (message) => {
    void stdioTransport.send(message);
  };
  daemonTransport.onclose = () => {
    daemonClosed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    void stdioTransport.close();
  };
  daemonTransport.onerror = (error) => {
    console.error(`Daemon transport error: ${error.message}`);
  };

  stdioTransport.onmessage = (message) => {
    void daemonTransport.send(message);
  };
  stdioTransport.onclose = () => {
    stdioClosed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    void closeDaemon(true);
  };
  stdioTransport.onerror = (error) => {
    console.error(`Stdio transport error: ${error.message}`);
  };

  await daemonTransport.start();
  const launcherHint =
    process.env["MCP_SQUARED_LAUNCHER"] ??
    process.env["MCP_CLIENT_NAME"] ??
    process.env["MCP_SQUARED_AGENT"];
  const clientId = launcherHint
    ? `${launcherHint}-${process.pid}`
    : `proxy-${process.pid}`;
  void daemonTransport.sendControl({
    type: "hello",
    clientId,
    ...(sharedSecret ? { sharedSecret } : {}),
  });

  heartbeatTimer = setInterval(() => {
    if (!sessionId) {
      return;
    }
    void daemonTransport.sendControl({
      type: "heartbeat",
      sessionId,
    });
  }, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);

  await stdioTransport.start();

  return {
    stop: async () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      await closeDaemon(true);
      if (!stdioClosed) {
        await stdioTransport.close();
      }
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
