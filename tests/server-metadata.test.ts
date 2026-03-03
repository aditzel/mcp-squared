import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "@/config/schema";
import { McpSquaredServer } from "@/server/index";

type SessionWithInternals = {
  _registeredTools?: Record<
    string,
    {
      title?: string;
      description?: string;
      handler?: (args: Record<string, unknown>) => Promise<{
        content?: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>;
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        openWorldHint?: boolean;
      };
    }
  >;
  server?: {
    _instructions?: string;
  };
};

describe("MCP metadata guidance", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("server advertises discovery-first instructions", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        auggie: {
          transport: "stdio",
          enabled: true,
          env: {},
          stdio: {
            command: "auggie",
            args: [],
          },
        },
      },
    };

    server = new McpSquaredServer({ config });

    const session =
      server.createSessionServer() as unknown as SessionWithInternals;
    const instructions = session.server?._instructions;

    expect(instructions).toBeString();
    expect(instructions).toContain("find_tools");
    expect(instructions).toContain("code search");
    expect(instructions).toContain("auggie");
  });

  test("meta-tools expose intentful titles and annotations", () => {
    server = new McpSquaredServer();
    const session =
      server.createSessionServer() as unknown as SessionWithInternals;
    const tools = session._registeredTools;

    expect(tools).toBeDefined();

    const findTools = tools?.["find_tools"];
    expect(findTools?.title).toBe("Discover Upstream Tools");
    expect(findTools?.description).toContain("Call this first");
    expect(findTools?.annotations?.readOnlyHint).toBe(true);
    expect(findTools?.annotations?.openWorldHint).toBe(false);

    const execute = tools?.["execute"];
    expect(execute?.title).toBe("Execute Upstream Tool");
    expect(execute?.description).toContain("after find_tools");
  });

  test("find_tools prioritizes configured code-search namespaces", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        auggie: {
          transport: "stdio",
          enabled: true,
          env: {},
          stdio: {
            command: "auggie",
            args: [],
          },
        },
      },
    };

    server = new McpSquaredServer({ config });
    const indexStore = server.getRetriever().getIndexStore();
    indexStore.indexTool({
      name: "search_context",
      description: "Search symbols and code across repositories",
      serverKey: "auggie",
      inputSchema: { type: "object" },
    });
    indexStore.indexTool({
      name: "read_file",
      description: "Read a file from the filesystem",
      serverKey: "filesystem",
      inputSchema: { type: "object" },
    });

    const session =
      server.createSessionServer() as unknown as SessionWithInternals;
    const findToolsHandler = session._registeredTools?.["find_tools"]?.handler;

    expect(findToolsHandler).toBeDefined();

    const result = await findToolsHandler?.({
      query: "search the codebase for a symbol",
      limit: 5,
    });
    const text = result?.content?.[0]?.text;
    expect(text).toBeString();

    const payload = JSON.parse(text ?? "{}") as {
      tools?: Array<{ serverKey: string; name: string }>;
      guidance?: { preferredNamespaces?: string[] };
    };

    expect(payload.tools?.[0]?.serverKey).toBe("auggie");
    expect(payload.guidance?.preferredNamespaces).toContain("auggie");
  });

  test("find_tools honors explicit code-search namespace preferences", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        ctxdb: {
          transport: "stdio",
          enabled: true,
          env: {},
          stdio: {
            command: "ctxdb",
            args: [],
          },
        },
      },
      operations: {
        ...DEFAULT_CONFIG.operations,
        findTools: {
          ...DEFAULT_CONFIG.operations.findTools,
          preferredNamespacesByIntent: {
            codeSearch: ["ctxdb"],
          },
        },
      },
    };

    server = new McpSquaredServer({ config });
    const indexStore = server.getRetriever().getIndexStore();
    indexStore.indexTool({
      name: "lookup",
      description: "Lookup indexed entries from context storage",
      serverKey: "ctxdb",
      inputSchema: { type: "object" },
    });
    indexStore.indexTool({
      name: "search_symbol",
      description: "Find symbol definitions in source code",
      serverKey: "filesystem",
      inputSchema: { type: "object" },
    });

    const session =
      server.createSessionServer() as unknown as SessionWithInternals;
    const findToolsHandler = session._registeredTools?.["find_tools"]?.handler;
    expect(findToolsHandler).toBeDefined();

    const result = await findToolsHandler?.({
      query: "find symbol in codebase",
      limit: 5,
    });
    const text = result?.content?.[0]?.text;
    expect(text).toBeString();

    const payload = JSON.parse(text ?? "{}") as {
      tools?: Array<{ serverKey: string; name: string }>;
      guidance?: { preferredNamespaces?: string[] };
    };

    expect(payload.tools?.[0]?.serverKey).toBe("ctxdb");
    expect(payload.guidance?.preferredNamespaces).toContain("ctxdb");
  });
});
