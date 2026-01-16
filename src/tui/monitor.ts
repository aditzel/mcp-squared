/**
 * TUI monitor for MCP² server.
 *
 * This module implements a terminal user interface for monitoring MCP² server
 * via Unix Domain Socket. It displays real-time statistics including server status,
 * request metrics, memory usage, index statistics, cache statistics, and tool usage.
 *
 * @module tui/monitor
 */

import {
  ASCIIFontRenderable,
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  RGBA,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core";
import { getSocketFilePath } from "../config/paths.js";
import type { ServerStats, ToolStats } from "../server/stats.js";
import { MonitorClient } from "./monitor-client.js";

/**
 * Options for running the monitor TUI.
 */
export interface MonitorTuiOptions {
  /** Path to the Unix Domain Socket file (default: from config paths) */
  socketPath?: string;
  /** Auto-refresh interval in milliseconds (default: 2000) */
  refreshInterval?: number;
}

/**
 * Runs the monitor TUI.
 *
 * @param options - Configuration options
 * @returns Promise that resolves when the TUI exits
 */
export async function runMonitorTui(
  options: MonitorTuiOptions = {},
): Promise<void> {
  const socketPath = options.socketPath ?? getSocketFilePath();
  const refreshInterval = options.refreshInterval ?? 2000;

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
  });

  renderer.setBackgroundColor("#0f172a");

  const app = new MonitorTuiApp(renderer, socketPath, refreshInterval);
  await app.start();
}

/**
 * Monitor TUI application class.
 */
class MonitorTuiApp {
  private readonly renderer: CliRenderer;
  private readonly refreshInterval: number;
  private readonly client: MonitorClient;
  private container: BoxRenderable | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private currentStats: ServerStats | null = null;
  private currentTools: ToolStats[] = [];
  private lastError: string | null = null;
  private lastUpdateTime = 0;

  // Panel references
  private serverStatusPanel: BoxRenderable | null = null;
  private requestStatsPanel: BoxRenderable | null = null;
  private memoryStatsPanel: BoxRenderable | null = null;
  private indexStatsPanel: BoxRenderable | null = null;
  private cacheStatsPanel: BoxRenderable | null = null;
  private toolStatsPanel: BoxRenderable | null = null;
  private statusText: TextRenderable | null = null;

  // Text element references for updates
  private serverStatusElements: {
    uptime: TextRenderable | null;
    connections: TextRenderable | null;
    health: TextRenderable | null;
  } = { uptime: null, connections: null, health: null };

  private requestStatsElements: {
    total: TextRenderable | null;
    success: TextRenderable | null;
    failed: TextRenderable | null;
    rate: TextRenderable | null;
    avgTime: TextRenderable | null;
  } = { total: null, success: null, failed: null, rate: null, avgTime: null };

  private memoryStatsElements: {
    heapUsed: TextRenderable | null;
    heapTotal: TextRenderable | null;
    rss: TextRenderable | null;
    external: TextRenderable | null;
  } = { heapUsed: null, heapTotal: null, rss: null, external: null };

  private indexStatsElements: {
    tools: TextRenderable | null;
    embeddings: TextRenderable | null;
    cooccurrence: TextRenderable | null;
    lastRefresh: TextRenderable | null;
  } = { tools: null, embeddings: null, cooccurrence: null, lastRefresh: null };

  private cacheStatsElements: {
    hits: TextRenderable | null;
    misses: TextRenderable | null;
    hitRate: TextRenderable | null;
    size: TextRenderable | null;
  } = { hits: null, misses: null, hitRate: null, size: null };

  private toolStatsElements: Array<{
    name: TextRenderable | null;
    stats: TextRenderable | null;
  }> = [];

  constructor(
    renderer: CliRenderer,
    socketPath: string,
    refreshInterval: number,
  ) {
    this.renderer = renderer;
    this.refreshInterval = refreshInterval;
    this.client = new MonitorClient({ socketPath });
  }

