/**
 * Parser for Roo Code VS Code extension MCP configurations.
 *
 * Roo Code stores MCP configs in:
 * - User: VS Code globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json
 * - Project: .roo/mcp.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...], "env": {...} } } }
 *
 * @module import/parsers/roo-code
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Roo Code extension configuration files.
 */
export class RooCodeParser extends StandardMcpServersParser {
  readonly toolId = "roo-code" as const;
  readonly displayName = "Roo Code";
}
