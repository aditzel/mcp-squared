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
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  UpstreamServerConfig,
  UpstreamSseServerConfig,
} from "@/config/schema";
import type { CallbackResult } from "@/oauth";
import { testUpstreamConnection } from "@/upstream/client";
import { withTempConfigHome } from "./helpers/config-home";

const stdio: UpstreamServerConfig = {
  transport: "stdio",
  enabled: true,
  env: {},
  stdio: { command: "unused", args: [] },
};
const sse: UpstreamSseServerConfig = {
  transport: "sse",
  enabled: true,
  env: {},
  sse: { url: "https://example.test/mcp", headers: {} },
};
function boundary() {
  const transport = {
    close: mock(async () => {}),
    start: mock(async () => {}),
    send: mock(async () => {}),
    finishAuth: mock(async (_code: string) => {}),
  };
  const client = {
    connect: mock(async (_transport: Transport) => {}),
    close: mock(async () => {}),
    listTools: mock(async () => ({
      tools: [
        { name: "plain" },
        { name: "described", description: "description" },
      ],
    })),
    getServerVersion: mock(
      (): { name: string; version: string } | undefined => undefined,
    ),
  };
  return {
    transport,
    client,
    options: {
      clientFactory: () => client,
      stdioTransportFactory: () => transport,
      httpTransportFactory: () =>
        transport as unknown as StreamableHTTPClientTransport,
    },
  };
}

let restoreHome: (() => void) | undefined;
beforeEach(async () => {
  restoreHome = (await withTempConfigHome()).restore;
});
afterEach(() => {
  restoreHome?.();
  mock.restore();
});

describe("upstream connection lifecycle", () => {
  test("preserves tool descriptions, optional server metadata and verbose stderr", async () => {
    const b = boundary();
    const log = spyOn(console, "log").mockImplementation(() => {});
    const result = await testUpstreamConnection("fixture", stdio, {
      ...b.options,
      verbose: true,
      stdioTransportFactory: (_config, _log, _verbose, onStderr) => {
        onStderr("one\n\n two\n");
        return b.transport;
      },
    });
    expect(result).toMatchObject({
      success: true,
      tools: [
        { name: "plain" },
        { name: "described", description: "description" },
      ],
      serverName: undefined,
      serverVersion: undefined,
      stderr: "one\n\n two\n",
    });
    expect(log.mock.calls.flat().join("\n")).toContain("stderr: one");
    expect(b.transport.close).toHaveBeenCalledTimes(1);
    expect(b.client.close).toHaveBeenCalledTimes(1);
  });

  test("reports connection and tool failures, tolerating cleanup errors", async () => {
    for (const phase of ["connect", "listTools"] as const) {
      for (const failure of [new Error("broken"), "non-error rejection"]) {
        const b = boundary();
        b.client[phase].mockRejectedValue(failure);
        b.client.close.mockRejectedValue(new Error("close failed"));
        b.transport.close.mockRejectedValue(
          new Error("transport close failed"),
        );
        const result = await testUpstreamConnection(
          "fixture",
          stdio,
          b.options,
        );
        expect(result).toMatchObject({
          success: false,
          error: failure instanceof Error ? failure.message : failure,
          tools: [],
        });
        expect(b.client.close).toHaveBeenCalledTimes(1);
        expect(b.transport.close).toHaveBeenCalledTimes(1);
      }
    }
  });

  test("bounds a stalled connection and closes both resources", async () => {
    const b = boundary();
    b.client.connect.mockImplementation(() => new Promise(() => {}));
    const result = await testUpstreamConnection("fixture", stdio, {
      ...b.options,
      timeoutMs: 5,
    });
    expect(result).toMatchObject({
      success: false,
      error: "Connection timeout",
    });
    expect(b.client.close).toHaveBeenCalledTimes(1);
    expect(b.transport.close).toHaveBeenCalledTimes(1);
  });

  test("handles transport construction and unsupported config failures before connecting", async () => {
    const b = boundary();
    const unknown = await testUpstreamConnection(
      "fixture",
      { ...stdio, transport: "unknown" } as unknown as UpstreamServerConfig,
      b.options,
    );
    expect(unknown.error).toBe("Unknown transport type: unknown");
    const construction = await testUpstreamConnection("fixture", stdio, {
      ...b.options,
      stdioTransportFactory: () => {
        throw new Error("bad executable configuration");
      },
    });
    expect(construction.error).toBe("bad executable configuration");
    expect(b.client.connect).not.toHaveBeenCalled();
    expect(b.client.close).toHaveBeenCalledTimes(2);
  });

  test("constructs default transports without making network calls through an injected client", async () => {
    const b = boundary();
    const log = spyOn(console, "log").mockImplementation(() => {});
    for (const config of [
      {
        ...stdio,
        env: {
          LITERAL: "value",
          MISSING: "$MCP_SQUARED_NONEXISTENT_TEST_VARIABLE",
        },
        stdio: { command: "unused", args: [], cwd: process.cwd() },
      },
      sse,
      {
        ...sse,
        sse: { ...sse.sse, headers: { "x-fixture": "yes" }, auth: true },
      },
    ] as UpstreamServerConfig[]) {
      const result = await testUpstreamConnection("fixture", config, {
        clientFactory: () => b.client,
        verbose: true,
      });
      expect(result.success).toBe(true);
    }
    expect(log.mock.calls.flat().join("\n")).toContain(
      "Environment: LITERAL, MISSING",
    );
    expect(log.mock.calls.flat().join("\n")).toContain("Headers: x-fixture");
    expect(b.client.connect).toHaveBeenCalledTimes(3);
  });

  test.each([
    [
      { error: "access_denied", errorDescription: "user declined" },
      "OAuth error: access_denied: user declined",
    ],
    [{ error: "access_denied" }, "OAuth error: access_denied"],
    [{}, "No authorization code received"],
    [{ code: "code" }, "OAuth state mismatch"],
    [{ code: "code", state: "wrong-state" }, "OAuth state mismatch"],
  ] as Array<
    [CallbackResult, string]
  >)("stops callback server and refuses invalid authorization %j", async (callback, expected) => {
    const b = boundary();
    b.client.connect.mockRejectedValue(
      new UnauthorizedError("authorization required"),
    );
    const stop = mock(() => {});
    const result = await testUpstreamConnection(
      "fixture",
      { ...sse, sse: { ...sse.sse, auth: true } },
      {
        ...b.options,
        oauthCallbackServerFactory: () => ({
          getCallbackUrl: () => "http://127.0.0.1:8089/callback",
          waitForCallback: async () => callback,
          stop,
        }),
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain(expected);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(b.transport.finishAuth).not.toHaveBeenCalled();
    expect(b.client.connect).toHaveBeenCalledTimes(1);
  });
});
