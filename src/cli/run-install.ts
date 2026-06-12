import { runInstall } from "../install/runner.js";
import type { InstallArgs } from "./index.js";

export interface RunInstallDependencies {
  runInstall: typeof runInstall;
}

export function createRunInstallDependencies(): RunInstallDependencies {
  return {
    runInstall,
  };
}

export async function runInstallCommand(
  options: InstallArgs,
  dependencies: RunInstallDependencies,
): Promise<void> {
  await dependencies.runInstall(options);
}
