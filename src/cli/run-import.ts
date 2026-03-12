import { runImport } from "../import/runner.js";
import type { ImportArgs } from "./index.js";

export interface RunImportDependencies {
  runImport: typeof runImport;
}

export function createRunImportDependencies(): RunImportDependencies {
  return {
    runImport,
  };
}

export async function runImportCommand(
  options: ImportArgs,
  dependencies: RunImportDependencies,
): Promise<void> {
  await dependencies.runImport(options);
}
