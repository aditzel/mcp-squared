/**
 * Selection tracking for co-occurrence-based tool suggestions.
 *
 * Tracks which tools are used together in a session and persists
 * co-occurrence data to the IndexStore for future suggestions.
 *
 * @module caching/selection-tracker
 */

import type { IndexStore } from "../index/index.js";

/**
 * In-memory tracker for tools used in the current session.
 *
 * The SelectionTracker collects tools as they are executed within a session,
 * then flushes co-occurrence data to persistent storage when appropriate.
 *
 * @example
 * ```ts
 * const tracker = new SelectionTracker();
 *
 * // Track tool executions
 * tracker.trackToolUsage("fs:read_file");
 * tracker.trackToolUsage("fs:write_file");
 *
 * // Persist co-occurrences to store
 * tracker.flushToStore(indexStore);
 *
 * // Start fresh for next session
 * tracker.reset();
 * ```
 */
export class SelectionTracker {
  /** Set of tool keys used in the current session */
  private sessionTools: Set<string> = new Set();

  /**
   * Records a tool usage in the current session.
   *
   * @param toolKey - Tool key in format "serverKey:toolName"
   */
  trackToolUsage(toolKey: string): void {
    this.sessionTools.add(toolKey);
  }

  /**
   * Gets all tools used in the current session.
   *
   * @returns Array of tool keys
   */
  getSessionTools(): string[] {
    return Array.from(this.sessionTools);
  }

  /**
   * Returns the number of tools tracked in this session.
   *
   * @returns Count of unique tools
   */
  getSessionToolCount(): number {
    return this.sessionTools.size;
  }

  /**
   * Checks if a tool has been used in this session.
   *
   * @param toolKey - Tool key to check
   * @returns true if tool was used
   */
  hasToolUsage(toolKey: string): boolean {
    return this.sessionTools.has(toolKey);
  }

  /**
   * Flushes session co-occurrences to persistent storage.
   * Records all pairs of tools used together in this session.
   *
   * @param store - IndexStore to persist co-occurrences to
   */
  flushToStore(store: IndexStore): void {
    const tools = this.getSessionTools();
    if (tools.length >= 2) {
      store.recordCooccurrences(tools);
    }
  }

  /**
   * Resets the session tracker for a new session.
   * Call this when starting a new logical session.
   */
  reset(): void {
    this.sessionTools.clear();
  }
}
