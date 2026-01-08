import { z } from "zod";

export const LATEST_SCHEMA_VERSION = 1;

export const LogLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

const EnvRecordSchema = z.record(z.string(), z.string()).default({});

const UpstreamBaseSchema = z.object({
  label: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  env: EnvRecordSchema,
});

const UpstreamStdioSchema = UpstreamBaseSchema.extend({
  transport: z.literal("stdio"),
  stdio: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().min(1).optional(),
  }),
});

const UpstreamSseSchema = UpstreamBaseSchema.extend({
  transport: z.literal("sse"),
  sse: z.object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
  }),
});

export const UpstreamServerSchema = z.discriminatedUnion("transport", [
  UpstreamStdioSchema,
  UpstreamSseSchema,
]);
export type UpstreamServerConfig = z.infer<typeof UpstreamServerSchema>;
export type UpstreamStdioServerConfig = z.infer<typeof UpstreamStdioSchema>;
export type UpstreamSseServerConfig = z.infer<typeof UpstreamSseSchema>;

export const SecurityToolsSchema = z.object({
  allow: z.array(z.string()).default(["*:*"]),
  block: z.array(z.string()).default([]),
  confirm: z.array(z.string()).default([]),
});

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

export const FindToolsSchema = z.object({
  defaultLimit: z.number().int().min(1).default(5),
  maxLimit: z.number().int().min(1).max(200).default(50),
});

export const IndexSchema = z.object({
  refreshIntervalMs: z.number().int().min(1000).default(30_000),
});

export const LoggingSchema = z.object({
  level: LogLevelSchema.default("info"),
});

export const OperationsSchema = z
  .object({
    findTools: FindToolsSchema.default({ defaultLimit: 5, maxLimit: 50 }),
    index: IndexSchema.default({ refreshIntervalMs: 30_000 }),
    logging: LoggingSchema.default({ level: "info" }),
  })
  .default({
    findTools: { defaultLimit: 5, maxLimit: 50 },
    index: { refreshIntervalMs: 30_000 },
    logging: { level: "info" },
  });

export const ConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  upstreams: z.record(z.string().min(1), UpstreamServerSchema).default({}),
  security: SecuritySchema,
  operations: OperationsSchema,
});

export type McpSquaredConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: McpSquaredConfig = ConfigSchema.parse({});
