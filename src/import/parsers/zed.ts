/**
 * Parser for Zed editor MCP configurations.
 *
 * Zed stores MCP configs in:
 * - User: ~/.config/zed/settings.json
 * - Project: .zed/settings.json
 *
 * Format: { "context_servers": { "name": { "command": ..., "args": [...], "env": {...} } } }
 * Note: Zed uses "context_servers" instead of "mcpServers"
 *
 * @module import/parsers/zed
 */

import type { ParseResult } from "../types.js";
import { BaseConfigParser } from "./base.js";

/**
 * Parser for Zed editor configuration files.
 * Zed uses "context_servers" key instead of "mcpServers".
 */
export class ZedParser extends BaseConfigParser {
  readonly toolId = "zed" as const;
  readonly displayName = "Zed";
  readonly configKey = "context_servers";

  canParse(content: unknown): boolean {
    if (typeof content !== "object" || content === null) {
      return false;
    }
    return "context_servers" in content;
  }

  parse(content: unknown, filePath: string): ParseResult {
    const servers = this.getServersSection(content);
    if (!servers) {
      return this.emptyResult();
    }

    const result: ParseResult = { servers: [], warnings: [] };

    for (const [name, config] of Object.entries(servers)) {
      const server = this.parseServerEntry(name, config);
      if (server) {
        result.servers.push(server);
      } else {
        result.warnings.push(`Skipped invalid server "${name}" in ${filePath}`);
      }
    }

    return result;
  }
}
