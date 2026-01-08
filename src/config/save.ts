/**
 * Configuration saving utilities.
 *
 * This module handles serializing and writing configuration files
 * in TOML format. Supports both async and sync saving.
 *
 * @module config/save
 */

import { stringify as stringifyToml } from "smol-toml";
import { ensureConfigDir } from "./paths.js";
import type { McpSquaredConfig } from "./schema.js";

/**
 * Error thrown when configuration cannot be saved.
 */
export class ConfigSaveError extends Error {
  constructor(
    /** Path to the file that failed to save */
    public readonly filePath: string,
    cause: unknown,
  ) {
    super(`Failed to save config file: ${filePath}`);
    this.name = "ConfigSaveError";
    this.cause = cause;
  }
}

/**
 * Saves configuration to a file in TOML format.
 * Creates parent directories if they don't exist.
 *
 * @param filePath - Path to save the config file
 * @param config - Configuration to save
 * @throws ConfigSaveError if serialization or writing fails
 */
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

/**
 * Synchronously saves configuration to a file in TOML format.
 * Creates parent directories if they don't exist.
 *
 * @param filePath - Path to save the config file
 * @param config - Configuration to save
 * @throws ConfigSaveError if serialization or writing fails
 */
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
