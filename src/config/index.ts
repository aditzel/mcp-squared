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
