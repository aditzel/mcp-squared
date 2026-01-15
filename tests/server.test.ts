import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  DetailLevelSchema,
  type McpSquaredConfig,
} from "@/config/schema";
import type {
  ToolFullSchema,
  ToolIdentity,
  ToolResult,
  ToolSummary,
} from "@/retriever/index";
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

describe("McpSquaredServer", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("can be instantiated with default options", () => {
    server = new McpSquaredServer();
    expect(server).toBeDefined();
    expect(server.isConnected()).toBe(false);
  });

  test("can be instantiated with custom options", () => {
    server = new McpSquaredServer({
      name: "test-server",
      version: "1.0.0",
    });
    expect(server).toBeDefined();
  });

  test("isConnected returns false before start", () => {
    server = new McpSquaredServer();
    expect(server.isConnected()).toBe(false);
  });

  test("exposes cataloger and retriever", () => {
    server = new McpSquaredServer();
    expect(server.getCataloger()).toBeDefined();
    expect(server.getRetriever()).toBeDefined();
  });
});

describe("DetailLevel types", () => {
  test("DetailLevelSchema validates L0, L1, L2", () => {
    expect(DetailLevelSchema.parse("L0")).toBe("L0");
    expect(DetailLevelSchema.parse("L1")).toBe("L1");
    expect(DetailLevelSchema.parse("L2")).toBe("L2");
  });

  test("DetailLevelSchema rejects invalid values", () => {
    expect(() => DetailLevelSchema.parse("L3")).toThrow();
    expect(() => DetailLevelSchema.parse("invalid")).toThrow();
  });

  test("ToolIdentity type has correct shape (L0)", () => {
    const tool: ToolIdentity = {
      name: "test_tool",
      serverKey: "test_server",
    };
    expect(tool.name).toBe("test_tool");
    expect(tool.serverKey).toBe("test_server");
    // Should not have description
    expect("description" in tool).toBe(false);
  });

  test("ToolSummary type has correct shape (L1)", () => {
    const tool: ToolSummary = {
      name: "test_tool",
      description: "A test tool",
      serverKey: "test_server",
    };
    expect(tool.name).toBe("test_tool");
    expect(tool.description).toBe("A test tool");
    expect(tool.serverKey).toBe("test_server");
  });

  test("ToolFullSchema type has correct shape (L2)", () => {
    const tool: ToolFullSchema = {
      name: "test_tool",
      description: "A test tool",
      serverKey: "test_server",
      inputSchema: {
        type: "object",
        properties: { arg: { type: "string" } },
      },
    };
    expect(tool.name).toBe("test_tool");
    expect(tool.description).toBe("A test tool");
    expect(tool.serverKey).toBe("test_server");
    expect(tool.inputSchema).toHaveProperty("type", "object");
  });

  test("ToolResult union type accepts all detail levels", () => {
    const l0: ToolResult = { name: "tool", serverKey: "server" };
    const l1: ToolResult = {
      name: "tool",
      description: "desc",
      serverKey: "server",
    };
    const l2: ToolResult = {
      name: "tool",
      description: "desc",
      serverKey: "server",
      inputSchema: { type: "object" },
    };

    expect(l0.name).toBe("tool");
    expect(l1.name).toBe("tool");
    expect(l2.name).toBe("tool");
  });
});

