/**
 * Config writer for OpenAI Codex CLI.
 *
 * Codex uses TOML format with "mcp_servers" key.
 * This writer produces a config structure compatible with Codex CLI.
 *
 * @module install/writers/codex
 */

import type { ToolId } from "../../import/types.js";
import type { InstallMode, McpServerEntry } from "../types.js";
import { BaseConfigWriter } from "./base.js";

/**
 * Config writer for OpenAI Codex CLI.
 * Uses "mcp_servers" key (underscore, not camelCase).
 */
export class CodexWriter extends BaseConfigWriter {
  readonly toolId: ToolId = "codex";
  readonly configKey = "mcp_servers";

  /**
   * Writes an MCP server entry to the Codex config.
   * Preserves other Codex config sections (non-MCP settings).
   */
  override write(
    existingConfig: Record<string, unknown> | null,
    entry: McpServerEntry,
    serverName: string,
    mode: InstallMode,
  ): Record<string, unknown> {
    // Start with existing config or create empty
    const config = existingConfig ?? {};

    // Get existing servers section or create empty
    const servers = (config[this.configKey] as Record<string, unknown>) ?? {};

    // Convert McpServerEntry to Codex format
    const codexEntry: Record<string, unknown> = {
      command: entry.command,
    };

    // Only include args if present and non-empty
    if (entry.args && entry.args.length > 0) {
      codexEntry["args"] = entry.args;
    }

    // Only include env if present and non-empty
    if (entry.env && Object.keys(entry.env).length > 0) {
      codexEntry["env"] = entry.env;
    }

    if (mode === "replace") {
      // Replace all servers with just the new entry
      config[this.configKey] = { [serverName]: codexEntry };
    } else {
      // Add alongside existing servers
      servers[serverName] = codexEntry;
      config[this.configKey] = servers;
    }

    return config;
  }
}
