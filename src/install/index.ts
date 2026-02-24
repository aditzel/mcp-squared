/**
 * Install module exports.
 *
 * This module provides the functionality to install MCP² as an MCP server
 * in other MCP client tools like Claude Desktop, Cursor, VS Code, etc.
 *
 * @module install
 */

export { createBackup, createBackupAsync } from "./backup.js";
export {
  discoverAvailableTools,
  performInstallation,
  runInstall,
} from "./runner.js";

export {
  type DiscoveredTool,
  type InstallArgs,
  type InstallMode,
  type InstallOptions,
  type InstallResult,
  type InstallScope,
  isValidInstallMode,
  isValidInstallScope,
  type McpServerEntry,
  type ToolInstallResult,
} from "./types.js";

export {
  BaseConfigWriter,
  getToolDisplayName,
  getWriter,
  StandardMcpServersWriter,
  VSCodeWriter,
  ZedWriter,
} from "./writers/index.js";
