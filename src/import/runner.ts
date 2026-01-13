/**
 * Main import runner that orchestrates the import process.
 *
 * Handles discovery, parsing, transformation, conflict resolution,
 * and writing the merged configuration.
 *
 * @module import/runner
 */

import { readFile } from "node:fs/promises";
import type { ImportArgs } from "../cli/index.js";
import {
  DEFAULT_CONFIG,
  type McpSquaredConfig,
  discoverConfigPath,
  getDefaultConfigPath,
  loadConfig,
  saveConfig,
} from "../config/index.js";
import { type DiscoveredConfig, discoverConfigs } from "./discovery/index.js";
import {
  type IncomingServerGroup,
  type MergeInput,
  detectConflicts,
  mergeWithResolutions,
  mergeWithStrategy,
  summarizeChanges,
} from "./merge/index.js";
import { getParser } from "./parsers/index.js";
import type {
  ExternalServer,
  ImportConflict,
  ImportOptions,
  ImportResult,
  MergeStrategy,
  ParsedExternalConfig,
  ToolId,
} from "./types.js";
import { TOOL_DISPLAY_NAMES } from "./types.js";

/**
 * ANSI color codes for terminal output.
 */
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

/**
 * Runs the import process based on CLI arguments.
 *
 * @param args - Import CLI arguments
 */
export async function runImport(args: ImportArgs): Promise<void> {
  // Build options, only setting defined values
  const options: ImportOptions = {
    scope: args.scope,
    strategy: args.strategy,
    interactive: args.interactive,
    dryRun: args.dryRun,
    list: args.list,
    verbose: args.verbose,
  };

  // Only set source/path if defined
  if (args.source !== undefined) {
    options.source = args.source;
  }
  if (args.path !== undefined) {
    options.path = args.path;
  }

  // List mode - just show discovered configs
  if (options.list) {
    await runListMode(options);
    return;
  }

  // Run full import
  const result = await performImport(options);

  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}

/**
 * Lists discovered MCP configurations without importing.
 */
async function runListMode(options: ImportOptions): Promise<void> {
  console.log("\nDiscovering MCP configurations...\n");

  let discovered: DiscoveredConfig[];

  if (options.path) {
    // Single path mode
    const tool = options.source ?? "claude-code";
    discovered = [
      {
        tool,
        path: options.path,
        scope: "user",
        exists: true,
        readable: true,
      },
    ];
  } else {
    // Full discovery - build options only with defined values
    const discoverOpts: {
      tools?: ToolId[];
      scope?: "user" | "project" | "both";
    } = {};
    if (options.source !== undefined) {
      discoverOpts.tools = [options.source];
    }
    if (options.scope !== undefined) {
      discoverOpts.scope = options.scope;
    }
    discovered = await discoverConfigs(discoverOpts);
  }

  const existingConfigs = discovered.filter((d) => d.exists && d.readable);

  if (existingConfigs.length === 0) {
    console.log("No MCP configurations found.\n");
    return;
  }

  // Group by tool
  const byTool = new Map<ToolId, DiscoveredConfig[]>();
  for (const config of existingConfigs) {
    const list = byTool.get(config.tool) ?? [];
    list.push(config);
    byTool.set(config.tool, list);
  }

  // Print by tool
  for (const [tool, configs] of byTool) {
    const displayName = TOOL_DISPLAY_NAMES[tool];
    console.log(`${colors.cyan}${displayName}${colors.reset}`);

    for (const config of configs) {
      const scopeLabel = config.scope === "user" ? "(user)" : "(project)";
      console.log(`  ${colors.dim}${scopeLabel}${colors.reset} ${config.path}`);

      // Try to parse and show server count
      if (options.verbose) {
        const parsed = await parseConfig(config);
        if (parsed) {
          console.log(
            `         ${colors.dim}${parsed.servers.length} server(s)${colors.reset}`,
          );
          for (const server of parsed.servers) {
            const transport = server.command ? "stdio" : "sse";
            const status = server.disabled
              ? `${colors.yellow}disabled${colors.reset}`
              : `${colors.green}enabled${colors.reset}`;
            console.log(`           • ${server.name} (${transport}) ${status}`);
          }
        }
      }
    }
    console.log("");
  }

  console.log(`Found ${existingConfigs.length} configuration file(s).`);
}

/**
 * Parses a discovered config file.
 */
