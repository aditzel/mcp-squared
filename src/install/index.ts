/**
 * Install module exports.
 *
 * This module provides the functionality to install MCP² as an MCP server
 * in other MCP client tools like Claude Desktop, Cursor, VS Code, etc.
 *
 * @module install
 */

export {
  discoverAvailableTools,
  performInstallation,
  runInstall,
} from "./runner.js";

export { createBackup, createBackupAsync } from "./backup.js";

export {
  type DiscoveredTool,
  type InstallArgs,
  type InstallMode,
  type InstallOptions,
  type InstallResult,
  type InstallScope,
  type McpServerEntry,
  type ToolInstallResult,
  isValidInstallMode,
  isValidInstallScope,
} from "./types.js";

export {
  BaseConfigWriter,
  getToolDisplayName,
  getWriter,
  StandardMcpServersWriter,
  VSCodeWriter,
  ZedWriter,
} from "./writers/index.js";
