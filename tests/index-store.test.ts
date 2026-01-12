import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IndexStore } from "../src/index/store.js";
import type { CatalogedTool } from "../src/upstream/cataloger.js";

describe("IndexStore", () => {
  let store: IndexStore;

  beforeEach(() => {
    store = new IndexStore(); // In-memory database
  });

  afterEach(() => {
    store.close();
  });

  describe("constructor", () => {
    test("creates in-memory database by default", () => {
      expect(store).toBeInstanceOf(IndexStore);
    });

    test("starts with zero tools", () => {
      expect(store.getToolCount()).toBe(0);
    });
  });

  describe("indexTool", () => {
    test("indexes a single tool", () => {
      const tool: CatalogedTool = {
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: { arg: { type: "string" } },
        },
        serverKey: "server1",
      };

      store.indexTool(tool);
      expect(store.getToolCount()).toBe(1);
    });

    test("updates existing tool with same name and server", () => {
      const tool1: CatalogedTool = {
        name: "test_tool",
        description: "Original description",
        inputSchema: { type: "object" },
        serverKey: "server1",
      };

      const tool2: CatalogedTool = {
        name: "test_tool",
        description: "Updated description",
        inputSchema: {
          type: "object",
          properties: { new: { type: "string" } },
        },
        serverKey: "server1",
      };

      store.indexTool(tool1);
      store.indexTool(tool2);

      expect(store.getToolCount()).toBe(1);
      const indexed = store.getTool("test_tool", "server1");
      expect(indexed?.description).toBe("Updated description");
    });

    test("allows same tool name from different servers", () => {
      const tool1: CatalogedTool = {
        name: "test_tool",
        description: "From server1",
        inputSchema: { type: "object" },
        serverKey: "server1",
      };

      const tool2: CatalogedTool = {
        name: "test_tool",
        description: "From server2",
        inputSchema: { type: "object" },
        serverKey: "server2",
      };

      store.indexTool(tool1);
      store.indexTool(tool2);

      expect(store.getToolCount()).toBe(2);
    });
  });

  describe("indexTools", () => {
    test("indexes multiple tools in a transaction", () => {
      const tools: CatalogedTool[] = [
        {
          name: "tool1",
          description: "First tool",
          inputSchema: { type: "object" },
          serverKey: "server1",
        },
        {
          name: "tool2",
          description: "Second tool",
          inputSchema: { type: "object" },
          serverKey: "server1",
        },
        {
          name: "tool3",
          description: "Third tool",
          inputSchema: { type: "object" },
          serverKey: "server2",
        },
      ];

      store.indexTools(tools);
      expect(store.getToolCount()).toBe(3);
    });

    test("handles empty array", () => {
      store.indexTools([]);
      expect(store.getToolCount()).toBe(0);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      const tools: CatalogedTool[] = [
        {
          name: "file_read",
          description: "Read contents of a file from disk",
          inputSchema: { type: "object" },
          serverKey: "filesystem",
        },
        {
          name: "file_write",
          description: "Write contents to a file on disk",
          inputSchema: { type: "object" },
          serverKey: "filesystem",
        },
        {
          name: "git_commit",
          description: "Create a git commit with staged changes",
          inputSchema: { type: "object" },
          serverKey: "git",
        },
        {
          name: "git_push",
          description: "Push commits to remote repository",
          inputSchema: { type: "object" },
          serverKey: "git",
        },
        {
          name: "http_request",
          description: "Make an HTTP request to a URL",
          inputSchema: { type: "object" },
          serverKey: "web",
        },
      ];
      store.indexTools(tools);
    });

    test("finds tools by name", () => {
      const results = store.search("file");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.name === "file_read")).toBe(true);
    });

    test("finds tools by description", () => {
      const results = store.search("commit");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.name === "git_commit")).toBe(true);
    });

    test("respects limit parameter", () => {
      const results = store.search("file", 1);
      expect(results.length).toBe(1);
    });

    test("returns empty array for empty query", () => {
      const results = store.search("");
      expect(results).toEqual([]);
    });

    test("returns empty array for whitespace query", () => {
      const results = store.search("   ");
      expect(results).toEqual([]);
    });

    test("returns results with scores", () => {
      const results = store.search("file");
      expect(results.length).toBeGreaterThan(0);
      expect(typeof results[0]?.score).toBe("number");
    });
  });

  describe("getTool", () => {
    beforeEach(() => {
      store.indexTool({
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: { arg: { type: "string" } },
        },
        serverKey: "server1",
      });
    });

    test("retrieves tool by name", () => {
      const tool = store.getTool("test_tool");
      expect(tool).not.toBeNull();
      expect(tool?.name).toBe("test_tool");
    });

    test("retrieves tool by name and server", () => {
      const tool = store.getTool("test_tool", "server1");
      expect(tool).not.toBeNull();
      expect(tool?.serverKey).toBe("server1");
    });

    test("returns null for non-existent tool", () => {
      const tool = store.getTool("nonexistent");
      expect(tool).toBeNull();
    });

    test("returns null for wrong server key", () => {
      const tool = store.getTool("test_tool", "wrong_server");
      expect(tool).toBeNull();
    });

    test("includes schema hash", () => {
      const tool = store.getTool("test_tool");
      expect(tool?.schemaHash).toBeDefined();
      expect(typeof tool?.schemaHash).toBe("string");
    });
  });

  describe("getToolsForServer", () => {
    beforeEach(() => {
      const tools: CatalogedTool[] = [
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: { type: "object" },
          serverKey: "server1",
        },
        {
          name: "tool2",
          description: "Tool 2",
          inputSchema: { type: "object" },
          serverKey: "server1",
        },
        {
          name: "tool3",
          description: "Tool 3",
          inputSchema: { type: "object" },
          serverKey: "server2",
        },
      ];
      store.indexTools(tools);
    });

    test("returns all tools for a server", () => {
      const tools = store.getToolsForServer("server1");
      expect(tools.length).toBe(2);
    });

    test("returns empty array for non-existent server", () => {
      const tools = store.getToolsForServer("nonexistent");
      expect(tools).toEqual([]);
    });
  });

  describe("getAllTools", () => {
    test("returns all indexed tools", () => {
      const tools: CatalogedTool[] = [
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: { type: "object" },
          serverKey: "server1",
        },
        {
          name: "tool2",
          description: "Tool 2",
          inputSchema: { type: "object" },
          serverKey: "server2",
        },
      ];
      store.indexTools(tools);

      const allTools = store.getAllTools();
      expect(allTools.length).toBe(2);
    });

    test("returns empty array when no tools indexed", () => {
      const tools = store.getAllTools();
      expect(tools).toEqual([]);
    });
  });

  describe("removeToolsForServer", () => {
    beforeEach(() => {
      const tools: CatalogedTool[] = [
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: { type: "object" },
          serverKey: "server1",
        },
        {
          name: "tool2",
          description: "Tool 2",
          inputSchema: { type: "object" },
          serverKey: "server1",
        },
        {
          name: "tool3",
          description: "Tool 3",
          inputSchema: { type: "object" },
          serverKey: "server2",
        },
      ];
      store.indexTools(tools);
    });

    test("removes all tools for a server", () => {
      const removed = store.removeToolsForServer("server1");
      expect(removed).toBe(2);
      expect(store.getToolCount()).toBe(1);
    });

    test("returns 0 for non-existent server", () => {
      const removed = store.removeToolsForServer("nonexistent");
      expect(removed).toBe(0);
    });
  });

  describe("removeTool", () => {
    beforeEach(() => {
      store.indexTool({
        name: "test_tool",
        description: "A test tool",
        inputSchema: { type: "object" },
        serverKey: "server1",
      });
    });

    test("removes a specific tool", () => {
      const removed = store.removeTool("test_tool", "server1");
      expect(removed).toBe(true);
      expect(store.getToolCount()).toBe(0);
    });

    test("returns false for non-existent tool", () => {
      const removed = store.removeTool("nonexistent", "server1");
      expect(removed).toBe(false);
    });
  });

  describe("clear", () => {
    test("removes all tools", () => {
      const tools: CatalogedTool[] = [
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: { type: "object" },
          serverKey: "server1",
        },
        {
          name: "tool2",
          description: "Tool 2",
          inputSchema: { type: "object" },
          serverKey: "server2",
        },
      ];
      store.indexTools(tools);

      store.clear();
      expect(store.getToolCount()).toBe(0);
    });
  });
});