async function parseConfig(
  discovered: DiscoveredConfig,
): Promise<ParsedExternalConfig | undefined> {
  try {
    const content = await readFile(discovered.path, "utf-8");
    const json = JSON.parse(content) as unknown;

    const parser = getParser(discovered.tool);
    if (!parser) {
      return undefined;
    }

    const result = parser.parse(json, discovered.path);

    return {
      tool: discovered.tool,
      path: discovered.path,
      scope: discovered.scope,
      servers: result.servers,
      rawContent: json,
    };
  } catch {
    return undefined;
  }
}

/**
 * Performs the full import process.
 */
async function performImport(options: ImportOptions): Promise<ImportResult> {
  console.log("\nMCP Configuration Import\n");

  // Step 1: Load existing MCP² config
  let existingConfig: McpSquaredConfig;
  let configPath: string;

  try {
    const loaded = await loadConfig();
    existingConfig = loaded.config;
    configPath = loaded.path;
    console.log(`${colors.dim}Existing config: ${configPath}${colors.reset}`);
  } catch {
    // No existing config - use defaults
    const pathResult = discoverConfigPath();
    if (pathResult) {
      configPath = pathResult.path;
    } else {
      configPath = getDefaultConfigPath().path;
    }
    existingConfig = DEFAULT_CONFIG;
    console.log(
      `${colors.dim}No existing config, will create: ${configPath}${colors.reset}`,
    );
  }

  // Step 2: Discover and parse external configs
  console.log("\nDiscovering external configurations...");

  let discovered: DiscoveredConfig[];
  if (options.path) {
    discovered = [
      {
        tool: options.source ?? ("claude-code" as ToolId),
        path: options.path,
        scope: "user" as const,
        exists: true,
        readable: true,
      },
    ];
  } else {
    // Build options only with defined values
    const discoverOpts: {
      tools?: ToolId[];
      scope?: "user" | "project" | "both";
    } = {};
    if (options.source !== undefined) {
      discoverOpts.tools = [options.source];
    }
    if (options.scope !== undefined) {
      discoverOpts.scope = options.scope;
    }
    discovered = await discoverConfigs(discoverOpts);
  }

  const existingDiscovered = discovered.filter((d) => d.exists && d.readable);

  if (existingDiscovered.length === 0) {
    console.log("\nNo external MCP configurations found.");
    return {
      success: true,
      imported: 0,
      skipped: 0,
      conflicts: [],
      changes: [],
      errors: [],
    };
  }

  // Parse all configs
  const incoming: IncomingServerGroup[] = [];
  let totalServers = 0;

  for (const disc of existingDiscovered) {
    const parsed = await parseConfig(disc);
    if (parsed && parsed.servers.length > 0) {
      incoming.push({
        tool: parsed.tool,
        path: parsed.path,
        servers: parsed.servers,
      });
      totalServers += parsed.servers.length;
      console.log(
        `  ${colors.green}✓${colors.reset} ${TOOL_DISPLAY_NAMES[parsed.tool]}: ${parsed.servers.length} server(s)`,
      );
    }
  }

  if (totalServers === 0) {
    console.log("\nNo servers found in external configurations.");
    return {
      success: true,
      imported: 0,
      skipped: 0,
      conflicts: [],
      changes: [],
      errors: [],
    };
  }

  console.log(`\nFound ${totalServers} server(s) total.`);

  // Step 3: Detect conflicts
  const mergeInput: MergeInput = { incoming, existingConfig };
  const detection = detectConflicts(mergeInput);

  if (detection.conflicts.length > 0) {
    console.log(
      `\n${colors.yellow}⚠${colors.reset} ${detection.conflicts.length} conflict(s) detected.`,
    );
  }

  // Show in-sync servers in verbose mode
  if (detection.inSync.length > 0 && options.verbose) {
    console.log(
      `\n${colors.green}=${colors.reset} ${detection.inSync.length} server(s) already in sync:`,
    );
    for (const server of detection.inSync) {
      console.log(
        `  ${colors.dim}• ${server.serverName} (from ${TOOL_DISPLAY_NAMES[server.sourceTool]})${colors.reset}`,
      );
    }
  }

  // Step 4: Handle conflicts
  let mergeResult;

  if (detection.conflicts.length === 0 || !options.interactive) {
    // No conflicts or non-interactive mode
    mergeResult = mergeWithStrategy(mergeInput, options.strategy ?? "skip");
  } else {
    // Interactive conflict resolution
    const resolutions = await resolveConflictsInteractively(
      detection.conflicts,
    );
    mergeResult = mergeWithResolutions(mergeInput, resolutions);
  }

  // Step 5: Show summary
  const summary = summarizeChanges(mergeResult.changes, mergeResult.inSync.length);
  console.log("\nChanges:");
  console.log(`  ${colors.green}+ ${summary.added} added${colors.reset}`);
  if (summary.updated > 0) {
    console.log(
      `  ${colors.yellow}~ ${summary.updated} updated${colors.reset}`,
    );
  }
  if (summary.renamed > 0) {
    console.log(`  ${colors.cyan}→ ${summary.renamed} renamed${colors.reset}`);
  }
  if (summary.skipped > 0) {
    console.log(`  ${colors.dim}- ${summary.skipped} skipped${colors.reset}`);
  }
  if (summary.inSync > 0) {
    console.log(`  ${colors.green}= ${summary.inSync} already in sync${colors.reset}`);
  }

  // Step 6: Write or dry-run
  if (options.dryRun) {
    console.log(
      `\n${colors.yellow}Dry run - no changes written.${colors.reset}`,
    );
    if (options.verbose) {
      console.log("\nMerged configuration preview:");
      console.log(JSON.stringify(mergeResult.config.upstreams, null, 2));
    }
  } else {
    console.log(`\nWriting to: ${configPath}`);
    await saveConfig(configPath, mergeResult.config);
    console.log(`${colors.green}✓${colors.reset} Configuration saved.`);
  }

  // Build result, only setting configPath if not dry-run
  const result: ImportResult = {
    success: true,
    imported: summary.added + summary.updated + summary.renamed,
    skipped: summary.skipped,
    conflicts: mergeResult.conflicts,
    changes: mergeResult.changes,
    errors: [],
  };

  if (!options.dryRun) {
    result.configPath = configPath;
  }

  return result;
}

