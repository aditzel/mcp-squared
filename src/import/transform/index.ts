/**
 * Transform module for converting external configs to MCP² format.
 *
 * @module import/transform
 */

export {
  mapExternalServer,
  mapExternalServers,
  normalizeEnvVars,
  normalizeEnvValue,
  getTransportType,
  type MappedServer,
  type MappingResult,
} from "./mapper.js";

export {
  isValidServerName,
  normalizeServerName,
  generateUniqueName,
  normalizeServerNames,
  hasConflict,
  getBaseName,
} from "./normalizer.js";
