/**
 * Configuration schema definitions using Zod.
 *
 * This module defines the complete schema for MCP² configuration files.
 * It supports TOML configuration with versioned schemas for future migrations.
 *
 * @module config/schema
 */

import { z } from "zod";
import { CAPABILITY_IDS } from "../capabilities/inference.js";

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
 * Schema for OAuth configuration on SSE upstreams.
 *
 * MCP uses OAuth 2.0 with Dynamic Client Registration (RFC 7591).
 * The SDK automatically:
 * 1. Discovers OAuth metadata from /.well-known/oauth-authorization-server
 * 2. Dynamically registers as a client (no pre-configured clientId needed)
 * 3. Handles the authorization code flow with PKCE
 *
 * Users just set `auth: true` to enable OAuth - everything else is automatic.
 */
export const OAuthConfigSchema = z.object({
  /** Port for local OAuth callback server (default: 8089) */
  callbackPort: z.number().int().min(1024).max(65535).default(8089),
  /** Client name to use during dynamic registration (default: "MCP²") */
  clientName: z.string().default("MCP²"),
});

/** Schema for SSE transport configuration (remote servers) */
const UpstreamSseSchema = UpstreamBaseSchema.extend({
  transport: z.literal("sse"),
  sse: z.object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    /**
     * Enable OAuth authentication for this upstream.
     * - true: Enable with defaults (callbackPort: 8089, clientName: "MCP²")
     * - object: Enable with custom settings
     * - false/undefined: No OAuth
     *
     * When enabled, MCP² uses OAuth 2.0 Dynamic Client Registration.
     * No clientId or endpoints needed - everything is auto-discovered.
     */
    auth: z.union([z.boolean(), OAuthConfigSchema]).optional(),
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
 * Patterns use glob-style matching: "capability:action" or "*:*"
 */
export const SecurityToolsSchema = z.object({
  allow: z.array(z.string()).default([]),
  block: z.array(z.string()).default([]),
  confirm: z.array(z.string()).default(["*:*"]),
});

/**
 * Schema for security configuration section.
 * Contains tool execution policies.
 */
export const SecuritySchema = z
  .object({
    tools: SecurityToolsSchema.default({
      allow: [],
      block: [],
      confirm: ["*:*"],
    }),
  })
  .default({
    tools: { allow: [], block: [], confirm: ["*:*"] },
  });

/**
 * Search modes for internal retrieval operations.
 * - fast: FTS5 full-text search only (fastest, default)
 * - semantic: Vector similarity search only (requires embeddings)
 * - hybrid: FTS5 + rerank with embeddings (best quality)
 */
export const SearchModeSchema = z.enum(["fast", "semantic", "hybrid"]);

/** Available internal retrieval search modes */
export type SearchMode = z.infer<typeof SearchModeSchema>;

/**
 * Detail levels for internal retrieval projections.
 * - L0: Name only (minimal context footprint)
 * - L1: Summary with name + description (default)
 * - L2: Full schema with inputSchema included
 */
export const DetailLevelSchema = z.enum(["L0", "L1", "L2"]);

/** Available internal retrieval detail levels */
export type DetailLevel = z.infer<typeof DetailLevelSchema>;

/** Stable capability taxonomy IDs used by dynamic tool surfacing. */
export const CapabilityIdSchema = z.enum(CAPABILITY_IDS);

/** Capability identifier union */
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

/** Dynamic capability inference strategy. */
export const DynamicToolSurfaceInferenceSchema = z.enum([
  "heuristic_with_overrides",
  "hybrid",
]);

/** Dynamic tool surface refresh policy. */
export const DynamicToolSurfaceRefreshSchema = z.enum(["on_connect"]);

/** Schema for capability-first connect-time tool surfacing. */
export const DynamicToolSurfaceSchema = z.object({
  inference: DynamicToolSurfaceInferenceSchema.default(
    "heuristic_with_overrides",
  ),
  refresh: DynamicToolSurfaceRefreshSchema.default("on_connect"),
  capabilityOverrides: z
    .record(z.string().min(1), CapabilityIdSchema)
    .default({}),
  /** Minimum cosine similarity for ML classification to override heuristic (hybrid mode only) */
  semanticConfidenceThreshold: z.number().min(0).max(1).default(0.45),
});

/** Dynamic tool surface configuration type. */
export type DynamicToolSurfaceConfig = z.infer<typeof DynamicToolSurfaceSchema>;

/** Schema for internal retrieval defaults */
const PreferredNamespacesByIntentSchema = z.object({
  /** Namespaces to prioritize for codebase search/retrieval intents */
  codeSearch: z.array(z.string().min(1)).default([]),
});

/** Preferred namespaces grouped by retrieval intent */
export type PreferredNamespacesByIntent = z.infer<
  typeof PreferredNamespacesByIntentSchema
>;

/** Schema for internal retrieval settings */
export const FindToolsSchema = z.object({
  defaultLimit: z.number().int().min(1).default(5),
  maxLimit: z.number().int().min(1).max(200).default(50),
  defaultMode: SearchModeSchema.default("fast"),
  defaultDetailLevel: DetailLevelSchema.default("L1"),
  preferredNamespacesByIntent: PreferredNamespacesByIntentSchema.default({
    codeSearch: [],
  }),
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
 * Schema for embeddings configuration.
 * Controls whether semantic/hybrid search embeddings are initialized at startup.
 */
export const EmbeddingsSchema = z.object({
  /** Enable embedding generation for semantic/hybrid search (default: false) */
  enabled: z.boolean().default(false),
});

/** Embeddings configuration type */
export type EmbeddingsConfig = z.infer<typeof EmbeddingsSchema>;

/**
 * Schema for response resource offloading configuration.
 * Controls when large upstream responses are stored as MCP Resources.
 */
export const ResponseResourceSchema = z.object({
  /** Enable response resource offloading (default: false) */
  enabled: z.boolean().default(false),
  /** Byte threshold for offloading (default: 51200 = 50 KB) */
  thresholdBytes: z.number().int().min(1024).default(51_200),
  /** Maximum lines to include inline as preview (default: 20) */
  maxInlineLines: z.number().int().min(1).default(20),
  /** Maximum number of stored resources before eviction (default: 100) */
  maxResources: z.number().int().min(1).default(100),
  /** Time-to-live for stored resources in milliseconds (default: 600000 = 10 minutes) */
  ttlMs: z.number().int().min(0).default(600_000),
});

/** Response resource offloading configuration type */
export type ResponseResourceConfig = z.infer<typeof ResponseResourceSchema>;

/** Default response resource configuration derived from schema defaults. */
export const DEFAULT_RESPONSE_RESOURCE_CONFIG: ResponseResourceConfig =
  ResponseResourceSchema.parse({});

/**
 * Schema for selection caching configuration.
 * Controls co-occurrence tracking for tool suggestions.
 */
export const SelectionCacheSchema = z.object({
  /** Enable selection caching (default: true) */
  enabled: z.boolean().default(true),
  /** Minimum co-occurrence count before suggesting (default: 2) */
  minCooccurrenceThreshold: z.number().int().min(1).default(2),
  /** Maximum bundle suggestions returned by internal retrieval operations */
  maxBundleSuggestions: z.number().int().min(0).default(3),
});

/** Selection cache configuration type */
export type SelectionCacheConfig = z.infer<typeof SelectionCacheSchema>;

/**
 * Schema for operations configuration section.
 * Contains settings for retrieval, indexing, logging, and selection caching.
 */
export const OperationsSchema = z
  .object({
    findTools: FindToolsSchema.default({
      defaultLimit: 5,
      maxLimit: 50,
      defaultMode: "fast",
      defaultDetailLevel: "L1",
      preferredNamespacesByIntent: { codeSearch: [] },
    }),
    index: IndexSchema.default({ refreshIntervalMs: 30_000 }),
    logging: LoggingSchema.default({ level: "info" }),
    embeddings: EmbeddingsSchema.default({ enabled: false }),
    responseResource: ResponseResourceSchema.default(
      DEFAULT_RESPONSE_RESOURCE_CONFIG,
    ),
    selectionCache: SelectionCacheSchema.default({
      enabled: true,
      minCooccurrenceThreshold: 2,
      maxBundleSuggestions: 3,
    }),
    dynamicToolSurface: DynamicToolSurfaceSchema.default({
      inference: "heuristic_with_overrides",
      refresh: "on_connect",
      capabilityOverrides: {},
      semanticConfidenceThreshold: 0.45,
    }),
  })
  .default({
    findTools: {
      defaultLimit: 5,
      maxLimit: 50,
      defaultMode: "fast",
      defaultDetailLevel: "L1",
      preferredNamespacesByIntent: { codeSearch: [] },
    },
    index: { refreshIntervalMs: 30_000 },
    logging: { level: "info" },
    embeddings: { enabled: false },
    responseResource: DEFAULT_RESPONSE_RESOURCE_CONFIG,
    selectionCache: {
      enabled: true,
      minCooccurrenceThreshold: 2,
      maxBundleSuggestions: 3,
    },
    dynamicToolSurface: {
      inference: "heuristic_with_overrides",
      refresh: "on_connect",
      capabilityOverrides: {},
      semanticConfidenceThreshold: 0.45,
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

/**
 * Permissive security profile (legacy default).
 * Allows all tools without confirmation. Useful for trusted local-only setups.
 */
export const PERMISSIVE_SECURITY: McpSquaredConfig["security"] = {
  tools: { allow: ["*:*"], block: [], confirm: [] },
};
