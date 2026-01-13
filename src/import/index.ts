/**
 * MCP Configuration Import Module.
 *
 * Provides functionality to discover, parse, and import MCP server
 * configurations from popular agentic coding tools into MCP² format.
 *
 * @module import
 */

// Main runner
export { runImport } from "./runner.js";

// Discovery
export {
  discoverConfigs,
  discoverToolConfig,
  formatDiscoveredConfigs,
  getToolPaths,
  ALL_TOOL_IDS,
  isValidToolId,
  type DiscoveredConfig,
  type DiscoveryOptions,
} from "./discovery/index.js";

// Parsers
export {
  getParser,
  getAllParsers,
  getRegisteredToolIds,
  detectParser,
  BaseConfigParser,
  StandardMcpServersParser,
} from "./parsers/index.js";

// Transform
export {
  mapExternalServer,
  mapExternalServers,
  normalizeEnvVars,
  normalizeEnvValue,
  getTransportType,
  isValidServerName,
  normalizeServerName,
  generateUniqueName,
  normalizeServerNames,
  hasConflict,
  getBaseName,
  type MappedServer,
  type MappingResult,
} from "./transform/index.js";

// Merge
export {
  detectConflicts,
  resolveConflict,
  applyChanges,
  mergeWithStrategy,
  mergeWithResolutions,
  summarizeChanges,
  type MergeInput,
  type IncomingServerGroup,
  type MergeResult,
  type ConflictDetectionResult,
} from "./merge/index.js";

// Types
export type {
  ToolId,
  ImportScope,
  MergeStrategy,
  ExternalServer,
  ParsedExternalConfig,
  ImportConflict,
  ConflictResolution,
  ConfigChange,
  ImportOptions,
  ImportResult,
  ImportError,
  ToolPaths,
  ParseResult,
} from "./types.js";

export { TOOL_DISPLAY_NAMES } from "./types.js";

// Errors
export {
  ImportError as ImportErrorClass,
  ImportDiscoveryError,
  ImportParseError,
  ImportValidationError,
  ImportMergeError,
  ImportWriteError,
  ImportCancelledError,
  ImportParserNotFoundError,
  isImportError,
  formatImportError,
} from "./errors.js";
