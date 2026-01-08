import { stringify as stringifyToml } from "smol-toml";
import { ensureConfigDir } from "./paths.js";
import type { McpSquaredConfig } from "./schema.js";

export class ConfigSaveError extends Error {
  constructor(
    public readonly filePath: string,
    cause: unknown,
  ) {
    super(`Failed to save config file: ${filePath}`);
    this.name = "ConfigSaveError";
    this.cause = cause;
  }
}

export async function saveConfig(
  filePath: string,
  config: McpSquaredConfig,
): Promise<void> {
  ensureConfigDir(filePath);

  let tomlContent: string;
  try {
    tomlContent = stringifyToml(config as Record<string, unknown>);
  } catch (err) {
    throw new ConfigSaveError(filePath, err);
  }

  try {
    await Bun.write(filePath, tomlContent);
  } catch (err) {
    throw new ConfigSaveError(filePath, err);
  }
}

export function saveConfigSync(
  filePath: string,
  config: McpSquaredConfig,
): void {
  ensureConfigDir(filePath);

  let tomlContent: string;
  try {
    tomlContent = stringifyToml(config as Record<string, unknown>);
  } catch (err) {
    throw new ConfigSaveError(filePath, err);
  }

  try {
    require("node:fs").writeFileSync(filePath, tomlContent, "utf-8");
  } catch (err) {
    throw new ConfigSaveError(filePath, err);
  }
}
