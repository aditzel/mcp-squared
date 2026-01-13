/**
 * Configuration schema definitions using Zod.
 *
 * This module defines the complete schema for MCP² configuration files.
 * It supports TOML configuration with versioned schemas for future migrations.
 *
 * @module config/schema
 */

import { z } from "zod";

/** Current configuration schema version */
export const LATEST_SCHEMA_VERSION = 1;

/**
 * Schema for log levels (fatal through trace).
 */
export const LogLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
]);

/** Available log levels for MCP² */
export type LogLevel = z.infer<typeof LogLevelSchema>;

/** Schema for environment variable mappings */
const EnvRecordSchema = z.record(z.string(), z.string()).default({});

/** Base schema for all upstream server configurations */
const UpstreamBaseSchema = z.object({
  label: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  env: EnvRecordSchema,
});

/** Schema for stdio transport configuration (local processes) */
const UpstreamStdioSchema = UpstreamBaseSchema.extend({
  transport: z.literal("stdio"),
  stdio: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().min(1).optional(),
  }),
});

/**
 * OAuth grant types supported for SSE upstreams.
 * - authorization_code: Browser-based interactive auth (user consent)
 * - client_credentials: Machine-to-machine auth (service accounts)
 */
export const OAuthGrantTypeSchema = z.enum([
  "authorization_code",
  "client_credentials",
]);

/** OAuth grant type */
export type OAuthGrantType = z.infer<typeof OAuthGrantTypeSchema>;

/**
 * Schema for OAuth configuration on SSE upstreams.
 * Supports both authorization_code and client_credentials flows.
 */
export const OAuthConfigSchema = z.object({
  /** OAuth grant type to use */
  grantType: OAuthGrantTypeSchema,
  /** OAuth client ID */
  clientId: z.string().min(1),
  /** OAuth client secret (supports $ENV_VAR syntax for env resolution) */
  clientSecret: z.string().optional(),
  /** Authorization endpoint URL (required for authorization_code) */
  authorizationEndpoint: z.string().url().optional(),
  /** Token endpoint URL */
  tokenEndpoint: z.string().url(),
  /** OAuth scopes to request (space-separated) */
  scope: z.string().optional(),
  /** Redirect URL for authorization_code flow */
  redirectUrl: z.string().url().default("http://localhost:8089/callback"),
  /** Port for local callback server */
  callbackPort: z.number().int().min(1024).max(65535).default(8089),
  /** Use PKCE for authorization_code (recommended, default true) */
  usePkce: z.boolean().default(true),
});

/** OAuth configuration type */
export type OAuthConfig = z.infer<typeof OAuthConfigSchema>;

/** Schema for SSE transport configuration (remote servers) */
const UpstreamSseSchema = UpstreamBaseSchema.extend({
  transport: z.literal("sse"),
  sse: z.object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    /** Optional OAuth configuration for authenticated endpoints */
    oauth: OAuthConfigSchema.optional(),
  }),
});

/**
 * Schema for upstream server configuration.
 * Discriminated union supporting stdio and SSE transport types.
 */
export const UpstreamServerSchema = z.discriminatedUnion("transport", [
  UpstreamStdioSchema,
  UpstreamSseSchema,
]);

/** Configuration for a single upstream MCP server */
export type UpstreamServerConfig = z.infer<typeof UpstreamServerSchema>;

/** Stdio-specific upstream server configuration */
export type UpstreamStdioServerConfig = z.infer<typeof UpstreamStdioSchema>;

/** SSE-specific upstream server configuration */
export type UpstreamSseServerConfig = z.infer<typeof UpstreamSseSchema>;

/**
 * Schema for tool security policies (allow/block/confirm lists).
 * Patterns use glob-style matching: "serverKey:toolName" or "*:*"
 */
export const SecurityToolsSchema = z.object({
  allow: z.array(z.string()).default(["*:*"]),
  block: z.array(z.string()).default([]),
  confirm: z.array(z.string()).default([]),
});

