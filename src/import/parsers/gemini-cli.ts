/**
 * Parser for Gemini CLI MCP configurations.
 *
 * Gemini CLI stores MCP configs in:
 * - User: ~/.gemini/settings.json
 * - Project: .gemini/settings.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...], "httpUrl": "..." } } }
 *
 * @module import/parsers/gemini-cli
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Gemini CLI configuration files.
 */
export class GeminiCliParser extends StandardMcpServersParser {
  readonly toolId = "gemini-cli" as const;
  readonly displayName = "Gemini CLI";
}
