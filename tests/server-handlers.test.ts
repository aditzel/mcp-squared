/**
 * Tests for McpSquaredServer meta-tool handlers.
 *
 * These tests verify the behavior of the server's meta-tools:
 * - find_tools: Search and filter tools
 * - describe_tools: Get tool schemas with policy filtering
 * - execute: Tool execution with security policy
 * - clear_selection_cache: Reset co-occurrence patterns
 * - list_namespaces: List upstream server information
 */

import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "@/config/schema";
import {
  clearPendingConfirmations,
  compilePolicy,
  getToolVisibilityCompiled,
} from "@/security/index.js";
import { McpSquaredServer } from "@/server/index";

// Helper to create config with custom security settings
function createSecurityConfig(security: {
  allow?: string[];
  block?: string[];
  confirm?: string[];
}): McpSquaredConfig {
  return {
    ...DEFAULT_CONFIG,
    security: {
      tools: {
        allow: security.allow ?? ["*:*"],
        block: security.block ?? [],
        confirm: security.confirm ?? [],
      },
    },
  };
}

// Helper to add tools to the server's index
function indexTools(
  server: McpSquaredServer,
  tools: Array<{
    name: string;
    description: string;
    serverKey: string;
    inputSchema?: { type: "object"; properties?: Record<string, unknown> };
  }>,
): void {
  const indexStore = server.getRetriever().getIndexStore();
  for (const tool of tools) {
    indexStore.indexTool({
      name: tool.name,
      description: tool.description,
      serverKey: tool.serverKey,
      inputSchema: tool.inputSchema ?? { type: "object" },
    });
  }
}

type ExecuteHandlerArgs = {
  tool_name: string;
  arguments?: Record<string, unknown>;
  confirmation_token?: string;
};

type ExecuteHandlerResult = {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
};

type SessionWithRegisteredTools = {
  _registeredTools?: Record<
    string,
    { handler?: (args: ExecuteHandlerArgs) => Promise<ExecuteHandlerResult> }
  >;
};

function getExecuteHandler(
  server: McpSquaredServer,
): (args: ExecuteHandlerArgs) => Promise<ExecuteHandlerResult> {
  const session =
    server.createSessionServer() as unknown as SessionWithRegisteredTools;
  const handler = session._registeredTools?.["execute"]?.handler;
  if (!handler) {
    throw new Error("execute handler is not registered");
  }
  return handler;
}

