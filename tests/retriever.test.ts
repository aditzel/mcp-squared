import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Retriever } from "../src/retriever/retriever.js";
import { Cataloger } from "../src/upstream/cataloger.js";

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
    test("returns undefined for non-existent tool", () => {
      const tool = retriever.getTool("nonexistent");
      expect(tool).toBeUndefined();
    });
  });

  describe("getTools", () => {
    test("returns empty array for non-existent tools", () => {
      const tools = retriever.getTools(["tool1", "tool2"]);
      expect(tools).toEqual([]);
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
      const customRetriever = new Retriever(cataloger, { defaultMode: "hybrid" });
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
});
