/**
 * Parser for Google Antigravity MCP configurations.
 *
 * Antigravity stores MCP configs in:
 * - User: ~/.codeium/antigravity/mcp_config.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...] } } }
 *
 * @module import/parsers/antigravity
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Antigravity configuration files.
 */
export class AntigravityParser extends StandardMcpServersParser {
  readonly toolId = "antigravity" as const;
  readonly displayName = "Antigravity";
}
