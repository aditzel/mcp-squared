export { Guard, redactSecrets } from "./guard/guard.js";
export { PolicyDenied } from "./guard/errors.js";
export { SlidingWindowRateLimiter } from "./guard/ratelimit.js";

export { load_policy, readSafetyEnv } from "./policy/load.js";
export type { LoadedPolicy, SafetyEnvConfig } from "./policy/load.js";

export { build_sink } from "./observability/factory.js";
export {
  record_llm_tokens,
  task_span,
  tool_span,
} from "./observability/middleware.js";
export type {
  TaskSpanContext,
  ToolSpanContext,
} from "./observability/middleware.js";

export { NullSink } from "./observability/sinks/null.js";
export { StdoutSink } from "./observability/sinks/stdout.js";
export { OTelSink } from "./observability/sinks/otel.js";
export type {
  ObsAttributes,
  ObsSink,
  ObsSpan,
  SpanStatus,
} from "./observability/sinks/base.js";
