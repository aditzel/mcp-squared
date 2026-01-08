/**
 * CLI argument parsing for MCP²
 * @module cli
 */

export interface CliArgs {
  mode: "server" | "config";
  help: boolean;
  version: boolean;
}

export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    mode: "server",
    help: false,
    version: false,
  };

  for (const arg of args) {
    switch (arg) {
      case "config":
      case "--config":
      case "-c":
        result.mode = "config";
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

export function printHelp(): void {
  console.log(`
MCP² (Mercury Control Plane) - Meta-server for Model Context Protocol

Usage:
  mcp-squared              Start MCP server (stdio mode)
  mcp-squared config       Launch interactive configuration TUI
  mcp-squared --help       Show this help message
  mcp-squared --version    Show version information

Options:
  config, --config, -c     Launch configuration interface
  --help, -h               Show help
  --version, -v            Show version
`);
}
