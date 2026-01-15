/**
 * Parser for Cline VS Code extension MCP configurations.
 *
 * Cline stores MCP configs in VS Code globalStorage:
 * - globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...], "env": {...}, "alwaysAllow": [...] } } }
 *
 * @module import/parsers/cline
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Cline extension configuration files.
 */
export class ClineParser extends StandardMcpServersParser {
  readonly toolId = "cline" as const;
  readonly displayName = "Cline";
}
