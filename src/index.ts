/**
 * MCP² (Mercury Control Plane) - Main entry point
 * @module mcp-squared
 */

import { parseArgs, printHelp } from "./cli/index.js";
import { McpSquaredServer } from "./server/index.js";
import { runConfigTui } from "./tui/config.js";

export const VERSION = "0.1.0";

async function startServer(): Promise<void> {
  const server = new McpSquaredServer();

  process.on("SIGINT", async () => {
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(`MCP² v${VERSION}`);
    process.exit(0);
  }

  if (args.mode === "config") {
    await runConfigTui();
  } else {
    await startServer();
  }
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
