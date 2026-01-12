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

/** Schema for SSE transport configuration (remote servers) */
const UpstreamSseSchema = UpstreamBaseSchema.extend({
  transport: z.literal("sse"),
  sse: z.object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
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
 * Schema for operations configuration section.
 * Contains settings for find_tools, indexing, and logging.
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
