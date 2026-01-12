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

/**
 * Gets the full path to the user-level config file.
 * @internal
 */
function getUserConfigPath(): string {
  return join(getUserConfigDir(), "config.toml");
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
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
