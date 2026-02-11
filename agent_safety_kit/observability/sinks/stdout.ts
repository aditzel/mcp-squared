import {
  type ObsAttributes,
  type ObsSink,
  type ObsSpan,
  type SpanStatus,
  compactAttributes,
} from "./base.js";

interface StdoutEnvelope {
  ts: string;
  type: string;
  name?: string;
  attributes?: ObsAttributes;
  payload?: Record<string, unknown>;
  status?: SpanStatus;
  duration_ms?: number;
}

class StdoutSpan implements ObsSpan {
  private readonly startedAtMs = Date.now();
  private readonly attributes: ObsAttributes;

  constructor(
    private readonly sink: StdoutSink,
    private readonly spanName: string,
    initialAttributes?: ObsAttributes,
  ) {
    this.attributes = { ...compactAttributes(initialAttributes) };
    this.sink.write({
      ts: new Date(this.startedAtMs).toISOString(),
      type: "span.start",
      name: this.spanName,
      attributes: this.attributes,
    });
  }

  setAttributes(attributes: ObsAttributes): void {
    Object.assign(this.attributes, compactAttributes(attributes));
  }

  addEvent(name: string, attributes?: ObsAttributes): void {
    this.sink.write({
      ts: new Date().toISOString(),
      type: "span.event",
      name,
      attributes: compactAttributes({
        ...this.attributes,
        ...attributes,
      }),
    });
  }

  end(status?: SpanStatus): void {
    this.sink.write({
      ts: new Date().toISOString(),
      type: "span.end",
      name: this.spanName,
      attributes: this.attributes,
      duration_ms: Date.now() - this.startedAtMs,
      ...(status ? { status } : {}),
    });
  }
}

export class StdoutSink implements ObsSink {
  startSpan(name: string, attributes?: ObsAttributes): ObsSpan {
    return new StdoutSpan(this, name, attributes);
  }

  emit(event: string, payload: Record<string, unknown>): void {
    this.write({
      ts: new Date().toISOString(),
      type: "event",
      name: event,
      payload,
    });
  }

  increment(metric: string, value = 1, attributes?: ObsAttributes): void {
    this.write({
      ts: new Date().toISOString(),
      type: "metric.counter",
      name: metric,
      payload: {
        value,
        attributes: compactAttributes(attributes),
      },
    });
  }

  observe(metric: string, value: number, attributes?: ObsAttributes): void {
    this.write({
      ts: new Date().toISOString(),
      type: "metric.histogram",
      name: metric,
      payload: {
        value,
        attributes: compactAttributes(attributes),
      },
    });
  }

  write(entry: StdoutEnvelope): void {
    console.log(JSON.stringify(entry));
  }
}
