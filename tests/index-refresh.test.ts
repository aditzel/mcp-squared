import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  IndexRefreshManager,
  type ToolChanges,
  captureSnapshot,
  detectChanges,
  hasChanges,
} from "../src/background/index.js";
import type { Retriever } from "../src/retriever/index.js";
import type {
  CatalogedTool,
  Cataloger,
  ToolInputSchema,
} from "../src/upstream/index.js";

// Mock tools for testing
const createMockTool = (
  name: string,
  serverKey: string,
  schema: ToolInputSchema = { type: "object" },
): CatalogedTool => ({
  name,
  description: `Description for ${name}`,
  serverKey,
  inputSchema: schema,
});

// Mock cataloger
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
    refreshAllTools: mock(() => Promise.resolve()),
    refreshTools: mock(() => Promise.resolve()),
  } as unknown as Cataloger;
}

// Mock retriever
function createMockRetriever(): Retriever {
  return {
    syncFromCataloger: mock(() => {}),
    syncServerFromCataloger: mock(() => {}),
  } as unknown as Retriever;
}

describe("change-detection", () => {
  describe("captureSnapshot", () => {
    test("captures empty snapshot for empty cataloger", () => {
      const cataloger = createMockCataloger([]);
      const snapshot = captureSnapshot(cataloger);

      expect(snapshot.tools.size).toBe(0);
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });

    test("captures all tools with hashes", () => {
      const tools = [
        createMockTool("read_file", "fs"),
        createMockTool("write_file", "fs"),
        createMockTool("query", "db"),
      ];
      const cataloger = createMockCataloger(tools);
      const snapshot = captureSnapshot(cataloger);

      expect(snapshot.tools.size).toBe(3);
      expect(snapshot.tools.has("fs:read_file")).toBe(true);
      expect(snapshot.tools.has("fs:write_file")).toBe(true);
      expect(snapshot.tools.has("db:query")).toBe(true);
    });

    test("generates consistent hashes for same schema", () => {
      const tool1 = createMockTool("tool", "server", {
        type: "object",
        foo: 1,
      });
      const tool2 = createMockTool("tool", "server", {
        type: "object",
        foo: 1,
      });

      const snapshot1 = captureSnapshot(createMockCataloger([tool1]));
      const snapshot2 = captureSnapshot(createMockCataloger([tool2]));

      expect(snapshot1.tools.get("server:tool")).toBe(
        snapshot2.tools.get("server:tool"),
      );
    });

    test("generates different hashes for different schemas", () => {
      const tool1 = createMockTool("tool", "server", {
        type: "object",
        foo: 1,
      });
      const tool2 = createMockTool("tool", "server", {
        type: "object",
        foo: 2,
      });

      const snapshot1 = captureSnapshot(createMockCataloger([tool1]));
      const snapshot2 = captureSnapshot(createMockCataloger([tool2]));

      expect(snapshot1.tools.get("server:tool")).not.toBe(
        snapshot2.tools.get("server:tool"),
      );
    });
  });

  describe("detectChanges", () => {
    test("detects no changes when snapshots are identical", () => {
      const tools = [createMockTool("read_file", "fs")];
      const cataloger = createMockCataloger(tools);

      const before = captureSnapshot(cataloger);
      const after = captureSnapshot(cataloger);
      const changes = detectChanges(before, after);

      expect(changes.added).toEqual([]);
      expect(changes.removed).toEqual([]);
      expect(changes.modified).toEqual([]);
    });

    test("detects added tools", () => {
      const beforeTools = [createMockTool("read_file", "fs")];
      const afterTools = [
        createMockTool("read_file", "fs"),
        createMockTool("write_file", "fs"),
      ];

      const before = captureSnapshot(createMockCataloger(beforeTools));
      const after = captureSnapshot(createMockCataloger(afterTools));
      const changes = detectChanges(before, after);

      expect(changes.added).toEqual(["write_file"]);
      expect(changes.removed).toEqual([]);
      expect(changes.modified).toEqual([]);
    });

    test("detects removed tools", () => {
      const beforeTools = [
        createMockTool("read_file", "fs"),
        createMockTool("write_file", "fs"),
      ];
      const afterTools = [createMockTool("read_file", "fs")];

      const before = captureSnapshot(createMockCataloger(beforeTools));
      const after = captureSnapshot(createMockCataloger(afterTools));
      const changes = detectChanges(before, after);

      expect(changes.added).toEqual([]);
      expect(changes.removed).toEqual(["write_file"]);
      expect(changes.modified).toEqual([]);
    });

    test("detects modified tools", () => {
      const beforeTools = [
        createMockTool("read_file", "fs", { type: "object", v: 1 }),
      ];
      const afterTools = [
        createMockTool("read_file", "fs", { type: "object", v: 2 }),
      ];

      const before = captureSnapshot(createMockCataloger(beforeTools));
      const after = captureSnapshot(createMockCataloger(afterTools));
      const changes = detectChanges(before, after);

      expect(changes.added).toEqual([]);
      expect(changes.removed).toEqual([]);
      expect(changes.modified).toEqual(["read_file"]);
    });

    test("detects multiple changes at once", () => {
      const beforeTools = [
        createMockTool("tool_a", "fs"),
        createMockTool("tool_b", "fs", { type: "object", v: 1 }),
        createMockTool("tool_c", "fs"),
      ];
      const afterTools = [
        createMockTool("tool_a", "fs"),
        createMockTool("tool_b", "fs", { type: "object", v: 2 }), // modified
        createMockTool("tool_d", "fs"), // added (tool_c removed)
      ];

      const before = captureSnapshot(createMockCataloger(beforeTools));
      const after = captureSnapshot(createMockCataloger(afterTools));
      const changes = detectChanges(before, after);

      expect(changes.added).toContain("tool_d");
      expect(changes.removed).toContain("tool_c");
      expect(changes.modified).toContain("tool_b");
    });
  });

  describe("hasChanges", () => {
    test("returns false when no changes", () => {
      const changes: ToolChanges = {
        serverKey: "*",
        added: [],
        removed: [],
        modified: [],
        timestamp: Date.now(),
      };
      expect(hasChanges(changes)).toBe(false);
    });

    test("returns true when there are added tools", () => {
      const changes: ToolChanges = {
        serverKey: "*",
        added: ["new_tool"],
        removed: [],
        modified: [],
        timestamp: Date.now(),
      };
      expect(hasChanges(changes)).toBe(true);
    });

    test("returns true when there are removed tools", () => {
      const changes: ToolChanges = {
        serverKey: "*",
        added: [],
        removed: ["old_tool"],
        modified: [],
        timestamp: Date.now(),
      };
      expect(hasChanges(changes)).toBe(true);
    });

    test("returns true when there are modified tools", () => {
      const changes: ToolChanges = {
        serverKey: "*",
        added: [],
        removed: [],
        modified: ["updated_tool"],
        timestamp: Date.now(),
      };
      expect(hasChanges(changes)).toBe(true);
    });
  });
});

