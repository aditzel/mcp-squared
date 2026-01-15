/**
 * Standard MCP servers config writer.
 *
 * Handles tools that use the standard "mcpServers" key:
 * - Claude Code
 * - Claude Desktop
 * - Cursor
 * - Windsurf
 * - Cline
 * - Roo Code
 * - Kilo Code
 * - Gemini CLI
 * - Factory
 * - Qwen Code
 * - Trae
 * - Antigravity
 * - JetBrains
 * - OpenCode
 *
 * @module install/writers/standard
 */

import type { ToolId } from "../../import/types.js";
import { BaseConfigWriter } from "./base.js";

/**
 * Config writer for tools using the standard "mcpServers" key.
 */
export class StandardMcpServersWriter extends BaseConfigWriter {
  readonly toolId: ToolId;
  readonly configKey = "mcpServers";

  constructor(toolId: ToolId) {
    super();
    this.toolId = toolId;
  }
}

/**
 * List of tool IDs that use the standard mcpServers format.
 */
export const STANDARD_MCPSERVERS_TOOLS: ToolId[] = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "windsurf",
  "cline",
  "roo-code",
  "kilo-code",
  "gemini-cli",
  "factory",
  "qwen-code",
  "trae",
  "antigravity",
  "jetbrains",
  "opencode",
  "warp",
];
