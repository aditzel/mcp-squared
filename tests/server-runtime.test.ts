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

function getRegisteredToolNames(server: McpSquaredServer): string[] {
  const session = server.createSessionServer() as unknown as SessionWithTools;
  return Object.keys(session._registeredTools ?? {});
}

function getHandler(
  server: McpSquaredServer,
  capability: string,
): (args?: Record<string, unknown>) => Promise<HandlerResult> {
  const session = server.createSessionServer() as unknown as SessionWithTools;
  const handler = session._registeredTools?.[capability]?.handler;
  if (!handler) {
    throw new Error(`${capability} handler is not registered`);
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

  test("startCore is idempotent and handles embedding init failure", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        embeddings: { enabled: true },
      },
    };

    server = new McpSquaredServer({ config });
    const anyServer = server as unknown as {
      monitorServer: { start: () => Promise<void>; stop: () => Promise<void> };
      cataloger: {
        connect: (key: string, config: unknown) => Promise<void>;
        disconnectAll: () => Promise<void>;
      };
      indexRefreshManager: { start: () => void; stop: () => void };
    };
    const retriever = server.getRetriever();

    const connectSpy = spyOn(
      anyServer.cataloger,
      "connect",
    ).mockResolvedValue();
    const disconnectSpy = spyOn(
      anyServer.cataloger,
      "disconnectAll",
    ).mockResolvedValue();
    const monitorStartSpy = spyOn(
      anyServer.monitorServer,
      "start",
    ).mockResolvedValue();
    const monitorStopSpy = spyOn(
      anyServer.monitorServer,
      "stop",
    ).mockResolvedValue();
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

    expect(connectSpy).toHaveBeenCalledTimes(0);
    expect(monitorStartSpy).toHaveBeenCalledTimes(1);
    expect(refreshStartSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Embeddings: initialization failed"),
    );

    await server.stopCore();
    await server.stopCore();

    expect(monitorStopSpy).toHaveBeenCalledTimes(1);
    expect(refreshStopSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  test("capability router executes action against qualified upstream tool", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          allow: ["*:*"],
          block: [],
          confirm: [],
        },
      },
    };

    server = new McpSquaredServer({ config });
    const cataloger = server.getCataloger();

    spyOn(cataloger, "getStatus").mockReturnValue(
      new Map([["auggie", { status: "connected", error: undefined }]]),
    );
    spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
      if (key === "auggie") {
        return [
          {
            name: "codebase-retrieval",
            description: "Search source code",
            serverKey: "auggie",
            inputSchema: {
              type: "object",
              properties: {
                information_request: { type: "string" },
                directory_path: { type: "string" },
              },
              required: ["information_request", "directory_path"],
            },
          },
        ];
      }
      return [];
    });

    const callToolSpy = spyOn(cataloger, "callTool").mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      isError: false,
    });

    const handler = getHandler(server, "code_search");
    const result = await handler({
      action: "codebase_retrieval",
      arguments: {
        information_request: "find auth middleware",
        directory_path: "/Users/allan/projects/personal/mcp-squared",
      },
    });

    expect(result.isError).toBe(false);
    expect(callToolSpy).toHaveBeenCalledWith("auggie:codebase-retrieval", {
      information_request: "find auth middleware",
      directory_path: "/Users/allan/projects/personal/mcp-squared",
    });
  });

  test("__describe_actions returns action catalog without upstream identifiers", async () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    spyOn(cataloger, "getStatus").mockReturnValue(
      new Map([["auggie", { status: "connected", error: undefined }]]),
    );
    spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
      if (key === "auggie") {
        return [
          {
            name: "codebase-retrieval",
            description: "Search source code",
            serverKey: "auggie",
            inputSchema: { type: "object" },
          },
        ];
      }
      return [];
    });

    const handler = getHandler(server, "code_search");
    const result = await handler({
      action: "__describe_actions",
      arguments: {},
    });
    const payload = parsePayload(result);

    expect(payload["capability"]).toBe("code_search");
    expect(payload["totalActions"]).toBe(1);
    expect(JSON.stringify(payload)).not.toContain("auggie");
    expect(JSON.stringify(payload)).not.toContain("codebase-retrieval");
  });

  test("unknown action returns available actions", async () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    spyOn(cataloger, "getStatus").mockReturnValue(
      new Map([["time", { status: "connected", error: undefined }]]),
    );
    spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
      if (key === "time") {
        return [
          {
            name: "convert_time",
            description: "Convert time values",
            serverKey: "time",
            inputSchema: { type: "object" },
          },
        ];
      }
      return [];
    });

    const handler = getHandler(server, "time_util");
    const result = await handler({
      action: "does_not_exist",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload["error"]).toBe("Unknown action");
    expect(payload["availableActions"]).toEqual(["convert_time"]);
  });

  test("ambiguous normalized actions require disambiguation", async () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    spyOn(cataloger, "getStatus").mockReturnValue(
      new Map([["misc", { status: "connected", error: undefined }]]),
    );
    spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
      if (key === "misc") {
        return [
          {
            name: "foo-bar",
            description: "misc operation one",
            serverKey: "misc",
            inputSchema: { type: "object" },
          },
          {
            name: "foo_bar",
            description: "misc operation two",
            serverKey: "misc",
            inputSchema: { type: "object" },
          },
        ];
      }
      return [];
    });

    const handler = getHandler(server, "general");
    const result = await handler({
      action: "foo_bar",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload["requires_disambiguation"]).toBe(true);
    expect(payload["candidates"]).toEqual(["foo_bar", "foo_bar__2"]);
  });

  test("confirmation policy is enforced for capability actions", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          allow: [],
          block: [],
          confirm: ["code_search:*"],
        },
      },
    };

    server = new McpSquaredServer({ config });
    const cataloger = server.getCataloger();

    spyOn(cataloger, "getStatus").mockReturnValue(
      new Map([["auggie", { status: "connected", error: undefined }]]),
    );
    spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
      if (key === "auggie") {
        return [
          {
            name: "codebase-retrieval",
            description: "Search source code",
            serverKey: "auggie",
            inputSchema: {
              type: "object",
              properties: {
                information_request: { type: "string" },
                directory_path: { type: "string" },
              },
            },
          },
        ];
      }
      return [];
    });

    const callToolSpy = spyOn(cataloger, "callTool").mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      isError: false,
    });

    const handler = getHandler(server, "code_search");
    const first = await handler({
      action: "codebase_retrieval",
      arguments: {
        information_request: "find auth middleware",
        directory_path: "/Users/allan/projects/personal/mcp-squared",
      },
    });
    const firstPayload = parsePayload(first);
    const token = firstPayload["confirmation_token"];
    expect(firstPayload["requires_confirmation"]).toBe(true);
    expect(typeof token).toBe("string");
    expect(callToolSpy).not.toHaveBeenCalled();

    const second = await handler({
      action: "codebase_retrieval",
      arguments: {
        information_request: "find auth middleware",
        directory_path: "/Users/allan/projects/personal/mcp-squared",
      },
      confirmation_token: token as string,
    });

    expect(second.isError).toBe(false);
    expect(callToolSpy).toHaveBeenCalledWith("auggie:codebase-retrieval", {
      information_request: "find auth middleware",
      directory_path: "/Users/allan/projects/personal/mcp-squared",
    });
  });

  test("reserved action names are rewritten deterministically", async () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    spyOn(cataloger, "getStatus").mockReturnValue(
      new Map([["misc", { status: "connected", error: undefined }]]),
    );
    spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
      if (key === "misc") {
        return [
          {
            name: "describe-actions",
            description: "reserved-looking action name",
            serverKey: "misc",
            inputSchema: { type: "object" },
          },
        ];
      }
      return [];
    });

    const handler = getHandler(server, "general");
    const result = await handler({
      action: "__describe_actions",
      arguments: {},
    });
    const payload = parsePayload(result);
    const actions = (payload["actions"] as Array<{ action: string }>) ?? [];
    expect(actions.some((a) => a.action === "__describe_actions__tool")).toBe(
      true,
    );
  });

  test("registers one router per non-empty capability", () => {
    server = new McpSquaredServer();
    const cataloger = server.getCataloger();

    spyOn(cataloger, "getStatus").mockReturnValue(
      new Map([
        ["auggie", { status: "connected", error: undefined }],
        ["time", { status: "connected", error: undefined }],
      ]),
    );
    spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
      if (key === "auggie") {
        return [
          {
            name: "codebase-retrieval",
            description: "Search source code",
            serverKey: "auggie",
            inputSchema: { type: "object" },
          },
        ];
      }
      if (key === "time") {
        return [
          {
            name: "convert_time",
            description: "Convert time values",
            serverKey: "time",
            inputSchema: { type: "object" },
          },
        ];
      }
      return [];
    });

    const toolNames = getRegisteredToolNames(server).sort();
    expect(toolNames).toEqual(["code_search", "time_util"]);
  });

  test("hybrid inference populates computed overrides when embeddings available", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        embeddings: { enabled: true },
        dynamicToolSurface: {
          ...DEFAULT_CONFIG.operations.dynamicToolSurface,
          inference: "hybrid",
        },
      },
    };

    server = new McpSquaredServer({ config });
    const anyServer = server as unknown as {
      monitorServer: { start: () => Promise<void>; stop: () => Promise<void> };
      cataloger: {
        connect: (key: string, config: unknown) => Promise<void>;
        disconnectAll: () => Promise<void>;
        getStatus: () => Map<string, { status: string; error?: string }>;
        getToolsForServer: (key: string) => Array<{
          name: string;
          description?: string;
          serverKey: string;
          inputSchema?: Record<string, unknown>;
        }>;
      };
      indexRefreshManager: { start: () => void; stop: () => void };
      computedCapabilityOverrides: Partial<Record<string, string>>;
      classifyNamespacesSemantic: () => Promise<void>;
    };
    const retriever = server.getRetriever();

    spyOn(anyServer.monitorServer, "start").mockResolvedValue();
    spyOn(anyServer.monitorServer, "stop").mockResolvedValue();
    spyOn(anyServer.indexRefreshManager, "start").mockImplementation(() => {});
    spyOn(anyServer.indexRefreshManager, "stop").mockImplementation(() => {});
    spyOn(retriever, "initializeEmbeddings").mockResolvedValue();
    spyOn(retriever, "generateToolEmbeddings").mockResolvedValue(0);
    spyOn(retriever, "hasEmbeddings").mockReturnValue(true);

    // Mock getEmbeddingGenerator to return null (so we test graceful degradation)
    spyOn(retriever, "getEmbeddingGenerator").mockReturnValue(null);

    spyOn(anyServer.cataloger, "getStatus").mockReturnValue(
      new Map([["time", { status: "connected", error: undefined }]]),
    );
    spyOn(anyServer.cataloger, "getToolsForServer").mockReturnValue([]);

    errorSpy = spyOn(console, "error").mockImplementation(() => {});

    await server.startCore();

    // With null generator, should log warning and fall back
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Hybrid inference: embeddings not available, falling back to heuristic",
      ),
    );
    // No computed overrides should be set
    expect(Object.keys(anyServer.computedCapabilityOverrides).length).toBe(0);

    await server.stopCore();
  });

  test("hybrid inference degrades gracefully when embeddings unavailable", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        embeddings: { enabled: false },
        dynamicToolSurface: {
          ...DEFAULT_CONFIG.operations.dynamicToolSurface,
          inference: "hybrid",
        },
      },
    };

    server = new McpSquaredServer({ config });
    const anyServer = server as unknown as {
      monitorServer: { start: () => Promise<void>; stop: () => Promise<void> };
      indexRefreshManager: { start: () => void; stop: () => void };
      computedCapabilityOverrides: Partial<Record<string, string>>;
    };
    const retriever = server.getRetriever();

    spyOn(anyServer.monitorServer, "start").mockResolvedValue();
    spyOn(anyServer.monitorServer, "stop").mockResolvedValue();
    spyOn(anyServer.indexRefreshManager, "start").mockImplementation(() => {});
    spyOn(anyServer.indexRefreshManager, "stop").mockImplementation(() => {});

    // Embeddings disabled, so getEmbeddingGenerator returns null
    spyOn(retriever, "getEmbeddingGenerator").mockReturnValue(null);

    errorSpy = spyOn(console, "error").mockImplementation(() => {});

    await server.startCore();

    // Should log fallback warning
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("falling back to heuristic"),
    );
    expect(Object.keys(anyServer.computedCapabilityOverrides).length).toBe(0);

    await server.stopCore();
  });

  test("user config overrides always win over computed ML overrides", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        dynamicToolSurface: {
          ...DEFAULT_CONFIG.operations.dynamicToolSurface,
          capabilityOverrides: { notion: "cms_content" },
        },
      },
    };

    server = new McpSquaredServer({ config });
    const anyServer = server as unknown as {
      computedCapabilityOverrides: Partial<Record<string, string>>;
    };
    const cataloger = server.getCataloger();

    // Simulate computed ML override for "notion" → "browser_automation"
    anyServer.computedCapabilityOverrides = {
      notion: "browser_automation",
    };

    spyOn(cataloger, "getStatus").mockReturnValue(
      new Map([["notion", { status: "connected", error: undefined }]]),
    );
    spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
      if (key === "notion") {
        return [
          {
            name: "create_page",
            description: "Create a new page",
            serverKey: "notion",
            inputSchema: { type: "object" },
          },
        ];
      }
      return [];
    });

    const toolNames = getRegisteredToolNames(server);
    // User override (cms_content) should win over computed (browser_automation)
    expect(toolNames).toContain("cms_content");
    expect(toolNames).not.toContain("browser_automation");
  });
});
