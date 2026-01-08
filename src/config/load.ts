/**
 * Configuration loading and parsing.
 *
 * This module handles loading, parsing, validating, and migrating
 * configuration files. It supports both async and sync loading.
 *
 * @module config/load
 */

import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { ZodError } from "zod";
import { type RawConfig, migrateConfig } from "./migrations/index.js";
import {
  type ConfigSource,
  discoverConfigPath,
  getDefaultConfigPath,
} from "./paths.js";
import {
  ConfigSchema,
  DEFAULT_CONFIG,
  type McpSquaredConfig,
} from "./schema.js";

/**
 * Base error class for configuration-related errors.
 */
export class ConfigError extends Error {
  override cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConfigError";
    this.cause = cause;
  }
}

/**
 * Error thrown when no configuration file can be found.
 */
export class ConfigNotFoundError extends ConfigError {
  constructor() {
    super("No configuration file found");
    this.name = "ConfigNotFoundError";
  }
}

/**
 * Error thrown when a configuration file cannot be parsed.
 */
export class ConfigParseError extends ConfigError {
  constructor(
    /** Path to the file that failed to parse */
    public readonly filePath: string,
    cause: unknown,
  ) {
    super(`Failed to parse config file: ${filePath}`, cause);
    this.name = "ConfigParseError";
  }
}

/**
 * Error thrown when configuration validation fails.
 * Contains the Zod validation error with detailed issues.
 */
export class ConfigValidationError extends ConfigError {
  constructor(
    /** Path to the file with validation errors */
    public readonly filePath: string,
    /** The Zod validation error */
    public readonly zodError: ZodError,
  ) {
    const issues = zodError.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    super(`Invalid configuration in ${filePath}:\n${issues}`, zodError);
    this.name = "ConfigValidationError";
  }
}

/**
 * Result of loading configuration.
 */
export interface LoadConfigResult {
  /** The parsed and validated configuration */
  config: McpSquaredConfig;
  /** Path to the loaded config file */
  path: string;
  /** Where the config was found */
  source: ConfigSource;
}

/**
 * Loads configuration using multi-scope discovery.
 * Returns default config if no file is found.
 *
 * @param cwd - Working directory for project config search
 * @returns Loaded configuration with path and source info
 */
export async function loadConfig(cwd?: string): Promise<LoadConfigResult> {
  const discovered = discoverConfigPath(cwd);

  if (!discovered) {
    return {
      config: DEFAULT_CONFIG,
      path: getDefaultConfigPath().path,
      source: "user",
    };
  }

  return loadConfigFromPath(discovered.path, discovered.source);
}

/**
 * Loads configuration from a specific file path.
 * Parses TOML, applies migrations, and validates the schema.
 *
 * @param filePath - Path to the config file
 * @param source - Source type for the config
 * @returns Loaded and validated configuration
 * @throws ConfigNotFoundError if file doesn't exist
 * @throws ConfigParseError if TOML parsing fails
 * @throws ConfigValidationError if schema validation fails
 */
export async function loadConfigFromPath(
  filePath: string,
  source: ConfigSource,
): Promise<LoadConfigResult> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    throw new ConfigNotFoundError();
  }

  let content: string;
  try {
    content = await file.text();
  } catch (err) {
    throw new ConfigParseError(filePath, err);
  }

  let rawConfig: RawConfig;
  try {
    rawConfig = parseToml(content) as RawConfig;
  } catch (err) {
    throw new ConfigParseError(filePath, err);
  }

  const migrated = migrateConfig(rawConfig);

  let config: McpSquaredConfig;
  try {
    config = ConfigSchema.parse(migrated);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ConfigValidationError(filePath, err);
    }
    throw err;
  }

  return { config, path: filePath, source };
}

/**
 * Synchronously loads configuration using multi-scope discovery.
 * Returns default config if no file is found.
 *
 * @param cwd - Working directory for project config search
 * @returns Loaded configuration with path and source info
 */
export function loadConfigSync(cwd?: string): LoadConfigResult {
  const discovered = discoverConfigPath(cwd);

  if (!discovered) {
    return {
      config: DEFAULT_CONFIG,
      path: getDefaultConfigPath().path,
      source: "user",
    };
  }

  return loadConfigFromPathSync(discovered.path, discovered.source);
}

/**
 * Synchronously loads configuration from a specific file path.
 * Parses TOML, applies migrations, and validates the schema.
 *
 * @param filePath - Path to the config file
 * @param source - Source type for the config
 * @returns Loaded and validated configuration
 * @throws ConfigParseError if TOML parsing fails
 * @throws ConfigValidationError if schema validation fails
 */
export function loadConfigFromPathSync(
  filePath: string,
  source: ConfigSource,
): LoadConfigResult {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new ConfigParseError(filePath, err);
  }

  let rawConfig: RawConfig;
  try {
    rawConfig = parseToml(content) as RawConfig;
  } catch (err) {
    throw new ConfigParseError(filePath, err);
  }

  const migrated = migrateConfig(rawConfig);

  let config: McpSquaredConfig;
  try {
    config = ConfigSchema.parse(migrated);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ConfigValidationError(filePath, err);
    }
    throw err;
  }

  return { config, path: filePath, source };
}
