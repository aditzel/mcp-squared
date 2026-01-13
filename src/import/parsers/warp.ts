/**
 * Parser for Warp terminal MCP configurations.
 *
 * NOTE: Warp stores MCP configurations in Warp Drive (cloud), not locally.
 * This parser is provided for manual imports via --path if users export
 * their configuration from Warp.
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...] } } }
 *
 * @module import/parsers/warp
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Warp configuration files.
 */
export class WarpParser extends StandardMcpServersParser {
  readonly toolId = "warp" as const;
  readonly displayName = "Warp";
}
