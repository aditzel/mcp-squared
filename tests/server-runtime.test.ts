import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "@/config/schema";
import { McpSquaredServer } from "@/server/index";

type HandlerResult = {
  content?: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type SessionWithTools = {
  _registeredTools?: Record<
    string,
    {
      handler?: (args?: Record<string, unknown>) => Promise<HandlerResult>;
    }
  >;
};

function getHandler(
  server: McpSquaredServer,
  name: string,
): (args?: Record<string, unknown>) => Promise<HandlerResult> {
  const session = server.createSessionServer() as unknown as SessionWithTools;
  const handler = session._registeredTools?.[name]?.handler;
  if (!handler) {
    throw new Error(`${name} handler is not registered`);
  }
  return handler;
}

function parsePayload(result: HandlerResult): Record<string, unknown> {
  const text = result.content?.[0]?.text;
  if (!text) {
    return {};
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe("server runtime coverage", () => {
  let server: McpSquaredServer | null = null;
  let errorSpy: ReturnType<typeof spyOn> | null = null;

  afterEach(async () => {
    if (errorSpy) {
      errorSpy.mockRestore();
      errorSpy = null;
    }

    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("refresh complete hook logs embedding generation failures", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        embeddings: { enabled: true },
      },
    };

    server = new McpSquaredServer({ config });
    const retriever = server.getRetriever();
    spyOn(retriever, "generateToolEmbeddings").mockRejectedValueOnce(
      new Error("boom"),
    );

    errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const manager = (
      server as unknown as {
        indexRefreshManager: {
          emit: (event: string, duration: number) => void;
        };
      }
    ).indexRefreshManager;
    manager.emit("refresh:complete", 1);

    // Allow async catch branch to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Background embedding generation failed"),
    );
  });

  test("describe_tools reports blocked, ambiguous, and notFound entries", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          allow: ["*:*"],
          block: ["blocked:*"],
          confirm: [],
        },
      },
    };

    server = new McpSquaredServer({ config });
    const retriever = server.getRetriever();
    spyOn(retriever, "getTools").mockReturnValue({
      tools: [
        {
          name: "safe_tool",
          description: "safe",
          serverKey: "safe",
          inputSchema: { type: "object" },
        },
        {
          name: "danger_tool",
          description: "danger",
          serverKey: "blocked",
          inputSchema: { type: "object" },
        },
      ],
      ambiguous: [{ name: "dup", alternatives: ["a:dup", "b:dup"] }],
    });

    const describeHandler = getHandler(server, "describe_tools");
    const result = await describeHandler({
      tool_names: ["safe_tool", "danger_tool", "dup", "missing"],
    });

    const payload = parsePayload(result);
    const schemas =
      (payload["schemas"] as Array<{ qualifiedName: string }>) ?? [];
    const blocked = (payload["blocked"] as string[]) ?? [];
    const notFound = (payload["notFound"] as string[]) ?? [];

    expect(result.isError).toBeUndefined();
    expect(schemas.map((s) => s.qualifiedName)).toEqual(["safe:safe_tool"]);
    expect(blocked).toEqual(["blocked:danger_tool"]);
    expect(notFound).toEqual(["missing"]);
    expect(payload["ambiguous"]).toBeDefined();
  });

  test("clear_selection_cache returns number of removed patterns", async () => {
    server = new McpSquaredServer();

    const indexStore = server.getRetriever().getIndexStore();
    indexStore.recordCooccurrence("a", "b");
    indexStore.recordCooccurrence("b", "c");

    const clearHandler = getHandler(server, "clear_selection_cache");
    const result = await clearHandler({});
    const payload = parsePayload(result);

    expect(payload["message"]).toBe("Selection cache cleared");
    expect(payload["patternsRemoved"]).toBe(2);
    expect(indexStore.getCooccurrenceCount()).toBe(0);
  });

  test("list_namespaces includes tools and conflict metadata", async () => {
    server = new McpSquaredServer();

    const cataloger = server.getCataloger();
    spyOn(cataloger, "getStatus").mockReturnValue(
      new Map([
        ["ctxdb", { status: "connected", error: undefined }],
        ["broken", { status: "error", error: "timeout" }],
      ]),
    );
    spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
      if (key === "ctxdb") {
        return [
          {
            name: "search_context",
            description: "search",
            serverKey: "ctxdb",
            inputSchema: { type: "object" },
          },
        ];
      }
      return [];
    });
    spyOn(cataloger, "getConflictingTools").mockReturnValue(
      new Map([["search", ["ctxdb:search", "github:search"]]]),
    );

    const namespacesHandler = getHandler(server, "list_namespaces");
    const result = await namespacesHandler({ include_tools: true });
    const payload = parsePayload(result);

    expect(payload["totalNamespaces"]).toBe(2);
    expect(payload["connectedCount"]).toBe(1);
    expect(payload["conflictingTools"]).toBeDefined();
    expect(payload["conflictNote"]).toBeString();

    const namespaces =
      (payload["namespaces"] as Array<Record<string, unknown>>) ?? [];
    const ctxdb = namespaces.find((n) => n["name"] === "ctxdb");
    const broken = namespaces.find((n) => n["name"] === "broken");

    expect(ctxdb?.["tools"]).toEqual(["search_context"]);
    expect(broken?.["error"]).toBe("timeout");
  });

  test("execute handler catches unexpected exceptions", async () => {
    server = new McpSquaredServer();

    const cataloger = server.getCataloger();
    spyOn(cataloger, "findTool").mockImplementation(() => {
      throw new Error("explode");
    });

    const executeHandler = getHandler(server, "execute");
    const result = await executeHandler({
      tool_name: "whatever",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload["error"]).toBe("explode");
  });

  test("find_tools supports L0 and L2 detail levels", async () => {
    server = new McpSquaredServer();

    server
      .getRetriever()
      .getIndexStore()
      .indexTool({
        name: "search_context",
        description: "Search symbols in source code",
        serverKey: "auggie",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      });

    const findHandler = getHandler(server, "find_tools");

    const l0 = await findHandler({
      query: "code search",
      detail_level: "L0",
      limit: 5,
    });
    const l0Payload = parsePayload(l0);
    const l0Tools =
      (l0Payload["tools"] as Array<Record<string, unknown>>) ?? [];

    expect(l0Tools.length).toBeGreaterThan(0);
    expect(l0Tools[0]?.["name"]).toBe("search_context");
    expect(l0Tools[0]?.["description"]).toBeUndefined();

    const l2 = await findHandler({
      query: "code search",
      detail_level: "L2",
      limit: 5,
    });
    const l2Payload = parsePayload(l2);
    const l2Tools =
      (l2Payload["tools"] as Array<Record<string, unknown>>) ?? [];

    expect(l2Tools.length).toBeGreaterThan(0);
    expect(l2Tools[0]?.["inputSchema"]).toEqual({ type: "object" });
  });

  test("startCore is idempotent and handles embedding init failure", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        local: {
          transport: "stdio",
          enabled: true,
          env: {},
          stdio: {
            command: "echo",
            args: ["noop"],
          },
        },
      },
      operations: {
        ...DEFAULT_CONFIG.operations,
        embeddings: { enabled: true },
      },
    };

    server = new McpSquaredServer({ config });
    const anyServer = server as unknown as {
      monitorServer: {
        start: () => Promise<void>;
        stop: () => Promise<void>;
        setClientInfoProvider: (provider?: () => unknown[]) => void;
      };
      indexRefreshManager: { start: () => void; stop: () => void };
    };

    const cataloger = server.getCataloger();
    const retriever = server.getRetriever();

    const connectSpy = spyOn(cataloger, "connect").mockResolvedValue(undefined);
    const disconnectSpy = spyOn(cataloger, "disconnectAll").mockResolvedValue(
      undefined,
    );
    const monitorStartSpy = spyOn(
      anyServer.monitorServer,
      "start",
    ).mockResolvedValue(undefined);
    const monitorStopSpy = spyOn(
      anyServer.monitorServer,
      "stop",
    ).mockResolvedValue(undefined);
    const refreshStartSpy = spyOn(
      anyServer.indexRefreshManager,
      "start",
    ).mockImplementation(() => {});
    const refreshStopSpy = spyOn(
      anyServer.indexRefreshManager,
      "stop",
    ).mockImplementation(() => {});

    spyOn(retriever, "initializeEmbeddings").mockRejectedValueOnce(
      new Error("init failed"),
    );
    errorSpy = spyOn(console, "error").mockImplementation(() => {});

    await server.startCore();
    await server.startCore();

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(monitorStartSpy).toHaveBeenCalledTimes(1);
    expect(refreshStartSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Embeddings: initialization failed"),
    );

    // Exercise monitor helpers and stats accessors.
    server.setMonitorClientProvider(() => []);
    expect(server.getStats()).toBeDefined();
    expect(Array.isArray(server.getToolStats())).toBe(true);

    await server.stopCore();
    await server.stopCore();

    expect(monitorStopSpy).toHaveBeenCalledTimes(1);
    expect(refreshStopSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
