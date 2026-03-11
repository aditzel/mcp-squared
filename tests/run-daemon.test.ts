import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { DaemonArgs } from "@/cli";
import {
  createRunDaemonDependencies,
  runDaemonCommand,
} from "@/cli/run-daemon";
import type { CliProcessLike } from "@/cli/runtime-bootstrap";
import { DEFAULT_CONFIG } from "@/config/schema";

function createProcessStub() {
  const handlers = new Map<string, () => void>();
  const stdinHandlers = new Map<string, () => void>();
  const exit = mock(((_code?: number) => undefined) as never);

  const processRef: CliProcessLike = {
    argv: ["bun", "run", "mcp-squared", "daemon"],
    cwd: () => "/tmp/worktree",
    env: { MCP_SQUARED_DAEMON_SECRET: "env-secret" },
    exit,
    on: ((event: string, listener: () => void) => {
      handlers.set(event, listener);
    }) as never,
    pid: 101,
    stdin: {
      on: ((event: string, listener: () => void) => {
        stdinHandlers.set(event, listener);
      }) as never,
    },
  };

  return { exit, handlers, processRef, stdinHandlers };
}

describe("runDaemonCommand", () => {
  afterEach(() => {
    mock.restore();
  });

  beforeEach(() => {
    process.env.MCP_SQUARED_DAEMON_SECRET = "env-secret";
  });

  test("starts the daemon, registers shutdown handlers, and exits cleanly on signal", async () => {
    const { exit, handlers, processRef, stdinHandlers } = createProcessStub();
    const calls: string[] = [];
    const start = mock(async () => {
      calls.push("start");
    });
    const stop = mock(async () => {
      calls.push("stop");
    });
    const createRuntime = mock(() => ({ kind: "runtime" }));
    const createDaemon = mock((options) => {
      calls.push(`secret:${options.sharedSecret ?? "none"}`);
      return { start, stop };
    });
    const writeInstanceEntry = spyOn(
      await import("@/config"),
      "writeInstanceEntry",
    ).mockImplementation(() => "/tmp/instance.json");
    const deleteInstanceEntry = spyOn(
      await import("@/config"),
      "deleteInstanceEntry",
    ).mockImplementation(() => {});
    const ensureRegistry = spyOn(
      await import("@/config"),
      "ensureInstanceRegistryDir",
    ).mockImplementation(() => {});
    const ensureSocket = spyOn(
      await import("@/config"),
      "ensureSocketDir",
    ).mockImplementation(() => {});

    await runDaemonCommand(
      {
        sharedSecret: "cli-secret",
        socketPath: "/tmp/daemon.sock",
      } as DaemonArgs,
      {
        computeConfigHash: () => "cfg-hash",
        createDaemon,
        createRuntime: createRuntime as never,
        getSocketFilePath: () => "/tmp/monitor.sock",
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
        processRef,
      },
    );

    expect(createRuntime).toHaveBeenCalledWith({
      config: DEFAULT_CONFIG,
      monitorSocketPath: "/tmp/monitor.sock",
    });
    expect(createDaemon).toHaveBeenCalledWith({
      configHash: "cfg-hash",
      onIdleShutdown: expect.any(Function),
      runtime: { kind: "runtime" },
      sharedSecret: "cli-secret",
      socketPath: "/tmp/daemon.sock",
    });
    expect(ensureRegistry).toHaveBeenCalledTimes(1);
    expect(ensureSocket).toHaveBeenCalledTimes(1);
    expect(writeInstanceEntry).toHaveBeenCalledTimes(1);
    expect(handlers.has("SIGINT")).toBeTrue();
    expect(handlers.has("SIGTERM")).toBeTrue();
    expect(handlers.has("exit")).toBeTrue();
    expect(stdinHandlers.size).toBe(0);

    handlers.get("SIGINT")?.();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(deleteInstanceEntry).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(calls).toEqual([
      "security",
      "search",
      "secret:cli-secret",
      "start",
      "stop",
    ]);
  });

  test("dispatch helpers send default interactive server mode to the daemon runner", async () => {
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
        isStderrTty: true,
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

    expect(runDaemon).toHaveBeenCalledTimes(1);
    expect(runProxy).not.toHaveBeenCalled();
  });

  test("createRunDaemonDependencies wires the default runtime factories", () => {
    const deps = createRunDaemonDependencies({
      logSearchModeProfile: () => {},
      logSecurityProfile: () => {},
    });

    expect(typeof deps.computeConfigHash).toBe("function");
    expect(typeof deps.getSocketFilePath).toBe("function");
    expect(typeof deps.loadConfig).toBe("function");
    expect(deps.processRef).toBe(process);
  });
});
