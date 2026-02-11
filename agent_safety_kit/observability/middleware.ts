import type { ObsAttributes, ObsSink } from "./sinks/base.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface TaskSpanContext {
  agent: string;
  taskName: string;
  model?: string;
  playbook?: string;
  env?: string;
}

export interface ToolSpanContext {
  agent: string;
  tool: string;
  action: string;
  cacheHit?: boolean;
  playbook?: string;
  env?: string;
}

export async function task_span<T>(
  sink: ObsSink,
  context: TaskSpanContext,
  run: () => Promise<T> | T,
): Promise<T> {
  const attrs: ObsAttributes = {
    agent: context.agent,
    "task.name": context.taskName,
    ...(context.model ? { model: context.model } : {}),
    ...(context.playbook ? { playbook: context.playbook } : {}),
    ...(context.env ? { env: context.env } : {}),
  };

  const span = sink.startSpan("agent.task", attrs);

  try {
    const result = await run();
    span.end({ ok: true });
    return result;
  } catch (error) {
    span.end({ ok: false, error: errorMessage(error) });
    throw error;
  }
}

export async function tool_span<T>(
  sink: ObsSink,
  context: ToolSpanContext,
  run: () => Promise<T> | T,
): Promise<T> {
  const attrs: ObsAttributes = {
    agent: context.agent,
    tool: context.tool,
    action: context.action,
    cache_hit: context.cacheHit ?? false,
    ...(context.playbook ? { playbook: context.playbook } : {}),
    ...(context.env ? { env: context.env } : {}),
  };

  sink.increment("tool_calls_total", 1, attrs);

  const span = sink.startSpan("agent.tool", attrs);
  const startedAt = Date.now();

  try {
    const result = await run();
    sink.observe("tool_latency_ms", Date.now() - startedAt, attrs);
    span.end({ ok: true });
    return result;
  } catch (error) {
    sink.observe("tool_latency_ms", Date.now() - startedAt, attrs);
    span.end({ ok: false, error: errorMessage(error) });
    throw error;
  }
}

export function record_llm_tokens(
  sink: ObsSink,
  inputTokens: number,
  outputTokens: number,
  attributes: ObsAttributes = {},
): void {
  sink.increment("llm_tokens_in_total", inputTokens, attributes);
  sink.increment("llm_tokens_out_total", outputTokens, attributes);
}
