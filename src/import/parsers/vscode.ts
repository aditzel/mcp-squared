/**
 * Parser for VS Code (Copilot) MCP configurations.
 *
 * VS Code stores MCP configs in:
 * - User: ~/Library/Application Support/Code/User/mcp.json (macOS)
 * - Project: .vscode/mcp.json
 *
 * Format: { "servers": { "name": { "command": ..., "args": [...] } } }
 * Note: VS Code uses "servers" instead of "mcpServers"
 *
 * @module import/parsers/vscode
 */

import type { ParseResult } from "../types.js";
import { BaseConfigParser } from "./base.js";

/**
 * Parser for VS Code configuration files.
 * VS Code uses a slightly different format with "servers" key.
 */
export class VSCodeParser extends BaseConfigParser {
  readonly toolId = "vscode" as const;
  readonly displayName = "VS Code";
  readonly configKey = "servers";

  canParse(content: unknown): boolean {
    if (typeof content !== "object" || content === null) {
      return false;
    }
    // VS Code uses "servers" key
    return "servers" in content;
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
