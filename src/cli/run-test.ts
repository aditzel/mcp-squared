import {
  formatValidationIssues,
  loadConfig,
  type McpSquaredConfig,
  validateConfig,
  validateUpstreamConfig,
} from "../config/index.js";
import type { UpstreamServerConfig } from "../config/schema.js";
import { type TestResult, testUpstreamConnection } from "../upstream/index.js";

interface LoadConfigResult {
  config: McpSquaredConfig;
  path: string;
}

export interface RunTestDependencies {
  formatValidationIssues: typeof formatValidationIssues;
  loadConfig: () => Promise<LoadConfigResult>;
  processRef: Pick<typeof process, "exit">;
  testUpstreamConnection: typeof testUpstreamConnection;
  validateConfig: typeof validateConfig;
  validateUpstreamConfig: typeof validateUpstreamConfig;
}

export function createRunTestDependencies(): RunTestDependencies {
  return {
    formatValidationIssues,
    loadConfig,
    processRef: process,
    testUpstreamConnection,
    validateConfig,
    validateUpstreamConfig,
  };
}

function formatTestResult(
  name: string,
  result: TestResult,
  verbose = false,
): void {
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
    if (!verbose && result.stderr) {
      console.log("  Stderr output:");
      for (const line of result.stderr.split("\n").slice(0, 10)) {
        if (line.trim()) {
          console.log(`    ${line}`);
        }
      }
      const lines = result.stderr.split("\n").filter((line) => line.trim());
      if (lines.length > 10) {
        console.log(`    ... and ${lines.length - 10} more lines`);
      }
    }
  }
}

export async function runTestCommand(
  targetName: string | undefined,
  verbose: boolean,
  dependencies: RunTestDependencies,
): Promise<void> {
  const {
    formatValidationIssues,
    loadConfig,
    processRef,
    testUpstreamConnection,
    validateConfig,
    validateUpstreamConfig,
  } = dependencies;

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
    processRef.exit(1);
    return;
  }

  const upstreamEntries = Object.entries(config.upstreams);

  if (upstreamEntries.length === 0) {
    console.error(
      "Error: No upstreams configured. Run 'mcp-squared config' to add one.",
    );
    processRef.exit(1);
    return;
  }

  const validationIssues = validateConfig(config);
  const errorUpstreams = new Set(
    validationIssues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.upstream),
  );

  if (validationIssues.length > 0) {
    console.error(formatValidationIssues(validationIssues));
    console.error("");
  }

  if (targetName) {
    const upstream = config.upstreams[targetName];
    if (!upstream) {
      console.error(`Error: Upstream '${targetName}' not found.`);
      console.error(
        `Available upstreams: ${Object.keys(config.upstreams).join(", ")}`,
      );
      processRef.exit(1);
      return;
    }

    const targetIssues = validateUpstreamConfig(targetName, upstream);
    const targetErrors = targetIssues.filter(
      (issue) => issue.severity === "error",
    );
    if (targetErrors.length > 0) {
      console.error(`\n\x1b[31m✗\x1b[0m ${targetName}`);
      console.error(
        `  Error: Invalid configuration - ${targetErrors[0]?.message}`,
      );
      if (targetErrors[0]?.suggestion) {
        console.error(`  \x1b[90m→ ${targetErrors[0].suggestion}\x1b[0m`);
      }
      processRef.exit(1);
      return;
    }

    console.log(`Testing upstream: ${targetName}...`);
    const result = await testUpstreamConnection(targetName, upstream, {
      verbose,
    });
    formatTestResult(targetName, result, verbose);
    processRef.exit(result.success ? 0 : 1);
    return;
  }

  console.log(`Testing ${upstreamEntries.length} upstream(s)...`);

  let allSuccess = true;
  for (const [name, upstream] of upstreamEntries) {
    if (!upstream.enabled) {
      console.log(`\n⊘ ${name} (disabled)`);
      continue;
    }

    if (errorUpstreams.has(name)) {
      console.log(`\n\x1b[31m✗\x1b[0m ${name}`);
      const issue = validationIssues.find(
        (validationIssue) =>
          validationIssue.upstream === name &&
          validationIssue.severity === "error",
      );
      console.log(`  Error: Invalid configuration - ${issue?.message}`);
      if (issue?.suggestion) {
        console.log(`  \x1b[90m→ ${issue.suggestion}\x1b[0m`);
      }
      allSuccess = false;
      continue;
    }

    const result = await testUpstreamConnection(
      name,
      upstream as UpstreamServerConfig,
      {
        verbose,
      },
    );
    formatTestResult(name, result, verbose);
    if (!result.success) {
      allSuccess = false;
    }
  }

  console.log("");
  processRef.exit(allSuccess ? 0 : 1);
}
