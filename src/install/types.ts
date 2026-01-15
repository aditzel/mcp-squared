/**
 * Type definitions for the install command.
 *
 * The install command configures MCP² as an MCP server in other MCP client tools.
 *
 * @module install/types
 */

import type { ToolId } from "../import/types.js";

/**
 * Installation mode: replace all servers or add alongside existing.
 */
export type InstallMode = "replace" | "add";

/**
 * Installation scope: user-level or project-level configuration.
 */
export type InstallScope = "user" | "project";

/**
 * Install-specific command-line arguments.
 */
export interface InstallArgs {
  /** Target tool to install to (skip selection prompt) */
  tool?: ToolId;
  /** Scope preference: user or project */
  scope?: InstallScope;
  /** Install mode: replace all or add alongside */
  mode?: InstallMode;
  /** Enable interactive prompts (default: true) */
  interactive: boolean;
  /** Preview changes without writing */
  dryRun: boolean;
  /** Server name to use for mcp-squared entry (default: "mcp-squared") */
  serverName: string;
  /** Command to run (default: "mcp-squared") */
  command: string;
}

/**
 * MCP server entry to write to target config.
 */
export interface McpServerEntry {
  /** Command to execute */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Result of installing to a single tool.
 */
export interface ToolInstallResult {
  /** Tool that was configured */
  tool: ToolId;
  /** Path to the config file */
  path: string;
  /** Scope that was configured */
  scope: InstallScope;
  /** Whether installation succeeded */
  success: boolean;
  /** Path to backup file if created */
  backupPath?: string | undefined;
  /** True if config file was newly created */
  created: boolean;
  /** Error message if installation failed */
  error?: string | undefined;
}

/**
 * Overall install result.
 */
export interface InstallResult {
  /** Whether all installations succeeded */
  success: boolean;
  /** Individual results per tool */
  results: ToolInstallResult[];
  /** Error messages */
  errors: string[];
}

/**
 * Options for performing an installation.
 */
export interface InstallOptions {
  /** Tool to install to */
  tool: ToolId;
  /** Target config file path */
  path: string;
  /** Scope being configured */
  scope: InstallScope;
  /** Install mode */
  mode: InstallMode;
  /** Server name for the entry */
  serverName: string;
  /** Command to run */
  command: string;
  /** Dry run mode */
  dryRun: boolean;
}

/**
 * Information about a discovered tool that can be configured.
 */
export interface DiscoveredTool {
  /** Tool identifier */
  tool: ToolId;
  /** Display name for the tool */
  displayName: string;
  /** Available scopes for this tool */
  scopes: InstallScope[];
  /** Paths for each scope */
  paths: {
    user?: string | undefined;
    project?: string | undefined;
  };
}

/**
 * Checks if a string is a valid install mode.
 */
export function isValidInstallMode(value: string): value is InstallMode {
  return value === "replace" || value === "add";
}

/**
 * Checks if a string is a valid install scope.
 */
export function isValidInstallScope(value: string): value is InstallScope {
  return value === "user" || value === "project";
}