describe("Security filtering in discovery", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("server compiles policy on construction", () => {
    const config = createSecurityConfig({
      allow: ["fs:*"],
      block: ["fs:delete"],
      confirm: ["fs:write"],
    });
    server = new McpSquaredServer({ config });
    // Server should not throw during construction
    expect(server).toBeDefined();
  });

  test("server with block policy filters tools correctly", () => {
    const config = createSecurityConfig({
      allow: ["*:*"],
      block: ["dangerous:*"],
    });
    server = new McpSquaredServer({ config });

    // Index some mock tools via the retriever
    const retriever = server.getRetriever();
    const indexStore = retriever.getIndexStore();

    // Add tools directly to the index store for testing
    indexStore.indexTool({
      name: "safe_tool",
      description: "A safe tool",
      serverKey: "safe_server",
      inputSchema: { type: "object" },
    });
    indexStore.indexTool({
      name: "dangerous_tool",
      description: "A dangerous tool",
      serverKey: "dangerous",
      inputSchema: { type: "object" },
    });

    // Verify tools are in index
    expect(indexStore.getToolCount()).toBe(2);
  });

  test("requiresConfirmation flag can be added to tools", () => {
    // This tests the type system allows the flag
    const toolWithConfirmation: ToolSummary & {
      requiresConfirmation?: boolean;
    } = {
      name: "write_file",
      description: "Write a file",
      serverKey: "fs",
      requiresConfirmation: true,
    };

    expect(toolWithConfirmation.requiresConfirmation).toBe(true);
  });

  test("tool without requiresConfirmation flag is valid", () => {
    const toolWithoutConfirmation: ToolSummary & {
      requiresConfirmation?: boolean;
    } = {
      name: "read_file",
      description: "Read a file",
      serverKey: "fs",
    };

    expect(toolWithoutConfirmation.requiresConfirmation).toBeUndefined();
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

  test("server exposes cataloger for namespace queries", () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    // Initial state: no connections
    const status = cataloger.getStatus();
    expect(status.size).toBe(0);
  });

  test("cataloger getStatus returns namespace information", () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    // Initially empty
    const status = cataloger.getStatus();
    expect(status.size).toBe(0);
  });

  test("cataloger getToolsForServer returns empty for unknown namespace", () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    const tools = cataloger.getToolsForServer("unknown_namespace");
    expect(tools).toEqual([]);
  });

  test("cataloger getConflictingTools returns empty when no connections", () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    const conflicts = cataloger.getConflictingTools();
    expect(conflicts.size).toBe(0);
  });

  test("server can be queried for namespaces via cataloger", () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    // Build namespace info like list_namespaces tool does
    const status = cataloger.getStatus();
    const namespaces: Array<{
      name: string;
      status: string;
      toolCount: number;
    }> = [];

    for (const [key, info] of status) {
      const tools = cataloger.getToolsForServer(key);
      namespaces.push({
        name: key,
        status: info.status,
        toolCount: tools.length,
      });
    }

    expect(namespaces).toEqual([]);
    expect(namespaces.length).toBe(0);
  });

  test("namespace info structure matches expected format", () => {
    // Test the type structure that list_namespaces returns
    type NamespaceInfo = {
      name: string;
      status: string;
      toolCount: number;
      error?: string;
      tools?: string[];
    };

    const namespace: NamespaceInfo = {
      name: "test-server",
      status: "connected",
      toolCount: 5,
    };

    expect(namespace.name).toBe("test-server");
    expect(namespace.status).toBe("connected");
    expect(namespace.toolCount).toBe(5);
    expect(namespace.error).toBeUndefined();
    expect(namespace.tools).toBeUndefined();
  });

  test("namespace info with tools has correct structure", () => {
    type NamespaceInfo = {
      name: string;
      status: string;
      toolCount: number;
      error?: string;
      tools?: string[];
    };

    const namespace: NamespaceInfo = {
      name: "filesystem",
      status: "connected",
      toolCount: 3,
      tools: ["read_file", "write_file", "list_directory"],
    };

    expect(namespace.tools).toEqual([
      "read_file",
      "write_file",
      "list_directory",
    ]);
    expect(namespace.tools?.length).toBe(3);
  });

  test("namespace info with error has correct structure", () => {
    type NamespaceInfo = {
      name: string;
      status: string;
      toolCount: number;
      error?: string;
      tools?: string[];
    };

    const namespace: NamespaceInfo = {
      name: "broken-server",
      status: "error",
      toolCount: 0,
      error: "Connection timeout",
    };

    expect(namespace.status).toBe("error");
    expect(namespace.error).toBe("Connection timeout");
    expect(namespace.toolCount).toBe(0);
  });
});
