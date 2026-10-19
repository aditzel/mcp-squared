import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { UpstreamSseServerConfig } from "@/config";
import { TokenStorage } from "@/oauth/token-storage";
import { Cataloger } from "@/upstream/cataloger";
import { withTempConfigHome } from "./helpers/config-home";

let restore: (() => void) | undefined;
const instances: Cataloger[] = [];
beforeEach(async () => {
  restore = (await withTempConfigHome()).restore;
});
afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.disconnectAll();
  mock.restore();
  restore?.();
});
const http: UpstreamSseServerConfig = {
  transport: "sse",
  enabled: true,
  env: {},
  sse: { url: "https://example.test/mcp", headers: {} },
};
function fixture() {
  const cataloger = new Cataloger();
  instances.push(cataloger);
  const connect = spyOn(Client.prototype, "connect").mockResolvedValue();
  const close = spyOn(Client.prototype, "close").mockResolvedValue();
  spyOn(Client.prototype, "getServerVersion").mockReturnValue({
    name: "Fixture",
    version: "1.0",
  });
  const list = spyOn(Client.prototype, "listTools").mockResolvedValue({
    tools: [
      {
        name: "shared",
        description: "Shared tool",
        inputSchema: { type: "object" },
      },
      { name: "unique", inputSchema: { type: "object" } },
    ],
  });
  return { cataloger, connect, close, list };
}

describe("cataloger connection lifecycle", () => {
  test("catalogs transports, replaces connections and reports ambiguous tool names", async () => {
    const { cataloger, close, list } = fixture();
    await cataloger.connect("stdio", {
      transport: "stdio",
      enabled: true,
      env: { LOCAL: "literal", ABSENT: "$MCP_SQUARED_MISSING_FIXTURE_ENV" },
      stdio: { command: "unused", args: [], cwd: process.cwd() },
    });
    expect(cataloger.getConnection("stdio")).toMatchObject({
      status: "connected",
      serverName: "Fixture",
      serverVersion: "1.0",
    });
    await cataloger.connect("http", {
      ...http,
      env: { LOCAL: "literal" },
      sse: {
        ...http.sse,
        headers: {
          literal: "value",
          local: "$LOCAL",
          missing: "$MCP_SQUARED_MISSING_FIXTURE_ENV",
        },
      },
    });
    expect(cataloger.findTool("shared")).toMatchObject({
      ambiguous: true,
      alternatives: ["stdio:shared", "http:shared"],
    });
    expect(cataloger.findTool("http:shared").tool?.serverKey).toBe("http");
    expect(cataloger.findTool("http:missing").tool).toBeUndefined();
    expect(cataloger.findToolsByName("missing")).toEqual([]);
    expect(cataloger.getConflictingTools().get("shared")).toEqual([
      "stdio:shared",
      "http:shared",
    ]);
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    cataloger.logConflicts();
    expect(warning.mock.calls.flat().join("\n")).toContain(
      "stdio:shared, http:shared",
    );
    list.mockResolvedValue({
      tools: [{ name: "replacement", inputSchema: { type: "object" } }],
    });
    await cataloger.connect("http", http);
    expect(close).toHaveBeenCalledTimes(1);
    expect(
      cataloger.getToolsForServer("http").map((tool) => tool.name),
    ).toEqual(["replacement"]);
    expect(cataloger.getConflictingTools().size).toBe(0);
    await cataloger.disconnect("stdio");
    expect(cataloger.findTool("stdio:shared").tool).toBeUndefined();
    expect(cataloger.getAllTools().map((tool) => tool.name)).toEqual([
      "replacement",
    ]);
  });

  test("keeps OAuth pending and refresh errors distinct from healthy connections", async () => {
    const { cataloger, connect, list } = fixture();
    connect.mockRejectedValue(new UnauthorizedError("authorization required"));
    await cataloger.connect("oauth", {
      ...http,
      sse: { ...http.sse, auth: { callbackPort: 9099, clientName: "fixture" } },
    });
    expect(cataloger.getConnection("oauth")).toMatchObject({
      status: "needs_auth",
      authPending: true,
    });
    expect(cataloger.hasConnections()).toBe(false);
    expect(cataloger.getToolsForServer("oauth")).toEqual([]);
    expect(cataloger.getAllTools()).toEqual([]);
    connect.mockResolvedValue();
    new TokenStorage().save("stored", {
      tokens: { access_token: "fixture", token_type: "Bearer" },
    });
    await cataloger.connect("stored", http);
    expect(cataloger.getConnection("stored")?.authProvider).not.toBeNull();
    list.mockRejectedValue(new UnauthorizedError("expired"));
    await cataloger.refreshTools("stored");
    expect(cataloger.getConnection("stored")).toMatchObject({
      status: "needs_auth",
      authPending: true,
    });
  });

  test("refreshes tool inventory and contains ordinary and non-Error failures", async () => {
    const { cataloger, connect, list, close } = fixture();
    await cataloger.connect("plain", http);
    list.mockResolvedValue({
      tools: [
        {
          name: "new_tool",
          description: "new",
          inputSchema: { type: "object" },
        },
      ],
    });
    await cataloger.refreshAllTools();
    expect(
      cataloger.getToolsForServer("plain").map((tool) => tool.name),
    ).toEqual(["new_tool"]);
    list.mockRejectedValue("network failure");
    await cataloger.refreshTools("plain");
    expect(cataloger.getStatus().get("plain")).toEqual({
      status: "error",
      error: "network failure",
    });
    expect(cataloger.findTool("plain:new_tool").tool).toBeUndefined();
    close.mockRejectedValue(new Error("close failure"));
    connect.mockRejectedValue("connection failure");
    await cataloger.connect("broken", http);
    expect(cataloger.getConnection("broken")).toMatchObject({
      status: "error",
      error: "connection failure",
      client: null,
      transport: null,
    });
  });
});
