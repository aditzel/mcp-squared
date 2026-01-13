/**
 * Parser for Qwen Code MCP configurations.
 *
 * Qwen Code stores MCP configs in:
 * - User: ~/.qwen/settings.json
 * - Project: .qwen/settings.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...] } } }
 *
 * @module import/parsers/qwen-code
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Qwen Code configuration files.
 */
export class QwenCodeParser extends StandardMcpServersParser {
  readonly toolId = "qwen-code" as const;
  readonly displayName = "Qwen Code";
}
