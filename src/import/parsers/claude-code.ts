/**
 * Parser for Claude Code MCP configurations.
 *
 * Claude Code stores MCP configs in:
 * - User: ~/.claude.json
 * - Project: .mcp.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...], "env": {...} } } }
 *
 * @module import/parsers/claude-code
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Claude Code configuration files.
 */
export class ClaudeCodeParser extends StandardMcpServersParser {
  readonly toolId = "claude-code" as const;
  readonly displayName = "Claude Code";
}