  /**
   * Starts the monitor TUI.
   */
  async start(): Promise<void> {
    this.isRunning = true;
    this.setupLayout();
    this.setupKeyboardHandlers();

    // Initial data fetch
    await this.refreshData();

    // Start auto-refresh
    this.refreshTimer = setInterval(() => {
      this.refreshData().catch((error) => {
        console.error("Failed to refresh data:", error);
      });
    }, this.refreshInterval);

    this.updateDisplay();
  }

  /**
   * Stops the monitor TUI.
   */
  stop(): void {
    this.isRunning = false;

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.client.disconnect();
    this.renderer.destroy();
  }

  /**
   * Sets up the TUI layout.
   */
  private setupLayout(): void {
    this.container = new BoxRenderable(this.renderer, {
      id: "monitor-container",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });
    this.renderer.root.add(this.container);

    // Header
    this.addHeader();

    // Main content area with panels
    const mainContent = new BoxRenderable(this.renderer, {
      id: "monitor-main",
      flexDirection: "row",
      width: "100%",
      height: "100%",
      gap: 1,
    });
    this.container.add(mainContent);

    // Left column
    const leftColumn = new BoxRenderable(this.renderer, {
      id: "monitor-left",
      flexDirection: "column",
      width: "50%",
      height: "100%",
      gap: 1,
    });
    mainContent.add(leftColumn);

    // Right column
    const rightColumn = new BoxRenderable(this.renderer, {
      id: "monitor-right",
      flexDirection: "column",
      width: "50%",
      height: "100%",
      gap: 1,
    });
    mainContent.add(rightColumn);

    // Server status panel
    this.serverStatusPanel = this.createPanel(
      leftColumn,
      "Server Status",
      "#38bdf8",
      8,
    );
    this.createServerStatusElements();

    // Request statistics panel
    this.requestStatsPanel = this.createPanel(
      leftColumn,
      "Request Statistics",
      "#4ade80",
      8,
    );
    this.createRequestStatsElements();

    // Memory usage panel
    this.memoryStatsPanel = this.createPanel(
      leftColumn,
      "Memory Usage",
      "#fbbf24",
      8,
    );
    this.createMemoryStatsElements();

    // Index statistics panel
    this.indexStatsPanel = this.createPanel(
      rightColumn,
      "Index Statistics",
      "#a78bfa",
      8,
    );
    this.createIndexStatsElements();

    // Cache statistics panel
    this.cacheStatsPanel = this.createPanel(
      rightColumn,
      "Cache Statistics",
      "#f472b6",
      8,
    );
    this.createCacheStatsElements();

    // Tool statistics panel
    this.toolStatsPanel = this.createPanel(
      rightColumn,
      "Top Tools by Usage",
      "#22d3ee",
      12,
    );
    this.createToolStatsElements();

    // Status bar
    this.addStatusBar();
  }

  /**
   * Adds the header to the layout.
   */
  private addHeader(): void {
    if (!this.container) return;

    const headerRow = new BoxRenderable(this.renderer, {
      id: "monitor-header-row",
      flexDirection: "row",
      alignItems: "flex-start",
      marginBottom: 1,
    });
    this.container.add(headerRow);

    const titleMcp = new ASCIIFontRenderable(this.renderer, {
      id: "monitor-title-mcp",
      text: "MCP",
      font: "tiny",
      color: RGBA.fromHex("#38bdf8"),
    });
    headerRow.add(titleMcp);

    const titleSquared = new TextRenderable(this.renderer, {
      id: "monitor-title-squared",
      content: "²",
      fg: "#38bdf8",
    });
    headerRow.add(titleSquared);

    const subtitle = new TextRenderable(this.renderer, {
      id: "monitor-subtitle",
      content: "Server Monitor",
      fg: "#94a3b8",
      marginLeft: 2,
    });
    headerRow.add(subtitle);
  }

