import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { createRunAuthDependencies, runAuthCommand } from "@/cli/run-auth";
import { dispatchCliRuntime } from "@/cli/runtime-dispatch";
import { DEFAULT_CONFIG } from "@/config/schema";

describe("runAuthCommand", () => {
  afterEach(() => {
    mock.restore();
  });

  test("completes the OAuth browser flow and closes resources", async () => {
    const exit = mock(((_code?: number) => undefined) as never);
    const close = mock(async () => {});
    const connect = mock(async () => {
      throw new UnauthorizedError("auth required");
    });
    const finishAuth = mock(async () => {});
    const stop = mock(() => {});
    const clearCodeVerifier = mock(() => {});
    const verifyState = mock(() => true);

    await runAuthCommand("github", {
      createAuthProvider: mock(() => ({
        clearCodeVerifier,
        isTokenExpired: () => true,
        tokens: () => undefined,
        verifyState,
      })),
      createCallbackServer: mock(() => ({
        getCallbackUrl: () => "http://localhost:4317/callback",
        stop,
        waitForCallback: async () => ({
          code: "oauth-code",
          state: "state-123",
        }),
      })),
      createClient: mock(() => ({ close, connect })),
      createTokenStorage: mock(() => ({}) as never),
      createTransport: mock(() => ({ finishAuth })),
      loadConfig: async () => ({
        config: {
          ...DEFAULT_CONFIG,
          upstreams: {
            github: {
              env: {},
              enabled: true,
              sse: {
                auth: { callbackPort: 4317, clientName: "mcp-squared" },
                headers: { Authorization: "Bearer token" },
                url: "https://example.com/sse",
              },
              transport: "sse",
            },
          },
        },
        path: "/tmp/config.toml",
      }),
      processRef: { exit },
      resolveOAuthProviderOptions: mock(() => ({
        callbackPort: 4317,
        clientName: "mcp-squared",
      })),
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(finishAuth).toHaveBeenCalledWith("oauth-code");
    expect(clearCodeVerifier).toHaveBeenCalledTimes(1);
    expect(verifyState).toHaveBeenCalledWith("state-123");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  test("exits successfully when valid tokens already exist", async () => {
    const exit = mock(((_code?: number) => undefined) as never);
    const createCallbackServer = mock(() => ({
      getCallbackUrl: () => "http://localhost:4317/callback",
      stop: () => {},
      waitForCallback: async () => ({ code: "unused" }),
    }));

    await runAuthCommand("github", {
      createAuthProvider: mock(() => ({
        clearCodeVerifier: () => {},
        isTokenExpired: () => false,
        tokens: () => ({ accessToken: "cached" }),
        verifyState: () => true,
      })),
      createCallbackServer,
      createClient: mock(() => ({
        close: async () => {},
        connect: async () => {},
      })),
      createTokenStorage: mock(() => ({}) as never),
      createTransport: mock(() => ({ finishAuth: async () => {} })),
      loadConfig: async () => ({
        config: {
          ...DEFAULT_CONFIG,
          upstreams: {
            github: {
              env: {},
              enabled: true,
              sse: { headers: {}, url: "https://example.com/sse" },
              transport: "sse",
            },
          },
        },
        path: "/tmp/config.toml",
      }),
      processRef: { exit },
      resolveOAuthProviderOptions: mock(() => ({
        callbackPort: 4317,
        clientName: "mcp-squared",
      })),
    });

    expect(createCallbackServer).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("dispatch rejects auth mode without a target name", async () => {
    const exit = spyOn(process, "exit").mockImplementation(
      (() => undefined) as never,
    );
    const error = spyOn(console, "error").mockImplementation(() => {});

    await dispatchCliRuntime(
      {
        authTarget: undefined,
        daemon: { noSpawn: false } as never,
        help: false,
        import: {
          dryRun: false,
          interactive: true,
          list: false,
          scope: "all",
          strategy: "merge",
          verbose: false,
        } as never,
        init: { security: "default" } as never,
        install: {
          command: "mcp-squared",
          dryRun: false,
          interactive: true,
          serverName: "mcp-squared",
        } as never,
        migrate: { dryRun: false } as never,
        mode: "auth",
        monitor: { noAutoRefresh: false, refreshInterval: 2000 } as never,
        proxy: { noSpawn: false } as never,
        stdio: false,
        testTarget: undefined,
        testVerbose: false,
        version: false,
      },
      {
        isStderrTty: true,
        isStdinTty: true,
        runAuth: async () => {},
        runConfig: async () => {},
        runDaemon: async () => {},
        runImport: async () => {},
        runInit: async () => {},
        runInstall: async () => {},
        runMigrate: async () => {},
        runMonitor: async () => {},
        runProxy: async () => {},
        runStatus: async () => {},
        runTest: async () => {},
        startServer: async () => {},
      },
    );

    expect(error).toHaveBeenCalledWith(
      "Error: auth command requires an upstream name.",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("createRunAuthDependencies wires the default auth factories", () => {
    const deps = createRunAuthDependencies();

    expect(typeof deps.loadConfig).toBe("function");
    expect(typeof deps.resolveOAuthProviderOptions).toBe("function");
    expect(deps.processRef.exit).toBe(process.exit);
  });
});
