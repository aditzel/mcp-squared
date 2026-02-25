import { describe, expect, mock, test } from "bun:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { UpstreamSseServerConfig } from "../src/config/schema.js";
import {
  type CallbackResult,
  type CallbackServerOptions,
  DEFAULT_OAUTH_CALLBACK_PORT,
} from "../src/oauth/index.js";
import { testUpstreamConnection } from "../src/upstream/client.js";

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
});
