/**
 * Parser for JetBrains IDEs MCP configurations.
 *
 * JetBrains primarily uses UI-based configuration, but Junie
 * uses mcp.json files:
 * - Project: .idea/mcp.json or mcp.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...] } } }
 *
 * @module import/parsers/jetbrains
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for JetBrains IDE configuration files.
 */
export class JetBrainsParser extends StandardMcpServersParser {
  readonly toolId = "jetbrains" as const;
  readonly displayName = "JetBrains";
}
