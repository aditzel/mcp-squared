/**
 * Runtime adapter interfaces for upstream MCP server connections.
 *
 * Each transport type (stdio, SSE/HTTP) has its own adapter that handles
 * transport creation, post-connect validation, and cleanup. The Cataloger
 * delegates transport-specific logic to the appropriate adapter.
 *
 * @module upstream/adapter
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { UpstreamServerConfig } from "../config/schema.js";

/** Result of creating a transport and optional auth provider. */
export interface TransportCreationResult {
  transport: Transport;
  authProvider?: unknown;
}

/** Context passed to adapter methods. */
export interface AdapterContext {
  /** Upstream key for logging/identification. */
  key: string;
  /** Raw upstream configuration. */
  config: UpstreamServerConfig;
}

/** Post-connect validation result. */
export interface PostConnectResult {
  /** Whether the connection is healthy. */
  ok: boolean;
  /** Error message if not ok. */
  error?: string;
}

/**
 * Runtime adapter for a specific transport type.
 * Handles transport creation, validation, and cleanup.
 */
export interface UpstreamAdapter {
  /** The transport type this adapter handles. */
  readonly transportType: "stdio" | "sse";

  /** Creates a transport for the given upstream config. */
  createTransport(context: AdapterContext): Promise<TransportCreationResult>;

  /** Optional post-connect validation (e.g., stdio exit code check). */
  postConnect?(
    context: AdapterContext,
    client: Client,
  ): Promise<PostConnectResult>;

  /** Optional cleanup when disconnecting. */
  cleanup?(context: AdapterContext): Promise<void>;
}

/**
 * Resolves environment variables in a string value.
 * Supports $VAR and ${VAR} syntax.
 */
export function resolveEnvVars(
  value: string,
  env: Record<string, string>,
): string {
  return value.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gi, (_, name) => {
    return env[name] ?? process.env[name] ?? "";
  });
}

/**
 * Resolves environment variables in header values.
 */
export function resolveHeaders(
  headers: Record<string, string>,
  env: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    resolved[key] = resolveEnvVars(value, env);
  }
  return resolved;
}
