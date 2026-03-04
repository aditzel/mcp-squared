import { afterEach, describe, expect, spyOn, test } from "bun:test";
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

function parsePayload(result: {
  content?: Array<{ type: string; text: string }>;
}): Record<string, unknown> {
  const text = result.content?.[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("MCP metadata guidance", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("server advertises capability-first instructions", () => {
    server = new McpSquaredServer();
    const session =
      server.createSessionServer() as unknown as SessionWithInternals;
    const instructions = session.server?._instructions;

    expect(instructions).toBeString();
    expect(instructions).toContain("__describe_actions");
    expect(instructions).toContain("action");
    expect(instructions).not.toContain("find_tools");
  });

  test("capability routers expose capability-forward metadata", () => {
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
            description: "Search code context",
            serverKey: "auggie",
            inputSchema: { type: "object" },
          },
        ];
      }
      return [];
    });

    const session =
      server.createSessionServer() as unknown as SessionWithInternals;
    const tools = session._registeredTools;

    const codeSearch = tools?.["code_search"];
    expect(codeSearch?.title).toBe("Code Search");
    expect(codeSearch?.description).toContain("source-code");
    expect(codeSearch?.description).not.toContain("Routes to");
    expect(codeSearch?.annotations?.openWorldHint).toBe(true);
  });

  test("code_search __describe_actions exposes action catalog without upstream names", async () => {
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
    const cataloger = server.getCataloger();
    spyOn(cataloger, "getStatus").mockReturnValue(
      new Map([["auggie", { status: "connected", error: undefined }]]),
    );
    spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
      if (key === "auggie") {
        return [
          {
            name: "codebase-retrieval",
            description: "Search source code and symbols",
            serverKey: "auggie",
            inputSchema: { type: "object" },
          },
        ];
      }
      return [];
    });

    const session =
      server.createSessionServer() as unknown as SessionWithInternals;
    const handler = session._registeredTools?.["code_search"]?.handler;
    expect(handler).toBeDefined();

    const result = await handler?.({
      action: "__describe_actions",
      arguments: {},
    });
    const payload = parsePayload(result ?? {});
    expect(payload["capability"]).toBe("code_search");
    expect(payload["totalActions"]).toBe(1);
    expect(JSON.stringify(payload)).not.toContain("auggie");
    expect(JSON.stringify(payload)).not.toContain("codebase-retrieval");
  });

  test("registers capability routers and omits legacy meta-tools", () => {
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

    const session =
      server.createSessionServer() as unknown as SessionWithInternals;
    const tools = session._registeredTools;

    expect(tools?.["find_tools"]).toBeUndefined();
    expect(tools?.["describe_tools"]).toBeUndefined();
    expect(tools?.["execute"]).toBeUndefined();
    expect(tools?.["time_util"]).toBeDefined();
  });
});
