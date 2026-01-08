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

export class ConfigError extends Error {
  override cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConfigError";
    this.cause = cause;
  }
}

export class ConfigNotFoundError extends ConfigError {
  constructor() {
    super("No configuration file found");
    this.name = "ConfigNotFoundError";
  }
}

export class ConfigParseError extends ConfigError {
  constructor(
    public readonly filePath: string,
    cause: unknown,
  ) {
    super(`Failed to parse config file: ${filePath}`, cause);
    this.name = "ConfigParseError";
  }
}

export class ConfigValidationError extends ConfigError {
  constructor(
    public readonly filePath: string,
    public readonly zodError: ZodError,
  ) {
    const issues = zodError.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    super(`Invalid configuration in ${filePath}:\n${issues}`, zodError);
    this.name = "ConfigValidationError";
  }
}

export interface LoadConfigResult {
  config: McpSquaredConfig;
  path: string;
  source: ConfigSource;
}

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
