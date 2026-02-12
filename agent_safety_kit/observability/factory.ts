import { readSafetyEnv } from "../policy/load.js";
import type { ObsSink } from "./sinks/base.js";
import { NullSink } from "./sinks/null.js";
import { OTelSink } from "./sinks/otel.js";
import { StdoutSink } from "./sinks/stdout.js";

export interface BuildSinkOptions {
  enabled?: boolean;
  sinkName?: "null" | "stdout" | "otel";
  serviceName?: string;
}

export function build_sink(options: BuildSinkOptions = {}): ObsSink {
  const env = readSafetyEnv();
  const enabled = options.enabled ?? env.enabled;

  if (!enabled) {
    return new NullSink();
  }

  const sinkName = options.sinkName ?? env.obsSink;

  if (sinkName === "null") {
    return new NullSink();
  }

  if (sinkName === "otel") {
    try {
      return new OTelSink(options.serviceName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[agent-safety-kit] ${message}. Falling back to stdout sink.`,
      );
      return new StdoutSink();
    }
  }

  return new StdoutSink();
}
