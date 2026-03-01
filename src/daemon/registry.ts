/**
 * Shared daemon registry helpers.
 *
 * @module daemon/registry
 */

import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { connect, type Socket } from "node:net";
import { ensureDaemonDir, getDaemonRegistryPath } from "../config/paths.js";
import { isProcessRunning } from "../config/pid.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 300;

function isTcpEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("tcp://");
}

function parseTcpEndpoint(endpoint: string): { host: string; port: number } {
  const url = new URL(endpoint);
  if (url.protocol !== "tcp:") {
    throw new Error(`Invalid TCP endpoint protocol: ${url.protocol}`);
  }
  const host = url.hostname;
  const port = Number.parseInt(url.port, 10);
  if (!host || Number.isNaN(port)) {
    throw new Error(`Invalid TCP endpoint: ${endpoint}`);
  }
  return { host, port };
}

export interface DaemonRegistryEntry {
  daemonId: string;
  endpoint: string;
  pid: number;
  startedAt: number;
  version?: string;
  configHash?: string;
  sharedSecret?: string;
}

export function readDaemonRegistry(
  configHash?: string,
): DaemonRegistryEntry | null {
  const path = getDaemonRegistryPath(configHash);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, { encoding: "utf8" });
    const data = JSON.parse(raw) as DaemonRegistryEntry;
    if (!data || typeof data !== "object") {
      return null;
    }
    if (
      typeof data.daemonId !== "string" ||
      typeof data.endpoint !== "string" ||
      typeof data.pid !== "number" ||
      typeof data.startedAt !== "number"
    ) {
      return null;
    }
    if (
      data.sharedSecret !== undefined &&
      typeof data.sharedSecret !== "string"
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function writeDaemonRegistry(entry: DaemonRegistryEntry): void {
  ensureDaemonDir(entry.configHash);
  const path = getDaemonRegistryPath(entry.configHash);
  const tempPath = `${path}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(entry, null, 2)}\n`;
  writeFileSync(tempPath, payload, { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, path);
}

export function deleteDaemonRegistry(configHash?: string): void {
  const path = getDaemonRegistryPath(configHash);
  if (!existsSync(path)) {
    return;
  }
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}

async function canConnect(
  endpoint: string,
  timeoutMs: number,
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
      socket.destroy();
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

export async function isDaemonAlive(
  entry: DaemonRegistryEntry,
  timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<boolean> {
  if (!isProcessRunning(entry.pid)) {
    return false;
  }
  return canConnect(entry.endpoint, timeoutMs);
}

export async function loadLiveDaemonRegistry(
  configHash?: string,
): Promise<DaemonRegistryEntry | null> {
  const entry = readDaemonRegistry(configHash);
  if (!entry) {
    return null;
  }
  const alive = await isDaemonAlive(entry);
  if (!alive) {
    deleteDaemonRegistry(configHash);
    return null;
  }
  return entry;
}
