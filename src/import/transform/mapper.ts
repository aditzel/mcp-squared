/**
 * Transforms external MCP server configurations to MCP² format.
 *
 * Handles conversion from various JSON formats (mcpServers, servers,
 * context_servers) to MCP²'s TOML-based UpstreamServerConfig structure.
 *
 * @module import/transform/mapper
 */

import type {
  UpstreamServerConfig,
  UpstreamSseServerConfig,
  UpstreamStdioServerConfig,
} from "../../config/schema.js";
import type { ExternalServer } from "../types.js";

/**
 * Result of mapping an external server to MCP² format.
 */
export interface MappedServer {
  /** Server name (may be normalized) */
  name: string;
  /** MCP² upstream configuration */
  config: UpstreamServerConfig;
}

/**
 * Mapping result with optional warnings.
 */
export interface MappingResult {
  /** Successfully mapped servers */
  servers: MappedServer[];
  /** Warnings encountered during mapping */
  warnings: string[];
}

/**
 * Maps a single external server to MCP² upstream format.
 *
 * Determines transport type (stdio vs SSE) based on available fields,
 * and normalizes environment variable references.
 *
 * @param server - External server configuration
 * @returns MappedServer or undefined if invalid
 */
export function mapExternalServer(
  server: ExternalServer,
): MappedServer | undefined {
  // Determine transport type
  const hasCommand = server.command !== undefined;
  const hasUrl = server.url !== undefined || server.httpUrl !== undefined;

  // Must have at least one transport type
  if (!hasCommand && !hasUrl) {
    return undefined;
  }

  // Prefer SSE if URL is present, otherwise use stdio
  if (hasUrl) {
    return mapToSseServer(server);
  }

  return mapToStdioServer(server);
}

/**
 * Maps an external server to stdio transport format.
 */
function mapToStdioServer(server: ExternalServer): MappedServer | undefined {
  if (!server.command) {
    return undefined;
  }

  const config: UpstreamStdioServerConfig = {
    transport: "stdio",
    enabled: !server.disabled,
    label: server.name,
    env: normalizeEnvVars(server.env ?? {}),
    stdio: {
      command: server.command,
      args: server.args ?? [],
    },
  };

  // Add optional cwd if present
  if (server.cwd) {
    config.stdio.cwd = server.cwd;
  }

  return {
    name: server.name,
    config,
  };
}

/**
 * Maps an external server to SSE transport format.
 */
function mapToSseServer(server: ExternalServer): MappedServer | undefined {
  // Get URL from either field
  const url = server.url ?? server.httpUrl;
  if (!url) {
    return undefined;
  }

  const config: UpstreamSseServerConfig = {
    transport: "sse",
    enabled: !server.disabled,
    label: server.name,
    env: normalizeEnvVars(server.env ?? {}),
    sse: {
      url,
      headers: normalizeEnvVars(server.headers ?? {}),
    },
  };

  return {
    name: server.name,
    config,
  };
}

/**
 * Maps multiple external servers to MCP² format.
 *
 * @param servers - Array of external server configurations
 * @returns MappingResult with servers and warnings
 */
export function mapExternalServers(servers: ExternalServer[]): MappingResult {
  const result: MappingResult = {
    servers: [],
    warnings: [],
  };

  for (const server of servers) {
    const mapped = mapExternalServer(server);
    if (mapped) {
      result.servers.push(mapped);
    } else {
      result.warnings.push(
        `Could not map server "${server.name}" - missing command or url`,
      );
    }
  }

  return result;
}

/**
 * Normalizes environment variable values.
 *
 * Converts various env var reference formats to MCP²'s $VAR format:
 * - ${VAR} -> $VAR
 * - process.env.VAR -> $VAR
 * - $VAR -> $VAR (unchanged)
 *
 * @param env - Environment variable record
 * @returns Normalized environment record
 */
export function normalizeEnvVars(
  env: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    result[key] = normalizeEnvValue(value);
  }

  return result;
}

/**
 * Normalizes a single environment variable value.
 *
 * @param value - Environment variable value
 * @returns Normalized value
 */
export function normalizeEnvValue(value: string): string {
  // Handle ${VAR} format -> $VAR
  let normalized = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$$$1");

  // Handle process.env.VAR format -> $VAR
  normalized = normalized.replace(
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    "$$$1",
  );

  return normalized;
}

/**
 * Extracts transport type from an external server config.
 *
 * @param server - External server configuration
 * @returns "stdio" | "sse" | undefined
 */
export function getTransportType(
  server: ExternalServer,
): "stdio" | "sse" | undefined {
  const hasCommand = server.command !== undefined;
  const hasUrl = server.url !== undefined || server.httpUrl !== undefined;

  if (hasUrl) return "sse";
  if (hasCommand) return "stdio";
  return undefined;
}
