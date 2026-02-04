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
  OAuthConfigSchema,
  SelectionCacheSchema,
  UpstreamServerSchema,
  type LogLevel,
  type McpSquaredConfig,
  type SelectionCacheConfig,
  type UpstreamServerConfig,
  type UpstreamSseServerConfig,
  type UpstreamStdioServerConfig,
} from "./schema.js";

export {
  discoverConfigPath,
  ensureDaemonDir,
  ensureConfigDir,
  ensureInstanceRegistryDir,
  ensureSocketDir,
  getDaemonDir,
  getDaemonRegistryPath,
  getDaemonSocketPath,
  getDefaultConfigPath,
  getInstanceRegistryDir,
  getPidFilePath,
  getSocketDir,
  getSocketFilePath,
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

export {
  UnknownSchemaVersionError,
  migrateConfig,
  type RawConfig,
} from "./migrations/index.js";

export {
  formatValidationIssues,
  validateConfig,
  validateStdioUpstream,
  validateUpstreamConfig,
  type ValidationIssue,
  type ValidationSeverity,
} from "./validate.js";

export {
  deleteInstanceEntry,
  listActiveInstanceEntries,
  listInstanceEntries,
  readInstanceEntry,
  writeInstanceEntry,
  type InstanceRegistryEntry,
  type InstanceRegistryEntryRecord,
} from "./instance-registry.js";
