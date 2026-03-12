import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { startStdioServer } from "@/cli/run-stdio-server";
import { DEFAULT_CONFIG } from "@/config/schema";

describe("startStdioServer", () => {
  afterEach(() => {
    mock.restore();
  });

  test("starts the stdio server, registers the instance, and shuts down cleanly", async () => {
    const calls: string[] = [];
    const start = mock(async () => {
      calls.push("start");
    });
    const stop = mock(async () => {
      calls.push("stop");
    });
    const registerInstance = mock(() => {
      calls.push("register");
    });
    const unregisterInstance = mock(() => {
      calls.push("unregister");
    });
    const exit = mock(((_code?: number) => undefined) as never);
    let shutdownHandler: ((exitCode: number) => Promise<void>) | undefined;

    await startStdioServer({
      buildCliInstanceEntry: mock(() => ({ id: "instance-entry" }) as never),
      createInstanceRegistration: mock(() => ({
        registerInstance,
        unregisterInstance,
      })),
      createServer: mock(() => ({ start, stop })),
      getSocketFilePath: () => "/tmp/monitor.sock",
      listActiveInstanceEntries: async (options) => {
        calls.push(`prune:${String(options?.prune)}`);
        return [];
      },
      loadConfig: async () => ({
        config: DEFAULT_CONFIG,
        path: "/tmp/config.toml",
      }),
      logSearchModeProfile: mock(() => {
        calls.push("search");
      }),
      logSecurityProfile: mock(() => {
        calls.push("security");
      }),
      performPreflightAuth: async () => ({
        alreadyValid: [],
        authenticated: [],
        failed: [],
      }),
      prepareCliRuntimeFilesystem: mock(() => {
        calls.push("prepare");
      }),
      processRef: { ...process, exit },
      randomUUID: () => "instance-123",
      registerShutdownHooks: mock((options) => {
        shutdownHandler = options.shutdown;
      }),
      resolveLauncherHint: () => "claude",
      version: "0.8.1",
    });

    expect(calls).toEqual([
      "security",
      "search",
      "prune:true",
      "prepare",
      "start",
      "register",
    ]);
    expect(shutdownHandler).toBeDefined();

    await shutdownHandler?.(0);

    expect(calls).toEqual([
      "security",
      "search",
      "prune:true",
      "prepare",
      "start",
      "register",
      "stop",
      "unregister",
    ]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("logs preflight authentication failures and continues starting", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});

    await startStdioServer({
      buildCliInstanceEntry: mock(() => ({ id: "instance-entry" }) as never),
      createInstanceRegistration: mock(() => ({
        registerInstance: () => {},
        unregisterInstance: () => {},
      })),
      createServer: mock(() => ({
        start: async () => {},
        stop: async () => {},
      })),
      getSocketFilePath: () => "/tmp/monitor.sock",
      listActiveInstanceEntries: async () => [],
      loadConfig: async () => ({
        config: DEFAULT_CONFIG,
        path: "/tmp/config.toml",
      }),
      logSearchModeProfile: () => {},
      logSecurityProfile: () => {},
      performPreflightAuth: async () => ({
        alreadyValid: [],
        authenticated: ["github"],
        failed: [{ error: "denied", name: "slack" }],
      }),
      prepareCliRuntimeFilesystem: () => {},
      processRef: {
        ...process,
        exit: mock(((_code?: number) => undefined) as never),
      },
      randomUUID: () => "instance-123",
      registerShutdownHooks: () => {},
      resolveLauncherHint: () => undefined,
      version: "0.8.1",
    });

    expect(error).toHaveBeenCalledWith(
      "[preflight] Authenticated 1 upstream(s): github",
    );
    expect(error).toHaveBeenCalledWith(
      "[preflight] Warning: 1 upstream(s) failed authentication:",
    );
    expect(error).toHaveBeenCalledWith("[preflight]   - slack: denied");
  });
});
