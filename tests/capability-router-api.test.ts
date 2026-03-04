import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "@/config/schema";
import { McpSquaredServer } from "@/server/index";

type SessionWithTools = {
  _registeredTools?: Record<
    string,
    {
      title?: string;
      description?: string;
      handler?: (args?: Record<string, unknown>) => Promise<{
        content?: Array<{ type: "text"; text: string }>;
        isError?: boolean;
      }>;
    }
  >;
};

function getSession(server: McpSquaredServer): SessionWithTools {
  return server.createSessionServer() as unknown as SessionWithTools;
}

function getPayload(result: {
  content?: Array<{ type: "text"; text: string }>;
}): Record<string, unknown> {
  const text = result.content?.[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("capability-first public api", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("registers one capability router per non-empty capability", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          allow: ["code_search:codebase_retrieval"],
          block: [],
          confirm: [],
        },
      },
    };
    server = new McpSquaredServer({ config });
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
            description: "Search code context",
            serverKey: "auggie",
            inputSchema: { type: "object" },
          },
        ];
      }
      if (key === "time") {
        return [
          {
            name: "convert_time",
            description: "Convert timezone values",
            serverKey: "time",
            inputSchema: { type: "object" },
          },
        ];
      }
      return [];
    });

    const session = getSession(server);
    const names = Object.keys(session._registeredTools ?? {}).sort();

    expect(names).toEqual(["code_search", "time_util"]);
    expect(names).not.toContain("find_tools");
    expect(names).not.toContain("describe_tools");
    expect(names).not.toContain("execute");
  });

  test("capability router exposes __describe_actions without upstream identifiers", async () => {
    const config: McpSquaredConfig = { ...DEFAULT_CONFIG };
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
            description: "Search code context",
            serverKey: "auggie",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        ];
      }
      return [];
    });

    const session = getSession(server);
    const handler = session._registeredTools?.["code_search"]?.handler;
    if (!handler) {
      throw new Error("code_search router is not registered");
    }

    const result = await handler({ action: "__describe_actions" });
    const payload = getPayload(result);

    expect(payload["capability"]).toBe("code_search");
    expect(payload["actions"]).toBeDefined();
    expect(JSON.stringify(payload)).not.toContain("auggie");
    expect(JSON.stringify(payload)).not.toContain("codebase-retrieval");
  });

  test("execution failures do not leak upstream identifiers", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          allow: ["code_search:codebase_retrieval"],
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
            description: "Search code context",
            serverKey: "auggie",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        ];
      }
      return [];
    });
    spyOn(cataloger, "callTool").mockRejectedValueOnce(
      new Error("auggie:codebase-retrieval failed"),
    );

    const session = getSession(server);
    const handler = session._registeredTools?.["code_search"]?.handler;
    if (!handler) {
      throw new Error("code_search router is not registered");
    }

    const result = await handler({
      action: "codebase_retrieval",
      arguments: { query: "foo" },
    });
    const payload = getPayload(result);

    expect(result.isError).toBe(true);
    expect(payload["error"]).toBe("Action execution failed");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("auggie");
    expect(serialized).not.toContain("codebase-retrieval");
  });
});
