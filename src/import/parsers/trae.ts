/**
 * Parser for Trae IDE MCP configurations.
 *
 * Trae stores MCP configs in:
 * - User: ~/Library/Application Support/Trae/User/mcp.json (macOS)
 * - Project: .trae/mcp.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...] } } }
 *
 * @module import/parsers/trae
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Trae IDE configuration files.
 */
export class TraeParser extends StandardMcpServersParser {
  readonly toolId = "trae" as const;
  readonly displayName = "Trae IDE";
}
