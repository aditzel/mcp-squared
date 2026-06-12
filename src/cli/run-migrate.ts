import { runMigrate } from "../migrate/runner.js";
import type { MigrateArgs } from "./index.js";

export interface RunMigrateDependencies {
  runMigrate: typeof runMigrate;
}

export function createRunMigrateDependencies(): RunMigrateDependencies {
  return {
    runMigrate,
  };
}

export async function runMigrateCommand(
  options: MigrateArgs,
  dependencies: RunMigrateDependencies,
): Promise<void> {
  await dependencies.runMigrate(options);
}
