import { describe, expect, test } from "bun:test";
import type { IndexStore } from "@/index/index";
import { StatsCollector } from "@/server/stats";

describe("StatsCollector", () => {
  describe("constructor", () => {
    test("creates collector with default options", () => {
      const collector = new StatsCollector();
      expect(collector).toBeDefined();
    });

    test("creates collector with index store", () => {
      const mockIndexStore: Pick<
        IndexStore,
        "getToolCount" | "getEmbeddingCount" | "getCooccurrenceCount"
      > = {
        getToolCount: () => 10,
        getEmbeddingCount: () => 5,
        getCooccurrenceCount: () => 3,
      };
      const collector = new StatsCollector({
        indexStore: mockIndexStore as unknown as IndexStore,
      });
      expect(collector).toBeDefined();
    });

    test("creates collector with tool tracking enabled", () => {
      const collector = new StatsCollector({ enableToolTracking: true });
      expect(collector).toBeDefined();
    });
  });

  describe("request tracking", () => {
    test("starts and ends request successfully", () => {
      const collector = new StatsCollector();
      const requestId = collector.startRequest();
      expect(requestId).toBe(1);

      collector.endRequest(requestId, true, 100);
      const stats = collector.getStats();
      expect(stats.requests.total).toBe(1);
      expect(stats.requests.successful).toBe(1);
      expect(stats.requests.failed).toBe(0);
    });

    test("tracks multiple requests", () => {
      const collector = new StatsCollector();
      const id1 = collector.startRequest();
      const id2 = collector.startRequest();
      const id3 = collector.startRequest();

      collector.endRequest(id1, true, 100);
      collector.endRequest(id2, false, 50);
      collector.endRequest(id3, true, 150);

      const stats = collector.getStats();
      expect(stats.requests.total).toBe(3);
      expect(stats.requests.successful).toBe(2);
      expect(stats.requests.failed).toBe(1);
    });

    test("handles invalid request ID", () => {
      const collector = new StatsCollector();
      collector.endRequest(999, true, 100);

      const stats = collector.getStats();
      expect(stats.requests.total).toBe(0);
    });

    test("tracks response times correctly", () => {
      const collector = new StatsCollector();
      const id1 = collector.startRequest();
      const id2 = collector.startRequest();
      const id3 = collector.startRequest();

      collector.endRequest(id1, true, 50);
      collector.endRequest(id2, true, 100);
      collector.endRequest(id3, true, 150);

      const stats = collector.getStats();
      expect(stats.requests.minResponseTime).toBe(50);
      expect(stats.requests.maxResponseTime).toBe(150);
      expect(stats.requests.totalResponseTime).toBe(300);
    });

    test("calculates average response time", () => {
      const collector = new StatsCollector();
      const id1 = collector.startRequest();
      const id2 = collector.startRequest();

      collector.endRequest(id1, true, 100);
      collector.endRequest(id2, true, 200);

      expect(collector.getAverageResponseTime()).toBe(150);
    });

    test("returns zero average when no requests", () => {
      const collector = new StatsCollector();
      expect(collector.getAverageResponseTime()).toBe(0);
    });
  });

  describe("connection tracking", () => {
    test("increments and decrements active connections", () => {
      const collector = new StatsCollector();
      expect(collector.getStats().activeConnections).toBe(0);

      collector.incrementActiveConnections();
      expect(collector.getStats().activeConnections).toBe(1);

      collector.incrementActiveConnections();
      expect(collector.getStats().activeConnections).toBe(2);

      collector.decrementActiveConnections();
      expect(collector.getStats().activeConnections).toBe(1);
    });

    test("prevents negative connection count", () => {
      const collector = new StatsCollector();
      collector.decrementActiveConnections();
      expect(collector.getStats().activeConnections).toBe(0);
    });
  });

  describe("cache tracking", () => {
    test("records cache hits and misses", () => {
      const collector = new StatsCollector();
      collector.recordCacheHit();
      collector.recordCacheHit();
      collector.recordCacheMiss();

      const stats = collector.getStats();
      expect(stats.cache.hits).toBe(2);
      expect(stats.cache.misses).toBe(1);
    });

    test("updates cache size", () => {
      const collector = new StatsCollector();
      collector.updateCacheSize(100);
      expect(collector.getStats().cache.size).toBe(100);

      collector.updateCacheSize(200);
      expect(collector.getStats().cache.size).toBe(200);
    });

    test("calculates cache hit rate", () => {
      const collector = new StatsCollector();
      collector.recordCacheHit();
      collector.recordCacheHit();
      collector.recordCacheHit();
      collector.recordCacheMiss();
      collector.recordCacheMiss();

      expect(collector.getCacheHitRate()).toBe(60);
    });

    test("returns zero hit rate when no cache activity", () => {
      const collector = new StatsCollector();
      expect(collector.getCacheHitRate()).toBe(0);
    });
  });

  describe("index tracking", () => {
    test("updates index refresh time", () => {
      const collector = new StatsCollector();
      const timestamp = Date.now();
      collector.updateIndexRefreshTime(timestamp);

      const stats = collector.getStats();
      expect(stats.index.lastRefreshTime).toBe(timestamp);
    });

    test("returns default index stats without index store", () => {
      const collector = new StatsCollector();
      const stats = collector.getStats();

      expect(stats.index.toolCount).toBe(0);
      expect(stats.index.embeddingCount).toBe(0);
      expect(stats.index.cooccurrenceCount).toBe(0);
    });

    test("returns index stats from index store", () => {
      const mockIndexStore: Pick<
        IndexStore,
        "getToolCount" | "getEmbeddingCount" | "getCooccurrenceCount"
      > = {
        getToolCount: () => 10,
        getEmbeddingCount: () => 5,
        getCooccurrenceCount: () => 3,
      };
      const collector = new StatsCollector({
        indexStore: mockIndexStore as unknown as IndexStore,
      });
      const stats = collector.getStats();

      expect(stats.index.toolCount).toBe(10);
      expect(stats.index.embeddingCount).toBe(5);
      expect(stats.index.cooccurrenceCount).toBe(3);
    });
  });

  describe("tool tracking", () => {
    test("does not track tools when disabled", () => {
      const collector = new StatsCollector({ enableToolTracking: false });
      const id = collector.startRequest();
      collector.endRequest(id, true, 100, "test_tool", "test_server");

      const toolStats = collector.getToolStats();
      expect(toolStats.length).toBe(0);
    });

    test("tracks tool calls when enabled", () => {
      const collector = new StatsCollector({ enableToolTracking: true });
      const id = collector.startRequest();
      collector.endRequest(id, true, 100, "test_tool", "test_server");

      const toolStats = collector.getToolStats();
      expect(toolStats.length).toBe(1);
      expect(toolStats[0]?.name).toBe("test_tool");
      expect(toolStats[0]?.serverKey).toBe("test_server");
      expect(toolStats[0]?.callCount).toBe(1);
    });

    test("tracks multiple tool calls", () => {
      const collector = new StatsCollector({ enableToolTracking: true });
      const id1 = collector.startRequest();
      const id2 = collector.startRequest();
      const id3 = collector.startRequest();

      collector.endRequest(id1, true, 100, "tool_a", "server_1");
      collector.endRequest(id2, true, 150, "tool_a", "server_1");
      collector.endRequest(id3, true, 200, "tool_b", "server_1");

      const toolStats = collector.getToolStats();
      expect(toolStats.length).toBe(2);

      const toolA = toolStats.find((t) => t.name === "tool_a");
      expect(toolA?.callCount).toBe(2);

      const toolB = toolStats.find((t) => t.name === "tool_b");
      expect(toolB?.callCount).toBe(1);
    });

    test("tracks tool success and failure", () => {
      const collector = new StatsCollector({ enableToolTracking: true });
      const id1 = collector.startRequest();
      const id2 = collector.startRequest();
      const id3 = collector.startRequest();

      collector.endRequest(id1, true, 100, "test_tool", "test_server");
      collector.endRequest(id2, true, 150, "test_tool", "test_server");
      collector.endRequest(id3, false, 50, "test_tool", "test_server");

      const toolStats = collector.getToolStats();
      expect(toolStats[0]?.successCount).toBe(2);
      expect(toolStats[0]?.failureCount).toBe(1);
    });

    test("calculates average tool response time", () => {
      const collector = new StatsCollector({ enableToolTracking: true });
      const id1 = collector.startRequest();
      const id2 = collector.startRequest();

      collector.endRequest(id1, true, 100, "test_tool", "test_server");
      collector.endRequest(id2, true, 200, "test_tool", "test_server");

      const toolStats = collector.getToolStats();
      expect(toolStats[0]?.avgResponseTime).toBe(150);
    });

    test("gets specific tool stats", () => {
      const collector = new StatsCollector({ enableToolTracking: true });
      const id = collector.startRequest();
      collector.endRequest(id, true, 100, "test_tool", "test_server");

      const toolStats = collector.getToolStat("test_tool", "test_server");
      expect(toolStats).toBeDefined();
      expect(toolStats?.name).toBe("test_tool");
    });

    test("returns undefined for unknown tool", () => {
      const collector = new StatsCollector({ enableToolTracking: true });
      const toolStats = collector.getToolStat("unknown", "unknown");
      expect(toolStats).toBeUndefined();
    });

    test("limits tool stats results", () => {
      const collector = new StatsCollector({ enableToolTracking: true });

      for (let i = 0; i < 20; i++) {
        const id = collector.startRequest();
        collector.endRequest(id, true, 100, `tool_${i}`, "server_1");
      }

      const toolStats = collector.getToolStats(10);
      expect(toolStats.length).toBe(10);
    });

    test("sorts tool stats by call count", () => {
      const collector = new StatsCollector({ enableToolTracking: true });
      const id1 = collector.startRequest();
      const id2 = collector.startRequest();
      const id3 = collector.startRequest();
      const id4 = collector.startRequest();

      collector.endRequest(id1, true, 100, "tool_a", "server_1");
      collector.endRequest(id2, true, 100, "tool_a", "server_1");
      collector.endRequest(id3, true, 100, "tool_a", "server_1");
      collector.endRequest(id4, true, 100, "tool_b", "server_1");

      const toolStats = collector.getToolStats();
      expect(toolStats[0]?.name).toBe("tool_a");
      expect(toolStats[0]?.callCount).toBe(3);
      expect(toolStats[1]?.name).toBe("tool_b");
      expect(toolStats[1]?.callCount).toBe(1);
    });
  });

  describe("success rate", () => {
    test("calculates success rate", () => {
      const collector = new StatsCollector();
      const id1 = collector.startRequest();
      const id2 = collector.startRequest();
      const id3 = collector.startRequest();
      const id4 = collector.startRequest();

      collector.endRequest(id1, true, 100);
      collector.endRequest(id2, true, 100);
      collector.endRequest(id3, true, 100);
      collector.endRequest(id4, false, 100);

      expect(collector.getSuccessRate()).toBe(75);
    });

    test("returns zero success rate when no requests", () => {
      const collector = new StatsCollector();
      expect(collector.getSuccessRate()).toBe(0);
    });
  });

  describe("memory stats", () => {
    test("returns memory statistics", () => {
      const collector = new StatsCollector();
      const stats = collector.getStats();

      expect(stats.memory.heapUsed).toBeGreaterThanOrEqual(0);
      expect(stats.memory.heapTotal).toBeGreaterThanOrEqual(0);
      expect(stats.memory.rss).toBeGreaterThanOrEqual(0);
      expect(stats.memory.external).toBeGreaterThanOrEqual(0);
      expect(stats.memory.arrayBuffers).toBeGreaterThanOrEqual(0);
    });
  });

  describe("uptime", () => {
    test("tracks uptime", async () => {
      const collector = new StatsCollector();
      const initialUptime = collector.getStats().uptime;
      expect(initialUptime).toBeGreaterThanOrEqual(0);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const laterUptime = collector.getStats().uptime;
      expect(laterUptime).toBeGreaterThan(initialUptime);
    });
  });

  describe("reset", () => {
    test("resets all statistics", () => {
      const collector = new StatsCollector({ enableToolTracking: true });
      const id1 = collector.startRequest();
      const id2 = collector.startRequest();

      collector.endRequest(id1, true, 100, "tool_a", "server_1");
      collector.endRequest(id2, false, 50, "tool_b", "server_1");
      collector.incrementActiveConnections();
      collector.recordCacheHit();
      collector.recordCacheMiss();
      collector.updateCacheSize(100);
      collector.updateIndexRefreshTime(Date.now());

      collector.reset();

      const stats = collector.getStats();
      expect(stats.requests.total).toBe(0);
      expect(stats.requests.successful).toBe(0);
      expect(stats.requests.failed).toBe(0);
      expect(stats.requests.totalResponseTime).toBe(0);
      expect(stats.requests.minResponseTime).toBe(0);
      expect(stats.requests.maxResponseTime).toBe(0);
      expect(stats.activeConnections).toBe(0);
      expect(stats.cache.hits).toBe(0);
      expect(stats.cache.misses).toBe(0);
      expect(stats.cache.size).toBe(0);
      expect(stats.index.lastRefreshTime).toBe(0);
      expect(collector.getToolStats().length).toBe(0);
    });
  });

  describe("timestamp", () => {
    test("includes timestamp in stats", () => {
      const collector = new StatsCollector();
      const before = Date.now();
      const stats = collector.getStats();
      const after = Date.now();

      expect(stats.timestamp).toBeGreaterThanOrEqual(before);
      expect(stats.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
