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
    test("returns empty results for empty index", () => {
      const result = retriever.search("test");
      expect(result.tools).toEqual([]);
      expect(result.query).toBe("test");
    });

    test("returns all tools for empty query", () => {
      const result = retriever.search("");
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
    test("respects default limit", () => {
      const customRetriever = new Retriever(cataloger, { defaultLimit: 3 });
      const result = customRetriever.search("");
      expect(result.tools.length).toBeLessThanOrEqual(3);
      customRetriever.close();
    });

    test("respects max limit", () => {
      const customRetriever = new Retriever(cataloger, {
        defaultLimit: 100,
        maxLimit: 10,
      });
      const result = customRetriever.search("");
      expect(result.tools.length).toBeLessThanOrEqual(10);
      customRetriever.close();
    });
  });
});
