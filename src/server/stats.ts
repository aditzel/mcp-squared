/**
 * Stats collection module for MCP² server.
 *
 * This module provides comprehensive statistics tracking for the MCP server,
 * including uptime, request metrics, performance data, and resource usage.
 *
 * @module server/stats
 */

import type { IndexStore } from "../index/index.js";

/**
 * Request statistics tracking.
 */
export interface RequestStats {
  /** Total number of requests processed */
  total: number;
  /** Number of successful requests */
  successful: number;
  /** Number of failed requests */
  failed: number;
  /** Cumulative response time in milliseconds */
  totalResponseTime: number;
  /** Minimum response time in milliseconds */
  minResponseTime: number;
  /** Maximum response time in milliseconds */
  maxResponseTime: number;
}

/**
 * Index statistics tracking.
 */
export interface IndexStats {
  /** Total number of indexed tools */
  toolCount: number;
  /** Number of tools with embeddings */
  embeddingCount: number;
  /** Number of co-occurrence records */
  cooccurrenceCount: number;
  /** Unix timestamp of last index refresh */
  lastRefreshTime: number;
}

/**
 * Cache statistics tracking.
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Current cache size (number of entries) */
  size: number;
}

/**
 * Memory usage statistics.
 */
export interface MemoryStats {
  /** Current heap used in bytes */
  heapUsed: number;
  /** Current heap total in bytes */
  heapTotal: number;
  /** RSS (Resident Set Size) in bytes */
  rss: number;
  /** External memory in bytes */
  external: number;
  /** Array buffers in bytes */
  arrayBuffers: number;
}

/**
 * Comprehensive server statistics.
 */
export interface ServerStats {
  /** Server uptime in milliseconds */
  uptime: number;
  /** Request statistics */
  requests: RequestStats;
  /** Number of currently active connections */
  activeConnections: number;
  /** Memory usage statistics */
  memory: MemoryStats;
  /** Index statistics */
  index: IndexStats;
  /** Cache statistics */
  cache: CacheStats;
  /** Unix timestamp when stats were collected */
  timestamp: number;
}

/**
 * Tool-specific statistics.
 */
export interface ToolStats {
  /** Tool name */
  name: string;
  /** Server key */
  serverKey: string;
  /** Number of times this tool was called */
  callCount: number;
  /** Number of successful calls */
  successCount: number;
  /** Number of failed calls */
  failureCount: number;
  /** Average response time in milliseconds */
  avgResponseTime: number;
  /** Last call timestamp */
  lastCallTime: number;
}

/**
 * Options for creating a StatsCollector.
 */
export interface StatsCollectorOptions {
  /** Index store instance for index statistics */
  indexStore?: IndexStore;
  /** Whether to enable detailed tool-level tracking (default: false) */
  enableToolTracking?: boolean;
}

/**
 * Statistics collector for MCP² server.
 *
 * Tracks server metrics including uptime, requests, performance,
 * memory usage, and index statistics. Designed to be thread-safe
 * and have minimal performance impact.
 *
 * @example
 * ```ts
 * const collector = new StatsCollector({ indexStore });
 * collector.start();
 *
 * // Track a request
 * const requestId = collector.startRequest();
 * // ... process request ...
 * collector.endRequest(requestId, true, 150);
 *
 * // Get current stats
 * const stats = collector.getStats();
 * ```
 */
export class StatsCollector {
  private readonly indexStore: IndexStore | undefined;
  private readonly enableToolTracking: boolean;
  private readonly startTime: number;
  private readonly requestStats: RequestStats;
  private readonly cacheStats: CacheStats;
  private readonly toolStats: Map<string, ToolStats>;
  private activeConnections: number;
  private lastIndexRefreshTime: number;
  private nextRequestId: number;
  private activeRequests: Map<number, number>;

