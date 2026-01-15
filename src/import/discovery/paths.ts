/**
 * Platform-aware path utilities for MCP config discovery.
 *
 * This module provides cross-platform path resolution for finding
 * MCP server configuration files from various agentic coding tools.
 *
 * @module import/discovery/paths
 */

import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Gets the user's home directory.
 */
export function getHomeDir(): string {
  return homedir();
}

/**
 * Gets the current operating system platform.
 */
export function getPlatform(): NodeJS.Platform {
  return platform();
}

/**
 * Gets an environment variable value.
 */
export function getEnv(key: string): string | undefined {
  return Bun.env[key];
}

/**
 * Gets the XDG config home directory.
 * Falls back to ~/.config if XDG_CONFIG_HOME is not set.
 *
 * @returns XDG config home path
 */
export function getXdgConfigHome(): string {
  return getEnv("XDG_CONFIG_HOME") || join(getHomeDir(), ".config");
}

/**
 * Gets the APPDATA directory on Windows.
 * Falls back to ~/AppData/Roaming if APPDATA is not set.
 *
 * @returns APPDATA path
 */
export function getAppData(): string {
  return getEnv("APPDATA") || join(getHomeDir(), "AppData", "Roaming");
}

/**
 * Gets the Application Support directory on macOS.
 *
 * @returns Application Support path
 */
export function getMacApplicationSupport(): string {
  return join(getHomeDir(), "Library", "Application Support");
}

/**
 * Gets VS Code's user data directory.
 * This is where extensions store their global settings.
 *
 * @returns VS Code user data directory
 */
export function getVSCodeUserDataDir(): string {
  const os = getPlatform();

  switch (os) {
    case "darwin":
      return join(getMacApplicationSupport(), "Code", "User");
    case "win32":
      return join(getAppData(), "Code", "User");
    default:
      return join(getXdgConfigHome(), "Code", "User");
  }
}

/**
 * Gets the global storage path for a VS Code extension.
 * Extensions store per-user settings in globalStorage.
 *
 * @param extensionId - Extension identifier (e.g., "saoudrizwan.claude-dev")
 * @returns Path to extension's global storage directory
 */
export function getVSCodeExtensionGlobalStorage(extensionId: string): string {
  return join(getVSCodeUserDataDir(), "globalStorage", extensionId);
}

/**
 * Expands a path with platform-specific variables.
 * Supports:
 * - ~ -> home directory
 * - $HOME -> home directory
 * - $XDG_CONFIG_HOME -> XDG config home
 * - %APPDATA% -> APPDATA on Windows
 * - %USERPROFILE% -> home directory on Windows
 *
 * @param inputPath - Path with variables to expand
 * @returns Expanded absolute path
 */
export function expandPath(inputPath: string): string {
  let result = inputPath;
  const home = getHomeDir();

  // Unix-style expansions
  if (result.startsWith("~/")) {
    result = join(home, result.slice(2));
  } else if (result.startsWith("$HOME/")) {
    result = join(home, result.slice(6));
  } else if (result.startsWith("$XDG_CONFIG_HOME/")) {
    result = join(getXdgConfigHome(), result.slice(17));
  }

  // Windows-style expansions
  if (result.includes("%APPDATA%")) {
    result = result.replace(/%APPDATA%/g, getAppData());
  }
  if (result.includes("%USERPROFILE%")) {
    result = result.replace(/%USERPROFILE%/g, home);
  }

  return result;
}

/**
 * Joins paths safely, handling empty segments.
 *
 * @param segments - Path segments to join
 * @returns Joined path
 */
export function safePath(...segments: string[]): string {
  const filtered = segments.filter(Boolean);
  return filtered.length > 0 ? join(...filtered) : "";
}