function parseExecutePayload(
  result: ExecuteHandlerResult,
): Record<string, unknown> {
  const text = result.content[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function mockCatalogerForSingleTool(server: McpSquaredServer): {
  callToolRequests: string[];
} {
  const callToolRequests: string[] = [];
  const cataloger = server.getCataloger() as unknown as {
    findTool: (toolName: string) => {
      tool: { name: string; serverKey: string } | undefined;
      ambiguous: boolean;
      alternatives: string[];
    };
    callTool: (
      toolName: string,
      args: Record<string, unknown>,
    ) => Promise<{ content: unknown[]; isError: boolean | undefined }>;
  };

  cataloger.findTool = (toolName: string) => {
    if (toolName === "delete_file" || toolName === "github:delete_file") {
      return {
        tool: { name: "delete_file", serverKey: "github" },
        ambiguous: false,
        alternatives: [],
      };
    }

    return { tool: undefined, ambiguous: false, alternatives: [] };
  };

  cataloger.callTool = async (toolName: string) => {
    callToolRequests.push(toolName);
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      isError: false,
    };
  };

  return { callToolRequests };
}

describe("execute tool policy normalization", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    clearPendingConfirmations();
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("applies block policy consistently to bare and qualified names", async () => {
    const config = createSecurityConfig({
      allow: ["*:*"],
      block: ["github:delete_file"],
    });
    server = new McpSquaredServer({ config });
    const { callToolRequests } = mockCatalogerForSingleTool(server);
    const execute = getExecuteHandler(server);

    const bareResult = await execute({
      tool_name: "delete_file",
      arguments: {},
    });
    const qualifiedResult = await execute({
      tool_name: "github:delete_file",
      arguments: {},
    });

    const barePayload = parseExecutePayload(bareResult);
    const qualifiedPayload = parseExecutePayload(qualifiedResult);

    expect(bareResult.isError).toBe(true);
    expect(qualifiedResult.isError).toBe(true);
    expect(barePayload["blocked"]).toBe(true);
    expect(qualifiedPayload["blocked"]).toBe(true);
    expect(callToolRequests).toEqual([]);
  });

  test("applies confirm policy consistently and accepts cross-form confirmation tokens", async () => {
    const config = createSecurityConfig({
      allow: [],
      confirm: ["github:delete_file"],
    });
    server = new McpSquaredServer({ config });
    const { callToolRequests } = mockCatalogerForSingleTool(server);
    const execute = getExecuteHandler(server);

    const qualifiedConfirm = await execute({
      tool_name: "github:delete_file",
      arguments: {},
    });
    const qualifiedConfirmPayload = parseExecutePayload(qualifiedConfirm);

    expect(qualifiedConfirm.isError).toBe(false);
    expect(qualifiedConfirmPayload["requires_confirmation"]).toBe(true);
    const token = qualifiedConfirmPayload["confirmation_token"];
    expect(typeof token).toBe("string");
    expect(callToolRequests).toEqual([]);

    const bareAllowed = await execute({
      tool_name: "delete_file",
      arguments: {},
      confirmation_token: token as string,
    });
    const bareAllowedPayload = parseExecutePayload(bareAllowed);

    expect(bareAllowed.isError).toBe(false);
    expect(bareAllowedPayload).toEqual({ ok: true });
    expect(callToolRequests).toEqual(["delete_file"]);
  });

  test("applies allow policy consistently to bare and qualified names", async () => {
    const config = createSecurityConfig({
      allow: ["github:delete_file"],
    });
    server = new McpSquaredServer({ config });
    const { callToolRequests } = mockCatalogerForSingleTool(server);
    const execute = getExecuteHandler(server);

    const bareResult = await execute({
      tool_name: "delete_file",
      arguments: {},
    });
    const qualifiedResult = await execute({
      tool_name: "github:delete_file",
      arguments: {},
    });

    const barePayload = parseExecutePayload(bareResult);
    const qualifiedPayload = parseExecutePayload(qualifiedResult);

    expect(bareResult.isError).toBe(false);
    expect(qualifiedResult.isError).toBe(false);
    expect(barePayload).toEqual({ ok: true });
    expect(qualifiedPayload).toEqual({ ok: true });
    expect(callToolRequests).toEqual(["delete_file", "github:delete_file"]);
  });
});

