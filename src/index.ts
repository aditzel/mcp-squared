#!/usr/bin/env bun
/**
 * MCP² (Mercury Control Plane) - Main entry point.
 *
 * MCP² is a local-first meta-server that aggregates multiple upstream MCP servers
 * and provides unified tool discovery and execution. It supports:
 *
 * - Multi-scope configuration (env, project, user)
 * - Security policies (allow/block/confirm)
 * - Full-text tool search via SQLite FTS5
 * - stdio and SSE transport types
 *
 * @module mcp-squared
 */

import { parseArgs, printHelp } from "./cli/index.js";
import { type McpSquaredConfig, loadConfig } from "./config/index.js";
import { runImport } from "./import/runner.js";
import { McpSquaredServer } from "./server/index.js";
import { runConfigTui } from "./tui/config.js";
import { type TestResult, testUpstreamConnection } from "./upstream/index.js";

/** Current version of MCP² */
export const VERSION = "0.1.0";

/**
 * Starts the MCP server in stdio mode.
 * Loads configuration, sets up signal handlers, and begins listening.
 * @internal
 */
async function startServer(): Promise<void> {
  // Load configuration
  const { config } = await loadConfig();

  const server = new McpSquaredServer({ config });

  // Track if shutdown is already in progress to prevent double cleanup
  let isShuttingDown = false;

  const gracefulShutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      await server.stop();
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error during shutdown: ${message}`);
      process.exit(1);
    }
  };

  // Use void operator to explicitly mark the promise as intentionally not awaited
  process.on("SIGINT", () => {
    void gracefulShutdown();
  });

  process.on("SIGTERM", () => {
    void gracefulShutdown();
  });

  await server.start();
}

/**
 * Formats and prints a test result to stdout.
 * Shows success/failure status, server info, and available tools.
 *
 * @param name - The upstream server name
 * @param result - The test result to format
 * @param verbose - Whether to show additional details
 * @internal
 */
function formatTestResult(name: string, result: TestResult, verbose = false): void {
  const status = result.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`\n${status} ${name}`);

  if (result.success) {
    if (result.serverName) {
      console.log(
        `  Server: ${result.serverName}${result.serverVersion ? ` v${result.serverVersion}` : ""}`,
      );
    }
    console.log(`  Tools: ${result.tools.length} available`);
    for (const tool of result.tools.slice(0, 10)) {
      const desc = tool.description
        ? ` - ${tool.description.slice(0, 50)}${tool.description.length > 50 ? "..." : ""}`
        : "";
      console.log(`    • ${tool.name}${desc}`);
    }
    if (result.tools.length > 10) {
      console.log(`    ... and ${result.tools.length - 10} more`);
    }
    console.log(`  Time: ${result.durationMs}ms`);
  } else {
    console.log(`  Error: ${result.error}`);
    console.log(`  Time: ${result.durationMs}ms`);
    // Show stderr in non-verbose mode for failed connections (verbose mode prints in real-time)
    if (!verbose && result.stderr) {
      console.log(`  Stderr output:`);
      for (const line of result.stderr.split("\n").slice(0, 10)) {
        if (line.trim()) {
          console.log(`    ${line}`);
        }
      }
      const lines = result.stderr.split("\n").filter((l) => l.trim());
      if (lines.length > 10) {
        console.log(`    ... and ${lines.length - 10} more lines`);
      }
    }
  }
}

/**
 * Runs connection tests against upstream servers.
 * Tests a specific server if name provided, or all enabled servers.
 *
 * @param targetName - Optional specific server name to test
 * @param verbose - Whether to show detailed connection info
 * @internal
 */
async function runTest(targetName: string | undefined, verbose = false): Promise<void> {
  let config: McpSquaredConfig;
  try {
    const loaded = await loadConfig();
    config = loaded.config;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error loading configuration: ${message}`);
    console.error(
      "Run 'mcp-squared config' to create or fix your configuration.",
    );
    process.exit(1);
  }

  const upstreamEntries = Object.entries(config.upstreams);

  if (upstreamEntries.length === 0) {
    console.error(
      "Error: No upstreams configured. Run 'mcp-squared config' to add one.",
    );
    process.exit(1);
  }

  if (targetName) {
    const upstream = config.upstreams[targetName];
    if (!upstream) {
      console.error(`Error: Upstream '${targetName}' not found.`);
      console.error(
        `Available upstreams: ${Object.keys(config.upstreams).join(", ")}`,
      );
      process.exit(1);
    }

    console.log(`Testing upstream: ${targetName}...`);
    const result = await testUpstreamConnection(targetName, upstream, { verbose });
    formatTestResult(targetName, result, verbose);
    process.exit(result.success ? 0 : 1);
  }

  console.log(`Testing ${upstreamEntries.length} upstream(s)...`);

  let allSuccess = true;
  for (const [name, upstream] of upstreamEntries) {
    if (!upstream.enabled) {
      console.log(`\n⊘ ${name} (disabled)`);
      continue;
    }

    const result = await testUpstreamConnection(name, upstream, { verbose });
    formatTestResult(name, result, verbose);
    if (!result.success) allSuccess = false;
  }

  console.log("");
  process.exit(allSuccess ? 0 : 1);
}

/**
 * Main entry point for the MCP² CLI.
 * Parses arguments and dispatches to the appropriate mode.
 * @internal
 */
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

  switch (args.mode) {
    case "config":
      await runConfigTui();
      break;
    case "test":
      await runTest(args.testTarget, args.testVerbose);
      break;
    case "import":
      await runImport(args.import);
      break;
    default:
      await startServer();
  }
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
