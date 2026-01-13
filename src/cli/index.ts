/**
 * Command-line interface argument parsing.
 *
 * This module handles parsing command-line arguments for the mcp-squared CLI.
 * Supports server mode (default), config TUI, connection testing, and import.
 *
 * @module cli
 */

import type { ImportScope, MergeStrategy, ToolId } from "../import/types.js";

/**
 * Parsed command-line arguments.
 */
export interface CliArgs {
  /** Operating mode: server, config TUI, test, or import */
  mode: "server" | "config" | "test" | "import";
  /** Whether --help was requested */
  help: boolean;
  /** Whether --version was requested */
  version: boolean;
  /** Target upstream server name for test mode (optional) */
  testTarget: string | undefined;
  /** Import-specific options */
  import: ImportArgs;
}

/**
 * Import-specific command-line arguments.
 */
export interface ImportArgs {
  /** Import from a specific tool only */
  source?: ToolId;
  /** Explicit path to import from */
  path?: string;
  /** Scope to search (user, project, or both) */
  scope: ImportScope;
  /** Conflict resolution strategy (for non-interactive mode) */
  strategy: MergeStrategy;
  /** Enable interactive prompts (default: true) */
  interactive: boolean;
  /** Preview changes without writing */
  dryRun: boolean;
  /** List discovered configs without importing */
  list: boolean;
  /** Verbose output */
  verbose: boolean;
}

/** Valid tool IDs for import source validation */
const VALID_TOOL_IDS: readonly string[] = [
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
];

/**
 * Checks if a string is a valid tool ID.
 */
function isValidToolId(value: string): value is ToolId {
  return VALID_TOOL_IDS.includes(value);
}

/**
 * Checks if a string is a valid import scope.
 */
function isValidScope(value: string): value is ImportScope {
  return value === "user" || value === "project" || value === "both";
}

/**
 * Checks if a string is a valid merge strategy.
 */
function isValidStrategy(value: string): value is MergeStrategy {
  return value === "skip" || value === "replace" || value === "rename";
}

/**
 * Parses command-line arguments into structured CliArgs.
 *
 * @param args - Array of command-line arguments (without node/script)
 * @returns Parsed CLI arguments
 *
 * @example
 * ```ts
 * const args = parseArgs(process.argv.slice(2));
 * if (args.mode === "config") {
 *   // Launch config TUI
 * }
 * ```
 */
export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    mode: "server",
    help: false,
    version: false,
    testTarget: undefined,
    import: {
      scope: "both",
      strategy: "skip",
      interactive: true,
      dryRun: false,
      list: false,
      verbose: false,
    },
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Get value for --flag=value format
    const eqIndex = arg?.indexOf("=") ?? -1;
    const argName = eqIndex > 0 ? arg?.slice(0, eqIndex) : arg;
    const argValue = eqIndex > 0 ? arg?.slice(eqIndex + 1) : undefined;

    switch (argName) {
      case "config":
      case "--config":
      case "-c":
        result.mode = "config";
        break;

      case "test":
      case "--test":
      case "-t": {
        result.mode = "test";
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          result.testTarget = nextArg;
          i++;
        }
        break;
      }

      case "import":
        result.mode = "import";
        break;

      case "--list":
        result.import.list = true;
        break;

      case "--dry-run":
        result.import.dryRun = true;
        break;

      case "--no-interactive":
        result.import.interactive = false;
        break;

      case "--verbose":
        result.import.verbose = true;
        break;

      case "--source": {
        const value = argValue ?? args[++i];
        if (value && isValidToolId(value)) {
          result.import.source = value;
        }
        break;
      }

      case "--path": {
        const value = argValue ?? args[++i];
        if (value) {
          result.import.path = value;
        }
        break;
      }

      case "--scope": {
        const value = argValue ?? args[++i];
        if (value && isValidScope(value)) {
          result.import.scope = value;
        }
        break;
      }

      case "--strategy": {
        const value = argValue ?? args[++i];
        if (value && isValidStrategy(value)) {
          result.import.strategy = value;
        }
        break;
      }

      case "--help":
      case "-h":
        result.help = true;
        break;

      case "--version":
      case "-v":
        result.version = true;
        break;
    }
  }

  return result;
}

/**
 * Prints the help message to stdout.
 * Shows available commands, options, and examples.
 */
export function printHelp(): void {
  console.log(`
MCP² (Mercury Control Plane) - Meta-server for Model Context Protocol

Usage:
  mcp-squared                   Start MCP server (stdio mode)
  mcp-squared config            Launch interactive configuration TUI
  mcp-squared test [upstream]   Test connection to upstream server(s)
  mcp-squared import [options]  Import MCP configs from other tools
  mcp-squared --help            Show this help message
  mcp-squared --version         Show version information

Commands:
  config, --config, -c          Launch configuration interface
  test [name], --test, -t       Test upstream connection (all if no name given)
  import                        Import MCP server configs from other tools
  --help, -h                    Show help
  --version, -v                 Show version

Import Options:
  --list                        List discovered configs without importing
  --dry-run                     Preview changes without writing
  --source=<tool>               Import from specific tool only
  --path=<path>                 Import from explicit file path
  --scope=<scope>               Scope: user, project, or both (default: both)
  --strategy=<strategy>         Conflict strategy: skip, replace, rename
  --no-interactive              Disable interactive prompts (use --strategy)
  --verbose                     Show detailed output

Supported Tools:
  claude-code, claude-desktop, cursor, windsurf, vscode, cline,
  roo-code, kilo-code, gemini-cli, zed, jetbrains, factory,
  opencode, qwen-code, trae, antigravity

Examples:
  mcp-squared test github       Test connection to 'github' upstream
  mcp-squared test              Test all configured upstreams
  mcp-squared import --list     List all discovered MCP configs
  mcp-squared import --dry-run  Preview import changes
  mcp-squared import            Import with interactive conflict resolution
  mcp-squared import --source=cursor --no-interactive --strategy=rename
`);
}
