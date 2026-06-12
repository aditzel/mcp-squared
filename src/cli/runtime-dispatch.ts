import type {
  CliArgs,
  DaemonArgs,
  ImportArgs,
  InitArgs,
  InstallArgs,
  MigrateArgs,
  MonitorArgs,
  ProxyArgs,
} from "./index.js";

export interface RuntimeDispatchDependencies {
  isStderrTty: boolean;
  isStdinTty: boolean;
  runAuth: (target: string) => Promise<void>;
  runConfig: () => Promise<void>;
  runDaemon: (options: DaemonArgs) => Promise<void>;
  runImport: (options: ImportArgs) => Promise<void>;
  runInit: (options: InitArgs) => Promise<void>;
  runInstall: (options: InstallArgs) => Promise<void>;
  runMigrate: (options: MigrateArgs) => Promise<void>;
  runMonitor: (options: MonitorArgs) => Promise<void>;
  runProxy: (options: ProxyArgs) => Promise<void>;
  runStatus: (options: { verbose: boolean }) => Promise<void>;
  runTest: (targetName: string | undefined, verbose?: boolean) => Promise<void>;
  startServer: () => Promise<void>;
}

export async function dispatchCliRuntime(
  args: CliArgs,
  dependencies: RuntimeDispatchDependencies,
): Promise<void> {
  switch (args.mode) {
    case "config":
      await dependencies.runConfig();
      break;
    case "test":
      await dependencies.runTest(args.testTarget, args.testVerbose);
      break;
    case "import":
      await dependencies.runImport(args.import);
      break;
    case "auth":
      if (!args.authTarget) {
        console.error("Error: auth command requires an upstream name.");
        console.error("Usage: mcp-squared auth <upstream>");
        process.exit(1);
      }
      await dependencies.runAuth(args.authTarget);
      break;
    case "install":
      await dependencies.runInstall(args.install);
      break;
    case "init":
      await dependencies.runInit(args.init);
      break;
    case "migrate":
      await dependencies.runMigrate(args.migrate);
      break;
    case "monitor":
      await dependencies.runMonitor(args.monitor);
      break;
    case "status":
      await dependencies.runStatus({ verbose: args.testVerbose });
      break;
    case "daemon":
      await dependencies.runDaemon(args.daemon);
      break;
    case "proxy":
      await dependencies.runProxy(args.proxy);
      break;
    default:
      if (args.stdio) {
        await dependencies.startServer();
        break;
      }
      if (dependencies.isStdinTty && dependencies.isStderrTty) {
        await dependencies.runDaemon(args.daemon);
      } else {
        await dependencies.runProxy(args.proxy);
      }
  }
}
