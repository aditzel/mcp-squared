/**
 * MCP² (Mercury Control Plane) - Main entry point
 * @module mcp-squared
 */

import { McpSquaredServer } from "./server/index.js";

export const VERSION = "0.1.0";

async function main(): Promise<void> {
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

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
