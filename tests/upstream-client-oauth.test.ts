import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { UpstreamSseServerConfig } from "@/config/schema.js";
import {
  type CallbackResult,
  type CallbackServerOptions,
  DEFAULT_OAUTH_CALLBACK_PORT,
} from "@/oauth/index.js";
import { testUpstreamConnection } from "@/upstream/client.js";
import { withTempConfigHome } from "./helpers/config-home";

function createSseConfig(
  auth: UpstreamSseServerConfig["sse"]["auth"],
): UpstreamSseServerConfig {
  return {
    transport: "sse",
    enabled: true,
    env: {},
    sse: {
      url: "https://example.com/mcp",
      headers: {},
      auth,
    },
  };
}

describe("testUpstreamConnection OAuth callback settings", () => {
  let restoreConfigHome: (() => void) | undefined;

  beforeEach(async () => {
    const ctx = await withTempConfigHome();
    restoreConfigHome = ctx.restore;
  });

  afterEach(() => {
    restoreConfigHome?.();
    restoreConfigHome = undefined;
  });

  test("uses custom callbackPort from upstream auth config", async () => {
    const observedCallbackServerOptions: CallbackServerOptions[] = [];
    let issuedState: string | undefined;

    const transport = {
      finishAuth: mock(async (_code: string) => {}),
      close: mock(async () => {}),
    };

    let connectAttempts = 0;
    const client = {
      connect: mock(async () => {
        connectAttempts += 1;
        if (connectAttempts === 1) {
          throw new UnauthorizedError("Unauthorized");
        }
      }),
      close: mock(async () => {}),
      listTools: mock(async () => ({ tools: [] })),
      getServerVersion: () => ({ name: "example", version: "1.0.0" }),
    };

    const result = await testUpstreamConnection(
      "oauth-custom",
      createSseConfig({ callbackPort: 9321, clientName: "Acme Agent" }),
      {
        clientFactory: () => client,
        httpTransportFactory: (_config, _log, _verbose, authProvider) => {
          issuedState = authProvider?.state();
          return transport as unknown as StreamableHTTPClientTransport;
        },
        oauthCallbackServerFactory: (options) => {
          observedCallbackServerOptions.push(options);
          return {
            getCallbackUrl: () =>
              `http://localhost:${options.port}${options.path ?? ""}`,
            waitForCallback: async () => {
              const result: CallbackResult = { code: "auth-code" };
              if (issuedState) {
                result.state = issuedState;
              }
              return result;
            },
            stop: () => {},
          };
        },
      },
    );

    expect(result.success).toBe(true);
    expect(observedCallbackServerOptions).toHaveLength(1);
    expect(observedCallbackServerOptions[0]?.port).toBe(9321);
    expect(observedCallbackServerOptions[0]?.path).toBe("/callback");
  });

  test("uses default callback port when auth is enabled without overrides", async () => {
    const observedCallbackServerOptions: CallbackServerOptions[] = [];
    let issuedState: string | undefined;

    const transport = {
      finishAuth: mock(async (_code: string) => {}),
      close: mock(async () => {}),
    };

    let connectAttempts = 0;
    const client = {
      connect: mock(async () => {
        connectAttempts += 1;
        if (connectAttempts === 1) {
          throw new UnauthorizedError("Unauthorized");
        }
      }),
      close: mock(async () => {}),
      listTools: mock(async () => ({ tools: [] })),
      getServerVersion: () => ({ name: "example", version: "1.0.0" }),
    };

    const result = await testUpstreamConnection(
      "oauth-default",
      createSseConfig(true),
      {
        clientFactory: () => client,
        httpTransportFactory: (_config, _log, _verbose, authProvider) => {
          issuedState = authProvider?.state();
          return transport as unknown as StreamableHTTPClientTransport;
        },
        oauthCallbackServerFactory: (options) => {
          observedCallbackServerOptions.push(options);
          return {
            getCallbackUrl: () =>
              `http://localhost:${options.port}${options.path ?? ""}`,
            waitForCallback: async () => {
              const result: CallbackResult = { code: "auth-code" };
              if (issuedState) {
                result.state = issuedState;
              }
              return result;
            },
            stop: () => {},
          };
        },
      },
    );

    expect(result.success).toBe(true);
    expect(observedCallbackServerOptions).toHaveLength(1);
    expect(observedCallbackServerOptions[0]?.port).toBe(
      DEFAULT_OAUTH_CALLBACK_PORT,
    );
  });

  test("recreates the SSE transport after interactive OAuth before reconnecting", async () => {
    const observedTransports: Array<{ finishAuth: ReturnType<typeof mock> }> =
      [];
    let issuedState: string | undefined;

    const firstTransport = {
      finishAuth: mock(async (_code: string) => {}),
      close: mock(async () => {}),
    };
    const secondTransport = {
      finishAuth: mock(async (_code: string) => {}),
      close: mock(async () => {}),
    };

    let transportFactoryCalls = 0;
    let connectAttempts = 0;
    const client = {
      connect: mock(async (_transport: unknown) => {
        connectAttempts += 1;
        if (connectAttempts === 1) {
          throw new UnauthorizedError("Unauthorized");
        }
      }),
      close: mock(async () => {}),
      listTools: mock(async () => ({
        tools: [{ name: "example-action", description: "Example action" }],
      })),
      getServerVersion: () => ({ name: "example", version: "1.0.0" }),
    };

    const result = await testUpstreamConnection(
      "oauth-reconnect",
      createSseConfig(true),
      {
        clientFactory: () => client,
        httpTransportFactory: (_config, _log, _verbose, authProvider) => {
          issuedState = authProvider?.state();
          transportFactoryCalls += 1;
          const transport =
            transportFactoryCalls === 1 ? firstTransport : secondTransport;
          observedTransports.push(transport);
          return transport as unknown as StreamableHTTPClientTransport;
        },
        oauthCallbackServerFactory: (options) => ({
          getCallbackUrl: () =>
            `http://localhost:${options.port}${options.path ?? ""}`,
          waitForCallback: async () => {
            const result: CallbackResult = { code: "auth-code" };
            if (issuedState) {
              result.state = issuedState;
            }
            return result;
          },
          stop: () => {},
        }),
      },
    );

    expect(result.success).toBe(true);
    expect(transportFactoryCalls).toBe(2);
    expect(firstTransport.finishAuth).toHaveBeenCalledWith("auth-code");
    expect(secondTransport.finishAuth).not.toHaveBeenCalled();
    expect(client.connect.mock.calls[0]?.[0]).toBe(firstTransport);
    expect(client.connect.mock.calls[1]?.[0]).toBe(secondTransport);
    expect(observedTransports).toHaveLength(2);
  });
});
