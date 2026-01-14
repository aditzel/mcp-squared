/**
 * Tool registry with MCP configuration file paths.
 *
 * This module defines the well-known configuration file locations
 * for all supported agentic coding tools across platforms.
 *
 * @module import/discovery/registry
 */

import { join } from "node:path";
import type { ToolId, ToolPaths } from "../types.js";
import {
  getAppData,
  getHomeDir,
  getMacApplicationSupport,
  getPlatform,
  getVSCodeExtensionGlobalStorage,
  getVSCodeUserDataDir,
  getXdgConfigHome,
} from "./paths.js";

/**
 * Registry of all supported tools and their config paths.
 */
export function getToolPaths(toolId: ToolId): ToolPaths {
  const home = getHomeDir();
  const os = getPlatform();

  switch (toolId) {
    // ============================================
    // CLI Tools
    // ============================================

    case "claude-code":
      return {
        user: [join(home, ".claude.json")],
        project: [".mcp.json"],
      };

    case "gemini-cli":
      return {
        user: [join(home, ".gemini", "settings.json")],
        project: [".gemini/settings.json"],
      };

    case "opencode":
      return {
        user: [join(getXdgConfigHome(), "opencode", "opencode.json")],
        project: ["opencode.json"],
        envVar: "OPENCODE_CONFIG",
      };

    case "qwen-code":
      return {
        user: [join(home, ".qwen", "settings.json")],
        project: [".qwen/settings.json"],
      };

    // ============================================
    // Desktop Apps
    // ============================================

    case "claude-desktop":
      return {
        user: getClaudeDesktopPaths(os),
        project: [],
      };

    // ============================================
    // IDEs (VS Code Family)
    // ============================================

    case "vscode":
      return {
        user: [join(getVSCodeUserDataDir(), "mcp.json")],
        project: [".vscode/mcp.json"],
      };

    case "cursor":
      return {
        user: [join(home, ".cursor", "mcp.json")],
        project: [".cursor/mcp.json"],
      };

    case "windsurf":
      return {
        user: [join(home, ".codeium", "windsurf", "mcp_config.json")],
        project: [],
      };

    case "trae":
      return {
        user: getTraePaths(os),
        project: [".trae/mcp.json"],
      };

    // ============================================
    // VS Code Extensions
    // ============================================

    case "cline":
      return {
        user: [
          join(
            getVSCodeExtensionGlobalStorage("saoudrizwan.claude-dev"),
            "settings",
            "cline_mcp_settings.json",
          ),
        ],
        project: [],
      };

    case "roo-code":
      return {
        user: [
          join(
            getVSCodeExtensionGlobalStorage("rooveterinaryinc.roo-cline"),
            "settings",
            "cline_mcp_settings.json",
          ),
        ],
        project: [".roo/mcp.json"],
      };

    case "kilo-code":
      return {
        user: [
          join(
            getVSCodeExtensionGlobalStorage("kilocode.kilo-code"),
            "settings",
            "mcp_settings.json",
          ),
          // CLI config location
          join(
            home,
            ".kilocode",
            "cli",
            "global",
            "settings",
            "mcp_settings.json",
          ),
        ],
        project: [".kilocode/mcp.json"],
      };

    // ============================================
    // Other Editors
    // ============================================

    case "zed":
      return {
        user: [join(getXdgConfigHome(), "zed", "settings.json")],
        project: [".zed/settings.json"],
      };

    case "jetbrains":
      // JetBrains primarily uses UI-based config, but Junie uses mcp.json
      return {
        user: [], // No standard user-level file
        project: [".idea/mcp.json", "mcp.json"],
      };

    case "factory":
      return {
        user: [join(home, ".factory", "mcp.json")],
        project: [".factory/mcp.json"],
        envVar: "DROID_MCP_CONFIG_PATH",
      };

    case "antigravity":
      // Antigravity uses similar paths to Windsurf (Codeium-based)
      return {
        user: [join(home, ".codeium", "antigravity", "mcp_config.json")],
        project: [],
      };

    case "warp":
      // Warp stores MCP configs in Warp Drive (cloud), not local files
      // Users can still import via --path if they export their config
      return { user: [], project: [] };

    case "codex":
      return {
        user: [join(getCodexHome(), "config.toml")],
        project: [".codex/config.toml"],
        envVar: "CODEX_HOME",
      };

    default:
      return { user: [], project: [] };
  }
}

/**
 * Gets the Codex home directory, respecting CODEX_HOME env var.
 */
function getCodexHome(): string {
  return process.env["CODEX_HOME"] || join(getHomeDir(), ".codex");
}

/**
 * Gets Claude Desktop config paths for the current platform.
 */
function getClaudeDesktopPaths(os: NodeJS.Platform): string[] {
  switch (os) {
    case "darwin":
      return [
        join(
          getMacApplicationSupport(),
          "Claude",
          "claude_desktop_config.json",
        ),
      ];
    case "win32":
      return [join(getAppData(), "Claude", "claude_desktop_config.json")];
    default:
      return [join(getXdgConfigHome(), "Claude", "claude_desktop_config.json")];
  }
}

/**
 * Gets Trae IDE config paths for the current platform.
 */
function getTraePaths(os: NodeJS.Platform): string[] {
  switch (os) {
    case "darwin":
      return [join(getMacApplicationSupport(), "Trae", "User", "mcp.json")];
    case "win32":
      return [join(getAppData(), "Trae", "User", "mcp.json")];
    default:
      return [join(getXdgConfigHome(), "Trae", "User", "mcp.json")];
  }
}

/**
 * List of all supported tool IDs.
 */
export const ALL_TOOL_IDS: ToolId[] = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "windsurf",
  "vscode",
  "cline",
  "roo-code",
  "kilo-code",
  "gemini-cli",
  "zed",
  "jetbrains",
  "factory",
  "opencode",
  "qwen-code",
  "trae",
  "antigravity",
  "warp",
  "codex",
];

/**
 * Checks if a tool ID is valid.
 */
export function isValidToolId(id: string): id is ToolId {
  return ALL_TOOL_IDS.includes(id as ToolId);
}
