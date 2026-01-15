/**
 * Background index refresh manager.
 *
 * This module implements automatic background refreshing of the tool index
 * from upstream MCP servers. It periodically polls upstreams for tool changes
 * and updates the local search index without blocking request handling.
 *
 * @module background/index-refresh
 */

import { EventEmitter } from "node:events";
import type { Retriever } from "../retriever/index.js";
import type { Cataloger } from "../upstream/index.js";
import {
  type ToolChanges,
  type ToolSnapshot,
  captureSnapshot,
  detectChanges,
  hasChanges,
} from "./change-detection.js";

/**
 * Configuration options for IndexRefreshManager.
 */
export interface IndexRefreshManagerOptions {
  /** The cataloger to refresh tools from */
  cataloger: Cataloger;
  /** The retriever to sync the index to */
  retriever: Retriever;
  /** Refresh interval in milliseconds (default: 30000) */
  refreshIntervalMs?: number;
}

/**
 * Events emitted by IndexRefreshManager.
 */
export interface IndexRefreshManagerEvents {
  /** Emitted when a refresh cycle starts */
  "refresh:start": [];
  /** Emitted when a refresh cycle completes successfully */
  "refresh:complete": [duration: number];
  /** Emitted when tool changes are detected */
  "tools:changed": [changes: ToolChanges];
  /** Emitted when a refresh cycle fails */
  "refresh:error": [error: Error];
}

/**
 * Manages automatic background refreshing of the tool index.
 *
 * The manager periodically polls upstream MCP servers for tool updates
 * and synchronizes changes to the local search index. It emits events
 * for monitoring and integrating with the rest of the system.
 *
 * @example
 * ```ts
 * const manager = new IndexRefreshManager({
 *   cataloger,
 *   retriever,
 *   refreshIntervalMs: 30000,
 * });
 *
 * manager.on('tools:changed', (changes) => {
 *   console.log('Tools changed:', changes);
 * });
 *
 * manager.start();
 * // Later...
 * manager.stop();
 * ```
 */
export class IndexRefreshManager extends EventEmitter<IndexRefreshManagerEvents> {
  private readonly cataloger: Cataloger;
  private readonly retriever: Retriever;
  private readonly refreshIntervalMs: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRefreshing = false;
  private lastSnapshot: ToolSnapshot | null = null;

  /**
   * Creates a new IndexRefreshManager instance.
   *
   * @param options - Configuration options
   */
  constructor(options: IndexRefreshManagerOptions) {
    super();
    this.cataloger = options.cataloger;
    this.retriever = options.retriever;
    this.refreshIntervalMs = options.refreshIntervalMs ?? 30000;
  }

  /**
   * Starts the background refresh timer.
   * Does nothing if already started.
   */
  start(): void {
    if (this.intervalId !== null) {
      return; // Already started
    }

    // Capture initial snapshot
    this.lastSnapshot = captureSnapshot(this.cataloger);

    // Start the interval timer
    this.intervalId = setInterval(() => {
      void this.refresh();
    }, this.refreshIntervalMs);
  }

  /**
   * Stops the background refresh timer.
   * Does nothing if not running.
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Returns whether the refresh timer is currently running.
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Returns whether a refresh is currently in progress.
   */
  isRefreshInProgress(): boolean {
    return this.isRefreshing;
  }

  /**
   * Forces an immediate refresh, bypassing the interval timer.
   * If a refresh is already in progress, waits for it to complete.
   *
   * @returns Promise that resolves when the refresh is complete
   */
  async forceRefresh(): Promise<void> {
    // If already refreshing, wait for completion
    if (this.isRefreshing) {
      await new Promise<void>((resolve) => {
        const onComplete = () => {
          this.off("refresh:complete", onComplete);
          this.off("refresh:error", onError);
          resolve();
        };
        const onError = () => {
          this.off("refresh:complete", onComplete);
          this.off("refresh:error", onError);
          resolve();
        };
        this.once("refresh:complete", onComplete);
        this.once("refresh:error", onError);
      });
      return;
    }

    await this.refresh();
  }

  /**
   * Performs a single refresh cycle.
   * @internal
   */
  private async refresh(): Promise<void> {
    // Skip if already refreshing (for interval-triggered calls)
    if (this.isRefreshing) {
      return;
    }

    this.isRefreshing = true;
    const startTime = Date.now();

    this.emit("refresh:start");

    try {
      // Refresh all tools from upstreams
      await this.cataloger.refreshAllTools();

      // Capture new snapshot
      const newSnapshot = captureSnapshot(this.cataloger);

      // Detect changes if we have a previous snapshot
      if (this.lastSnapshot) {
        const changes = detectChanges(this.lastSnapshot, newSnapshot);
        if (hasChanges(changes)) {
          this.emit("tools:changed", changes);
        }
      }

      // Update the index
      this.retriever.syncFromCataloger();

      // Save snapshot for next comparison
      this.lastSnapshot = newSnapshot;

      const duration = Date.now() - startTime;
      this.emit("refresh:complete", duration);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit("refresh:error", error);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Returns the refresh interval in milliseconds.
   */
  getRefreshIntervalMs(): number {
    return this.refreshIntervalMs;
  }
}
