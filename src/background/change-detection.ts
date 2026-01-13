/**
 * Change detection utilities for tracking tool updates.
 *
 * This module provides pure functions for capturing snapshots of indexed tools
 * and detecting changes between snapshots. Used by IndexRefreshManager to
 * identify when upstream tools have been added, removed, or modified.
 *
 * @module background/change-detection
 */

import type { CatalogedTool, Cataloger } from "../upstream/index.js";

/**
 * Compute a hash for a tool's input schema.
 * Used for detecting schema changes.
 * @internal
 */
function hashSchema(schema: CatalogedTool["inputSchema"]): string {
  return Bun.hash(JSON.stringify(schema)).toString(16);
}

/**
 * A snapshot of tool state for change detection.
 * Maps qualified tool names ("server:tool") to their schema hashes.
 */
export interface ToolSnapshot {
  /** Map of "serverKey:toolName" to schema hash */
  tools: Map<string, string>;
  /** Timestamp when the snapshot was captured */
  timestamp: number;
}

/**
 * Changes detected between two snapshots.
 */
export interface ToolChanges {
  /** Server key these changes apply to (or "*" for all servers) */
  serverKey: string;
  /** Tool names that were added */
  added: string[];
  /** Tool names that were removed */
  removed: string[];
  /** Tool names whose schema changed */
  modified: string[];
  /** Timestamp of the change detection */
  timestamp: number;
}

/**
 * Capture a snapshot of all tools from the cataloger.
 *
 * @param cataloger - The cataloger to capture tools from
 * @returns A snapshot of current tool state
 */
export function captureSnapshot(cataloger: Cataloger): ToolSnapshot {
  const tools = new Map<string, string>();

  for (const tool of cataloger.getAllTools()) {
    const qualifiedName = `${tool.serverKey}:${tool.name}`;
    tools.set(qualifiedName, hashSchema(tool.inputSchema));
  }

  return {
    tools,
    timestamp: Date.now(),
  };
}

/**
 * Capture a snapshot of tools for a specific server.
 *
 * @param cataloger - The cataloger to capture tools from
 * @param serverKey - The server key to capture tools for
 * @returns A snapshot of current tool state for that server
 */
export function captureServerSnapshot(
  cataloger: Cataloger,
  serverKey: string,
): ToolSnapshot {
  const tools = new Map<string, string>();

  for (const tool of cataloger.getToolsForServer(serverKey)) {
    const qualifiedName = `${tool.serverKey}:${tool.name}`;
    tools.set(qualifiedName, hashSchema(tool.inputSchema));
  }

  return {
    tools,
    timestamp: Date.now(),
  };
}

/**
 * Detect changes between two snapshots.
 *
 * @param before - Snapshot before the change
 * @param after - Snapshot after the change
 * @param serverKey - Server key for the changes (default: "*" for all)
 * @returns Detected changes between the snapshots
 */
export function detectChanges(
  before: ToolSnapshot,
  after: ToolSnapshot,
  serverKey = "*",
): ToolChanges {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  // Find added and modified tools
  for (const [qualifiedName, newHash] of after.tools) {
    const oldHash = before.tools.get(qualifiedName);
    if (oldHash === undefined) {
      // Tool didn't exist before
      added.push(extractToolName(qualifiedName));
    } else if (oldHash !== newHash) {
      // Tool exists but schema changed
      modified.push(extractToolName(qualifiedName));
    }
  }

  // Find removed tools
  for (const qualifiedName of before.tools.keys()) {
    if (!after.tools.has(qualifiedName)) {
      removed.push(extractToolName(qualifiedName));
    }
  }

  return {
    serverKey,
    added,
    removed,
    modified,
    timestamp: Date.now(),
  };
}

/**
 * Check if there are any changes in the ToolChanges object.
 *
 * @param changes - The changes to check
 * @returns true if there are any changes
 */
export function hasChanges(changes: ToolChanges): boolean {
  return (
    changes.added.length > 0 ||
    changes.removed.length > 0 ||
    changes.modified.length > 0
  );
}

/**
 * Extract just the tool name from a qualified name.
 * @internal
 */
function extractToolName(qualifiedName: string): string {
  const colonIndex = qualifiedName.indexOf(":");
  return colonIndex >= 0 ? qualifiedName.slice(colonIndex + 1) : qualifiedName;
}
