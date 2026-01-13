/**
 * Parser for Windsurf IDE MCP configurations.
 *
 * Windsurf stores MCP configs in:
 * - User: ~/.codeium/windsurf/mcp_config.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...], "env": {...} } } }
 *
 * @module import/parsers/windsurf
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Windsurf IDE configuration files.
 */
export class WindsurfParser extends StandardMcpServersParser {
  readonly toolId = "windsurf" as const;
  readonly displayName = "Windsurf";
}
