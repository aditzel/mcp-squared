import { parseArgs, printHelp } from "./cli/index.js";
import { type McpSquaredConfig, loadConfig } from "./config/index.js";
import { McpSquaredServer } from "./server/index.js";
import { runConfigTui } from "./tui/config.js";
import { type TestResult, testUpstreamConnection } from "./upstream/index.js";

export const VERSION = "0.1.0";

async function startServer(): Promise<void> {
  // Load configuration
  const { config } = await loadConfig();

  const server = new McpSquaredServer({ config });

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

function formatTestResult(name: string, result: TestResult): void {
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
  }
}

async function runTest(targetName: string | undefined): Promise<void> {
  let config: McpSquaredConfig;
  try {
    const loaded = await loadConfig();
    config = loaded.config;
  } catch {
    console.error(
      "Error: No configuration found. Run 'mcp-squared config' first.",
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
    const result = await testUpstreamConnection(targetName, upstream);
    formatTestResult(targetName, result);
    process.exit(result.success ? 0 : 1);
  }

  console.log(`Testing ${upstreamEntries.length} upstream(s)...`);

  let allSuccess = true;
  for (const [name, upstream] of upstreamEntries) {
    if (!upstream.enabled) {
      console.log(`\n⊘ ${name} (disabled)`);
      continue;
    }

    const result = await testUpstreamConnection(name, upstream);
    formatTestResult(name, result);
    if (!result.success) allSuccess = false;
  }

  console.log("");
  process.exit(allSuccess ? 0 : 1);
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

  switch (args.mode) {
    case "config":
      await runConfigTui();
      break;
    case "test":
      await runTest(args.testTarget);
      break;
    default:
      await startServer();
  }
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
