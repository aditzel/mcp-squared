/**
 * Parser registry for MCP configuration files.
 *
 * Provides access to all tool-specific parsers and auto-detection
 * capabilities for unknown config formats.
 *
 * @module import/parsers
 */

import type { ToolId } from "../types.js";
import type { BaseConfigParser } from "./base.js";

import { AntigravityParser } from "./antigravity.js";
// Standard format parsers (mcpServers key)
import { ClaudeCodeParser } from "./claude-code.js";
import { ClaudeDesktopParser } from "./claude-desktop.js";
import { ClineParser } from "./cline.js";
import { CursorParser } from "./cursor.js";
import { FactoryParser } from "./factory.js";
import { GeminiCliParser } from "./gemini-cli.js";
import { JetBrainsParser } from "./jetbrains.js";
import { KiloCodeParser } from "./kilo-code.js";
import { QwenCodeParser } from "./qwen-code.js";
import { RooCodeParser } from "./roo-code.js";
import { TraeParser } from "./trae.js";
import { WarpParser } from "./warp.js";
import { WindsurfParser } from "./windsurf.js";

import { CodexParser } from "./codex.js";
import { OpenCodeParser } from "./opencode.js";
// Custom format parsers
import { VSCodeParser } from "./vscode.js";
import { ZedParser } from "./zed.js";

// Re-export base class and types
export { BaseConfigParser, StandardMcpServersParser } from "./base.js";

// Re-export all parsers for direct access
export { ClaudeCodeParser } from "./claude-code.js";
export { ClaudeDesktopParser } from "./claude-desktop.js";
export { CursorParser } from "./cursor.js";
export { WindsurfParser } from "./windsurf.js";
export { ClineParser } from "./cline.js";
export { RooCodeParser } from "./roo-code.js";
export { KiloCodeParser } from "./kilo-code.js";
export { GeminiCliParser } from "./gemini-cli.js";
export { FactoryParser } from "./factory.js";
export { QwenCodeParser } from "./qwen-code.js";
export { TraeParser } from "./trae.js";
export { AntigravityParser } from "./antigravity.js";
export { JetBrainsParser } from "./jetbrains.js";
export { VSCodeParser } from "./vscode.js";
export { ZedParser } from "./zed.js";
export { OpenCodeParser } from "./opencode.js";
export { WarpParser } from "./warp.js";
export { CodexParser } from "./codex.js";

/**
 * Singleton instances of all parsers, indexed by tool ID.
 */
const parserRegistry: Map<ToolId, BaseConfigParser> = new Map();

/**
 * Initialize the parser registry with all available parsers.
 */
function initializeRegistry(): void {
  if (parserRegistry.size > 0) {
    return; // Already initialized
  }

  const parsers: BaseConfigParser[] = [
    // Standard format (mcpServers)
    new ClaudeCodeParser(),
    new ClaudeDesktopParser(),
    new CursorParser(),
    new WindsurfParser(),
    new ClineParser(),
    new RooCodeParser(),
    new KiloCodeParser(),
    new GeminiCliParser(),
    new FactoryParser(),
    new QwenCodeParser(),
    new TraeParser(),
    new AntigravityParser(),
    new JetBrainsParser(),
    new WarpParser(),
    // Custom formats
    new VSCodeParser(),
    new ZedParser(),
    new OpenCodeParser(),
    new CodexParser(),
  ];

  for (const parser of parsers) {
    parserRegistry.set(parser.toolId, parser);
  }
}

// Initialize on module load
initializeRegistry();

/**
 * Gets a parser for the specified tool.
 *
 * @param toolId - The tool identifier
 * @returns The parser instance, or undefined if not found
 */
export function getParser(toolId: ToolId): BaseConfigParser | undefined {
  return parserRegistry.get(toolId);
}

/**
 * Gets all registered parsers.
 *
 * @returns Array of all parser instances
 */
export function getAllParsers(): BaseConfigParser[] {
  return Array.from(parserRegistry.values());
}

/**
 * Gets all registered tool IDs.
 *
 * @returns Array of all tool identifiers
 */
export function getRegisteredToolIds(): ToolId[] {
  return Array.from(parserRegistry.keys());
}

/**
 * Detects which parser can handle the given content.
 *
 * Used for auto-detection when the source tool is unknown.
 * Checks custom format parsers first (more specific), then
 * falls back to standard format parsers.
 *
 * @param content - Parsed JSON content
 * @returns The matching parser, or undefined if none match
 */
export function detectParser(content: unknown): BaseConfigParser | undefined {
  // Check custom formats first (more specific keys)
  const customParsers: ToolId[] = ["vscode", "zed", "opencode", "codex"];
  for (const toolId of customParsers) {
    const parser = parserRegistry.get(toolId);
    if (parser?.canParse(content)) {
      return parser;
    }
  }

  // Fall back to standard format parsers
  // Return first one that can parse (they all use mcpServers key)
  for (const [toolId, parser] of parserRegistry) {
    if (!customParsers.includes(toolId) && parser.canParse(content)) {
      return parser;
    }
  }

  return undefined;
}

/**
 * Checks if a tool ID is valid/registered.
 *
 * @param toolId - The tool identifier to check
 * @returns true if the tool is registered
 */
export function isValidToolId(toolId: string): toolId is ToolId {
  return parserRegistry.has(toolId as ToolId);
}
