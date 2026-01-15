/**
 * Parser for Claude Desktop MCP configurations.
 *
 * Claude Desktop stores MCP configs in:
 * - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
 * - Windows: %APPDATA%/Claude/claude_desktop_config.json
 * - Linux: ~/.config/Claude/claude_desktop_config.json
 *
 * Format: { "mcpServers": { "name": { "command": ..., "args": [...], "env": {...} } } }
 *
 * @module import/parsers/claude-desktop
 */

import { StandardMcpServersParser } from "./base.js";

/**
 * Parser for Claude Desktop configuration files.
 */
export class ClaudeDesktopParser extends StandardMcpServersParser {
  readonly toolId = "claude-desktop" as const;
  readonly displayName = "Claude Desktop";
}
