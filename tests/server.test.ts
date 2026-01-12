import { afterEach, describe, expect, test } from "bun:test";
import { DetailLevelSchema } from "@/config/schema";
import { McpSquaredServer } from "@/server/index";
import type {
  ToolFullSchema,
  ToolIdentity,
  ToolResult,
  ToolSummary,
} from "@/retriever/index";

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
    const l1: ToolResult = { name: "tool", description: "desc", serverKey: "server" };
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
