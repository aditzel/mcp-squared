import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { CliArgs } from "@/cli";
import { type RunCliMainDependencies, runCliMain } from "@/cli/main-runtime";
import { main } from "@/index";
import { VERSION } from "@/version";

function createCliArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
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
    ...overrides,
  };
}

function createDependencies(
  overrides: Partial<RunCliMainDependencies> = {},
): RunCliMainDependencies {
  return {
    createRuntimeDispatchDependencies: () => ({
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
    }),
    dispatchCliRuntime: async () => {},
    parseArgs: createCliArgs,
    printHelp: () => {},
    processRef: process,
    version: VERSION,
    ...overrides,
  };
}

describe("runCliMain", () => {
  afterEach(() => {
    mock.restore();
  });

  test("prints help and exits before dispatching", async () => {
    const printHelp = mock(() => {});
    const dispatchCliRuntime = mock(async () => {});
    const exit = mock(((_code?: number) => undefined) as never);

    await runCliMain(
      ["--help"],
      createDependencies({
        dispatchCliRuntime,
        parseArgs: () => createCliArgs({ help: true }),
        printHelp,
        processRef: { ...process, exit },
      }),
    );

    expect(printHelp).toHaveBeenCalledTimes(1);
    expect(dispatchCliRuntime).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("prints version and exits before dispatching", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const dispatchCliRuntime = mock(async () => {});
    const exit = mock(((_code?: number) => undefined) as never);

    await runCliMain(
      ["--version"],
      createDependencies({
        dispatchCliRuntime,
        parseArgs: () => createCliArgs({ version: true }),
        processRef: { ...process, exit },
      }),
    );

    expect(log).toHaveBeenCalledWith(`MCP² v${VERSION}`);
    expect(dispatchCliRuntime).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("builds runtime dependencies from parsed args and dispatches them", async () => {
    const parsedArgs = createCliArgs({ mode: "test", testTarget: "github" });
    const runtimeDependencies = {
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
    };
    const createRuntimeDispatchDependencies = mock(() => runtimeDependencies);
    const dispatchCliRuntime = mock(async () => {});

    await runCliMain(
      ["test", "github"],
      createDependencies({
        createRuntimeDispatchDependencies,
        dispatchCliRuntime,
        parseArgs: () => parsedArgs,
      }),
    );

    expect(createRuntimeDispatchDependencies).toHaveBeenCalledWith(parsedArgs);
    expect(dispatchCliRuntime).toHaveBeenCalledWith(
      parsedArgs,
      runtimeDependencies,
    );
  });

  test("main delegates to the injectable CLI runtime dependencies", async () => {
    const parsedArgs = createCliArgs({ mode: "status", testVerbose: true });
    const dispatchCliRuntime = mock(async () => {});

    await main(
      ["status", "--verbose"],
      createDependencies({
        dispatchCliRuntime,
        parseArgs: () => parsedArgs,
      }),
    );

    expect(dispatchCliRuntime).toHaveBeenCalledWith(
      parsedArgs,
      expect.objectContaining({
        isStderrTty: true,
        isStdinTty: true,
      }),
    );
  });
});
