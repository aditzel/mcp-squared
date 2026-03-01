/**
 * Command-line interface argument parsing.
 *
 * This module handles parsing command-line arguments for the mcp-squared CLI.
 * Supports server mode (default), config TUI, connection testing, and import.
 *
 * @module cli
 */

import type { ImportScope, MergeStrategy, ToolId } from "../import/types.js";
import type { InstallMode, InstallScope } from "../install/types.js";

/**
 * Parsed command-line arguments.
 */
export interface CliArgs {
  /** Operating mode: server, config TUI, test, import, auth, install, init, or monitor */
  mode:
    | "server"
    | "config"
    | "test"
    | "import"
    | "auth"
    | "install"
    | "init"
    | "monitor"
    | "daemon"
    | "proxy";
  /** Force stdio server mode */
  stdio: boolean;
  /** Whether --help was requested */
  help: boolean;
  /** Whether --version was requested */
  version: boolean;
  /** Target upstream server name for test mode (optional) */
  testTarget: string | undefined;
  /** Verbose output for test mode */
  testVerbose: boolean;
  /** Import-specific options */
  import: ImportArgs;
  /** Target upstream server name for auth mode (required) */
  authTarget: string | undefined;
  /** Install-specific options */
  install: InstallArgs;
  /** Monitor-specific options */
  monitor: MonitorArgs;
  /** Init-specific options */
  init: InitArgs;
  /** Daemon-specific options */
  daemon: DaemonArgs;
  /** Proxy-specific options */
  proxy: ProxyArgs;
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

/**
 * Install-specific command-line arguments.
 */
export interface InstallArgs {
  /** Target tool to install to (skip selection prompt) */
  tool?: ToolId;
  /** Scope preference: user or project */
  scope?: InstallScope;
  /** Install mode: replace all or add alongside */
  mode?: InstallMode;
  /** Enable interactive prompts (default: true) */
  interactive: boolean;
  /** Preview changes without writing */
  dryRun: boolean;
  /** Server name to use for mcp-squared entry (default: "mcp-squared") */
  serverName: string;
  /** Command to run (default: "mcp-squared") */
  command: string;
  /** Optional command arguments */
  args?: string[] | undefined;
}

/**
 * Monitor-specific command-line arguments.
 */
export interface MonitorArgs {
  /** Auto-refresh interval in milliseconds (default: 2000) */
  refreshInterval: number;
  /** Disable auto-refresh (manual refresh only) */
  noAutoRefresh: boolean;
  /** Target instance ID (full or prefix) */
  instanceId?: string;
  /** Explicit socket path or TCP endpoint */
  socketPath?: string;
}

/**
 * Daemon-specific command-line arguments.
 */
export interface DaemonArgs {
  /** Override daemon socket path */
  socketPath?: string;
  /** Optional shared secret required for daemon IPC clients */
  sharedSecret?: string;
}

/**
 * Proxy-specific command-line arguments.
 */
export interface ProxyArgs {
  /** Explicit daemon endpoint to connect to */
  socketPath?: string;
  /** Do not auto-spawn the daemon */
  noSpawn: boolean;
  /** Optional shared secret used for daemon IPC authentication */
  sharedSecret?: string;
}

/** Available security profiles for init command */
export type SecurityProfile = "hardened" | "permissive";

/**
 * Init-specific command-line arguments.
 */
export interface InitArgs {
  /** Security profile to use (default: hardened) */
  security: SecurityProfile;
  /** Write config to project-local path instead of user-level */
  project: boolean;
  /** Overwrite existing config without prompting */
  force: boolean;
}

/**
 * Checks if a string is a valid security profile.
 */
function isValidSecurityProfile(value: string): value is SecurityProfile {
  return value === "hardened" || value === "permissive";
}

/**
 * Checks if a string is a valid install mode.
 */
function isValidInstallMode(value: string): value is InstallMode {
  return value === "replace" || value === "add";
}

/**
 * Checks if a string is a valid install scope.
 */
function isValidInstallScope(value: string): value is InstallScope {
  return value === "user" || value === "project";
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
  "codex",
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
    stdio: false,
    help: false,
    version: false,
    testTarget: undefined,
    testVerbose: false,
    import: {
      scope: "both",
      strategy: "skip",
      interactive: true,
      dryRun: false,
      list: false,
      verbose: false,
    },
    authTarget: undefined,
    init: {
      security: "hardened",
      project: false,
      force: false,
    },
    install: {
      interactive: true,
      dryRun: false,
      serverName: "mcp-squared",
      command: "mcp-squared",
      args: undefined,
    },
    monitor: {
      refreshInterval: 2000,
      noAutoRefresh: false,
    },
    daemon: {},
    proxy: {
      noSpawn: false,
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

      case "auth": {
        result.mode = "auth";
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          result.authTarget = nextArg;
          i++;
        }
        break;
      }

      case "install":
        result.mode = "install";
        break;

      case "init":
        result.mode = "init";
        break;

      case "monitor":
        result.mode = "monitor";
        break;

      case "daemon":
        result.mode = "daemon";
        break;

      case "proxy":
        result.mode = "proxy";
        break;

      case "--stdio":
        result.stdio = true;
        result.install.args = ["--stdio"];
        break;

      case "--tool": {
        const value = argValue ?? args[++i];
        if (value && isValidToolId(value)) {
          result.install.tool = value;
        }
        break;
      }

      case "--mode": {
        const value = argValue ?? args[++i];
        if (value && isValidInstallMode(value)) {
          result.install.mode = value;
        }
        break;
      }

      case "--name": {
        const value = argValue ?? args[++i];
        if (value) {
          result.install.serverName = value;
        }
        break;
      }

      case "--command": {
        const value = argValue ?? args[++i];
        if (value) {
          result.install.command = value;
        }
        break;
      }

      case "--proxy":
        result.install.args = ["proxy"];
        break;

      case "--list":
        result.import.list = true;
        break;

      case "--dry-run":
        result.import.dryRun = true;
        result.install.dryRun = true;
        break;

      case "--no-interactive":
        result.import.interactive = false;
        result.install.interactive = false;
        break;

      case "--verbose":
      case "-V":
        result.import.verbose = true;
        result.testVerbose = true;
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
        // Also handle install scope (user or project only)
        if (value && isValidInstallScope(value)) {
          result.install.scope = value;
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

      case "--refresh-interval": {
        const value = argValue ?? args[++i];
        if (value) {
          const interval = Number.parseInt(value, 10);
          if (!Number.isNaN(interval) && interval > 0) {
            result.monitor.refreshInterval = interval;
          }
        }
        break;
      }

      case "--instance": {
        const value = argValue ?? args[++i];
        if (value) {
          result.monitor.instanceId = value;
        }
        break;
      }

      case "--socket": {
        const value = argValue ?? args[++i];
        if (value) {
          result.monitor.socketPath = value;
        }
        break;
      }

      case "--daemon-socket": {
        const value = argValue ?? args[++i];
        if (value) {
          result.daemon.socketPath = value;
          result.proxy.socketPath = value;
        }
        break;
      }

      case "--daemon-secret": {
        const value = argValue ?? args[++i];
        if (value) {
          result.daemon.sharedSecret = value;
          result.proxy.sharedSecret = value;
        }
        break;
      }

      case "--no-daemon-spawn":
        result.proxy.noSpawn = true;
        break;

      case "--security": {
        const value = argValue ?? args[++i];
        if (value && isValidSecurityProfile(value)) {
          result.init.security = value;
        }
        break;
      }

      case "--project":
        result.init.project = true;
        break;

      case "--force":
        result.init.force = true;
        break;

      case "--no-auto-refresh":
        result.monitor.noAutoRefresh = true;
        break;

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
  mcp-squared                   Auto: daemon (TTY) or proxy (piped stdio)
  mcp-squared --stdio           Start MCP server (stdio mode)
  mcp-squared config            Launch interactive configuration TUI
  mcp-squared test [upstream]   Test connection to upstream server(s)
  mcp-squared auth <upstream>   Authenticate with an OAuth-protected upstream
  mcp-squared import [options]  Import MCP configs from other tools
  mcp-squared init [options]    Generate a starter config file with security profile
  mcp-squared install [options] Install MCP² into other MCP clients
  mcp-squared monitor [options] Launch server monitor TUI
  mcp-squared daemon [options]  Start shared MCP² daemon
  mcp-squared proxy [options]   Start stdio proxy (connects to daemon)
  mcp-squared --help            Show this help message
  mcp-squared --version         Show version information

Commands:
  config, --config, -c          Launch configuration interface
  test [name], --test, -t       Test upstream connection (all if no name given)
  auth <name>                   Authenticate with an OAuth-protected upstream
  import                        Import MCP server configs from other tools
  init                          Generate a starter config with security profile
  install                       Install MCP² as a server in other MCP clients
  monitor                       Launch server monitor TUI
  daemon                        Start shared daemon for multiple clients
  proxy                         Start stdio proxy for daemon
  --stdio                       Force stdio server mode
  --help, -h                    Show help
  --version, -v                 Show version

Test Options:
  --verbose, -V                 Show detailed connection info (stderr, timing)

Import Options:
  --list                        List discovered configs without importing
  --dry-run                     Preview changes without writing
  --source=<tool>               Import from specific tool only
  --path=<path>                 Import from explicit file path
  --scope=<scope>               Scope: user, project, or both (default: both)
  --strategy=<strategy>         Conflict strategy: skip, replace, rename
  --no-interactive              Disable interactive prompts (use --strategy)
  --verbose                     Show detailed output

Init Options:
  --security=<profile>          Security profile: hardened (default) or permissive
  --project                     Write to project-local mcp-squared.toml (default: user-level)
  --force                       Overwrite existing config without prompting

Install Options:
  --tool=<tool>                 Target tool (skip selection prompt)
  --scope=<scope>               Scope: user or project
  --mode=<mode>                 Mode: replace (all) or add (alongside existing)
  --name=<name>                 Server name (default: mcp-squared)
  --command=<cmd>               Command to run (default: mcp-squared)
  --proxy                       Install as shared-daemon proxy (uses 'mcp-squared proxy')
  --stdio                       Install as standalone stdio server (uses 'mcp-squared --stdio')
  --dry-run                     Preview changes without writing
  --no-interactive              Disable interactive prompts

Monitor Options:
  (daemon-first; attaches to shared daemon monitor by default)
  --refresh-interval=<ms>       Auto-refresh interval in milliseconds (default: 2000)
  --no-auto-refresh             Disable auto-refresh (manual refresh only)
  --socket=<path>               Connect to a specific monitor socket or tcp://host:port

Daemon Options:
  --daemon-socket=<path>        Override daemon socket path
  --daemon-secret=<secret>      Require shared secret for daemon IPC clients

Proxy Options:
  --daemon-socket=<path>        Connect to a specific daemon socket
  --no-daemon-spawn             Do not auto-spawn daemon if missing
  --daemon-secret=<secret>      Provide shared secret for daemon handshake

Supported Tools:
  ${VALID_TOOL_IDS.join(", ")}

Examples:
  mcp-squared test github       Test connection to 'github' upstream
  mcp-squared test              Test all configured upstreams
  mcp-squared auth vercel-mcp   Authenticate with 'vercel-mcp' upstream (OAuth)
  mcp-squared init              Generate hardened config (confirm-all by default)
  mcp-squared init --security=permissive  Generate permissive config (allow-all)
  mcp-squared init --project    Generate project-local config
  mcp-squared import --list     List all discovered MCP configs
  mcp-squared import --dry-run  Preview import changes
  mcp-squared import            Import with interactive conflict resolution
  mcp-squared import --source=cursor --no-interactive --strategy=rename
  mcp-squared install           Install MCP² interactively
  mcp-squared install --tool=cursor --scope=user --mode=add
  mcp-squared install --proxy   Install MCP² in shared-daemon proxy mode
  mcp-squared install --dry-run Preview installation changes
  mcp-squared monitor           Launch server monitor with default settings
  mcp-squared monitor --refresh-interval=5000  Refresh every 5 seconds
  mcp-squared monitor --no-auto-refresh  Manual refresh only
  mcp-squared monitor --socket=/tmp/mcp-squared.sock  Monitor a specific socket
  mcp-squared daemon            Start shared daemon
  mcp-squared proxy             Run stdio proxy (auto-spawn daemon)
`);
}