/**
 * Schema for security configuration section.
 * Contains tool execution policies.
 */
export const SecuritySchema = z
  .object({
    tools: SecurityToolsSchema.default({
      allow: ["*:*"],
      block: [],
      confirm: [],
    }),
  })
  .default({
    tools: { allow: ["*:*"], block: [], confirm: [] },
  });

/**
 * Search modes for find_tools operation.
 * - fast: FTS5 full-text search only (fastest, default)
 * - semantic: Vector similarity search only (requires embeddings)
 * - hybrid: FTS5 + rerank with embeddings (best quality)
 */
export const SearchModeSchema = z.enum(["fast", "semantic", "hybrid"]);

/** Available search modes for find_tools */
export type SearchMode = z.infer<typeof SearchModeSchema>;

/**
 * Detail levels for find_tools responses.
 * - L0: Name only (minimal context footprint)
 * - L1: Summary with name + description (default)
 * - L2: Full schema with inputSchema included
 */
export const DetailLevelSchema = z.enum(["L0", "L1", "L2"]);

/** Available detail levels for find_tools responses */
export type DetailLevel = z.infer<typeof DetailLevelSchema>;

/** Schema for find_tools operation configuration */
export const FindToolsSchema = z.object({
  defaultLimit: z.number().int().min(1).default(5),
  maxLimit: z.number().int().min(1).max(200).default(50),
  defaultMode: SearchModeSchema.default("fast"),
  defaultDetailLevel: DetailLevelSchema.default("L1"),
});

/** Schema for index refresh configuration */
export const IndexSchema = z.object({
  refreshIntervalMs: z.number().int().min(1000).default(30_000),
});

/** Schema for logging configuration */
export const LoggingSchema = z.object({
  level: LogLevelSchema.default("info"),
});

/**
 * Schema for selection caching configuration.
 * Controls co-occurrence tracking for tool suggestions.
 */
export const SelectionCacheSchema = z.object({
  /** Enable selection caching (default: true) */
  enabled: z.boolean().default(true),
  /** Minimum co-occurrence count before suggesting (default: 2) */
  minCooccurrenceThreshold: z.number().int().min(1).default(2),
  /** Maximum bundle suggestions per find_tools response (default: 3) */
  maxBundleSuggestions: z.number().int().min(0).default(3),
});

/** Selection cache configuration type */
export type SelectionCacheConfig = z.infer<typeof SelectionCacheSchema>;

/**
 * Schema for operations configuration section.
 * Contains settings for find_tools, indexing, logging, and selection caching.
 */
export const OperationsSchema = z
  .object({
    findTools: FindToolsSchema.default({
      defaultLimit: 5,
      maxLimit: 50,
      defaultMode: "fast",
      defaultDetailLevel: "L1",
    }),
    index: IndexSchema.default({ refreshIntervalMs: 30_000 }),
    logging: LoggingSchema.default({ level: "info" }),
    selectionCache: SelectionCacheSchema.default({
      enabled: true,
      minCooccurrenceThreshold: 2,
      maxBundleSuggestions: 3,
    }),
  })
  .default({
    findTools: {
      defaultLimit: 5,
      maxLimit: 50,
      defaultMode: "fast",
      defaultDetailLevel: "L1",
    },
    index: { refreshIntervalMs: 30_000 },
    logging: { level: "info" },
    selectionCache: {
      enabled: true,
      minCooccurrenceThreshold: 2,
      maxBundleSuggestions: 3,
    },
  });

/**
 * Root configuration schema for MCP².
 * Defines the complete structure of mcp-squared.toml files.
 */
export const ConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  upstreams: z.record(z.string().min(1), UpstreamServerSchema).default({}),
  security: SecuritySchema,
  operations: OperationsSchema,
});

/** Complete MCP² configuration type */
export type McpSquaredConfig = z.infer<typeof ConfigSchema>;

/** Default configuration with all defaults applied */
export const DEFAULT_CONFIG: McpSquaredConfig = ConfigSchema.parse({});
