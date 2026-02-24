/**
 * Transform module for converting external configs to MCP² format.
 *
 * @module import/transform
 */

export {
  getTransportType,
  type MappedServer,
  type MappingResult,
  mapExternalServer,
  mapExternalServers,
  normalizeEnvValue,
  normalizeEnvVars,
} from "./mapper.js";

export {
  generateUniqueName,
  getBaseName,
  hasConflict,
  isValidServerName,
  normalizeServerName,
  normalizeServerNames,
} from "./normalizer.js";