describe("IndexRefreshManager", () => {
  let manager: IndexRefreshManager;
  let mockCataloger: Cataloger;
  let mockRetriever: Retriever;

  beforeEach(() => {
    const tools = [createMockTool("read_file", "fs")];
    mockCataloger = createMockCataloger(tools);
    mockRetriever = createMockRetriever();
  });

  afterEach(() => {
    if (manager) {
      manager.stop();
    }
  });

  test("starts and stops correctly", () => {
    manager = new IndexRefreshManager({
      cataloger: mockCataloger,
      retriever: mockRetriever,
      refreshIntervalMs: 1000,
    });

    expect(manager.isRunning()).toBe(false);

    manager.start();
    expect(manager.isRunning()).toBe(true);

    manager.stop();
    expect(manager.isRunning()).toBe(false);
  });

  test("start is idempotent", () => {
    manager = new IndexRefreshManager({
      cataloger: mockCataloger,
      retriever: mockRetriever,
      refreshIntervalMs: 1000,
    });

    manager.start();
    manager.start(); // Should not throw or create duplicate timers
    expect(manager.isRunning()).toBe(true);
  });

  test("stop is idempotent", () => {
    manager = new IndexRefreshManager({
      cataloger: mockCataloger,
      retriever: mockRetriever,
      refreshIntervalMs: 1000,
    });

    manager.stop(); // Should not throw when not running
    expect(manager.isRunning()).toBe(false);
  });

  test("forceRefresh triggers immediate refresh", async () => {
    manager = new IndexRefreshManager({
      cataloger: mockCataloger,
      retriever: mockRetriever,
      refreshIntervalMs: 60000, // Long interval
    });

    let refreshCompleted = false;
    manager.on("refresh:complete", () => {
      refreshCompleted = true;
    });

    manager.start();
    await manager.forceRefresh();

    expect(refreshCompleted).toBe(true);
    expect(mockCataloger.refreshAllTools).toHaveBeenCalled();
    expect(mockRetriever.syncFromCataloger).toHaveBeenCalled();
  });

  test("emits refresh:start and refresh:complete events", async () => {
    manager = new IndexRefreshManager({
      cataloger: mockCataloger,
      retriever: mockRetriever,
      refreshIntervalMs: 60000,
    });

    const events: string[] = [];
    manager.on("refresh:start", () => events.push("start"));
    manager.on("refresh:complete", () => events.push("complete"));

    manager.start();
    await manager.forceRefresh();

    expect(events).toContain("start");
    expect(events).toContain("complete");
  });

  test("emits refresh:error on failure", async () => {
    const errorCataloger = {
      ...mockCataloger,
      refreshAllTools: mock(() =>
        Promise.reject(new Error("Connection failed")),
      ),
    } as unknown as Cataloger;

    manager = new IndexRefreshManager({
      cataloger: errorCataloger,
      retriever: mockRetriever,
      refreshIntervalMs: 60000,
    });

    let errorEmitted: Error | undefined;
    manager.on("refresh:error", (err) => {
      errorEmitted = err;
    });

    manager.start();
    await manager.forceRefresh();

    expect(errorEmitted).toBeDefined();
    expect(errorEmitted?.message).toBe("Connection failed");
  });

  test("returns correct refresh interval", () => {
    manager = new IndexRefreshManager({
      cataloger: mockCataloger,
      retriever: mockRetriever,
      refreshIntervalMs: 5000,
    });

    expect(manager.getRefreshIntervalMs()).toBe(5000);
  });

  test("uses default refresh interval when not specified", () => {
    manager = new IndexRefreshManager({
      cataloger: mockCataloger,
      retriever: mockRetriever,
    });

    expect(manager.getRefreshIntervalMs()).toBe(30000);
  });

  test("prevents concurrent refreshes", async () => {
    let refreshCount = 0;
    const slowCataloger = {
      ...mockCataloger,
      refreshAllTools: mock(async () => {
        refreshCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }),
    } as unknown as Cataloger;

    manager = new IndexRefreshManager({
      cataloger: slowCataloger,
      retriever: mockRetriever,
      refreshIntervalMs: 60000,
    });

    manager.start();

    // Trigger multiple concurrent refreshes
    const refresh1 = manager.forceRefresh();
    const refresh2 = manager.forceRefresh();
    const refresh3 = manager.forceRefresh();

    await Promise.all([refresh1, refresh2, refresh3]);

    // Should only have refreshed once (concurrent calls wait for first to complete)
    expect(refreshCount).toBe(1);
  });
});
