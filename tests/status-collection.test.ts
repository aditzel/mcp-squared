import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { DEFAULT_CONFIG, getDefaultConfigPath, saveConfig } from "@/config";
import {
  collectStatus,
  formatStatus,
  runStatus,
  type UpstreamStatus,
} from "@/status/runner";
import {
  type CatalogedTool,
  Cataloger,
  type ServerConnection,
} from "@/upstream/cataloger";
import { withTempConfigHome } from "./helpers/config-home";

afterEach(() => mock.restore());
const upstream = {
  transport: "stdio" as const,
  enabled: true,
  env: {},
  stdio: { command: "unused", args: [] },
};
const tool = (serverKey: string): CatalogedTool => ({
  serverKey,
  name: "search",
  description: "Search source code",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
});

function networkBoundary() {
  const connect = spyOn(Cataloger.prototype, "connectAll").mockResolvedValue();
  const disconnect = spyOn(
    Cataloger.prototype,
    "disconnectAll",
  ).mockResolvedValue();
  return { connect, disconnect };
}

describe("status collection", () => {
  test("reports disabled, absent, failed and connected servers, routing only connected inventories", async () => {
    const boundary = networkBoundary();
    const config = structuredClone(DEFAULT_CONFIG);
    config.upstreams = {
      zeta: { ...upstream, label: "Code search" },
      alpha: upstream,
      absent: upstream,
      failed: upstream,
      disabled: { ...upstream, enabled: false },
    };
    config.operations.dynamicToolSurface.capabilityOverrides = {
      zeta: "code_search",
    };
    config.operations.adapterProjection.enabled = true;
    spyOn(Cataloger.prototype, "getStatus").mockReturnValue(
      new Map([
        ["zeta", { status: "connected", error: undefined }],
        ["alpha", { status: "connected", error: undefined }],
        ["failed", { status: "error", error: "offline" }],
      ]),
    );
    spyOn(Cataloger.prototype, "getConnection").mockImplementation((name) =>
      name === "zeta"
        ? ({
            tools: [tool(name)],
            serverName: "Fixture",
            serverVersion: "1.0",
          } as ServerConnection)
        : undefined,
    );
    const tools = spyOn(
      Cataloger.prototype,
      "getToolsForServer",
    ).mockImplementation((name) => [tool(name)]);
    const result = await collectStatus(config);
    expect(result.upstreams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "disabled",
          enabled: false,
          toolCount: 0,
        }),
        expect.objectContaining({
          name: "absent",
          status: "disconnected",
          toolCount: 0,
        }),
        expect.objectContaining({
          name: "failed",
          status: "error",
          error: "offline",
        }),
        expect.objectContaining({
          name: "zeta",
          status: "connected",
          serverName: "Fixture",
          serverVersion: "1.0",
          toolCount: 1,
        }),
      ]),
    );
    expect(tools).toHaveBeenCalledTimes(2);
    expect(
      result.classifications?.find((item) => item.namespace === "zeta")
        ?.canonicalCapability,
    ).toBe("code_search");
    expect(result.adapterProjection?.projections).toHaveLength(2);
    expect(result.contextStats?.upstreamToolCount).toBe(2);
    expect(boundary.connect).toHaveBeenCalledWith(config);
    expect(boundary.disconnect).toHaveBeenCalledTimes(1);
  });

  test("returns empty routing without connected inventories and always disconnects after failure", async () => {
    const boundary = networkBoundary();
    const config = structuredClone(DEFAULT_CONFIG);
    config.upstreams = { disabled: { ...upstream, enabled: false } };
    expect(await collectStatus(config)).toMatchObject({
      routers: [],
      classifications: [],
    });
    const failure = new Error("connection setup failed");
    boundary.connect.mockRejectedValue(failure);
    await expect(collectStatus(config)).rejects.toBe(failure);
    expect(boundary.disconnect).toHaveBeenCalledTimes(2);
  });

  test("loads a real isolated config and prints its report", async () => {
    const context = await withTempConfigHome();
    try {
      const config = structuredClone(DEFAULT_CONFIG);
      config.upstreams = { disabled: { ...upstream, enabled: false } };
      const path = getDefaultConfigPath().path;
      await saveConfig(path, config);
      const log = spyOn(console, "log").mockImplementation(() => {});
      networkBoundary();
      await runStatus({ verbose: true });
      expect(log.mock.calls.flat().join("\n")).toContain(path);
      expect(log.mock.calls.flat().join("\n")).toContain("1 disabled");
    } finally {
      context.restore();
    }
  });

  test("formats unavailable/auth/error runtime details and empty capability actions", () => {
    const runtime = {
      lifecycle: "singleton" as const,
      concurrency: "exclusive" as const,
      maxPoolSize: 1,
      restart: "on_failure" as const,
      lease: { enabled: false, maxDurationMs: 300000 },
    };
    const upstreams: UpstreamStatus[] = [
      "needs_auth",
      "error",
      "disconnected",
      "connecting",
    ].map((status) => ({
      name: status,
      status: status as UpstreamStatus["status"],
      enabled: true,
      toolCount: 0,
      runtime,
    }));
    const report = formatStatus(
      { upstreams, routers: [{ capability: "general", actions: [] }] },
      { verbose: true },
    );
    expect(report).toContain("Authentication required");
    expect(report).toContain("Unknown error");
    expect(report.match(/runtime=singleton\/exclusive/g)).toHaveLength(4);
    expect(report).toContain("(no actions)");
    expect(report).toContain("connecting");
  });
});
