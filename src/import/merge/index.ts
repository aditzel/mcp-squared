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
  /** Servers already in sync (no action needed) */
  inSync: InSyncServer[];
  /** Warnings generated during merge */
  warnings: string[];
}

/**
 * Server that is already in sync (identical config exists in MCP²).
 */
export interface InSyncServer {
  /** Normalized server name */
  serverName: string;
  /** Source tool */
  sourceTool: ToolId;
  /** Source file path */
  sourcePath: string;
}

/**
 * Result of conflict detection.
 */
export interface ConflictDetectionResult {
  /** Servers without conflicts (new servers) */
  noConflict: Array<{
    server: MappedServer;
    tool: ToolId;
    path: string;
    originalName: string;
  }>;
  /** Servers with conflicts (different config exists) */
  conflicts: ImportConflict[];
  /** Servers already in sync (identical config exists) */
  inSync: InSyncServer[];
}

/**
 * Compares two upstream configs for equality.
 * Returns true if the configs are functionally identical.
 */
function areConfigsEqual(
  a: UpstreamServerConfig,
  b: UpstreamServerConfig,
): boolean {
  // Different transport types = not equal
  if (a.transport !== b.transport) {
    return false;
  }

  // Compare enabled status
  if (a.enabled !== b.enabled) {
    return false;
  }

  // Compare environment variables
  const aEnvKeys = Object.keys(a.env).sort();
  const bEnvKeys = Object.keys(b.env).sort();
  if (aEnvKeys.length !== bEnvKeys.length) {
    return false;
  }
  for (let i = 0; i < aEnvKeys.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop condition
    const key = aEnvKeys[i]!;
    if (key !== bEnvKeys[i] || a.env[key] !== b.env[key]) {
      return false;
    }
  }

  // Compare transport-specific fields
  if (a.transport === "stdio" && b.transport === "stdio") {
    if (a.stdio.command !== b.stdio.command) {
      return false;
    }
    if (a.stdio.cwd !== b.stdio.cwd) {
      return false;
    }
    // Compare args arrays
    if (a.stdio.args.length !== b.stdio.args.length) {
      return false;
    }
    for (let i = 0; i < a.stdio.args.length; i++) {
      if (a.stdio.args[i] !== b.stdio.args[i]) {
        return false;
      }
    }
  } else if (a.transport === "sse" && b.transport === "sse") {
    if (a.sse.url !== b.sse.url) {
      return false;
    }
    // Compare headers
    const aHeaderKeys = Object.keys(a.sse.headers).sort();
    const bHeaderKeys = Object.keys(b.sse.headers).sort();
    if (aHeaderKeys.length !== bHeaderKeys.length) {
      return false;
    }
    for (let i = 0; i < aHeaderKeys.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop condition
      const key = aHeaderKeys[i]!;
      if (key !== bHeaderKeys[i] || a.sse.headers[key] !== b.sse.headers[key]) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Detects conflicts between incoming servers and existing config.
 * Servers with identical configs are marked as "in sync" rather than conflicts.
 *
 * @param input - Merge input with incoming servers and existing config
 * @returns Conflict detection result
 */
export function detectConflicts(input: MergeInput): ConflictDetectionResult {
  const existingNames = new Set(Object.keys(input.existingConfig.upstreams));
  const result: ConflictDetectionResult = {
    noConflict: [],
    conflicts: [],
    inSync: [],
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
        const existingConfig = input.existingConfig.upstreams[normalizedName];
        if (existingConfig) {
          // Check if configs are identical
          if (areConfigsEqual(existingConfig, mapped.config)) {
            // Already in sync - no action needed
            result.inSync.push({
              serverName: normalizedName,
              sourceTool: group.tool,
              sourcePath: group.path,
            });
          } else {
            // Actual conflict - configs differ
            result.conflicts.push({
              serverName: normalizedName,
              existing: upstreamToExternal(normalizedName, existingConfig),
              incoming: server,
              sourceTool: group.tool,
              sourcePath: group.path,
            });
          }
        }
      } else {
        // No conflict - new server
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

  // Add non-conflicting servers - use upstreamToExternal to preserve all fields
  for (const item of detection.noConflict) {
    const normalizedName = normalizeServerName(item.originalName);
    // Convert the mapped config back to ExternalServer with all fields preserved
    const server = upstreamToExternal(normalizedName, item.server.config);
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
    inSync: detection.inSync,
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

  // Add non-conflicting servers - use upstreamToExternal to preserve all fields
  for (const item of detection.noConflict) {
    const normalizedName = normalizeServerName(item.originalName);
    // Convert the mapped config back to ExternalServer with all fields preserved
    const server = upstreamToExternal(normalizedName, item.server.config);
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
    inSync: detection.inSync,
    warnings,
  };
}

/**
 * Summarizes merge changes for display.
 *
 * @param changes - Changes from merge
 * @param inSyncCount - Number of servers already in sync
 * @returns Summary counts
 */
export function summarizeChanges(
  changes: ConfigChange[],
  inSyncCount = 0,
): {
  added: number;
  updated: number;
  renamed: number;
  skipped: number;
  inSync: number;
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

  return { added, updated, renamed, skipped, inSync: inSyncCount };
}
