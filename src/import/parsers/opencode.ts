/**
 * Parser for OpenCode MCP configurations.
 *
 * OpenCode stores MCP configs in:
 * - User: ~/.config/opencode/opencode.json
 * - Project: opencode.json
 * - Env var: OPENCODE_CONFIG
 *
 * Format: { "mcp": { "name": { "command": ..., "args": [...] } } }
 * Note: OpenCode uses "mcp" instead of "mcpServers"
 *
 * @module import/parsers/opencode
 */

import type { ParseResult } from "../types.js";
import { BaseConfigParser } from "./base.js";

/**
 * Parser for OpenCode configuration files.
 * OpenCode uses "mcp" key instead of "mcpServers".
 */
export class OpenCodeParser extends BaseConfigParser {
  readonly toolId = "opencode" as const;
  readonly displayName = "OpenCode";
  readonly configKey = "mcp";

  canParse(content: unknown): boolean {
    if (typeof content !== "object" || content === null) {
      return false;
    }
    return "mcp" in content;
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