  /**
   * Adds the status bar to the layout.
   */
  private addStatusBar(): void {
    if (!this.container) return;

    const statusBar = new BoxRenderable(this.renderer, {
      id: "monitor-status-bar",
      flexDirection: "row",
      width: "100%",
      marginTop: 1,
    });
    this.container.add(statusBar);

    this.statusText = new TextRenderable(this.renderer, {
      id: "monitor-status-text",
      content: "Connecting...",
      fg: "#fbbf24",
    });
    statusBar.add(this.statusText);

    const instructions = new TextRenderable(this.renderer, {
      id: "monitor-instructions",
      content: "q: Quit | r: Refresh",
      fg: "#64748b",
      marginLeft: "auto",
    });
    statusBar.add(instructions);
  }

  /**
   * Creates a panel with a title.
   */
  private createPanel(
    parent: BoxRenderable,
    title: string,
    borderColor: string,
    height: number,
  ): BoxRenderable {
    const panel = new BoxRenderable(this.renderer, {
      id: `panel-${title.toLowerCase().replace(/\s+/g, "-")}`,
      width: "100%",
      height,
      border: true,
      borderStyle: "single",
      borderColor,
      title,
      titleAlignment: "left",
      backgroundColor: "#1e293b",
      flexDirection: "column",
      padding: 1,
    });
    parent.add(panel);
    return panel;
  }

  /**
   * Creates server status panel elements.
   */
  private createServerStatusElements(): void {
    if (!this.serverStatusPanel) return;

    this.serverStatusElements.uptime = new TextRenderable(this.renderer, {
      id: "server-status-uptime",
      content: "Uptime: --",
      fg: "#e2e8f0",
    });
    this.serverStatusPanel.add(this.serverStatusElements.uptime);

    this.serverStatusElements.connections = new TextRenderable(this.renderer, {
      id: "server-status-connections",
      content: "Connections: --",
      fg: "#e2e8f0",
    });
    this.serverStatusPanel.add(this.serverStatusElements.connections);

    this.serverStatusElements.health = new TextRenderable(this.renderer, {
      id: "server-status-health",
      content: "Health: --",
      fg: "#e2e8f0",
    });
    this.serverStatusPanel.add(this.serverStatusElements.health);
  }

  /**
   * Creates request statistics panel elements.
   */
  private createRequestStatsElements(): void {
    if (!this.requestStatsPanel) return;

    this.requestStatsElements.total = new TextRenderable(this.renderer, {
      id: "request-stats-total",
      content: "Total: --",
      fg: "#e2e8f0",
    });
    this.requestStatsPanel.add(this.requestStatsElements.total);

    this.requestStatsElements.success = new TextRenderable(this.renderer, {
      id: "request-stats-success",
      content: "Success: --",
      fg: "#4ade80",
    });
    this.requestStatsPanel.add(this.requestStatsElements.success);

    this.requestStatsElements.failed = new TextRenderable(this.renderer, {
      id: "request-stats-failed",
      content: "Failed: --",
      fg: "#f87171",
    });
    this.requestStatsPanel.add(this.requestStatsElements.failed);

    this.requestStatsElements.rate = new TextRenderable(this.renderer, {
      id: "request-stats-rate",
      content: "Success Rate: --",
      fg: "#e2e8f0",
    });
    this.requestStatsPanel.add(this.requestStatsElements.rate);

    this.requestStatsElements.avgTime = new TextRenderable(this.renderer, {
      id: "request-stats-avg-time",
      content: "Avg Response: --",
      fg: "#e2e8f0",
    });
    this.requestStatsPanel.add(this.requestStatsElements.avgTime);
  }

