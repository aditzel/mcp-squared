/**
 * Configuration module exports.
 *
 * This module provides complete configuration management for MCP²:
 * - Multi-scope path discovery (env, project, user)
 * - TOML parsing with Zod schema validation
 * - Schema versioning and migrations
 * - Async and sync load/save operations
 *
 * @module config
 */

export {
  ConfigSchema,
  DEFAULT_CONFIG,
  LATEST_SCHEMA_VERSION,
  LogLevelSchema,
  UpstreamServerSchema,
  type LogLevel,
  type McpSquaredConfig,
  type UpstreamServerConfig,
  type UpstreamSseServerConfig,
  type UpstreamStdioServerConfig,
} from "./schema.js";

export {
  discoverConfigPath,
  ensureConfigDir,
  getDefaultConfigPath,
  type ConfigPathResult,
  type ConfigSource,
} from "./paths.js";

export {
  ConfigError,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigValidationError,
  loadConfig,
  loadConfigFromPath,
  loadConfigFromPathSync,
  loadConfigSync,
  type LoadConfigResult,
} from "./load.js";

export {
  ConfigSaveError,
  saveConfig,
  saveConfigSync,
} from "./save.js";

export { migrateConfig, type RawConfig } from "./migrations/index.js";
