/**
 * Merge logic for combining external configs with existing MCP² config.
 *
 * Handles conflict detection, resolution, and generating the final
 * merged configuration.
 *
 * @module import/merge
 */

import type {
  McpSquaredConfig,
  UpstreamServerConfig,
} from "../../config/schema.js";
import { type MappedServer, mapExternalServer } from "../transform/mapper.js";
import {
  generateUniqueName,
  normalizeServerName,
} from "../transform/normalizer.js";
import type {
  ConfigChange,
  ExternalServer,
  ImportConflict,
  MergeStrategy,
  ToolId,
} from "../types.js";

/**
 * Input for merge operation.
 */
export interface MergeInput {
  /** Servers to import, grouped by source */
  incoming: IncomingServerGroup[];
  /** Existing MCP² configuration */
  existingConfig: McpSquaredConfig;
}

/**
 * Group of servers from a single source.
 */
export interface IncomingServerGroup {
  /** Source tool */
  tool: ToolId;
  /** Source file path */
  path: string;
  /** Servers from this source */
  servers: ExternalServer[];
}

/**
 * Result of merge operation.
 */
export interface MergeResult {
  /** Merged configuration */
  config: McpSquaredConfig;
  /** All changes made */
  changes: ConfigChange[];
  /** Conflicts that need resolution */
  conflicts: ImportConflict[];
  /** Warnings generated during merge */
  warnings: string[];
}

/**
 * Result of conflict detection.
 */
export interface ConflictDetectionResult {
  /** Servers without conflicts */
  noConflict: Array<{
    server: MappedServer;
    tool: ToolId;
    path: string;
    originalName: string;
  }>;
  /** Servers with conflicts */
  conflicts: ImportConflict[];
}

/**
 * Detects conflicts between incoming servers and existing config.
 *
 * @param input - Merge input with incoming servers and existing config
 * @returns Conflict detection result
 */
export function detectConflicts(input: MergeInput): ConflictDetectionResult {
  const existingNames = new Set(Object.keys(input.existingConfig.upstreams));
  const result: ConflictDetectionResult = {
    noConflict: [],
    conflicts: [],
  };

  for (const group of input.incoming) {
    for (const server of group.servers) {
      const normalizedName = normalizeServerName(server.name);
      const mapped = mapExternalServer(server);

      if (!mapped) {
        // Server couldn't be mapped - skip it
        continue;
      }

      if (existingNames.has(normalizedName)) {
        // Conflict detected
        const existingConfig = input.existingConfig.upstreams[normalizedName];
        if (existingConfig) {
          result.conflicts.push({
            serverName: normalizedName,
            existing: upstreamToExternal(normalizedName, existingConfig),
            incoming: server,
            sourceTool: group.tool,
            sourcePath: group.path,
          });
        }
      } else {
        // No conflict
        result.noConflict.push({
          server: mapped,
          tool: group.tool,
          path: group.path,
          originalName: server.name,
        });
        existingNames.add(normalizedName);
      }
    }
  }

  return result;
}

/**
 * Converts an MCP² upstream config back to ExternalServer format.
 * Used for conflict display.
 */
function upstreamToExternal(
  name: string,
  config: UpstreamServerConfig,
): ExternalServer {
  const server: ExternalServer = {
    name,
    disabled: !config.enabled,
  };

  if (config.transport === "stdio") {
    server.command = config.stdio.command;
    server.args = config.stdio.args;
    if (config.stdio.cwd !== undefined) {
      server.cwd = config.stdio.cwd;
    }
  } else if (config.transport === "sse") {
    server.url = config.sse.url;
    server.headers = config.sse.headers;
  }

  if (Object.keys(config.env).length > 0) {
    server.env = config.env;
  }

  return server;
}

/**
 * Applies a merge strategy to resolve a conflict.
 *
 * @param conflict - The conflict to resolve
 * @param strategy - How to resolve it
 * @param existingNames - Names already in use
 * @returns ConfigChange describing what was done
 */
export function resolveConflict(
  conflict: ImportConflict,
  strategy: MergeStrategy,
  existingNames: Set<string>,
): ConfigChange {
  const normalizedName = normalizeServerName(conflict.incoming.name);

  switch (strategy) {
    case "skip":
      return {
        type: "skip",
        serverName: normalizedName,
        sourceTool: conflict.sourceTool,
        sourcePath: conflict.sourcePath,
        server: conflict.incoming,
      };

    case "replace":
      return {
        type: "update",
        serverName: normalizedName,
        sourceTool: conflict.sourceTool,
        sourcePath: conflict.sourcePath,
        server: conflict.incoming,
      };

    case "rename": {
      const newName = generateUniqueName(normalizedName, existingNames);
      existingNames.add(newName);
      return {
        type: "rename",
        serverName: newName,
        originalName: normalizedName,
        sourceTool: conflict.sourceTool,
        sourcePath: conflict.sourcePath,
        server: conflict.incoming,
      };
    }
  }
}