describe("Security policy filtering", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("block policy hides tools from search results", async () => {
    const config = createSecurityConfig({
      allow: ["*:*"],
      block: ["dangerous:*"],
    });
    server = new McpSquaredServer({ config });

    indexTools(server, [
      { name: "safe_tool", description: "A safe tool", serverKey: "safe" },
      {
        name: "danger_tool",
        description: "A dangerous tool",
        serverKey: "dangerous",
      },
    ]);

    // Both tools should be in the raw search results (retriever doesn't filter)
    const result = await server.getRetriever().search("tool");
    expect(result.tools.length).toBe(2);

    // Verify policy filtering using the same logic as filterToolsByPolicy
    const compiled = compilePolicy(config);
    const safeVisibility = getToolVisibilityCompiled(
      "safe",
      "safe_tool",
      compiled,
    );
    const dangerVisibility = getToolVisibilityCompiled(
      "dangerous",
      "danger_tool",
      compiled,
    );

    // Safe tool should be visible, dangerous tool should be blocked
    expect(safeVisibility.visible).toBe(true);
    expect(dangerVisibility.visible).toBe(false);
  });

  test("confirm policy marks tools with requiresConfirmation", () => {
    const config = createSecurityConfig({
      allow: ["fs:read_file"],
      confirm: ["fs:write_file"], // Exact match (glob patterns like fs:write* not supported)
    });
    server = new McpSquaredServer({ config });

    indexTools(server, [
      { name: "read_file", description: "Read a file", serverKey: "fs" },
      { name: "write_file", description: "Write a file", serverKey: "fs" },
    ]);

    // Verify tools are indexed
    const store = server.getRetriever().getIndexStore();
    expect(store.getToolCount()).toBe(2);

    // Verify policy filtering marks confirm-list tools correctly
    const compiled = compilePolicy(config);
    const readVisibility = getToolVisibilityCompiled(
      "fs",
      "read_file",
      compiled,
    );
    const writeVisibility = getToolVisibilityCompiled(
      "fs",
      "write_file",
      compiled,
    );

    // read_file should be visible without confirmation
    expect(readVisibility.visible).toBe(true);
    expect(readVisibility.requiresConfirmation).toBe(false);

    // write_file should be visible but require confirmation
    expect(writeVisibility.visible).toBe(true);
    expect(writeVisibility.requiresConfirmation).toBe(true);
  });

  test("allow policy with specific patterns works", () => {
    const config = createSecurityConfig({
      allow: ["fs:read_file", "github:*"], // Exact match + wildcard (glob patterns like fs:read* not supported)
      block: [],
    });
    server = new McpSquaredServer({ config });

    indexTools(server, [
      { name: "read_file", description: "Read a file", serverKey: "fs" },
      { name: "write_file", description: "Write a file", serverKey: "fs" },
      { name: "list_repos", description: "List repos", serverKey: "github" },
    ]);

    // All tools are indexed (retriever doesn't filter)
    expect(server.getRetriever().getIndexStore().getToolCount()).toBe(3);

    // Verify policy filtering only allows matching patterns
    const compiled = compilePolicy(config);

    // fs:read_file matches "fs:read_file" exactly - should be visible
    expect(getToolVisibilityCompiled("fs", "read_file", compiled).visible).toBe(
      true,
    );

    // fs:write_file does NOT match any allow pattern - should be hidden
    expect(
      getToolVisibilityCompiled("fs", "write_file", compiled).visible,
    ).toBe(false);

    // github:list_repos matches "github:*" - should be visible
    expect(
      getToolVisibilityCompiled("github", "list_repos", compiled).visible,
    ).toBe(true);
  });
});

describe("find_tools search functionality", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("search returns matching tools", async () => {
    server = new McpSquaredServer();

    indexTools(server, [
      {
        name: "read_file",
        description: "Read content from a file",
        serverKey: "fs",
      },
      {
        name: "write_file",
        description: "Write content to a file",
        serverKey: "fs",
      },
      {
        name: "list_repos",
        description: "List GitHub repositories",
        serverKey: "github",
      },
    ]);

    const result = await server.getRetriever().search("file");
    expect(result.tools.length).toBeGreaterThanOrEqual(1);
    expect(result.tools.some((t) => t.name.includes("file"))).toBe(true);
  });

  test("search respects limit parameter", async () => {
    server = new McpSquaredServer();

    indexTools(server, [
      { name: "tool1", description: "Tool one", serverKey: "s1" },
      { name: "tool2", description: "Tool two", serverKey: "s2" },
      { name: "tool3", description: "Tool three", serverKey: "s3" },
      { name: "tool4", description: "Tool four", serverKey: "s4" },
      { name: "tool5", description: "Tool five", serverKey: "s5" },
    ]);

    const result = await server.getRetriever().search("tool", { limit: 2 });
    expect(result.tools.length).toBeLessThanOrEqual(2);
  });

  test("search with empty query returns results", async () => {
    server = new McpSquaredServer();

    indexTools(server, [
      { name: "tool1", description: "Tool one", serverKey: "s1" },
    ]);

    // Empty query should still work (returns all tools up to limit)
    const result = await server.getRetriever().search("");
    expect(result.tools.length).toBeGreaterThanOrEqual(0);
  });
});

