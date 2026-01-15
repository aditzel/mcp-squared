/**
 * Search latency benchmarks for MCP².
 *
 * These tests validate that tool discovery meets the <50ms latency requirement.
 * Fast mode (FTS5) is the primary target; semantic/hybrid modes may exceed 50ms.
 *
 * @module tests/benchmarks/search-latency
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Retriever } from "../../src/retriever/retriever.js";
import type { CatalogedTool, Cataloger } from "../../src/upstream/index.js";

// Target latency for fast mode search
const TARGET_LATENCY_MS = 50;

// Number of iterations for benchmark averaging
const BENCHMARK_ITERATIONS = 10;

/**
 * Generate mock tools for benchmarking.
 */
function generateMockTools(count: number): CatalogedTool[] {
  const tools: CatalogedTool[] = [];
  const serverNames = ["fs", "db", "api", "cloud", "local"];
  const toolTypes = [
    "read",
    "write",
    "delete",
    "update",
    "list",
    "create",
    "search",
    "query",
  ];

  for (let i = 0; i < count; i++) {
    // biome-ignore lint/style/noNonNullAssertion: modulo ensures valid index
    const serverKey = serverNames[i % serverNames.length]!;
    // biome-ignore lint/style/noNonNullAssertion: modulo ensures valid index
    const toolType = toolTypes[i % toolTypes.length]!;
    const toolName = `${toolType}_${serverKey}_tool_${i}`;

    tools.push({
      name: toolName,
      description: `A ${toolType} tool for ${serverKey} operations. This tool performs ${toolType} actions on the ${serverKey} system. Tool number ${i}.`,
      serverKey,
      inputSchema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "The target path" },
          options: {
            type: "object",
            properties: {
              recursive: { type: "boolean" },
              force: { type: "boolean" },
            },
          },
        },
        required: ["path"],
      },
    });
  }

  return tools;
}

/**
 * Create a mock cataloger with the given tools.
 */
function createMockCataloger(tools: CatalogedTool[]): Cataloger {
  const toolsByServer = new Map<string, CatalogedTool[]>();
  for (const tool of tools) {
    const existing = toolsByServer.get(tool.serverKey) ?? [];
    existing.push(tool);
    toolsByServer.set(tool.serverKey, existing);
  }

  return {
    getAllTools: () => tools,
    getToolsForServer: (key: string) => toolsByServer.get(key) ?? [],
    findTool: (name: string) => {
      const tool = tools.find((t) => t.name === name);
      return { tool, ambiguous: false, alternatives: [] };
    },
  } as unknown as Cataloger;
}

/**
 * Measure average latency over multiple iterations.
 */
async function measureLatency(
  fn: () => Promise<unknown> | unknown,
  iterations: number,
): Promise<{ avgMs: number; minMs: number; maxMs: number }> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);

  return { avgMs, minMs, maxMs };
}

