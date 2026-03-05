/**
 * Tests for structured content forwarding from upstream tool calls.
 *
 * Bug fix: `cataloger.callTool()` was silently dropping `structuredContent`
 * from the MCP SDK's `CallToolResult`. These tests verify that
 * `structuredContent` is now forwarded through the entire response chain.
 */

import { describe, expect, test } from "bun:test";
import type { ServerConnection } from "../src/upstream/cataloger.js";
import { Cataloger } from "../src/upstream/cataloger.js";

type CatalogerAccess = {
  connections: Map<string, ServerConnection>;
};

function makeMockConnection(
  key: string,
  toolName: string,
  callToolFn: (req: unknown) => Promise<unknown>,
): ServerConnection {
  return {
    key,
    status: "connected",
    error: undefined,
    serverName: "mock",
    serverVersion: "1.0",
    client: { callTool: callToolFn },
    transport: null,
    authProvider: null,
    authPending: false,
    authStateVersion: 0,
    tools: [
      {
        name: toolName,
        description: "test",
        inputSchema: { type: "object" },
        serverKey: key,
      },
    ],
    config: {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: { command: "echo", args: [] },
    },
  } as unknown as ServerConnection;
}

describe("structuredContent forwarding", () => {
  test("callTool returns structuredContent when present", async () => {
    const cataloger = new Cataloger();
    const internal = cataloger as unknown as CatalogerAccess;

    const mockStructuredContent = { result: { items: [1, 2, 3] }, total: 3 };

    internal.connections.set(
      "test-server",
      makeMockConnection("test-server", "my_tool", async () => ({
        content: [{ type: "text", text: "summary" }],
        structuredContent: mockStructuredContent,
        isError: false,
      })),
    );

    const result = await cataloger.callTool("test-server:my_tool", {
      query: "test",
    });

    expect(result.structuredContent).toEqual(mockStructuredContent);
    expect(result.content).toHaveLength(1);
    expect(result.isError).toBe(false);
  });

  test("callTool returns undefined structuredContent when absent", async () => {
    const cataloger = new Cataloger();
    const internal = cataloger as unknown as CatalogerAccess;

    internal.connections.set(
      "test-server",
      makeMockConnection("test-server", "my_tool", async () => ({
        content: [{ type: "text", text: "ok" }],
        isError: false,
      })),
    );

    const result = await cataloger.callTool("test-server:my_tool", {});

    expect(result.structuredContent).toBeUndefined();
  });
});