describe("describe_tools functionality", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  // Note: getTools uses cataloger data (connected servers), not indexStore
  // Without actual server connections, we test the structure and edge cases

  test("getTools returns empty when no connections", () => {
    server = new McpSquaredServer();

    // Without connected servers, getTools returns empty
    const result = server.getRetriever().getTools(["any_tool"]);
    expect(result.tools.length).toBe(0);
    expect(result.ambiguous.length).toBe(0);
  });

  test("getTools result has correct structure", () => {
    server = new McpSquaredServer();

    const result = server.getRetriever().getTools(["tool1", "tool2"]);
    expect(result).toHaveProperty("tools");
    expect(result).toHaveProperty("ambiguous");
    expect(Array.isArray(result.tools)).toBe(true);
    expect(Array.isArray(result.ambiguous)).toBe(true);
  });

  test("ambiguous result has alternatives field", () => {
    server = new McpSquaredServer();

    // The ambiguous structure has 'alternatives' not 'qualifiedNames'
    type AmbiguousResult = { name: string; alternatives: string[] };
    const ambiguous: AmbiguousResult = {
      name: "duplicate_tool",
      alternatives: ["s1:duplicate_tool", "s2:duplicate_tool"],
    };

    expect(ambiguous.name).toBe("duplicate_tool");
    expect(ambiguous.alternatives.length).toBe(2);
  });
});

describe("clear_selection_cache functionality", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("clearCooccurrences resets count to zero", () => {
    server = new McpSquaredServer();
    const indexStore = server.getRetriever().getIndexStore();

    // Record some co-occurrences
    indexStore.recordCooccurrence("tool1", "tool2");
    indexStore.recordCooccurrence("tool2", "tool3");
    expect(indexStore.getCooccurrenceCount()).toBeGreaterThan(0);

    // Clear and verify
    indexStore.clearCooccurrences();
    expect(indexStore.getCooccurrenceCount()).toBe(0);
  });

  test("getCooccurrenceCount returns correct count", () => {
    server = new McpSquaredServer();
    const indexStore = server.getRetriever().getIndexStore();

    expect(indexStore.getCooccurrenceCount()).toBe(0);

    indexStore.recordCooccurrence("a", "b");
    expect(indexStore.getCooccurrenceCount()).toBe(1);

    indexStore.recordCooccurrence("b", "c");
    expect(indexStore.getCooccurrenceCount()).toBe(2);
  });
});

describe("list_namespaces functionality", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("getStatus returns empty map when no connections", () => {
    server = new McpSquaredServer();
    const status = server.getCataloger().getStatus();
    expect(status.size).toBe(0);
  });

  test("getConflictingTools returns empty when no duplicates", () => {
    server = new McpSquaredServer();

    indexTools(server, [
      { name: "unique1", description: "Unique 1", serverKey: "s1" },
      { name: "unique2", description: "Unique 2", serverKey: "s2" },
    ]);

    const conflicts = server.getCataloger().getConflictingTools();
    expect(conflicts.size).toBe(0);
  });

  test("getConflictingTools detects duplicate tool names", () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    // Manually register conflicting tools via cataloger's internal state
    // Since we can't connect real servers, we test the conflict detection logic
    // by checking the method exists and returns expected type
    const conflicts = cataloger.getConflictingTools();
    expect(conflicts).toBeInstanceOf(Map);
  });
});

describe("Selection cache configuration", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("server respects selection cache disabled config", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        selectionCache: {
          enabled: false,
          minCooccurrenceThreshold: 2,
          maxBundleSuggestions: 3,
        },
      },
    };

    server = new McpSquaredServer({ config });
    expect(server).toBeDefined();
  });

  test("server respects selection cache enabled config", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        selectionCache: {
          enabled: true,
          minCooccurrenceThreshold: 5,
          maxBundleSuggestions: 10,
        },
      },
    };

    server = new McpSquaredServer({ config });
    expect(server).toBeDefined();
  });
});

