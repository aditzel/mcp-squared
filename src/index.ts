/**
 * MCP² (Mercury Control Plane) - Main entry point
 * @module mcp-squared
 */

export const VERSION = "0.1.0";

async function main(): Promise<void> {
  console.log(`MCP² v${VERSION}`);
  console.log("Mercury Control Plane - Starting...");
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
