#!/usr/bin/env bun
/**
 * Simple MCP server that echoes requests.
 * Used for testing process lifecycle.
 */

import { unlinkSync, writeFileSync } from "node:fs";

const markerPath = process.argv[2];

function cleanupMarker(): void {
  if (!markerPath) {
    return;
  }
  try {
    unlinkSync(markerPath);
  } catch {
    // best-effort cleanup
  }
}

if (markerPath) {
  try {
    writeFileSync(markerPath, String(process.pid), { encoding: "utf8" });
  } catch {
    // Marker file is best-effort for tests only.
  }
}

// Handle signals to verify clean shutdown
process.on("SIGTERM", () => {
  cleanupMarker();
  process.exit(0);
});
process.on("SIGINT", () => {
  cleanupMarker();
  process.exit(0);
});
process.on("exit", cleanupMarker);

// Keep process alive
setInterval(() => {}, 1000);

// Basic MCP stdio server loop (mock)
process.stdin.on("data", (_chunk) => {
  // Ignore input
});

console.error("Echo server started");
