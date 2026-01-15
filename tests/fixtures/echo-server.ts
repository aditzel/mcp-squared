#!/usr/bin/env bun
/**
 * Simple MCP server that echoes requests.
 * Used for testing process lifecycle.
 */

// Handle signals to verify clean shutdown
process.on("SIGTERM", () => {
  // console.error("Echo server received SIGTERM");
  process.exit(0);
});

// Keep process alive
setInterval(() => {}, 1000);

// Basic MCP stdio server loop (mock)
process.stdin.on("data", (chunk) => {
  // Ignore input
});

console.error("Echo server started");
