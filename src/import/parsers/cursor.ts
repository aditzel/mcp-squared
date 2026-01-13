/**
 * Parser for Cursor IDE MCP configurations.
 *
 * Cursor stores MCP configs in:
 * - User: ~/.cursor/mcp.json
 * - Project: .cursor/mcp.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...], "env": {...} } } }
 *
 * @module import/parsers/cursor
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Cursor IDE configuration files.
 */
export class CursorParser extends StandardMcpServersParser {
  readonly toolId = "cursor" as const;
  readonly displayName = "Cursor";
}
