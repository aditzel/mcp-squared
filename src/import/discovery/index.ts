/**
 * Configuration discovery orchestration.
 *
 * This module coordinates the discovery of MCP configuration files
 * across all supported tools.
 *
 * @module import/discovery
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DiscoveredConfig, ImportScope, ToolId } from "../types.js";
import { getEnv } from "./paths.js";
import { ALL_TOOL_IDS, getToolPaths } from "./registry.js";

export { getToolPaths, ALL_TOOL_IDS, isValidToolId } from "./registry.js";
export * from "./paths.js";

// Re-export types used by discovery consumers
export type { DiscoveredConfig } from "../types.js";

/**
 * Options for config discovery.
 */
export interface DiscoveryOptions {
  /** Scope to search (user, project, or both) */
  scope?: ImportScope;
  /** Working directory for project-level discovery */
  cwd?: string;
  /** Specific tools to search for (default: all) */
  tools?: ToolId[];
}

/**
 * Probes a single config file path.
 *
 * @param tool - Tool ID
 * @param path - Path to probe
 * @param scope - Scope (user or project)
 * @returns DiscoveredConfig with existence/readability info
 */
async function probeConfig(
  tool: ToolId,
  path: string,
  scope: "user" | "project",
): Promise<DiscoveredConfig> {
  const exists = existsSync(path);
  let readable = false;
  let lastModified: Date | undefined;

  if (exists) {
    try {
      // Try to read the file to verify it's readable
      await Bun.file(path).text();
      readable = true;

      // Get modification time
      const stats = statSync(path);
      lastModified = stats.mtime;
    } catch {
      readable = false;
    }
  }

  const result: DiscoveredConfig = {
    tool,
    path,
    scope,
    exists,
    readable,
  };

  if (lastModified !== undefined) {
    result.lastModified = lastModified;
  }

  return result;
}

/**
 * Discovers all available MCP configuration files.
 *
 * Searches across all supported tools (or specified subset) for
 * configuration files at both user and project levels.
 *
 * @param options - Discovery options
 * @returns Array of discovered configurations
 */
export async function discoverConfigs(
  options: DiscoveryOptions = {},
): Promise<DiscoveredConfig[]> {
  const { scope = "both", cwd = process.cwd(), tools = ALL_TOOL_IDS } = options;

  const discovered: DiscoveredConfig[] = [];
  const probePromises: Promise<DiscoveredConfig>[] = [];

  for (const toolId of tools) {
    const paths = getToolPaths(toolId);

    // Check environment variable override first
    if (paths.envVar) {
      const envPath = getEnv(paths.envVar);
      if (envPath) {
        const resolvedPath = resolve(envPath);
        probePromises.push(probeConfig(toolId, resolvedPath, "user"));
      }
    }

    // Check user paths
    if (scope === "user" || scope === "both") {
      for (const userPath of paths.user) {
        probePromises.push(probeConfig(toolId, userPath, "user"));
      }
    }

    // Check project paths
    if (scope === "project" || scope === "both") {
      for (const projectPattern of paths.project) {
        const projectPath = join(resolve(cwd), projectPattern);
        probePromises.push(probeConfig(toolId, projectPath, "project"));
      }
    }
  }

  // Run all probes in parallel
  const results = await Promise.all(probePromises);

  // Filter to only existing and readable configs
  for (const config of results) {
    if (config.exists && config.readable) {
      discovered.push(config);
    }
  }

  // Sort by tool name, then by scope (user before project)
  discovered.sort((a, b) => {
    const toolCompare = a.tool.localeCompare(b.tool);
    if (toolCompare !== 0) return toolCompare;
    return a.scope === "user" ? -1 : 1;
  });

  return discovered;
}

/**
 * Discovers configs for a single tool.
 *
 * @param toolId - Tool to discover configs for
 * @param options - Discovery options
 * @returns Array of discovered configurations
 */
export async function discoverToolConfig(
  toolId: ToolId,
  options: Omit<DiscoveryOptions, "tools"> = {},
): Promise<DiscoveredConfig[]> {
  return discoverConfigs({ ...options, tools: [toolId] });
}

/**
 * Formats discovered configs for CLI display.
 *
 * @param configs - Discovered configurations
 * @returns Formatted string for CLI output
 */
export function formatDiscoveredConfigs(configs: DiscoveredConfig[]): string {
  if (configs.length === 0) {
    return "No MCP configurations found.";
  }

  const lines: string[] = [
    `Found ${configs.length} MCP configuration${configs.length === 1 ? "" : "s"}:`,
    "",
  ];

  // Group by tool
  const byTool = new Map<ToolId, DiscoveredConfig[]>();
  for (const config of configs) {
    const list = byTool.get(config.tool) || [];
    list.push(config);
    byTool.set(config.tool, list);
  }

  for (const [tool, toolConfigs] of byTool) {
    lines.push(`  ${tool}:`);
    for (const config of toolConfigs) {
      const scopeLabel = config.scope === "user" ? "[user]" : "[project]";
      const serverInfo =
        config.serverCount !== undefined
          ? ` (${config.serverCount} server${config.serverCount === 1 ? "" : "s"})`
          : "";
      lines.push(`    ${scopeLabel} ${config.path}${serverInfo}`);
    }
  }

  return lines.join("\n");
}
