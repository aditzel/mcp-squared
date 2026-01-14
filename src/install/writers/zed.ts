/**
 * Zed editor config writer.
 *
 * Zed uses "context_servers" for its MCP configuration,
 * and the config is nested in the overall settings.json.
 *
 * @module install/writers/zed
 */

import type { ToolId } from "../../import/types.js";
import type { InstallMode, McpServerEntry } from "../types.js";
import { BaseConfigWriter } from "./base.js";

/**
 * Config writer for Zed (uses "context_servers" key).
 *
 * Zed's settings.json has a different structure where context_servers
 * is a top-level key in the general settings file.
 */
export class ZedWriter extends BaseConfigWriter {
  readonly toolId: ToolId = "zed";
  readonly configKey = "context_servers";

  /**
   * Creates an empty config structure for Zed.
   * Note: Zed's settings.json may have other settings, so we just
   * add the context_servers section.
   */
  override createEmptyConfig(): Record<string, unknown> {
    return { [this.configKey]: {} };
  }

  /**
   * Writes an MCP server entry to Zed's config.
   *
   * Zed's format is slightly different - it nests settings under the server name.
   *
   * @param existingConfig - Current config content, or null if creating new
   * @param entry - MCP server entry to add
   * @param serverName - Name for the server entry
   * @param mode - Install mode (replace all or add alongside)
   * @returns Updated config object
   */
  override write(
    existingConfig: Record<string, unknown> | null,
    entry: McpServerEntry,
    serverName: string,
    mode: InstallMode,
  ): Record<string, unknown> {
    // Preserve other Zed settings if they exist
    const config = existingConfig ?? {};

    // Get existing context_servers section or create empty
    const servers = (config[this.configKey] as Record<string, unknown>) ?? {};

    // Zed format wraps the server config in a "settings" key
    const zedEntry = {
      command: entry.command,
      args: entry.args,
      env: entry.env,
    };

    if (mode === "replace") {
      // Replace all context servers with just the new entry
      config[this.configKey] = { [serverName]: zedEntry };
    } else {
      // Add alongside existing servers
      servers[serverName] = zedEntry;
      config[this.configKey] = servers;
    }

    return config;
  }
}
