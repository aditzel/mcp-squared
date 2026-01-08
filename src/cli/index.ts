export interface CliArgs {
  mode: "server" | "config" | "test";
  help: boolean;
  version: boolean;
  testTarget: string | undefined;
}

export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    mode: "server",
    help: false,
    version: false,
    testTarget: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
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

export function printHelp(): void {
  console.log(`
MCP² (Mercury Control Plane) - Meta-server for Model Context Protocol

Usage:
  mcp-squared                   Start MCP server (stdio mode)
  mcp-squared config            Launch interactive configuration TUI
  mcp-squared test [upstream]   Test connection to upstream server(s)
  mcp-squared --help            Show this help message
  mcp-squared --version         Show version information

Commands:
  config, --config, -c          Launch configuration interface
  test [name], --test, -t       Test upstream connection (all if no name given)
  --help, -h                    Show help
  --version, -v                 Show version

Examples:
  mcp-squared test github       Test connection to 'github' upstream
  mcp-squared test              Test all configured upstreams
`);
}
