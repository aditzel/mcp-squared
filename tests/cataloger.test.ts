import { describe, expect, mock, test } from "bun:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  McpSquaredConfig,
  UpstreamSseServerConfig,
} from "../src/config/schema.js";
import { Cataloger, type ServerConnection } from "../src/upstream/cataloger.js";

type CatalogerAccess = {
  connections: Map<string, ServerConnection>;
  connect: (key: string, config: ServerConnection["config"]) => Promise<void>;
  getAuthStateVersion: (key: string) => number;
};

function createSseConfig(): UpstreamSseServerConfig {
  return {
    transport: "sse",
    enabled: true,
    env: {},
    sse: {
      url: "https://example.com/mcp",
      headers: {},
      auth: true,
    },
  };
}

describe("Cataloger", () => {
  describe("constructor", () => {
    test("creates instance with default options", () => {
      const cataloger = new Cataloger();
      expect(cataloger).toBeInstanceOf(Cataloger);
    });

    test("creates instance with custom timeout", () => {
      const cataloger = new Cataloger({ connectTimeoutMs: 5000 });
      expect(cataloger).toBeInstanceOf(Cataloger);
    });
  });

  describe("initial state", () => {
    test("has no connections initially", () => {
      const cataloger = new Cataloger();
      expect(cataloger.hasConnections()).toBe(false);
    });

    test("returns empty tools list initially", () => {
      const cataloger = new Cataloger();
      expect(cataloger.getAllTools()).toEqual([]);
    });

    test("returns empty status map initially", () => {
      const cataloger = new Cataloger();
      expect(cataloger.getStatus().size).toBe(0);
    });
  });

  describe("getToolsForServer", () => {
    test("returns empty array for non-existent server", () => {
      const cataloger = new Cataloger();
      expect(cataloger.getToolsForServer("nonexistent")).toEqual([]);
    });
  });

  describe("findTool", () => {
    test("returns tool: undefined for non-existent tool", () => {
      const cataloger = new Cataloger();
      const result = cataloger.findTool("nonexistent");
      expect(result.tool).toBeUndefined();
      expect(result.ambiguous).toBe(false);
      expect(result.alternatives).toEqual([]);
    });
  });

  describe("getConnection", () => {
    test("returns undefined for non-existent connection", () => {
      const cataloger = new Cataloger();
      expect(cataloger.getConnection("nonexistent")).toBeUndefined();
    });
  });

  describe("disconnect", () => {
    test("handles disconnect of non-existent server gracefully", async () => {
      const cataloger = new Cataloger();
      await cataloger.disconnect("nonexistent");
      expect(cataloger.hasConnections()).toBe(false);
    });
  });

  describe("disconnectAll", () => {
    test("handles disconnect all with no connections", async () => {
      const cataloger = new Cataloger();
      await cataloger.disconnectAll();
      expect(cataloger.hasConnections()).toBe(false);
    });
  });

  describe("connectAll", () => {
    test("handles empty config", async () => {
      const cataloger = new Cataloger();
      const config: McpSquaredConfig = {
        schemaVersion: 1,
        upstreams: {},
        security: { tools: { allow: ["*:*"], block: [], confirm: [] } },
        operations: {
          findTools: {
            defaultLimit: 5,
            maxLimit: 50,
            defaultMode: "fast",
            defaultDetailLevel: "L1",
          },
          index: { refreshIntervalMs: 30000 },
          logging: { level: "info" },
          selectionCache: {
            enabled: true,
            minCooccurrenceThreshold: 2,
            maxBundleSuggestions: 3,
          },
        },
      };
      await cataloger.connectAll(config);
      expect(cataloger.hasConnections()).toBe(false);
    });

    test("skips disabled upstreams", async () => {
      const cataloger = new Cataloger({ connectTimeoutMs: 100 });
      const config: McpSquaredConfig = {
        schemaVersion: 1,
        upstreams: {
          disabled: {
            transport: "stdio",
            enabled: false,
            env: {},
            stdio: {
              command: "nonexistent-command",
              args: [],
            },
          },
        },
        security: { tools: { allow: ["*:*"], block: [], confirm: [] } },
        operations: {
          findTools: {
            defaultLimit: 5,
            maxLimit: 50,
            defaultMode: "fast",
            defaultDetailLevel: "L1",
          },
          index: { refreshIntervalMs: 30000 },
          logging: { level: "info" },
          selectionCache: {
            enabled: true,
            minCooccurrenceThreshold: 2,
            maxBundleSuggestions: 3,
          },
        },
      };
      await cataloger.connectAll(config);
      // Should not attempt to connect to disabled upstream
      expect(cataloger.getConnection("disabled")).toBeUndefined();
    });
  });

  describe("connect error handling", () => {
    test("handles connection to invalid command", async () => {
      const cataloger = new Cataloger({ connectTimeoutMs: 5000 });
      await cataloger.connect("test", {
        transport: "stdio",
        enabled: true,
        env: {},
        stdio: {
          command: "nonexistent-command-that-does-not-exist",
          args: [],
        },
      });

      const connection = cataloger.getConnection("test");
      expect(connection).toBeDefined();
      expect(connection?.status).toBe("error");
      expect(connection?.error).toBeDefined();

      // Verify the error message indicates the actual problem
      // Should mention one of: exit code, spawn error, ENOENT, or not found
      const errorMessage = connection?.error?.toLowerCase() ?? "";
      const indicatesInvalidCommand =
        errorMessage.includes("exit") ||
        errorMessage.includes("spawn") ||
        errorMessage.includes("enoent") ||
        errorMessage.includes("not found") ||
        errorMessage.includes("no such file");
      expect(indicatesInvalidCommand).toBe(true);
    });

    test("sets connecting status during connection attempt", async () => {
      const cataloger = new Cataloger({ connectTimeoutMs: 100 });

      // Start connection but don't await
      const connectPromise = cataloger.connect("test", {
        transport: "stdio",
        enabled: true,
        env: {},
        stdio: {
          command: "sleep",
          args: ["10"],
        },
      });

      // Check initial status (should be connecting or error depending on timing)
      const connection = cataloger.getConnection("test");
      expect(connection).toBeDefined();
      expect(connection?.status).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: status verified as defined above
      expect(["connecting", "error"]).toContain(connection!.status);

      await connectPromise;
    });
  });

  describe("callTool", () => {
    test("throws error for non-existent tool", async () => {
      const cataloger = new Cataloger();
      await expect(cataloger.callTool("nonexistent", {})).rejects.toThrow(
        "Tool not found: nonexistent",
      );
    });
  });

  describe("refreshTools", () => {
    test("handles refresh for non-existent server", async () => {
      const cataloger = new Cataloger();
      await cataloger.refreshTools("nonexistent");
      // Should not throw
    });

    test("reconnects auth-pending upstream when auth state changes", async () => {
      const cataloger = new Cataloger();
      const internals = cataloger as unknown as CatalogerAccess;
      const connectMock = mock(async () => {});

      const connection: ServerConnection = {
        key: "oauth-upstream",
        config: createSseConfig(),
        status: "error",
        error:
          "OAuth authorization required. Run: mcp-squared auth oauth-upstream",
        serverName: undefined,
        serverVersion: undefined,
        tools: [],
        client: null,
        transport: null,
        authProvider: {
          isNonInteractive: () => true,
        } as unknown as NonNullable<ServerConnection["authProvider"]>,
        authPending: true,
        authStateVersion: 1,
      };

      internals.connections.set("oauth-upstream", connection);
      internals.getAuthStateVersion = () => 2;
      internals.connect = connectMock as unknown as CatalogerAccess["connect"];

      await cataloger.refreshTools("oauth-upstream");

      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledWith(
        "oauth-upstream",
        connection.config,
      );
    });

    test("does not reconnect auth-pending upstream when auth state is unchanged", async () => {
      const cataloger = new Cataloger();
      const internals = cataloger as unknown as CatalogerAccess;
      const connectMock = mock(async () => {});

      const connection: ServerConnection = {
        key: "oauth-upstream",
        config: createSseConfig(),
        status: "error",
        error:
          "OAuth authorization required. Run: mcp-squared auth oauth-upstream",
        serverName: undefined,
        serverVersion: undefined,
        tools: [],
        client: null,
        transport: null,
        authProvider: {
          isNonInteractive: () => true,
        } as unknown as NonNullable<ServerConnection["authProvider"]>,
        authPending: true,
        authStateVersion: 2,
      };

      internals.connections.set("oauth-upstream", connection);
      internals.getAuthStateVersion = () => 2;
      internals.connect = connectMock as unknown as CatalogerAccess["connect"];

      await cataloger.refreshTools("oauth-upstream");

      expect(connectMock).toHaveBeenCalledTimes(0);
    });

    test("marks connection auth-pending when refresh hits UnauthorizedError", async () => {
      const cataloger = new Cataloger();
      const internals = cataloger as unknown as CatalogerAccess;
      const listToolsMock = mock(async () => {
        throw new UnauthorizedError("Unauthorized");
      });

      const connection: ServerConnection = {
        key: "oauth-upstream",
        config: createSseConfig(),
        status: "connected",
        error: undefined,
        serverName: "example",
        serverVersion: "1.0.0",
        tools: [],
        client: {
          listTools: listToolsMock,
        } as unknown as NonNullable<ServerConnection["client"]>,
        transport: null,
        authProvider: {
          isNonInteractive: () => true,
        } as unknown as NonNullable<ServerConnection["authProvider"]>,
        authPending: false,
        authStateVersion: 2,
      };

      internals.connections.set("oauth-upstream", connection);

      await cataloger.refreshTools("oauth-upstream");

      expect(listToolsMock).toHaveBeenCalledTimes(1);
      expect(connection.status).toBe("error");
      expect(connection.authPending).toBe(true);
      expect(connection.error).toContain("mcp-squared auth oauth-upstream");
    });
  });

  describe("refreshAllTools", () => {
    test("handles refresh with no connections", async () => {
      const cataloger = new Cataloger();
      await cataloger.refreshAllTools();
      // Should not throw
    });
  });

  describe("findToolsByName", () => {
    test("returns empty array when no connections", () => {
      const cataloger = new Cataloger();
      expect(cataloger.findToolsByName("any_tool")).toEqual([]);
    });
  });

  describe("findTool with qualified names", () => {
    test("parses qualified name and looks up by server key", () => {
      const cataloger = new Cataloger();
      const result = cataloger.findTool("nonexistent_server:some_tool");
      // Server doesn't exist, so tool is undefined
      expect(result.tool).toBeUndefined();
      expect(result.ambiguous).toBe(false);
      expect(result.alternatives).toEqual([]);
    });

    test("handles bare name with no matches", () => {
      const cataloger = new Cataloger();
      const result = cataloger.findTool("some_tool");
      expect(result.tool).toBeUndefined();
      expect(result.ambiguous).toBe(false);
      expect(result.alternatives).toEqual([]);
    });
  });

  describe("getConflictingTools", () => {
    test("returns empty map when no connections", () => {
      const cataloger = new Cataloger();
      const conflicts = cataloger.getConflictingTools();
      expect(conflicts.size).toBe(0);
    });
  });

  describe("callTool with qualified names", () => {
    test("throws error for non-existent qualified tool", async () => {
      const cataloger = new Cataloger();
      await expect(
        cataloger.callTool("server:nonexistent", {}),
      ).rejects.toThrow("Tool not found: server:nonexistent");
    });
  });
});
