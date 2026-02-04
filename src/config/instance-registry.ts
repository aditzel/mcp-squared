/**
 * Instance registry for MCP² server processes.
 *
 * Tracks active server instances so the monitor TUI can connect to any of them.
 * Entries are stored as JSON files in a per-user registry directory.
 *
 * @module config/instance-registry
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { type Socket, connect } from "node:net";
import { join } from "node:path";
import { getInstanceRegistryDir } from "./paths.js";
import { isProcessRunning } from "./pid.js";

const ENTRY_EXTENSION = ".json";
const DEFAULT_CONNECT_TIMEOUT_MS = 300;

/**
 * Instance registry entry shape.
 */
export interface InstanceRegistryEntry {
  /** Unique instance ID */
  id: string;
  /** Process ID */
  pid: number;
  /** Parent process ID (optional, runtime only) */
  ppid?: number;
  /** Role of the instance (server, daemon, proxy) */
  role?: "server" | "daemon" | "proxy";
  /** Launcher/agent hint (optional, runtime only) */
  launcher?: string;
  /** User name (optional, runtime only) */
  user?: string;
  /** Process name / executable (optional, runtime only) */
  processName?: string;
  /** Parent process name (optional, runtime only) */
  parentProcessName?: string;
  /** Parent command line (optional, runtime only) */
  parentCommand?: string;
  /** Monitor socket path or TCP endpoint */
  socketPath: string;
  /** Start time (Unix ms) */
  startedAt: number;
  /** Working directory for the process */
  cwd?: string;
  /** Config path used to start the server */
  configPath?: string;
  /** MCP² version */
  version?: string;
  /** Command line used to start the server */
  command?: string;
}

/**
 * Instance registry entry with source path.
 */
export interface InstanceRegistryEntryRecord extends InstanceRegistryEntry {
  /** Registry entry file path */
  entryPath: string;
}

interface ListInstanceEntriesOptions {
  /** Delete invalid entries as they are discovered */
  pruneInvalid?: boolean;
}

interface ActiveInstanceOptions {
  /** Delete stale entries as they are discovered */
  prune?: boolean;
  /** Connection timeout in milliseconds */
  timeoutMs?: number;
}

function ensureRegistryDir(): string {
  const dir = getInstanceRegistryDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function isTcpEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("tcp://");
}

