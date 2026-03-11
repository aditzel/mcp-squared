import { describe, expect, mock, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createSessionServer,
  startPrimaryServerSession,
  stopPrimaryServerSession,
} from "@/server/server-shell";

describe("server shell helpers", () => {
  test("createSessionServer creates a fresh server and registers the session surface", () => {
    const createdServer = { id: "session" } as unknown as McpServer;
    const createMcpServer = mock(() => createdServer);
    const registerConfiguredSessionSurface = mock(() => {});

    const server = createSessionServer({
      name: "mcp-squared",
      version: "1.2.3",
      createMcpServer,
      registerConfiguredSessionSurface,
    });

    expect(server).toBe(createdServer);
    expect(createMcpServer).toHaveBeenCalledWith("mcp-squared", "1.2.3");
    expect(registerConfiguredSessionSurface).toHaveBeenCalledWith(
      createdServer,
    );
  });

  test("startPrimaryServerSession registers the base session surface once and tracks the connection", async () => {
    const calls: string[] = [];
    const server = {
      connect: mock(async () => {
        calls.push("connect");
      }),
    } as unknown as McpServer;
    const startCore = mock(async () => {
      calls.push("startCore");
    });
    const registerConfiguredSessionSurface = mock(() => {
      calls.push("register");
    });
    const statsCollector = {
      incrementActiveConnections: mock(() => {
        calls.push("increment");
      }),
      decrementActiveConnections: mock(() => {}),
    };

    const result = await startPrimaryServerSession({
      startCore,
      baseToolsRegistered: false,
      server,
      registerConfiguredSessionSurface,
      statsCollector,
    });

    expect(result).toEqual({ baseToolsRegistered: true });
    expect(startCore).toHaveBeenCalledTimes(1);
    expect(registerConfiguredSessionSurface).toHaveBeenCalledWith(server);
    expect(statsCollector.incrementActiveConnections).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["startCore", "register", "connect", "increment"]);
  });

  test("startPrimaryServerSession skips re-registering the base session surface after first startup", async () => {
    const server = {
      connect: mock(async () => {}),
    } as unknown as McpServer;
    const registerConfiguredSessionSurface = mock(() => {});

    const result = await startPrimaryServerSession({
      startCore: async () => {},
      baseToolsRegistered: true,
      server,
      registerConfiguredSessionSurface,
      statsCollector: {
        incrementActiveConnections: () => {},
        decrementActiveConnections: () => {},
      },
    });

    expect(result).toEqual({ baseToolsRegistered: true });
    expect(registerConfiguredSessionSurface).not.toHaveBeenCalled();
  });

  test("stopPrimaryServerSession clears transport, decrements active connections, and stops the shared runtime", async () => {
    const calls: string[] = [];
    const server = {
      close: mock(async () => {
        calls.push("close");
      }),
    } as unknown as McpServer;
    const statsCollector = {
      incrementActiveConnections: mock(() => {}),
      decrementActiveConnections: mock(() => {
        calls.push("decrement");
      }),
    };
    const stopCore = mock(async () => {
      calls.push("stopCore");
    });

    await stopPrimaryServerSession({
      server,
      statsCollector,
      stopCore,
    });

    expect(statsCollector.decrementActiveConnections).toHaveBeenCalledTimes(1);
    expect(stopCore).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["close", "decrement", "stopCore"]);
  });
});
