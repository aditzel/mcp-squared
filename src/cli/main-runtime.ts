import { runStatus } from "../status/runner.js";
import { VERSION } from "../version.js";
import type { CliArgs, MonitorArgs } from "./index.js";
import { parseArgs, printHelp } from "./index.js";
import { createRunAuthDependencies, runAuthCommand } from "./run-auth.js";
import { createRunDaemonDependencies, runDaemonCommand } from "./run-daemon.js";
import { createRunImportDependencies, runImportCommand } from "./run-import.js";
import {
  createRunInstallDependencies,
  runInstallCommand,
} from "./run-install.js";
import {
  createRunMigrateDependencies,
  runMigrateCommand,
} from "./run-migrate.js";
import {
  createRunMonitorDependencies,
  runMonitorCommand,
} from "./run-monitor.js";
import { createRunProxyDependencies, runProxyCommand } from "./run-proxy.js";
import {
  createRunStdioServerDependencies,
  startStdioServer,
} from "./run-stdio-server.js";
import { createRunTestDependencies, runTestCommand } from "./run-test.js";
import {
  dispatchCliRuntime,
  type RuntimeDispatchDependencies,
} from "./runtime-dispatch.js";
import {
  logSearchModeProfile,
  logSecurityProfile,
} from "./runtime-profiles.js";
import {
  isTuiModuleNotFoundError,
  printTuiUnavailableError,
} from "./tui-runtime.js";

export interface RunCliMainDependencies {
  createRuntimeDispatchDependencies: (
    args: CliArgs,
  ) => RuntimeDispatchDependencies;
  dispatchCliRuntime: typeof dispatchCliRuntime;
  parseArgs: typeof parseArgs;
  printHelp: typeof printHelp;
  processRef: Pick<typeof process, "exit">;
  version: string;
}

export function createRuntimeDispatchDependencies(
  _args: CliArgs,
): RuntimeDispatchDependencies {
  return {
    isStderrTty: process.stdout.isTTY,
    isStdinTty: process.stdin.isTTY,
    runAuth: (targetName: string) =>
      runAuthCommand(targetName, createRunAuthDependencies()),
    runConfig: async () => {
      try {
        const { runConfigTui } = await import("../tui/config-loader.js");
        await runConfigTui();
      } catch (error) {
        if (isTuiModuleNotFoundError(error)) {
          printTuiUnavailableError("config");
          return process.exit(1);
        }
        throw error;
      }
    },
    runDaemon: (options) =>
      runDaemonCommand(
        options,
        createRunDaemonDependencies({
          logSearchModeProfile,
          logSecurityProfile,
        }),
      ),
    runImport: (options) =>
      runImportCommand(options, createRunImportDependencies()),
    runInit: async (options) => {
      const { runInit } = await import("../init/runner.js");
      await runInit(options);
    },
    runInstall: (options) =>
      runInstallCommand(options, createRunInstallDependencies()),
    runMigrate: (options) =>
      runMigrateCommand(options, createRunMigrateDependencies()),
    runMonitor: (options: MonitorArgs) =>
      runMonitorCommand(options, createRunMonitorDependencies()),
    runProxy: (options) =>
      runProxyCommand(options, createRunProxyDependencies()),
    runStatus,
    runTest: (targetName, verbose = false) =>
      runTestCommand(targetName, verbose, createRunTestDependencies()),
    startServer: () => startStdioServer(createRunStdioServerDependencies()),
  };
}

export function createRunCliMainDependencies(): RunCliMainDependencies {
  return {
    createRuntimeDispatchDependencies,
    dispatchCliRuntime,
    parseArgs,
    printHelp,
    processRef: process,
    version: VERSION,
  };
}

export async function runCliMain(
  argv: string[] = process.argv.slice(2),
  dependencies: RunCliMainDependencies = createRunCliMainDependencies(),
): Promise<void> {
  const args = dependencies.parseArgs(argv);

  if (args.help) {
    dependencies.printHelp();
    dependencies.processRef.exit(0);
    return;
  }

  if (args.version) {
    console.log(`MCP² v${dependencies.version}`);
    dependencies.processRef.exit(0);
    return;
  }

  const runtimeDependencies =
    dependencies.createRuntimeDispatchDependencies(args);
  await dependencies.dispatchCliRuntime(args, runtimeDependencies);
}