  /**
   * Creates a new StatsCollector instance.
   *
   * @param options - Configuration options
   */
  constructor(options: StatsCollectorOptions = {}) {
    this.indexStore = options.indexStore;
    this.enableToolTracking = options.enableToolTracking ?? false;
    this.startTime = Date.now();
    this.activeConnections = 0;
    this.lastIndexRefreshTime = 0;
    this.nextRequestId = 1;
    this.activeRequests = new Map();

    // Initialize request stats
    this.requestStats = {
      total: 0,
      successful: 0,
      failed: 0,
      totalResponseTime: 0,
      minResponseTime: Number.POSITIVE_INFINITY,
      maxResponseTime: 0,
    };

    // Initialize cache stats
    this.cacheStats = {
      hits: 0,
      misses: 0,
      size: 0,
    };

    // Initialize tool stats map
    this.toolStats = new Map();
  }

  /**
   * Starts tracking a new request.
   *
   * @returns Request ID to use when ending the request
   */
  startRequest(): number {
    const requestId = this.nextRequestId++;
    this.activeRequests.set(requestId, Date.now());
    return requestId;
  }

  /**
   * Ends tracking for a request.
   *
   * @param requestId - Request ID from startRequest()
   * @param success - Whether the request was successful
   * @param responseTime - Response time in milliseconds
   * @param toolName - Optional tool name for tool-level tracking
   * @param serverKey - Optional server key for tool-level tracking
   */
  endRequest(
    requestId: number,
    success: boolean,
    responseTime: number,
    toolName?: string,
    serverKey?: string,
  ): void {
    const startTime = this.activeRequests.get(requestId);
    if (startTime === undefined) {
      return; // Invalid request ID
    }

    this.activeRequests.delete(requestId);

    // Update request stats
    this.requestStats.total++;
    if (success) {
      this.requestStats.successful++;
    } else {
      this.requestStats.failed++;
    }

    this.requestStats.totalResponseTime += responseTime;
    this.requestStats.minResponseTime = Math.min(
      this.requestStats.minResponseTime,
      responseTime,
    );
    this.requestStats.maxResponseTime = Math.max(
      this.requestStats.maxResponseTime,
      responseTime,
    );

    // Update tool stats if enabled
    if (
      this.enableToolTracking &&
      toolName !== undefined &&
      serverKey !== undefined
    ) {
      this.updateToolStats(toolName, serverKey, success, responseTime);
    }
  }

  /**
   * Updates tool-level statistics.
   *
   * @param toolName - Tool name
   * @param serverKey - Server key
   * @param success - Whether the call was successful
   * @param responseTime - Response time in milliseconds
   * @internal
   */
  private updateToolStats(
    toolName: string,
    serverKey: string,
    success: boolean,
    responseTime: number,
  ): void {
    const key = `${serverKey}:${toolName}`;
    const existing = this.toolStats.get(key);

    if (existing) {
      existing.callCount++;
      if (success) {
        existing.successCount++;
      } else {
        existing.failureCount++;
      }
      // Recalculate average
      existing.avgResponseTime =
        (existing.avgResponseTime * (existing.callCount - 1) + responseTime) /
        existing.callCount;
      existing.lastCallTime = Date.now();
    } else {
      this.toolStats.set(key, {
        name: toolName,
        serverKey,
        callCount: 1,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        avgResponseTime: responseTime,
        lastCallTime: Date.now(),
      });
    }
  }

  /**
   * Increments the active connection count.
   */
  incrementActiveConnections(): void {
    this.activeConnections++;
  }

