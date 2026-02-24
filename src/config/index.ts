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
  deleteInstanceEntry,
  type InstanceRegistryEntry,
  type InstanceRegistryEntryRecord,
  listActiveInstanceEntries,
  listInstanceEntries,
  readInstanceEntry,
  writeInstanceEntry,
} from "./instance-registry.js";
export {
  ConfigError,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigValidationError,
  type LoadConfigResult,
  loadConfig,
  loadConfigFromPath,
  loadConfigFromPathSync,
  loadConfigSync,
} from "./load.js";
export {
  migrateConfig,
  type RawConfig,
  UnknownSchemaVersionError,
} from "./migrations/index.js";
export {
  type ConfigPathResult,
  type ConfigSource,
  discoverConfigPath,
  ensureConfigDir,
  ensureDaemonDir,
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
} from "./paths.js";
export {
  ConfigSaveError,
  saveConfig,
  saveConfigSync,
} from "./save.js";
export {
  ConfigSchema,
  DEFAULT_CONFIG,
  LATEST_SCHEMA_VERSION,
  type LogLevel,
  LogLevelSchema,
  type McpSquaredConfig,
  OAuthConfigSchema,
  type SelectionCacheConfig,
  SelectionCacheSchema,
  type UpstreamServerConfig,
  UpstreamServerSchema,
  type UpstreamSseServerConfig,
  type UpstreamStdioServerConfig,
} from "./schema.js";
export {
  formatValidationIssues,
  type ValidationIssue,
  type ValidationSeverity,
  validateConfig,
  validateStdioUpstream,
  validateUpstreamConfig,
} from "./validate.js";
