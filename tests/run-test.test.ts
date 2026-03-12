import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  createRunTestDependencies,
  type RunTestDependencies,
  runTestCommand,
} from "@/cli/run-test";
import { dispatchCliRuntime } from "@/cli/runtime-dispatch";
import { DEFAULT_CONFIG } from "@/config/schema";

function createTestDeps(
  overrides: Partial<RunTestDependencies> = {},
): RunTestDependencies {
  return {
    formatValidationIssues: () => "formatted issues",
    loadConfig: async () => ({
      config: {
        ...DEFAULT_CONFIG,
        upstreams: {
          github: {
            env: {},
            enabled: true,
            stdio: { args: ["server.js"], command: "node" },
            transport: "stdio",
          },
        },
      },
      path: "/tmp/config.toml",
    }),
    processRef: { exit: mock(((_code?: number) => undefined) as never) },
    testUpstreamConnection: mock(async () => ({
      durationMs: 12,
      error: "",
      serverName: "GitHub",
      serverVersion: "1.0.0",
      stderr: "",
      success: true,
      tools: [
        { description: "Search repositories", inputSchema: {}, name: "search" },
      ],
    })),
    validateConfig: () => [],
    validateUpstreamConfig: () => [],
    ...overrides,
  };
}

describe("runTestCommand", () => {
  afterEach(() => {
    mock.restore();
  });

  test("runs a targeted upstream test and exits successfully", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const deps = createTestDeps();

    await runTestCommand("github", true, deps);

    expect(deps.testUpstreamConnection).toHaveBeenCalledWith(
      "github",
      expect.objectContaining({ transport: "stdio" }),
      { verbose: true },
    );
    expect(log).toHaveBeenCalledWith("Testing upstream: github...");
    expect(deps.processRef.exit).toHaveBeenCalledWith(0);
  });

  test("reports missing upstream names and exits with failure", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const deps = createTestDeps();

    await runTestCommand("missing", false, deps);

    expect(deps.testUpstreamConnection).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Error: Upstream 'missing' not found.");
    expect(deps.processRef.exit).toHaveBeenCalledWith(1);
  });

  test("skips disabled upstreams, reports invalid configs, and exits non-zero when any fail", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    const deps = createTestDeps({
      loadConfig: async () => ({
        config: {
          ...DEFAULT_CONFIG,
          upstreams: {
            broken: {
              env: {},
              enabled: true,
              stdio: { args: ["broken.js"], command: "node" },
              transport: "stdio",
            },
            disabled: {
              env: {},
              enabled: false,
              stdio: { args: ["disabled.js"], command: "node" },
              transport: "stdio",
            },
            github: {
              env: {},
              enabled: true,
              stdio: { args: ["server.js"], command: "node" },
              transport: "stdio",
            },
          },
        },
        path: "/tmp/config.toml",
      }),
      validateConfig: () => [
        {
          message: "Missing command",
          severity: "error",
          suggestion: "Set command",
          upstream: "broken",
        },
      ],
    });

    await runTestCommand(undefined, false, deps);

    expect(error).toHaveBeenCalledWith("formatted issues");
    expect(deps.testUpstreamConnection).toHaveBeenCalledTimes(1);
    expect(deps.testUpstreamConnection).toHaveBeenCalledWith(
      "github",
      expect.objectContaining({ enabled: true }),
      { verbose: false },
    );
    expect(log).toHaveBeenCalledWith("Testing 3 upstream(s)...");
    expect(log).toHaveBeenCalledWith("\n⊘ disabled (disabled)");
    expect(deps.processRef.exit).toHaveBeenCalledWith(1);
  });

  test("createRunTestDependencies wires the default test dependencies", () => {
    const deps = createRunTestDependencies();

    expect(typeof deps.loadConfig).toBe("function");
    expect(typeof deps.validateConfig).toBe("function");
    expect(deps.processRef).toBe(process);
  });

  test("dispatch routes explicit test mode to the test runner", async () => {
    const runTest = mock(async () => {});

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
        mode: "test",
        monitor: { noAutoRefresh: false, refreshInterval: 2000 } as never,
        proxy: { noSpawn: false } as never,
        stdio: false,
        testTarget: "github",
        testVerbose: true,
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
        runTest,
        startServer: async () => {},
      },
    );

    expect(runTest).toHaveBeenCalledWith("github", true);
  });
});
