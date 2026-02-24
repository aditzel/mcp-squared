/**
 * MCP Configuration Import Module.
 *
 * Provides functionality to discover, parse, and import MCP server
 * configurations from popular agentic coding tools into MCP² format.
 *
 * @module import
 */

// Discovery
export {
  ALL_TOOL_IDS,
  type DiscoveredConfig,
  type DiscoveryOptions,
  discoverConfigs,
  discoverToolConfig,
  formatDiscoveredConfigs,
  getToolPaths,
  isValidToolId,
} from "./discovery/index.js";
// Errors
export {
  formatImportError,
  ImportCancelledError,
  ImportDiscoveryError,
  ImportError as ImportErrorClass,
  ImportMergeError,
  ImportParseError,
  ImportParserNotFoundError,
  ImportValidationError,
  ImportWriteError,
  isImportError,
} from "./errors.js";
// Merge
export {
  applyChanges,
  type ConflictDetectionResult,
  detectConflicts,
  type IncomingServerGroup,
  type MergeInput,
  type MergeResult,
  mergeWithResolutions,
  mergeWithStrategy,
  resolveConflict,
  summarizeChanges,
} from "./merge/index.js";
// Parsers
export {
  BaseConfigParser,
  detectParser,
  getAllParsers,
  getParser,
  getRegisteredToolIds,
  StandardMcpServersParser,
} from "./parsers/index.js";
// Main runner
export { runImport } from "./runner.js";
// Transform
export {
  generateUniqueName,
  getBaseName,
  getTransportType,
  hasConflict,
  isValidServerName,
  type MappedServer,
  type MappingResult,
  mapExternalServer,
  mapExternalServers,
  normalizeEnvValue,
  normalizeEnvVars,
  normalizeServerName,
  normalizeServerNames,
} from "./transform/index.js";
// Types
export type {
  ConfigChange,
  ConflictResolution,
  ExternalServer,
  ImportConflict,
  ImportError,
  ImportOptions,
  ImportResult,
  ImportScope,
  MergeStrategy,
  ParsedExternalConfig,
  ParseResult,
  ToolId,
  ToolPaths,
} from "./types.js";
export { TOOL_DISPLAY_NAMES } from "./types.js";
