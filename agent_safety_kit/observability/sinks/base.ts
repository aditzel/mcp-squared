export type ObsAttrValue = string | number | boolean;
export type ObsAttributes = Record<string, ObsAttrValue | undefined>;

export interface SpanStatus {
  ok: boolean;
  error?: string;
}

export interface ObsSpan {
  setAttributes(attributes: ObsAttributes): void;
  addEvent(name: string, attributes?: ObsAttributes): void;
  end(status?: SpanStatus): void;
}

export interface ObsSink {
  startSpan(name: string, attributes?: ObsAttributes): ObsSpan;
  emit(event: string, payload: Record<string, unknown>): void;
  increment(metric: string, value?: number, attributes?: ObsAttributes): void;
  observe(metric: string, value: number, attributes?: ObsAttributes): void;
  flush?(): Promise<void> | void;
}

export function compactAttributes(attributes?: ObsAttributes): ObsAttributes {
  const compact: ObsAttributes = {};
  if (!attributes) {
    return compact;
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      compact[key] = value;
    }
  }
  return compact;
}
