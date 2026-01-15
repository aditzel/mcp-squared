/**
 * Type definitions for the MCP configuration import feature.
 *
 * This module defines types for discovering, parsing, transforming, and merging
 * MCP server configurations from external tools into MCP² format.
 *
 * @module import/types
 */

/**
 * Supported tool identifiers for MCP config import.
 * Each tool has specific config file locations and JSON formats.
 */
export type ToolId =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "windsurf"
  | "vscode"
  | "cline"
  | "roo-code"
  | "kilo-code"
  | "gemini-cli"
  | "zed"
  | "jetbrains"
  | "factory"
  | "opencode"
  | "qwen-code"
  | "trae"
  | "antigravity"
  | "warp"
  | "codex";

/**
 * Display names for tools (used in CLI output).
 */
export const TOOL_DISPLAY_NAMES: Record<ToolId, string> = {
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
  factory: "Factory.ai Droids",
  opencode: "OpenCode",
  "qwen-code": "Qwen Code",
  trae: "Trae IDE",
  antigravity: "Antigravity",
  warp: "Warp",
  codex: "Codex CLI",
};

/**
 * Scope of configuration discovery.
 * - user: User-level configs (e.g., ~/.claude.json)
 * - project: Project-level configs (e.g., .mcp.json)
 * - both: Search both scopes
 */
export type ImportScope = "user" | "project" | "both";

/**
 * Strategy for handling naming conflicts during import.
 * - skip: Keep existing, don't import conflicting servers
 * - replace: Overwrite existing with incoming
 * - rename: Auto-rename incoming (e.g., "github" -> "github-2")
 */
export type MergeStrategy = "skip" | "replace" | "rename";

/**
 * Discovered configuration source.
 * Represents a potential config file found during discovery.
 */
export interface DiscoveredConfig {
  /** Tool this config belongs to */
  tool: ToolId;
  /** Absolute path to the config file */
  path: string;
  /** Whether this is a user or project-level config */
  scope: "user" | "project";
  /** Whether the file exists */
  exists: boolean;
  /** Whether the file is readable */
  readable: boolean;
  /** Last modification time (if available) */
  lastModified?: Date;
  /** Number of servers found (populated after parsing) */
  serverCount?: number;
}

/**
 * Raw server configuration from an external tool's JSON.
 * This represents the common superset of fields across tools.
 */
export interface ExternalServer {
  /** Server name (key in mcpServers/servers object) */
  name: string;
  /** Command to execute (for stdio transport) */
  command?: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory (optional) */
  cwd?: string;
  /** URL for SSE/HTTP transport */
  url?: string;
  /** Alternative URL field (some tools use httpUrl) */
  httpUrl?: string;
  /** HTTP headers for SSE transport */
  headers?: Record<string, string>;
  /** OAuth authentication settings for SSE transport */
  auth?: boolean | { callbackPort?: number; clientName?: string };
  /** Whether the server is disabled */
  disabled?: boolean;
  /** Always-allowed tools (Cline/Roo-specific) */
  alwaysAllow?: string[];
}

/**
 * Parsed external configuration.
 * Result of parsing a tool's config file.
 */
export interface ParsedExternalConfig {
  /** Tool this config was parsed from */
  tool: ToolId;
  /** Path to the source file */
  path: string;
  /** Scope (user or project) */
  scope: "user" | "project";
  /** Parsed server configurations */
  servers: ExternalServer[];
  /** Raw JSON content (for debugging) */
  rawContent: unknown;
}

/**
 * Import conflict details.
 * Describes a naming collision between existing and incoming configs,
 * or between two incoming configs from different sources.
 */
export interface ImportConflict {
  /** Server name that conflicts */
  serverName: string;
  /** Existing server configuration (from MCP² config or first incoming) */
  existing: ExternalServer;
  /** Incoming server configuration (from import) */
  incoming: ExternalServer;
  /** Source tool of the incoming config */
  sourceTool: ToolId;
  /** Source path of the incoming config */
  sourcePath: string;
  /** Source tool of the 'existing' config (when it's from another incoming file) */
  existingSourceTool?: ToolId;
  /** Source path of the 'existing' config (when it's from another incoming file) */
  existingSourcePath?: string;
}

/**
 * User's resolution choice for a conflict.
 */
export interface ConflictResolution {
  /** Action to take */
  action: MergeStrategy;
  /** Apply this resolution to all remaining conflicts */
  applyToAll: boolean;
}

/**
 * Represents a change to be made during import.
 */
export interface ConfigChange {
  /** Type of change */
  type: "add" | "update" | "skip" | "rename";
  /** Server name in the target config */
  serverName: string;
  /** Original name (for renames) */
  originalName?: string;
  /** Source tool */
  sourceTool: ToolId;
  /** Source file path */
  sourcePath: string;
  /** Server configuration */
  server: ExternalServer;
}

/**
 * Import options passed from CLI.
 */
export interface ImportOptions {
  /** Import from a specific tool only */
  source?: ToolId;
  /** Explicit path to import from (overrides discovery) */
  path?: string;
  /** Scope to search (user, project, or both) */
  scope?: ImportScope;
  /** Conflict resolution strategy (for non-interactive mode) */
  strategy?: MergeStrategy;
  /** Enable interactive prompts for conflicts (default: true) */
  interactive?: boolean;
  /** Preview changes without writing */
  dryRun?: boolean;
  /** List discovered configs without importing */
  list?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Target path for merged config */
  targetPath?: string;
}

/**
 * Import operation result.
 */
export interface ImportResult {
  /** Whether the import completed successfully */
  success: boolean;
  /** Number of servers imported */
  imported: number;
  /** Number of servers skipped */
  skipped: number;
  /** Conflicts encountered */
  conflicts: ImportConflict[];
  /** All changes made or planned */
  changes: ConfigChange[];
  /** Errors encountered during import */
  errors: ImportError[];
  /** Path to the written config (if not dry-run) */
  configPath?: string;
}

/**
 * Base import error type.
 */
export interface ImportError {
  /** Error type identifier */
  type: "discovery" | "parse" | "validation" | "merge" | "write";
  /** Human-readable error message */
  message: string;
  /** Tool related to the error (if applicable) */
  tool?: ToolId;
  /** Path related to the error (if applicable) */
  path?: string;
  /** Original error (if wrapped) */
  cause?: unknown;
}

/**
 * Tool path configuration.
 * Defines where to find config files for each tool on each platform.
 */
export interface ToolPaths {
  /** User-level config paths to check */
  user: string[];
  /** Project-level config patterns (relative to project root) */
  project: string[];
  /** Optional environment variable override */
  envVar?: string;
}

/**
 * Parser result from parsing a single config file.
 */
export interface ParseResult {
  /** Successfully parsed servers */
  servers: ExternalServer[];
  /** Warnings encountered during parsing */
  warnings: string[];
}