/**
 * Applies resolved changes to create the final merged config.
 *
 * @param existingConfig - Original MCP² configuration
 * @param changes - Changes to apply
 * @returns Merged configuration
 */
export function applyChanges(
  existingConfig: McpSquaredConfig,
  changes: ConfigChange[],
): { config: McpSquaredConfig; warnings: string[] } {
  const warnings: string[] = [];

  // Deep clone the config
  const config: McpSquaredConfig = {
    ...existingConfig,
    upstreams: { ...existingConfig.upstreams },
  };

  for (const change of changes) {
    if (change.type === "skip") {
      // No action needed
      continue;
    }

    const mapped = mapExternalServer(change.server);
    if (!mapped) {
      warnings.push(
        `Could not map server "${change.serverName}" from ${change.sourceTool}`,
      );
      continue;
    }

    if (
      change.type === "add" ||
      change.type === "update" ||
      change.type === "rename"
    ) {
      config.upstreams[change.serverName] = mapped.config;
    }
  }

  return { config, warnings };
}

/**
 * Performs a full merge with a single strategy for all conflicts.
 *
 * For non-interactive mode where all conflicts use the same strategy.
 *
 * @param input - Merge input
 * @param conflictStrategy - Strategy for all conflicts
 * @returns Complete merge result
 */
export function mergeWithStrategy(
  input: MergeInput,
  conflictStrategy: MergeStrategy,
): MergeResult {
  const detection = detectConflicts(input);
  const changes: ConfigChange[] = [];
  const existingNames = new Set(Object.keys(input.existingConfig.upstreams));

  // Add non-conflicting servers
  for (const item of detection.noConflict) {
    const normalizedName = normalizeServerName(item.originalName);
    const server: ExternalServer = { name: item.originalName };
    if (item.server.config.transport === "stdio") {
      server.command = item.server.config.stdio.command;
    } else if (item.server.config.transport === "sse") {
      server.url = item.server.config.sse.url;
    }
    changes.push({
      type: "add",
      serverName: normalizedName,
      sourceTool: item.tool,
      sourcePath: item.path,
      server,
    });
    existingNames.add(normalizedName);
  }

  // Resolve conflicts with the given strategy
  for (const conflict of detection.conflicts) {
    const resolution = resolveConflict(
      conflict,
      conflictStrategy,
      existingNames,
    );
    changes.push(resolution);
  }

  // Apply all changes
  const { config, warnings } = applyChanges(input.existingConfig, changes);

  return {
    config,
    changes,
    conflicts: detection.conflicts,
    warnings,
  };
}

/**
 * Performs a merge where conflicts have already been resolved.
 *
 * For interactive mode after user has made resolution choices.
 *
 * @param input - Merge input
 * @param resolutions - Map of conflict server names to their resolution strategies
 * @returns Complete merge result
 */
export function mergeWithResolutions(
  input: MergeInput,
  resolutions: Map<string, MergeStrategy>,
): MergeResult {
  const detection = detectConflicts(input);
  const changes: ConfigChange[] = [];
  const existingNames = new Set(Object.keys(input.existingConfig.upstreams));

  // Add non-conflicting servers
  for (const item of detection.noConflict) {
    const normalizedName = normalizeServerName(item.originalName);
    const server: ExternalServer = { name: item.originalName };
    if (item.server.config.transport === "stdio") {
      server.command = item.server.config.stdio.command;
    } else if (item.server.config.transport === "sse") {
      server.url = item.server.config.sse.url;
    }
    changes.push({
      type: "add",
      serverName: normalizedName,
      sourceTool: item.tool,
      sourcePath: item.path,
      server,
    });
    existingNames.add(normalizedName);
  }

  // Resolve each conflict with its specific resolution
  for (const conflict of detection.conflicts) {
    const strategy = resolutions.get(conflict.serverName) ?? "skip";
    const resolution = resolveConflict(conflict, strategy, existingNames);
    changes.push(resolution);
  }

  // Apply all changes
  const { config, warnings } = applyChanges(input.existingConfig, changes);

  return {
    config,
    changes,
    conflicts: detection.conflicts,
    warnings,
  };
}

/**
 * Summarizes merge changes for display.
 *
 * @param changes - Changes from merge
 * @returns Summary counts
 */
export function summarizeChanges(changes: ConfigChange[]): {
  added: number;
  updated: number;
  renamed: number;
  skipped: number;
} {
  let added = 0;
  let updated = 0;
  let renamed = 0;
  let skipped = 0;

  for (const change of changes) {
    switch (change.type) {
      case "add":
        added++;
        break;
      case "update":
        updated++;
        break;
      case "rename":
        renamed++;
        break;
      case "skip":
        skipped++;
        break;
    }
  }

  return { added, updated, renamed, skipped };
}
