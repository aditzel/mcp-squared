/**
 * Configuration path discovery and management.
 *
 * This module handles finding configuration files using a multi-scope
 * discovery strategy:
 * 1. Environment variable (MCP_SQUARED_CONFIG)
 * 2. Project-local config (mcp-squared.toml or .mcp-squared/config.toml)
 * 3. User-level config (~/.config/mcp-squared/config.toml)
 *
 * @module config/paths
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

const PID_FILENAME = "mcp-squared.pid";
const SOCKET_FILENAME = "mcp-squared.sock";
const INSTANCE_DIR_NAME = "instances";
const SOCKET_DIR_NAME = "sockets";
const DAEMON_DIR_NAME = "daemon";
const DAEMON_REGISTRY_FILENAME = "daemon.json";
const DAEMON_SOCKET_FILENAME = "daemon.sock";

/**
 * Source of the discovered configuration file.
 * - env: Found via MCP_SQUARED_CONFIG environment variable
 * - project: Found in project directory tree
 * - user: Found in user's config directory
 */
export type ConfigSource = "env" | "project" | "user";

/**
 * Result of configuration path discovery.
 */
export interface ConfigPathResult {
  /** Absolute path to the configuration file */
  path: string;
  /** Where the configuration was found */
  source: ConfigSource;
}

const CONFIG_FILENAME = "mcp-squared.toml";
const CONFIG_DIR_NAME = ".mcp-squared";
const APP_NAME = "mcp-squared";

/**
 * Gets an environment variable value.
 * @internal
 */
function getEnv(key: string): string | undefined {
  return Bun.env[key];
}

/**
 * Gets the XDG config home directory.
 * @internal
 */
function getXdgConfigHome(): string {
  return getEnv("XDG_CONFIG_HOME") || join(homedir(), ".config");
}

/**
 * Gets the user-level configuration directory path.
 * Uses XDG_CONFIG_HOME on Unix, APPDATA on Windows.
 * @internal
 */
function getUserConfigDir(): string {
  const os = platform();
  if (os === "win32") {
    return join(
      getEnv("APPDATA") || join(homedir(), "AppData", "Roaming"),
      APP_NAME,
    );
  }
  return join(getXdgConfigHome(), APP_NAME);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Gets the full path to the user-level config file.
 * @internal
 */
function getUserConfigPath(): string {
  return join(getUserConfigDir(), "config.toml");
}

/**
 * Gets the full path to the PID file.
 * The PID file is stored in the user-level config directory.
 *
 * @returns Path to the PID file
 */
export function getPidFilePath(): string {
  return join(getUserConfigDir(), PID_FILENAME);
}

/**
 * Gets the full path to the Unix Domain Socket file.
 * When instanceId is provided, it uses the per-instance socket directory.
 * The default path is retained for backward compatibility.
 *
 * @param instanceId - Optional instance ID for multi-instance sockets
 * @returns Path to the socket file
 */
export function getSocketFilePath(instanceId?: string): string {
  if (!instanceId) {
    return join(getUserConfigDir(), SOCKET_FILENAME);
  }
  return join(getSocketDir(), `mcp-squared.${instanceId}.sock`);
}

/**
 * Gets the directory used for the shared daemon registry and socket.
 *
 * @returns Path to the daemon directory
 */
export function getDaemonDir(configHash?: string): string {
  if (configHash) {
    return join(getUserConfigDir(), DAEMON_DIR_NAME, configHash);
  }
  return join(getUserConfigDir(), DAEMON_DIR_NAME);
}

/**
 * Gets the daemon registry file path.
 *
 * @returns Path to the daemon registry file
 */
export function getDaemonRegistryPath(configHash?: string): string {
  return join(getDaemonDir(configHash), DAEMON_REGISTRY_FILENAME);
}

/**
 * Gets the daemon socket path.
 *
 * @returns Path to the daemon socket
 */
export function getDaemonSocketPath(configHash?: string): string {
  return join(getDaemonDir(configHash), DAEMON_SOCKET_FILENAME);
}

/**
 * Gets the directory used to store per-instance registry entries.
 *
 * @returns Path to the instance registry directory
 */
export function getInstanceRegistryDir(): string {
  return join(getUserConfigDir(), INSTANCE_DIR_NAME);
}

/**
 * Gets the directory used to store per-instance socket files.
 *
 * @returns Path to the socket directory
 */
export function getSocketDir(): string {
  return join(getUserConfigDir(), SOCKET_DIR_NAME);
}

/**
 * Ensures the instance registry directory exists.
 */
export function ensureInstanceRegistryDir(): void {
  ensureDir(getInstanceRegistryDir());
}

/**
 * Ensures the socket directory exists.
 */
export function ensureSocketDir(): void {
  ensureDir(getSocketDir());
}

/**
 * Ensures the daemon directory exists.
 */
export function ensureDaemonDir(configHash?: string): void {
  ensureDir(getDaemonDir(configHash));
}

/**
 * Searches up the directory tree for a project-level config file.
 * Checks for both direct files and hidden directory configs.
 *
 * @param startDir - Directory to start searching from
 * @returns Path to config file if found, null otherwise
 * @internal
 */
function findProjectConfig(startDir: string): string | null {
  let currentDir = resolve(startDir);
  const root = dirname(currentDir);

  while (currentDir !== root) {
    const directPath = join(currentDir, CONFIG_FILENAME);
    if (existsSync(directPath)) {
      return directPath;
    }

    const hiddenDirPath = join(currentDir, CONFIG_DIR_NAME, "config.toml");
    if (existsSync(hiddenDirPath)) {
      return hiddenDirPath;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return null;
}

/**
 * Discovers the configuration file path using multi-scope discovery.
 *
 * Search order:
 * 1. MCP_SQUARED_CONFIG environment variable
 * 2. Project-local config (mcp-squared.toml or .mcp-squared/config.toml)
 * 3. User-level config (~/.config/mcp-squared/config.toml)
 *
 * @param cwd - Working directory to start project search from (default: process.cwd())
 * @returns Path and source if found, null if no config exists
 */
export function discoverConfigPath(
  cwd: string = process.cwd(),
): ConfigPathResult | null {
  const envPath = getEnv("MCP_SQUARED_CONFIG");
  if (envPath) {
    const resolvedEnvPath = resolve(envPath);
    if (existsSync(resolvedEnvPath)) {
      return { path: resolvedEnvPath, source: "env" };
    }
  }

  const projectPath = findProjectConfig(cwd);
  if (projectPath) {
    return { path: projectPath, source: "project" };
  }

  const userPath = getUserConfigPath();
  if (existsSync(userPath)) {
    return { path: userPath, source: "user" };
  }

  return null;
}

/**
 * Gets the default configuration file path (user-level).
 * Use this when creating a new config file.
 *
 * @returns Path to user-level config file
 */
export function getDefaultConfigPath(): ConfigPathResult {
  return {
    path: getUserConfigPath(),
    source: "user",
  };
}

/**
 * Ensures the directory for the config file exists.
 * Creates parent directories as needed.
 *
 * @param configPath - Path to the config file
 */
export function ensureConfigDir(configPath: string): void {
  const dir = dirname(configPath);
  ensureDir(dir);
}
