/**
 * Config writer registry and factory.
 *
 * @module install/writers
 */

import type { ToolId } from "../../import/types.js";
import type { BaseConfigWriter } from "./base.js";
import { CodexWriter } from "./codex.js";
import {
  STANDARD_MCPSERVERS_TOOLS,
  StandardMcpServersWriter,
} from "./standard.js";
import { VSCodeWriter } from "./vscode.js";
import { ZedWriter } from "./zed.js";

export { BaseConfigWriter } from "./base.js";
export { CodexWriter } from "./codex.js";
export {
  StandardMcpServersWriter,
  STANDARD_MCPSERVERS_TOOLS,
} from "./standard.js";
export { VSCodeWriter } from "./vscode.js";
export { ZedWriter } from "./zed.js";

/**
 * Gets the appropriate config writer for a tool.
 *
 * @param toolId - Tool ID to get writer for
 * @returns Config writer instance
 */
export function getWriter(toolId: ToolId): BaseConfigWriter {
  // VS Code uses "servers" key
  if (toolId === "vscode") {
    return new VSCodeWriter();
  }

  // Zed uses "context_servers" key
  if (toolId === "zed") {
    return new ZedWriter();
  }

  // Codex uses TOML format with "mcp_servers" key
  if (toolId === "codex") {
    return new CodexWriter();
  }

  // Most tools use standard "mcpServers" key
  if (STANDARD_MCPSERVERS_TOOLS.includes(toolId)) {
    return new StandardMcpServersWriter(toolId);
  }

  // Default to standard format for unknown tools
  return new StandardMcpServersWriter(toolId);
}

/**
 * Gets the display name for a tool.
 *
 * @param toolId - Tool ID
 * @returns Human-readable display name
 */
export function getToolDisplayName(toolId: ToolId): string {
  const names: Record<ToolId, string> = {
    "claude-code": "Claude Code",
    "claude-desktop": "Claude Desktop",
    cursor: "Cursor",
    windsurf: "Windsurf",
    vscode: "VS Code",
    cline: "Cline",
    "roo-code": "Roo Code",
    "kilo-code": "Kilo Code",
    "gemini-cli": "Gemini CLI",
    zed: "Zed",
    jetbrains: "JetBrains",
    factory: "Factory.ai",
    opencode: "OpenCode",
    "qwen-code": "Qwen Code",
    trae: "Trae",
    antigravity: "Antigravity",
    warp: "Warp",
    codex: "Codex CLI",
  };

  return names[toolId] ?? toolId;
}