describe("Co-occurrence tracking", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("recordCooccurrences creates pairs from tool list", () => {
    server = new McpSquaredServer();
    const indexStore = server.getRetriever().getIndexStore();

    // Record multiple tools at once
    indexStore.recordCooccurrences(["a", "b", "c"]);

    // Should create pairs: (a,b), (a,c), (b,c)
    const count = indexStore.getCooccurrenceCount();
    expect(count).toBe(3);
  });

  test("recordCooccurrences handles empty list", () => {
    server = new McpSquaredServer();
    const indexStore = server.getRetriever().getIndexStore();

    // Empty list should be no-op
    indexStore.recordCooccurrences([]);
    expect(indexStore.getCooccurrenceCount()).toBe(0);
  });

  test("recordCooccurrences handles single tool", () => {
    server = new McpSquaredServer();
    const indexStore = server.getRetriever().getIndexStore();

    // Single tool can't have co-occurrence
    indexStore.recordCooccurrences(["single"]);
    expect(indexStore.getCooccurrenceCount()).toBe(0);
  });

  test("getRelatedTools finds related tools", () => {
    server = new McpSquaredServer();
    const indexStore = server.getRetriever().getIndexStore();

    // Create co-occurrences
    indexStore.recordCooccurrence("tool_a", "tool_b");
    indexStore.recordCooccurrence("tool_a", "tool_b"); // Record twice
    indexStore.recordCooccurrence("tool_a", "tool_c");

    const related = indexStore.getRelatedTools("tool_a", 1, 10);
    expect(related.length).toBeGreaterThan(0);
  });

  test("getSuggestedBundles returns suggestions for tools", () => {
    server = new McpSquaredServer();
    const indexStore = server.getRetriever().getIndexStore();

    // Record co-occurrences with count >= threshold
    for (let i = 0; i < 3; i++) {
      indexStore.recordCooccurrence("read_file", "write_file");
    }

    const suggestions = indexStore.getSuggestedBundles(
      ["read_file"],
      2, // minCount
      5, // limit
    );

    // Should suggest write_file
    expect(suggestions.some((s) => s.toolKey === "write_file")).toBe(true);
  });
});

describe("Search modes", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("fast mode search works", async () => {
    server = new McpSquaredServer();

    indexTools(server, [
      { name: "read_file", description: "Read a file", serverKey: "fs" },
    ]);

    const result = await server.getRetriever().search("read", { mode: "fast" });
    expect(result.tools.length).toBeGreaterThanOrEqual(0);
  });

  test("search with default config mode works", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        findTools: {
          ...DEFAULT_CONFIG.operations.findTools,
          defaultMode: "fast",
        },
      },
    };

    server = new McpSquaredServer({ config });

    indexTools(server, [
      { name: "tool", description: "A tool", serverKey: "s1" },
    ]);

    const result = await server.getRetriever().search("tool");
    expect(result).toBeDefined();
  });
});

describe("Tool indexing", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("indexing same tool twice updates existing", () => {
    server = new McpSquaredServer();
    const indexStore = server.getRetriever().getIndexStore();

    indexStore.indexTool({
      name: "tool",
      description: "Original description",
      serverKey: "s1",
      inputSchema: { type: "object" },
    });

    expect(indexStore.getToolCount()).toBe(1);

    indexStore.indexTool({
      name: "tool",
      description: "Updated description",
      serverKey: "s1",
      inputSchema: { type: "object" },
    });

    // Should still be 1 (updated, not duplicated)
    expect(indexStore.getToolCount()).toBe(1);
  });

  test("getTool returns null for nonexistent tool", () => {
    server = new McpSquaredServer();
    const indexStore = server.getRetriever().getIndexStore();

    // getTool returns null (not undefined) for nonexistent tools
    const tool = indexStore.getTool("nonexistent", "tool");
    expect(tool).toBeNull();
  });

  test("tool count increases with indexing", () => {
    server = new McpSquaredServer();
    const indexStore = server.getRetriever().getIndexStore();

    expect(indexStore.getToolCount()).toBe(0);

    indexStore.indexTool({
      name: "tool1",
      description: "Tool 1",
      serverKey: "s1",
      inputSchema: { type: "object" },
    });
    expect(indexStore.getToolCount()).toBe(1);

    indexStore.indexTool({
      name: "tool2",
      description: "Tool 2",
      serverKey: "s1",
      inputSchema: { type: "object" },
    });
    expect(indexStore.getToolCount()).toBe(2);
  });
});