  /**
   * Decrements the active connection count.
   */
  decrementActiveConnections(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  /**
   * Records a cache hit.
   */
  recordCacheHit(): void {
    this.cacheStats.hits++;
  }

  /**
   * Records a cache miss.
   */
  recordCacheMiss(): void {
    this.cacheStats.misses++;
  }

  /**
   * Updates the cache size.
   *
   * @param size - Current cache size
   */
  updateCacheSize(size: number): void {
    this.cacheStats.size = size;
  }

  /**
   * Updates the last index refresh time.
   *
   * @param timestamp - Unix timestamp of the refresh
   */
  updateIndexRefreshTime(timestamp: number): void {
    this.lastIndexRefreshTime = timestamp;
  }

  /**
   * Gets current memory usage statistics.
   *
   * @returns Memory statistics
   * @internal
   */
  private getMemoryStats(): MemoryStats {
    const memoryUsage = process.memoryUsage();
    return {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      rss: memoryUsage.rss,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers,
    };
  }

  /**
   * Gets current index statistics.
   *
   * @returns Index statistics
   * @internal
   */
  private getIndexStats(): IndexStats {
    if (!this.indexStore) {
      return {
        toolCount: 0,
        embeddingCount: 0,
        cooccurrenceCount: 0,
        lastRefreshTime: this.lastIndexRefreshTime,
      };
    }

    return {
      toolCount: this.indexStore.getToolCount(),
      embeddingCount: this.indexStore.getEmbeddingCount(),
      cooccurrenceCount: this.indexStore.getCooccurrenceCount(),
      lastRefreshTime: this.lastIndexRefreshTime,
    };
  }

  /**
   * Gets current cache statistics.
   *
   * @returns Cache statistics
   * @internal
   */
  private getCacheStats(): CacheStats {
    return {
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      size: this.cacheStats.size,
    };
  }

  /**
   * Gets current request statistics.
   *
   * @returns Request statistics
   * @internal
   */
  private getRequestStats(): RequestStats {
    const avgResponseTime =
      this.requestStats.total > 0
        ? this.requestStats.totalResponseTime / this.requestStats.total
        : 0;

    return {
      total: this.requestStats.total,
      successful: this.requestStats.successful,
      failed: this.requestStats.failed,
      totalResponseTime: this.requestStats.totalResponseTime,
      minResponseTime:
        this.requestStats.minResponseTime === Number.POSITIVE_INFINITY
          ? 0
          : this.requestStats.minResponseTime,
      maxResponseTime: this.requestStats.maxResponseTime,
    };
  }

  /**
   * Gets comprehensive server statistics.
   *
   * @returns Current server statistics
   */
  getStats(): ServerStats {
    return {
      uptime: Date.now() - this.startTime,
      requests: this.getRequestStats(),
      activeConnections: this.activeConnections,
      memory: this.getMemoryStats(),
      index: this.getIndexStats(),
      cache: this.getCacheStats(),
      timestamp: Date.now(),
    };
  }

  /**
   * Gets tool-level statistics.
   *
   * @param limit - Maximum number of tools to return (default: 100)
   * @returns Array of tool statistics sorted by call count
   */
  getToolStats(limit = 100): ToolStats[] {
    return Array.from(this.toolStats.values())
      .sort((a, b) => b.callCount - a.callCount)
      .slice(0, limit);
  }

  /**
   * Gets statistics for a specific tool.
   *
   * @param toolName - Tool name
   * @param serverKey - Server key
   * @returns Tool statistics if found, undefined otherwise
   */
  getToolStat(toolName: string, serverKey: string): ToolStats | undefined {
    return this.toolStats.get(`${serverKey}:${toolName}`);
  }

  /**
   * Resets all statistics.
   * Useful for testing or periodic resets.
   */
  reset(): void {
    this.requestStats.total = 0;
    this.requestStats.successful = 0;
    this.requestStats.failed = 0;
    this.requestStats.totalResponseTime = 0;
    this.requestStats.minResponseTime = Number.POSITIVE_INFINITY;
    this.requestStats.maxResponseTime = 0;

    this.cacheStats.hits = 0;
    this.cacheStats.misses = 0;
    this.cacheStats.size = 0;

    this.toolStats.clear();
    this.activeConnections = 0;
    this.lastIndexRefreshTime = 0;
  }

  /**
   * Gets the average response time in milliseconds.
   *
   * @returns Average response time, or 0 if no requests
   */
  getAverageResponseTime(): number {
    return this.requestStats.total > 0
      ? this.requestStats.totalResponseTime / this.requestStats.total
      : 0;
  }

  /**
   * Gets the cache hit rate as a percentage.
   *
   * @returns Hit rate (0-100), or 0 if no cache activity
   */
  getCacheHitRate(): number {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return total > 0 ? (this.cacheStats.hits / total) * 100 : 0;
  }

  /**
   * Gets the success rate as a percentage.
   *
   * @returns Success rate (0-100), or 0 if no requests
   */
  getSuccessRate(): number {
    return this.requestStats.total > 0
      ? (this.requestStats.successful / this.requestStats.total) * 100
      : 0;
  }
}
