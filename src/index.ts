#!/usr/bin/env bun
/**
 * MCP² (Mercury Control Plane) - Main entry point.
 *
 * MCP² is a local-first meta-server that aggregates multiple upstream MCP servers
 * and provides unified tool discovery and execution.
 *
 * @module mcp-squared
 */

import {
  createRunCliMainDependencies,
  type RunCliMainDependencies,
  runCliMain,
} from "./cli/main-runtime.js";
import {
  logSearchModeProfile,
  logSecurityProfile,
} from "./cli/runtime-profiles.js";
import { VERSION } from "./version.js";

export { VERSION, logSearchModeProfile, logSecurityProfile };

/**
 * Main entry point for the MCP² CLI.
 * Parses arguments and dispatches to the appropriate mode.
 * @internal
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: RunCliMainDependencies = createRunCliMainDependencies(),
): Promise<void> {
  await runCliMain(argv, dependencies);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
