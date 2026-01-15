/**
 * Base config writer class for the install command.
 *
 * Provides the common interface and default implementation
 * for writing MCP server entries to config files.
 *
 * @module install/writers/base
 */

import type { ToolId } from "../../import/types.js";
import type { InstallMode, McpServerEntry } from "../types.js";

/**
 * Abstract base class for config writers.
 *
 * Each tool may have a different JSON structure for storing MCP servers.
 * Subclasses implement tool-specific config key handling.
 */
export abstract class BaseConfigWriter {
  /** Tool ID this writer handles */
  abstract readonly toolId: ToolId;

  /** JSON key where servers are stored (e.g., "mcpServers", "servers") */
  abstract readonly configKey: string;

  /**
   * Creates an empty config structure for this tool.
   * Used when the config file doesn't exist.
   */
  createEmptyConfig(): Record<string, unknown> {
    return { [this.configKey]: {} };
  }

  /**
   * Writes an MCP server entry to the config.
   *
   * @param existingConfig - Current config content, or null if creating new
   * @param entry - MCP server entry to add
   * @param serverName - Name for the server entry
   * @param mode - Install mode (replace all or add alongside)
   * @returns Updated config object
   */
  write(
    existingConfig: Record<string, unknown> | null,
    entry: McpServerEntry,
    serverName: string,
    mode: InstallMode,
  ): Record<string, unknown> {
    const config = existingConfig ?? this.createEmptyConfig();

    // Get existing servers section or create empty
    const servers = (config[this.configKey] as Record<string, unknown>) ?? {};

    if (mode === "replace") {
      // Replace all servers with just the new entry
      config[this.configKey] = { [serverName]: entry };
    } else {
      // Add alongside existing servers
      servers[serverName] = entry;
      config[this.configKey] = servers;
    }

    return config;
  }

  /**
   * Checks if an existing config already has the server configured.
   *
   * @param config - Existing config content
   * @param serverName - Server name to check for
   * @returns True if server already exists
   */
  hasServer(
    config: Record<string, unknown> | null,
    serverName: string,
  ): boolean {
    if (!config) return false;
    const servers = config[this.configKey] as
      | Record<string, unknown>
      | undefined;
    return servers !== undefined && serverName in servers;
  }

  /**
   * Gets the current server entry if it exists.
   *
   * @param config - Existing config content
   * @param serverName - Server name to get
   * @returns Server entry or undefined
   */
  getServer(
    config: Record<string, unknown> | null,
    serverName: string,
  ): McpServerEntry | undefined {
    if (!config) return undefined;
    const servers = config[this.configKey] as
      | Record<string, unknown>
      | undefined;
    return servers?.[serverName] as McpServerEntry | undefined;
  }
}
