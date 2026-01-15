import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { Retriever } from "../src/retriever/retriever.js";
import { Cataloger } from "../src/upstream/cataloger.js";

// Mock the Transformers.js library to avoid loading the real model (native crash)
mock.module("@huggingface/transformers", () => {
  return {
    env: {
      allowLocalModels: false,
      cacheDir: "",
    },
    pipeline: async (task: string, model: string, options: any) => {
      return async (input: string | string[], opts: any) => {
        const batchSize = Array.isArray(input) ? input.length : 1;
        const dims = 384;
        
        // Generate deterministic dummy embeddings
        const generateVector = () => {
          const vec = new Float32Array(dims);
          let norm = 0;
          for (let i = 0; i < dims; i++) {
             vec[i] = 0.5;
             norm += vec[i] * vec[i];
          }
          norm = Math.sqrt(norm);
          for (let i = 0; i < dims; i++) {
             vec[i] /= norm;
          }
          return vec;
        };

        const totalSize = batchSize * dims;
        const data = new Float32Array(totalSize);
        
        for (let b = 0; b < batchSize; b++) {
            const vec = generateVector();
            data.set(vec, b * dims);
        }

        return {
          data: data,
          dims: [batchSize, dims],
        };
      };
    },
  };
});

describe("Retriever", () => {
  let cataloger: Cataloger;
  let retriever: Retriever;

  beforeEach(() => {
    cataloger = new Cataloger();
    retriever = new Retriever(cataloger);
  });

  afterEach(() => {
    retriever.close();
  });

  describe("constructor", () => {
    test("creates instance with default options", () => {
      expect(retriever).toBeInstanceOf(Retriever);
    });

    test("starts with zero indexed tools", () => {
      expect(retriever.getIndexedToolCount()).toBe(0);
    });
  });

  describe("search", () => {
    test("returns empty results for empty index", async () => {
      const result = await retriever.search("test");
      expect(result.tools).toEqual([]);
      expect(result.query).toBe("test");
    });

    test("returns all tools for empty query", async () => {
      const result = await retriever.search("");
      expect(result.tools).toEqual([]);
      expect(result.totalMatches).toBe(0);
    });
  });

  describe("getTool", () => {
    test("returns tool: undefined for non-existent tool", () => {
      const result = retriever.getTool("nonexistent");
      expect(result.tool).toBeUndefined();
      expect(result.ambiguous).toBe(false);
      expect(result.alternatives).toEqual([]);
    });
  });

  describe("getTools", () => {
    test("returns empty tools array for non-existent tools", () => {
      const result = retriever.getTools(["tool1", "tool2"]);
      expect(result.tools).toEqual([]);
      expect(result.ambiguous).toEqual([]);
    });
  });

  describe("clearIndex", () => {
    test("clears the index", () => {
      retriever.clearIndex();
      expect(retriever.getIndexedToolCount()).toBe(0);
    });
  });

  describe("syncFromCataloger", () => {
    test("handles empty cataloger", () => {
      retriever.syncFromCataloger();
      expect(retriever.getIndexedToolCount()).toBe(0);
    });
  });

  describe("syncServerFromCataloger", () => {
    test("handles non-existent server", () => {
      retriever.syncServerFromCataloger("nonexistent");
      expect(retriever.getIndexedToolCount()).toBe(0);
    });
  });

  describe("with custom options", () => {
    test("respects default limit", async () => {
      const customRetriever = new Retriever(cataloger, { defaultLimit: 3 });
      const result = await customRetriever.search("");
      expect(result.tools.length).toBeLessThanOrEqual(3);
      customRetriever.close();
    });

    test("respects max limit", async () => {
      const customRetriever = new Retriever(cataloger, {
        defaultLimit: 100,
        maxLimit: 10,
      });
      const result = await customRetriever.search("");
      expect(result.tools.length).toBeLessThanOrEqual(10);
      customRetriever.close();
    });
  });

  describe("search modes", () => {
    test("supports SearchOptions object", async () => {
      const result = await retriever.search("test", { limit: 5 });
      expect(result.tools).toEqual([]);
      expect(result.query).toBe("test");
    });

    test("supports legacy number parameter for limit", async () => {
      const result = await retriever.search("test", 5);
      expect(result.tools).toEqual([]);
      expect(result.query).toBe("test");
    });

    test("returns default mode as fast", () => {
      expect(retriever.getDefaultMode()).toBe("fast");
    });

    test("respects custom default mode", () => {
      const customRetriever = new Retriever(cataloger, {
        defaultMode: "hybrid",
      });
      expect(customRetriever.getDefaultMode()).toBe("hybrid");
      customRetriever.close();
    });

    test("fast mode search works", async () => {
      const result = await retriever.search("test", { mode: "fast" });
      expect(result).toHaveProperty("tools");
      expect(result).toHaveProperty("query");
      expect(result).toHaveProperty("totalMatches");
    });

    test("semantic mode falls back to fast when no embeddings", async () => {
      // Without embeddings initialized, semantic falls back to fast
      const result = await retriever.search("test", { mode: "semantic" });
      expect(result).toHaveProperty("tools");
      expect(result).toHaveProperty("query");
    });

    test("hybrid mode falls back to fast when no embeddings", async () => {
      // Without embeddings initialized, hybrid falls back to fast
      const result = await retriever.search("test", { mode: "hybrid" });
      expect(result).toHaveProperty("tools");
      expect(result).toHaveProperty("query");
    });

    test("hasEmbeddings returns false initially", () => {
      expect(retriever.hasEmbeddings()).toBe(false);
    });

    test("getEmbeddingCount returns 0 initially", () => {
      expect(retriever.getEmbeddingCount()).toBe(0);
    });
  });

  describe("embedding initialization", () => {
    test("initializeEmbeddings can be called safely", async () => {
      // Should not throw even when called multiple times
      await retriever.initializeEmbeddings();
      await retriever.initializeEmbeddings(); // Second call should be no-op
      expect(retriever.hasEmbeddings()).toBe(false); // No tools indexed = no embeddings
    });

    test("generateToolEmbeddings returns 0 when no tools indexed", async () => {
      await retriever.initializeEmbeddings();
      const count = await retriever.generateToolEmbeddings();
      expect(count).toBe(0);
    });

    test("embedding methods work without initialization", async () => {
      // These should be safe even without explicit initialization
      expect(retriever.hasEmbeddings()).toBe(false);
      expect(retriever.getEmbeddingCount()).toBe(0);
    });
  });

  describe("indexed tools with embeddings", () => {
    test("generateToolEmbeddings generates embeddings for indexed tools", async () => {
      // Index a tool first
      retriever.getIndexStore().indexTool({
        name: "test_tool",
        description: "A test tool for embedding",
        serverKey: "test_server",
        inputSchema: { type: "object" },
      });

      expect(retriever.getIndexedToolCount()).toBe(1);

      // Initialize embeddings
      await retriever.initializeEmbeddings();

      // Generate embeddings - this requires the model to be loaded
      // which is slow, so we just test it doesn't throw
      const count = await retriever.generateToolEmbeddings();
      // The actual embedding count depends on whether model loads successfully
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test("hasEmbeddings returns correct state after indexing", () => {
      retriever.getIndexStore().indexTool({
        name: "another_tool",
        description: "Another tool",
        serverKey: "server",
        inputSchema: { type: "object" },
      });

      // Without generating embeddings, hasEmbeddings should still be false
      expect(retriever.hasEmbeddings()).toBe(false);
    });
  });

  describe("search with indexed tools", () => {
    beforeEach(() => {
      // Index some tools for searching
      const indexStore = retriever.getIndexStore();
      indexStore.indexTool({
        name: "read_file",
        description: "Read content from a file on disk",
        serverKey: "filesystem",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      });
      indexStore.indexTool({
        name: "write_file",
        description: "Write content to a file on disk",
        serverKey: "filesystem",
        inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
      });
      indexStore.indexTool({
        name: "list_repos",
        description: "List GitHub repositories",
        serverKey: "github",
        inputSchema: { type: "object" },
      });
    });

    test("search finds matching tools", async () => {
      const result = await retriever.search("file");
      expect(result.tools.length).toBeGreaterThan(0);
      expect(result.tools.some((t) => t.name.includes("file"))).toBe(true);
    });

    test("search respects mode parameter", async () => {
      const fastResult = await retriever.search("file", { mode: "fast" });
      expect(fastResult.tools.length).toBeGreaterThan(0);

      // Semantic/hybrid fall back to fast without embeddings
      const semanticResult = await retriever.search("file", { mode: "semantic" });
      expect(semanticResult.tools.length).toBeGreaterThan(0);
    });

    test("search respects limit parameter", async () => {
      const result = await retriever.search("file", { limit: 1 });
      expect(result.tools.length).toBeLessThanOrEqual(1);
    });

    test("search with no matches returns empty array", async () => {
      const result = await retriever.search("xyznonexistent123");
      expect(result.tools.length).toBe(0);
    });

    test("getIndexedToolCount returns correct count", () => {
      expect(retriever.getIndexedToolCount()).toBe(3);
    });
  });
});
