import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  createRunMonitorDependencies,
  runMonitorCommand,
} from "@/cli/run-monitor";
import { dispatchCliRuntime } from "@/cli/runtime-dispatch";
import { DEFAULT_CONFIG } from "@/config/schema";

describe("runMonitorCommand", () => {
  afterEach(() => {
    mock.restore();
  });

  test("loads the daemon monitor socket and launches the TUI", async () => {
    const exit = mock(((_code?: number) => undefined) as never);
    const augmentProcessInfo = mock(() => {});
    const runMonitorTui = mock(async () => {});

    await runMonitorCommand(
      { noAutoRefresh: false, refreshInterval: 2500 },
      {
        augmentProcessInfo,
        computeConfigHash: () => "cfg-hash",
        getSocketFilePath: () => "/tmp/monitor.sock",
        isTuiModuleNotFoundError: () => false,
        loadConfig: async () => ({
          config: DEFAULT_CONFIG,
          path: "/tmp/config.toml",
        }),
        loadLiveDaemonRegistry: async () => ({
          pid: 123,
          startedAt: "2026-03-10T14:44:00.000Z",
          version: "0.8.0",
        }),
        loadMonitorTui: async () => ({ runMonitorTui }),
        printTuiUnavailableError: mock(() => {}),
        processRef: { exit, platform: process.platform },
      },
    );

    expect(augmentProcessInfo).toHaveBeenCalledTimes(1);
    expect(runMonitorTui).toHaveBeenCalledWith({
      instances: [
        {
          command: "mcp-squared daemon",
          configPath: "/tmp/config.toml",
          id: "daemon-cfg-hash",
          pid: 123,
          role: "daemon",
          socketPath: "/tmp/monitor.sock",
          startedAt: "2026-03-10T14:44:00.000Z",
          version: "0.8.0",
        },
      ],
      refreshInterval: 2500,
      socketPath: "/tmp/monitor.sock",
    });
    expect(exit).not.toHaveBeenCalled();
  });

  test("exits with a TUI-specific error when the runtime is unavailable", async () => {
    const exit = mock(((_code?: number) => undefined) as never);
    const printTuiUnavailableError = mock(() => {});

    await runMonitorCommand(
      {
        noAutoRefresh: true,
        refreshInterval: 2500,
        socketPath: "/tmp/monitor.sock",
      },
      {
        augmentProcessInfo: mock(() => {}),
        computeConfigHash: () => "cfg-hash",
        getSocketFilePath: () => "/tmp/monitor.sock",
        isTuiModuleNotFoundError: () => true,
        loadConfig: async () => ({
          config: DEFAULT_CONFIG,
          path: "/tmp/config.toml",
        }),
        loadLiveDaemonRegistry: async () => null,
        loadMonitorTui: async () => {
          throw new Error("Cannot find module '@opentui/core'");
        },
        printTuiUnavailableError,
        processRef: { exit, platform: process.platform },
      },
    );

    expect(printTuiUnavailableError).toHaveBeenCalledWith("monitor");
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("dispatch calls the monitor runner for monitor mode", async () => {
    const runMonitor = mock(async () => {});

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
        mode: "monitor",
        monitor: {
          instanceId: "daemon-cfg",
          noAutoRefresh: true,
          refreshInterval: 1000,
          socketPath: "/tmp/monitor.sock",
        },
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
        runMonitor,
        runProxy: async () => {},
        runStatus: async () => {},
        runTest: async () => {},
        startServer: async () => {},
      },
    );

    expect(runMonitor).toHaveBeenCalledWith({
      instanceId: "daemon-cfg",
      noAutoRefresh: true,
      refreshInterval: 1000,
      socketPath: "/tmp/monitor.sock",
    });
  });

  test("createRunMonitorDependencies wires the default monitor factories", () => {
    const deps = createRunMonitorDependencies();

    expect(typeof deps.augmentProcessInfo).toBe("function");
    expect(typeof deps.computeConfigHash).toBe("function");
    expect(typeof deps.loadMonitorTui).toBe("function");
    expect(deps.processRef).toBe(process);
  });
});
