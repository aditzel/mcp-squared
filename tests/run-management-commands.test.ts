import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  createRunImportDependencies,
  runImportCommand,
} from "@/cli/run-import";
import {
  createRunInstallDependencies,
  runInstallCommand,
} from "@/cli/run-install";
import {
  createRunMigrateDependencies,
  runMigrateCommand,
} from "@/cli/run-migrate";
import { dispatchCliRuntime } from "@/cli/runtime-dispatch";

describe("management CLI command runners", () => {
  afterEach(() => {
    mock.restore();
  });

  test("runImportCommand delegates to the import runner", async () => {
    const runImport = mock(async () => {});
    const options = {
      dryRun: true,
      interactive: false,
      list: true,
      scope: "all",
      strategy: "merge",
      verbose: true,
    } as const;

    await runImportCommand(options, { runImport });

    expect(runImport).toHaveBeenCalledWith(options);
  });

  test("runInstallCommand delegates to the install runner", async () => {
    const runInstall = mock(async () => {});
    const options = {
      command: "mcp-squared",
      dryRun: true,
      interactive: false,
      serverName: "mcp-squared",
    } as const;

    await runInstallCommand(options, { runInstall });

    expect(runInstall).toHaveBeenCalledWith(options);
  });

  test("runMigrateCommand delegates to the migrate runner", async () => {
    const runMigrate = mock(async () => {});
    const options = { dryRun: true } as const;

    await runMigrateCommand(options, { runMigrate });

    expect(runMigrate).toHaveBeenCalledWith(options);
  });

  test("dispatch routes import, install, and migrate modes to their runners", async () => {
    const runImport = mock(async () => {});
    const runInstall = mock(async () => {});
    const runMigrate = mock(async () => {});
    const baseArgs = {
      authTarget: undefined,
      daemon: { noSpawn: false } as never,
      help: false,
      import: {
        dryRun: true,
        interactive: false,
        list: true,
        scope: "all",
        strategy: "merge",
        verbose: true,
      } as never,
      init: { security: "default" } as never,
      install: {
        command: "mcp-squared",
        dryRun: true,
        interactive: false,
        serverName: "mcp-squared",
      } as never,
      migrate: { dryRun: true } as never,
      monitor: { noAutoRefresh: false, refreshInterval: 2000 } as never,
      proxy: { noSpawn: false } as never,
      stdio: false,
      testTarget: undefined,
      testVerbose: false,
      version: false,
    };

    const dependencies = {
      isStderrTty: true,
      isStdinTty: true,
      runAuth: async () => {},
      runConfig: async () => {},
      runDaemon: async () => {},
      runImport,
      runInit: async () => {},
      runInstall,
      runMigrate,
      runMonitor: async () => {},
      runProxy: async () => {},
      runStatus: async () => {},
      runTest: async () => {},
      startServer: async () => {},
    };

    await dispatchCliRuntime({ ...baseArgs, mode: "import" }, dependencies);
    await dispatchCliRuntime({ ...baseArgs, mode: "install" }, dependencies);
    await dispatchCliRuntime({ ...baseArgs, mode: "migrate" }, dependencies);

    expect(runImport).toHaveBeenCalledWith(baseArgs.import);
    expect(runInstall).toHaveBeenCalledWith(baseArgs.install);
    expect(runMigrate).toHaveBeenCalledWith(baseArgs.migrate);
  });

  test("default management dependency factories wire the domain runners", () => {
    expect(typeof createRunImportDependencies().runImport).toBe("function");
    expect(typeof createRunInstallDependencies().runInstall).toBe("function");
    expect(typeof createRunMigrateDependencies().runMigrate).toBe("function");
  });
});