  /**
   * Creates memory statistics panel elements.
   */
  private createMemoryStatsElements(): void {
    if (!this.memoryStatsPanel) return;

    this.memoryStatsElements.heapUsed = new TextRenderable(this.renderer, {
      id: "memory-stats-heap-used",
      content: "Heap Used: --",
      fg: "#e2e8f0",
    });
    this.memoryStatsPanel.add(this.memoryStatsElements.heapUsed);

    this.memoryStatsElements.heapTotal = new TextRenderable(this.renderer, {
      id: "memory-stats-heap-total",
      content: "Heap Total: --",
      fg: "#e2e8f0",
    });
    this.memoryStatsPanel.add(this.memoryStatsElements.heapTotal);

    this.memoryStatsElements.rss = new TextRenderable(this.renderer, {
      id: "memory-stats-rss",
      content: "RSS: --",
      fg: "#e2e8f0",
    });
    this.memoryStatsPanel.add(this.memoryStatsElements.rss);

    this.memoryStatsElements.external = new TextRenderable(this.renderer, {
      id: "memory-stats-external",
      content: "External: --",
      fg: "#e2e8f0",
    });
    this.memoryStatsPanel.add(this.memoryStatsElements.external);
  }

  /**
   * Creates index statistics panel elements.
   */
  private createIndexStatsElements(): void {
    if (!this.indexStatsPanel) return;

    this.indexStatsElements.tools = new TextRenderable(this.renderer, {
      id: "index-stats-tools",
      content: "Tools: --",
      fg: "#e2e8f0",
    });
    this.indexStatsPanel.add(this.indexStatsElements.tools);

    this.indexStatsElements.embeddings = new TextRenderable(this.renderer, {
      id: "index-stats-embeddings",
      content: "Embeddings: --",
      fg: "#e2e8f0",
    });
    this.indexStatsPanel.add(this.indexStatsElements.embeddings);

    this.indexStatsElements.cooccurrence = new TextRenderable(this.renderer, {
      id: "index-stats-cooccurrence",
      content: "Co-occurrence: --",
      fg: "#e2e8f0",
    });
    this.indexStatsPanel.add(this.indexStatsElements.cooccurrence);

    this.indexStatsElements.lastRefresh = new TextRenderable(this.renderer, {
      id: "index-stats-last-refresh",
      content: "Last Refresh: --",
      fg: "#e2e8f0",
    });
    this.indexStatsPanel.add(this.indexStatsElements.lastRefresh);
  }

  /**
   * Creates cache statistics panel elements.
   */
  private createCacheStatsElements(): void {
    if (!this.cacheStatsPanel) return;

    this.cacheStatsElements.hits = new TextRenderable(this.renderer, {
      id: "cache-stats-hits",
      content: "Hits: --",
      fg: "#4ade80",
    });
    this.cacheStatsPanel.add(this.cacheStatsElements.hits);

    this.cacheStatsElements.misses = new TextRenderable(this.renderer, {
      id: "cache-stats-misses",
      content: "Misses: --",
      fg: "#f87171",
    });
    this.cacheStatsPanel.add(this.cacheStatsElements.misses);

    this.cacheStatsElements.hitRate = new TextRenderable(this.renderer, {
      id: "cache-stats-hit-rate",
      content: "Hit Rate: --",
      fg: "#e2e8f0",
    });
    this.cacheStatsPanel.add(this.cacheStatsElements.hitRate);

    this.cacheStatsElements.size = new TextRenderable(this.renderer, {
      id: "cache-stats-size",
      content: "Size: --",
      fg: "#e2e8f0",
    });
    this.cacheStatsPanel.add(this.cacheStatsElements.size);
  }

  /**
   * Creates tool statistics panel elements.
   */
  private createToolStatsElements(): void {
    if (!this.toolStatsPanel) return;

    // Create placeholder elements for up to 8 tools
    for (let i = 0; i < 8; i++) {
      const nameElement = new TextRenderable(this.renderer, {
        id: `tool-stats-${i}-name`,
        content: "",
        fg: "#e2e8f0",
      });
      this.toolStatsPanel.add(nameElement);

      const statsElement = new TextRenderable(this.renderer, {
        id: `tool-stats-${i}-stats`,
        content: "",
        fg: "#64748b",
      });
      this.toolStatsPanel.add(statsElement);

      this.toolStatsElements.push({ name: nameElement, stats: statsElement });
    }
  }