describe("Search Latency Benchmarks", () => {
  let retriever: Retriever;

  afterEach(() => {
    if (retriever) {
      retriever.close();
    }
  });

  describe("Fast mode (FTS5) - Target: <50ms", () => {
    test("100 tools: search latency < 50ms", async () => {
      const tools = generateMockTools(100);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });
      retriever.syncFromCataloger();

      const { avgMs, minMs, maxMs } = await measureLatency(
        () => retriever.search("read file operations", { limit: 10 }),
        BENCHMARK_ITERATIONS,
      );

      console.log(
        `  100 tools: avg=${avgMs.toFixed(2)}ms, min=${minMs.toFixed(2)}ms, max=${maxMs.toFixed(2)}ms`,
      );
      expect(avgMs).toBeLessThan(TARGET_LATENCY_MS);
    });

    test("500 tools: search latency < 50ms", async () => {
      const tools = generateMockTools(500);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });
      retriever.syncFromCataloger();

      const { avgMs, minMs, maxMs } = await measureLatency(
        () => retriever.search("database query operations", { limit: 10 }),
        BENCHMARK_ITERATIONS,
      );

      console.log(
        `  500 tools: avg=${avgMs.toFixed(2)}ms, min=${minMs.toFixed(2)}ms, max=${maxMs.toFixed(2)}ms`,
      );
      expect(avgMs).toBeLessThan(TARGET_LATENCY_MS);
    });

    test("1000 tools: search latency < 50ms", async () => {
      const tools = generateMockTools(1000);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });
      retriever.syncFromCataloger();

      const { avgMs, minMs, maxMs } = await measureLatency(
        () => retriever.search("api cloud operations", { limit: 10 }),
        BENCHMARK_ITERATIONS,
      );

      console.log(
        `  1000 tools: avg=${avgMs.toFixed(2)}ms, min=${minMs.toFixed(2)}ms, max=${maxMs.toFixed(2)}ms`,
      );
      expect(avgMs).toBeLessThan(TARGET_LATENCY_MS);
    });

    test("various query types maintain low latency", async () => {
      const tools = generateMockTools(500);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });
      retriever.syncFromCataloger();

      const queries = [
        "read", // Single word
        "file operations", // Two words
        "read write delete update", // Multiple words
        "fs:read", // Server-prefixed (won't match but tests FTS)
        "nonexistent query that matches nothing", // No matches
      ];

      for (const query of queries) {
        const { avgMs } = await measureLatency(
          () => retriever.search(query, { limit: 10 }),
          5,
        );

        console.log(`  Query "${query}": avg=${avgMs.toFixed(2)}ms`);
        expect(avgMs).toBeLessThan(TARGET_LATENCY_MS);
      }
    });
  });

  describe("Index operations timing", () => {
    test("indexing 100 tools < 100ms", async () => {
      const tools = generateMockTools(100);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });

      const { avgMs, minMs, maxMs } = await measureLatency(
        () => retriever.syncFromCataloger(),
        5,
      );

      console.log(
        `  Index 100 tools: avg=${avgMs.toFixed(2)}ms, min=${minMs.toFixed(2)}ms, max=${maxMs.toFixed(2)}ms`,
      );
      expect(avgMs).toBeLessThan(100);
    });

    test("indexing 500 tools < 500ms", async () => {
      const tools = generateMockTools(500);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });

      const { avgMs, minMs, maxMs } = await measureLatency(
        () => retriever.syncFromCataloger(),
        3,
      );

      console.log(
        `  Index 500 tools: avg=${avgMs.toFixed(2)}ms, min=${minMs.toFixed(2)}ms, max=${maxMs.toFixed(2)}ms`,
      );
      expect(avgMs).toBeLessThan(500);
    });
  });

  describe("Result limit impact", () => {
    beforeEach(() => {
      const tools = generateMockTools(500);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });
      retriever.syncFromCataloger();
    });

    test("limit=5 search < 50ms", async () => {
      const { avgMs } = await measureLatency(
        () => retriever.search("read operations", { limit: 5 }),
        BENCHMARK_ITERATIONS,
      );
      console.log(`  Limit 5: avg=${avgMs.toFixed(2)}ms`);
      expect(avgMs).toBeLessThan(TARGET_LATENCY_MS);
    });

    test("limit=20 search < 50ms", async () => {
      const { avgMs } = await measureLatency(
        () => retriever.search("read operations", { limit: 20 }),
        BENCHMARK_ITERATIONS,
      );
      console.log(`  Limit 20: avg=${avgMs.toFixed(2)}ms`);
      expect(avgMs).toBeLessThan(TARGET_LATENCY_MS);
    });

    test("limit=50 search < 50ms", async () => {
      const { avgMs } = await measureLatency(
        () => retriever.search("read operations", { limit: 50 }),
        BENCHMARK_ITERATIONS,
      );
      console.log(`  Limit 50: avg=${avgMs.toFixed(2)}ms`);
      expect(avgMs).toBeLessThan(TARGET_LATENCY_MS);
    });
  });
});
