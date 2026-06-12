import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ProxyArgs } from "@/cli";
import { runProxyCommand } from "@/cli/run-proxy";
import type { CliProcessLike } from "@/cli/runtime-bootstrap";
import { DEFAULT_CONFIG } from "@/config/schema";

function createProcessStub() {
  const handlers = new Map<string, () => void>();
  const stdinHandlers = new Map<string, () => void>();
  const exit = mock(((_code?: number) => undefined) as never);

  const processRef: CliProcessLike = {
    argv: ["bun", "run", "mcp-squared", "proxy"],
    cwd: () => "/tmp/worktree",
    env: { MCP_SQUARED_LAUNCHER: "cursor" },
    exit,
    on: ((event: string, listener: () => void) => {
      handlers.set(event, listener);
    }) as never,
    pid: 202,
    stdin: {
      on: ((event: string, listener: () => void) => {
        stdinHandlers.set(event, listener);
      }) as never,
    },
  };

  return { exit, handlers, processRef, stdinHandlers };
}

describe("runProxyCommand", () => {
  afterEach(() => {
    mock.restore();
  });

  test("starts the proxy, registers lifecycle hooks, and shuts down on stdin close", async () => {
    const { exit, handlers, processRef, stdinHandlers } = createProcessStub();
    const stop = mock(async () => {});
    const runProxy = mock(async () => ({ stop }));
    const writeInstanceEntry = spyOn(
      await import("@/config"),
      "writeInstanceEntry",
    ).mockImplementation(() => "/tmp/proxy-entry.json");
    const deleteInstanceEntry = spyOn(
      await import("@/config"),
      "deleteInstanceEntry",
    ).mockImplementation(() => false);
    const ensureRegistry = spyOn(
      await import("@/config"),
      "ensureInstanceRegistryDir",
    ).mockImplementation(() => {});
    const ensureSocket = spyOn(
      await import("@/config"),
      "ensureSocketDir",
    ).mockImplementation(() => {});

    await runProxyCommand(
      {
        noSpawn: true,
        sharedSecret: "shared-secret",
        socketPath: "/tmp/daemon.sock",
      } as ProxyArgs,
      {
        computeConfigHash: () => "cfg-hash",
        getSocketFilePath: () => "/tmp/monitor.sock",
        loadConfig: async () => ({
          config: DEFAULT_CONFIG,
          path: "/tmp/config.toml",
        }),
        processRef,
        runProxy,
      },
    );

    expect(runProxy).toHaveBeenCalledWith({
      configHash: "cfg-hash",
      endpoint: "/tmp/daemon.sock",
      noSpawn: true,
      sharedSecret: "shared-secret",
    });
    expect(ensureRegistry).toHaveBeenCalledTimes(1);
    expect(ensureSocket).toHaveBeenCalledTimes(1);
    expect(writeInstanceEntry).toHaveBeenCalledTimes(1);
    expect(handlers.has("SIGINT")).toBeTrue();
    expect(handlers.has("SIGTERM")).toBeTrue();
    expect(handlers.has("exit")).toBeTrue();
    expect(stdinHandlers.has("close")).toBeTrue();
    expect(stdinHandlers.has("end")).toBeTrue();

    stdinHandlers.get("close")?.();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(deleteInstanceEntry).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("unregisters the proxy instance if startup fails", async () => {
    const { processRef } = createProcessStub();
    const deleteInstanceEntry = spyOn(
      await import("@/config"),
      "deleteInstanceEntry",
    ).mockImplementation(() => false);
    spyOn(await import("@/config"), "writeInstanceEntry").mockImplementation(
      () => "/tmp/proxy-entry.json",
    );
    spyOn(
      await import("@/config"),
      "ensureInstanceRegistryDir",
    ).mockImplementation(() => {});
    spyOn(await import("@/config"), "ensureSocketDir").mockImplementation(
      () => {},
    );

    await expect(
      runProxyCommand({ noSpawn: false } as ProxyArgs, {
        computeConfigHash: () => "cfg-hash",
        getSocketFilePath: () => "/tmp/monitor.sock",
        loadConfig: async () => ({
          config: DEFAULT_CONFIG,
          path: "/tmp/config.toml",
        }),
        processRef,
        runProxy: mock(async () => {
          throw new Error("connect failed");
        }),
      }),
    ).rejects.toThrow("connect failed");

    expect(deleteInstanceEntry).not.toHaveBeenCalled();
  });

  test("dispatch helpers fall back to proxy runner for non-tty default mode", async () => {
    const { dispatchCliRuntime } = await import("@/cli/runtime-dispatch");
    const runDaemon = mock(async () => {});
    const runProxy = mock(async () => {});

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
        mode: "server",
        monitor: { noAutoRefresh: false, refreshInterval: 2000 } as never,
        proxy: { noSpawn: false } as never,
        stdio: false,
        testTarget: undefined,
        testVerbose: false,
        version: false,
      },
      {
        isStderrTty: false,
        isStdinTty: true,
        runAuth: async () => {},
        runConfig: async () => {},
        runDaemon,
        runImport: async () => {},
        runInit: async () => {},
        runInstall: async () => {},
        runMigrate: async () => {},
        runMonitor: async () => {},
        runProxy,
        runStatus: async () => {},
        runTest: async () => {},
        startServer: async () => {},
      },
    );

    expect(runProxy).toHaveBeenCalledTimes(1);
    expect(runDaemon).not.toHaveBeenCalled();
  });
});
