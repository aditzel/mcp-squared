/**
 * Parser for Factory.ai Droids MCP configurations.
 *
 * Factory stores MCP configs in:
 * - User: ~/.factory/mcp.json
 * - Project: .factory/mcp.json
 * - Env var: DROID_MCP_CONFIG_PATH
 *
 * Format: { "mcpServers": { "name": { "type": "stdio"|"http", "command": ..., "url": ... } } }
 *
 * @module import/parsers/factory
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Factory.ai Droids configuration files.
 */
export class FactoryParser extends StandardMcpServersParser {
  readonly toolId = "factory" as const;
  readonly displayName = "Factory.ai Droids";
}
