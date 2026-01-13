/**
 * Parser for Kilo Code VS Code extension MCP configurations.
 *
 * Kilo Code stores MCP configs in:
 * - User: VS Code globalStorage/kilocode.kilo-code/settings/mcp_settings.json
 * - CLI: ~/.kilocode/cli/global/settings/mcp_settings.json
 * - Project: .kilocode/mcp.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...], "env": {...} } } }
 *
 * @module import/parsers/kilo-code
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Kilo Code extension configuration files.
 */
export class KiloCodeParser extends StandardMcpServersParser {
  readonly toolId = "kilo-code" as const;
  readonly displayName = "Kilo Code";
}