/**
 * Prompts for interactive conflict resolution.
 * Simple readline-based prompts (not TUI).
 */
async function resolveConflictsInteractively(
  conflicts: ImportConflict[],
): Promise<Map<string, MergeStrategy>> {
  const resolutions = new Map<string, MergeStrategy>();
  let applyToAll: MergeStrategy | undefined;

  for (const conflict of conflicts) {
    if (applyToAll) {
      resolutions.set(conflict.serverName, applyToAll);
      continue;
    }

    console.log(
      `\n${colors.yellow}Conflict: "${conflict.serverName}"${colors.reset}`,
    );
    console.log("\nExisting (MCP²):");
    printServerSummary(conflict.existing, "  ");
    console.log(`\nIncoming (${TOOL_DISPLAY_NAMES[conflict.sourceTool]}):`);
    printServerSummary(conflict.incoming, "  ");

    const choice = await promptConflictChoice();

    if (choice.applyToAll) {
      applyToAll = choice.action;
    }

    resolutions.set(conflict.serverName, choice.action);
  }

  return resolutions;
}

/**
 * Prints a server summary for conflict display.
 */
function printServerSummary(server: ExternalServer, indent: string): void {
  if (server.command) {
    console.log(`${indent}command: ${server.command}`);
    if (server.args?.length) {
      console.log(`${indent}args: ${server.args.join(" ")}`);
    }
  } else if (server.url) {
    console.log(`${indent}url: ${server.url}`);
  }
}

/**
 * Prompts user for conflict resolution choice.
 */
async function promptConflictChoice(): Promise<{
  action: MergeStrategy;
  applyToAll: boolean;
}> {
  console.log("\nOptions:");
  console.log("  [s] Skip - keep existing");
  console.log("  [r] Replace - use incoming");
  console.log("  [n] Rename - import as new name");
  console.log("  [S/R/N] Apply to all remaining conflicts");

  const response = await promptUser("Choice [s/r/n/S/R/N]: ");
  const applyToAll = response === response.toUpperCase() && response !== "";

  let action: MergeStrategy;
  switch (response.toLowerCase()) {
    case "r":
      action = "replace";
      break;
    case "n":
      action = "rename";
      break;
    default:
      action = "skip";
  }

  return { action, applyToAll };
}

/**
 * Simple readline prompt.
 */
function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);

    const readline = require("node:readline") as typeof import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("", (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