function parseTcpEndpoint(endpoint: string): { host: string; port: number } {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid TCP endpoint: ${endpoint}`);
  }

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

function isValidEntry(data: unknown): data is InstanceRegistryEntry {
  if (!data || typeof data !== "object") {
    return false;
  }
  const record = data as Record<string, unknown>;
  const id = record["id"];
  if (typeof id !== "string" || id.trim() === "") {
    return false;
  }
  const pid = record["pid"];
  if (typeof pid !== "number" || pid <= 0) {
    return false;
  }
  const socketPath = record["socketPath"];
  if (typeof socketPath !== "string" || socketPath.trim() === "") {
    return false;
  }
  const startedAt = record["startedAt"];
  if (typeof startedAt !== "number" || startedAt <= 0) {
    return false;
  }
  const cwd = record["cwd"];
  if (cwd && typeof cwd !== "string") {
    return false;
  }
  const role = record["role"];
  if (role && typeof role !== "string") {
    return false;
  }
  const launcher = record["launcher"];
  if (launcher && typeof launcher !== "string") {
    return false;
  }
  const ppid = record["ppid"];
  if (ppid && typeof ppid !== "number") {
    return false;
  }
  const user = record["user"];
  if (user && typeof user !== "string") {
    return false;
  }
  const processName = record["processName"];
  if (processName && typeof processName !== "string") {
    return false;
  }
  const parentProcessName = record["parentProcessName"];
  if (parentProcessName && typeof parentProcessName !== "string") {
    return false;
  }
  const parentCommand = record["parentCommand"];
  if (parentCommand && typeof parentCommand !== "string") {
    return false;
  }
  const configPath = record["configPath"];
  if (configPath && typeof configPath !== "string") {
    return false;
  }
  const version = record["version"];
  if (version && typeof version !== "string") {
    return false;
  }
  const command = record["command"];
  if (command && typeof command !== "string") {
    return false;
  }
  return true;
}

/**
 * Writes an instance registry entry to disk.
 *
 * @param entry - Entry to write
 * @returns Path to the entry file
 */
export function writeInstanceEntry(entry: InstanceRegistryEntry): string {
  const dir = ensureRegistryDir();
  const entryPath = join(dir, `${entry.id}${ENTRY_EXTENSION}`);
  const tempPath = join(dir, `.${entry.id}.${process.pid}.tmp`);

  const payload = `${JSON.stringify(entry, null, 2)}\n`;
  writeFileSync(tempPath, payload, { encoding: "utf8" });
  renameSync(tempPath, entryPath);
  return entryPath;
}

/**
 * Reads an instance registry entry from disk.
 *
 * @param entryPath - Entry path to read
 * @returns Parsed entry or null if invalid
 */
export function readInstanceEntry(
  entryPath: string,
): InstanceRegistryEntry | null {
  if (!existsSync(entryPath)) {
    return null;
  }

  try {
    const raw = readFileSync(entryPath, { encoding: "utf8" });
    const data = JSON.parse(raw);
    return isValidEntry(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Deletes an instance registry entry.
 *
 * @param entryPath - Entry path to delete
 * @returns true if deleted or missing, false on failure
 */
export function deleteInstanceEntry(entryPath: string): boolean {
  if (!existsSync(entryPath)) {
    return true;
  }
  try {
    unlinkSync(entryPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists all instance entries found on disk.
 *
 * @param options - Listing options
 * @returns Array of entries with their file path
 */
export function listInstanceEntries(
  options: ListInstanceEntriesOptions = {},
): InstanceRegistryEntryRecord[] {
  const { pruneInvalid = false } = options;
  const dir = getInstanceRegistryDir();
  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir);
  const entries: InstanceRegistryEntryRecord[] = [];

  for (const file of files) {
    if (!file.endsWith(ENTRY_EXTENSION)) {
      continue;
    }

    const entryPath = join(dir, file);
    const entry = readInstanceEntry(entryPath);

    if (!entry) {
      if (pruneInvalid) {
        deleteInstanceEntry(entryPath);
      }
      continue;
    }

    entries.push({ ...entry, entryPath });
  }

  return entries;
}

async function canConnect(
  endpoint: string,
  timeoutMs: number,
): Promise<boolean> {
  if (!isTcpEndpoint(endpoint) && !existsSync(endpoint)) {
    return false;
  }

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

    if (!socket) {
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

async function isInstanceAlive(
  entry: InstanceRegistryEntry,
  timeoutMs: number,
): Promise<boolean> {
  if (!isProcessRunning(entry.pid)) {
    return false;
  }
  if (entry.role === "proxy") {
    return true;
  }
  return canConnect(entry.socketPath, timeoutMs);
}

/**
 * Lists active instance entries and optionally prunes stale ones.
 *
 * @param options - Active listing options
 * @returns Array of active instance entries
 */
export async function listActiveInstanceEntries(
  options: ActiveInstanceOptions = {},
): Promise<InstanceRegistryEntry[]> {
  const { prune = true, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS } = options;
  const entries = listInstanceEntries({ pruneInvalid: prune });
  const active: InstanceRegistryEntry[] = [];

  for (const entry of entries) {
    const alive = await isInstanceAlive(entry, timeoutMs);
    if (alive) {
      active.push(entry);
    } else if (prune) {
      deleteInstanceEntry(entry.entryPath);
    }
  }

  active.sort((a, b) => b.startedAt - a.startedAt);
  return active;
}
