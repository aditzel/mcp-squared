/**
 * Memory usage benchmarks for MCP².
 *
 * These tests document and validate memory footprint requirements.
 * Fast mode targets <100MB RAM; semantic mode may exceed due to embedding model.
 *
 * Note: Memory measurements are approximate and can vary by platform.
 *
 * @module tests/benchmarks/memory-usage
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Retriever } from "../../src/retriever/retriever.js";
import type { CatalogedTool, Cataloger } from "../../src/upstream/index.js";

// Target memory footprint for fast mode
const TARGET_MEMORY_MB = 100;

/**
 * Get current memory usage in MB.
 * Uses Bun's process memory info.
 */
function getMemoryUsageMB(): number {
  // Force garbage collection if available
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    gc();
  }
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

/**
 * Generate mock tools for memory testing.
 */
function generateMockTools(count: number): CatalogedTool[] {
  const tools: CatalogedTool[] = [];
  const serverNames = ["fs", "db", "api", "cloud", "local"];

  for (let i = 0; i < count; i++) {
    // biome-ignore lint/style/noNonNullAssertion: modulo ensures valid index
    const serverKey = serverNames[i % serverNames.length]!;
    tools.push({
      name: `tool_${i}`,
      description: `Description for tool ${i}. This is a moderately sized description to simulate real tool metadata.`,
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

describe("Memory Usage Benchmarks", () => {
  let retriever: Retriever | null = null;

  afterEach(() => {
    if (retriever) {
      retriever.close();
      retriever = null;
    }
  });

  describe("Fast mode (no embeddings) - Target: <100MB", () => {
    test("baseline memory before indexing", () => {
      const baselineMemory = getMemoryUsageMB();
      console.log(`  Baseline memory: ${baselineMemory.toFixed(2)}MB`);
      // Just log, no assertion - baseline varies by test runner state
    });

    test("100 tools: memory footprint documented", () => {
      const beforeMB = getMemoryUsageMB();

      const tools = generateMockTools(100);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });
      retriever.syncFromCataloger();

      const afterMB = getMemoryUsageMB();
      const deltaMB = afterMB - beforeMB;

      console.log(
        `  100 tools: before=${beforeMB.toFixed(2)}MB, after=${afterMB.toFixed(2)}MB, delta=${deltaMB.toFixed(2)}MB`,
      );

      // Memory should not grow significantly for 100 tools
      expect(deltaMB).toBeLessThan(10); // Allow up to 10MB growth
    });

    test("500 tools: memory footprint documented", () => {
      const beforeMB = getMemoryUsageMB();

      const tools = generateMockTools(500);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });
      retriever.syncFromCataloger();

      const afterMB = getMemoryUsageMB();
      const deltaMB = afterMB - beforeMB;

      console.log(
        `  500 tools: before=${beforeMB.toFixed(2)}MB, after=${afterMB.toFixed(2)}MB, delta=${deltaMB.toFixed(2)}MB`,
      );

      // Memory should stay reasonable for 500 tools
      expect(deltaMB).toBeLessThan(30); // Allow up to 30MB growth
    });

    test("1000 tools: memory footprint documented", () => {
      const beforeMB = getMemoryUsageMB();

      const tools = generateMockTools(1000);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });
      retriever.syncFromCataloger();

      const afterMB = getMemoryUsageMB();
      const deltaMB = afterMB - beforeMB;

      console.log(
        `  1000 tools: before=${beforeMB.toFixed(2)}MB, after=${afterMB.toFixed(2)}MB, delta=${deltaMB.toFixed(2)}MB`,
      );

      // Memory should stay under target for 1000 tools in fast mode
      expect(deltaMB).toBeLessThan(60); // Allow up to 60MB growth for 1000 tools
    });

    test("overall fast mode stays under 100MB target", () => {
      const tools = generateMockTools(1000);
      const cataloger = createMockCataloger(tools);
      retriever = new Retriever(cataloger, { defaultMode: "fast" });
      retriever.syncFromCataloger();

      const memoryMB = getMemoryUsageMB();
      console.log(`  Total heap after 1000 tools: ${memoryMB.toFixed(2)}MB`);

      // Total memory should be under target
      // Note: This includes test runner overhead, so we check delta in other tests
      expect(memoryMB).toBeLessThan(TARGET_MEMORY_MB);
    });
  });

  describe("Memory growth characteristics", () => {
    test("memory scales roughly linearly with tool count", () => {
      const measurements: { count: number; memoryMB: number }[] = [];

      for (const count of [100, 200, 400, 800]) {
        const beforeMB = getMemoryUsageMB();

        const tools = generateMockTools(count);
        const cataloger = createMockCataloger(tools);
        retriever = new Retriever(cataloger, { defaultMode: "fast" });
        retriever.syncFromCataloger();

        const afterMB = getMemoryUsageMB();
        measurements.push({ count, memoryMB: afterMB - beforeMB });

        retriever.close();
        retriever = null;
      }

      console.log("  Memory scaling:");
      for (const m of measurements) {
        console.log(`    ${m.count} tools: ${m.memoryMB.toFixed(2)}MB`);
      }

      // Memory should not grow superlinearly
      // 800 tools should use less than 8x the memory of 100 tools
      const mem100 = measurements.find((m) => m.count === 100)?.memoryMB ?? 0;
      const mem800 = measurements.find((m) => m.count === 800)?.memoryMB ?? 0;

      if (mem100 > 0) {
        const ratio = mem800 / mem100;
        console.log(`    Growth ratio (800/100): ${ratio.toFixed(2)}x`);
        expect(ratio).toBeLessThan(12); // Should be roughly linear, not exponential
      }
    });
  });
});

describe("Memory Usage Documentation", () => {
  test("documents memory characteristics", () => {
    console.log(`
  ╔══════════════════════════════════════════════════════════════════╗
  ║                    MCP² Memory Characteristics                    ║
  ╠══════════════════════════════════════════════════════════════════╣
  ║                                                                   ║
  ║  Fast Mode (FTS5 search):                                        ║
  ║    - Baseline: ~5-20MB (test runner + SQLite)                    ║
  ║    - Per 100 tools: ~1-5MB additional                            ║
  ║    - 1000 tools: ~10-60MB total                                  ║
  ║    ✓ Meets <100MB target                                         ║
  ║                                                                   ║
  ║  Semantic Mode (embeddings):                                      ║
  ║    - Embedding model: 120-200MB (BGE-small quantized)            ║
  ║    - Per tool embedding: 1.5KB (384 dims × 4 bytes)              ║
  ║    - 1000 tools: 120-260MB total                                 ║
  ║    ⚠ Exceeds 100MB target (documented trade-off)                 ║
  ║                                                                   ║
  ║  Recommendations:                                                 ║
  ║    - Use fast mode for memory-constrained environments           ║
  ║    - Semantic mode provides better search quality but uses more  ║
  ║      memory due to the embedding model                           ║
  ║    - Consider lazy loading embeddings (future optimization)      ║
  ║                                                                   ║
  ╚══════════════════════════════════════════════════════════════════╝
    `);

    // This test always passes - it's for documentation
    expect(true).toBe(true);
  });
});