  /**
   * Sets up keyboard handlers.
   */
  private setupKeyboardHandlers(): void {
    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
      if (key.name === "q") {
        this.stop();
        process.exit(0);
      } else if (key.name === "r") {
        this.refreshData().catch((error) => {
          console.error("Failed to refresh data:", error);
        });
      } else if (key.name === "c" && key.ctrl) {
        this.stop();
        process.exit(0);
      }
    });
  }

  /**
   * Refreshes data from the monitor server.
   */
  private async refreshData(): Promise<void> {
    try {
      if (!this.client.isClientConnected()) {
        await this.client.connect();
      }

      // Fetch stats
      this.currentStats = await this.client.getStats();

      // Fetch tools
      this.currentTools = await this.client.getTools(10);

      this.lastError = null;
      this.lastUpdateTime = Date.now();
      this.updateDisplay();
    } catch (error) {
      const err = error as Error;
      this.lastError = err.message;
      this.updateDisplay();
    }
  }

  /**
   * Updates the display with current data.
   */
  private updateDisplay(): void {
    if (!this.isRunning) return;

    // Update status text
    if (this.statusText) {
      if (this.lastError) {
        this.statusText.content = `Error: ${this.lastError}`;
        this.statusText.fg = "#f87171";
      } else if (this.currentStats) {
        const timeSinceUpdate = Date.now() - this.lastUpdateTime;
        this.statusText.content = `Last update: ${timeSinceUpdate}ms ago`;
        this.statusText.fg = "#4ade80";
      } else {
        this.statusText.content = "Connecting...";
        this.statusText.fg = "#fbbf24";
      }
    }

    // Update panels
    this.updateServerStatusPanel();
    this.updateRequestStatsPanel();
    this.updateMemoryStatsPanel();
    this.updateIndexStatsPanel();
    this.updateCacheStatsPanel();
    this.updateToolStatsPanel();
  }

  /**
   * Updates the server status panel.
   */
  private updateServerStatusPanel(): void {
    if (!this.currentStats) return;

    const uptime = this.formatUptime(this.currentStats.uptime);
    const health = this.currentStats.activeConnections > 0 ? "Healthy" : "Idle";

    if (this.serverStatusElements.uptime) {
      this.serverStatusElements.uptime.content = `Uptime: ${uptime}`;
    }

    if (this.serverStatusElements.connections) {
      this.serverStatusElements.connections.content = `Connections: ${this.currentStats.activeConnections}`;
    }

    if (this.serverStatusElements.health) {
      this.serverStatusElements.health.content = `Health: ${health}`;
      this.serverStatusElements.health.fg =
        health === "Healthy" ? "#4ade80" : "#fbbf24";
    }
  }

  /**
   * Updates the request statistics panel.
   */
  private updateRequestStatsPanel(): void {
    if (!this.currentStats) return;

    const { requests } = this.currentStats;
    const successRate =
      requests.total > 0
        ? ((requests.successful / requests.total) * 100).toFixed(1)
        : "0.0";
    const avgResponseTime =
      requests.total > 0
        ? (requests.totalResponseTime / requests.total).toFixed(2)
        : "0.00";

    if (this.requestStatsElements.total) {
      this.requestStatsElements.total.content = `Total: ${requests.total}`;
    }

    if (this.requestStatsElements.success) {
      this.requestStatsElements.success.content = `Success: ${requests.successful}`;
    }

    if (this.requestStatsElements.failed) {
      this.requestStatsElements.failed.content = `Failed: ${requests.failed}`;
    }

    if (this.requestStatsElements.rate) {
      this.requestStatsElements.rate.content = `Success Rate: ${successRate}%`;
    }

    if (this.requestStatsElements.avgTime) {
      this.requestStatsElements.avgTime.content = `Avg Response: ${avgResponseTime}ms`;
    }
  }

  /**
   * Updates the memory usage panel.
   */
  private updateMemoryStatsPanel(): void {
    if (!this.currentStats) return;

    const { memory } = this.currentStats;
    const heapUsed = this.formatBytes(memory.heapUsed);
    const heapTotal = this.formatBytes(memory.heapTotal);
    const rss = this.formatBytes(memory.rss);
    const external = this.formatBytes(memory.external);

    if (this.memoryStatsElements.heapUsed) {
      this.memoryStatsElements.heapUsed.content = `Heap Used: ${heapUsed}`;
    }

    if (this.memoryStatsElements.heapTotal) {
      this.memoryStatsElements.heapTotal.content = `Heap Total: ${heapTotal}`;
    }

    if (this.memoryStatsElements.rss) {
      this.memoryStatsElements.rss.content = `RSS: ${rss}`;
    }

    if (this.memoryStatsElements.external) {
      this.memoryStatsElements.external.content = `External: ${external}`;
    }
  }

  /**
   * Updates the index statistics panel.
   */
  private updateIndexStatsPanel(): void {
    if (!this.currentStats) return;

    const { index } = this.currentStats;
    const lastRefresh = index.lastRefreshTime
      ? this.formatTimeAgo(index.lastRefreshTime)
      : "Never";

    if (this.indexStatsElements.tools) {
      this.indexStatsElements.tools.content = `Tools: ${index.toolCount}`;
    }

    if (this.indexStatsElements.embeddings) {
      this.indexStatsElements.embeddings.content = `Embeddings: ${index.embeddingCount}`;
    }

    if (this.indexStatsElements.cooccurrence) {
      this.indexStatsElements.cooccurrence.content = `Co-occurrence: ${index.cooccurrenceCount}`;
    }

    if (this.indexStatsElements.lastRefresh) {
      this.indexStatsElements.lastRefresh.content = `Last Refresh: ${lastRefresh}`;
    }
  }

  /**
   * Updates the cache statistics panel.
   */
  private updateCacheStatsPanel(): void {
    if (!this.currentStats) return;

    const { cache } = this.currentStats;
    const total = cache.hits + cache.misses;
    const hitRate = total > 0 ? ((cache.hits / total) * 100).toFixed(1) : "0.0";

    if (this.cacheStatsElements.hits) {
      this.cacheStatsElements.hits.content = `Hits: ${cache.hits}`;
    }

    if (this.cacheStatsElements.misses) {
      this.cacheStatsElements.misses.content = `Misses: ${cache.misses}`;
    }

    if (this.cacheStatsElements.hitRate) {
      this.cacheStatsElements.hitRate.content = `Hit Rate: ${hitRate}%`;
    }

    if (this.cacheStatsElements.size) {
      this.cacheStatsElements.size.content = `Size: ${cache.size} entries`;
    }
  }

  /**
   * Updates the tool statistics panel.
   */
  private updateToolStatsPanel(): void {
    for (let i = 0; i < this.toolStatsElements.length; i++) {
      const element = this.toolStatsElements[i];
      const tool = this.currentTools[i];

      if (!element) continue;

      if (tool) {
        if (element.name) {
          element.name.content = `${tool.name} (${tool.serverKey})`;
        }
        if (element.stats) {
          element.stats.content = `  Calls: ${tool.callCount} | Success: ${tool.successCount} | Avg: ${tool.avgResponseTime.toFixed(2)}ms`;
        }
        continue;
      }

      if (element.name) {
        element.name.content = "";
      }
      if (element.stats) {
        element.stats.content = "";
      }
    }
  }

  /**
   * Formats uptime in a human-readable format.
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Formats bytes in a human-readable format.
   */
  private formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Formats time ago in a human-readable format.
   */
  private formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ago`;
    }
    if (hours > 0) {
      return `${hours}h ago`;
    }
    if (minutes > 0) {
      return `${minutes}m ago`;
    }
    return `${seconds}s ago`;
  }
}
