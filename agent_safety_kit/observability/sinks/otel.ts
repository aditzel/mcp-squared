import { createRequire } from "node:module";
import {
  type ObsAttributes,
  type ObsSink,
  type ObsSpan,
  type SpanStatus,
  compactAttributes,
} from "./base.js";

type OtelCounter = {
  add: (
    value: number,
    attrs?: Record<string, string | number | boolean>,
  ) => void;
};
type OtelHistogram = {
  record: (
    value: number,
    attrs?: Record<string, string | number | boolean>,
  ) => void;
};

type OtelSpanImpl = {
  setAttributes: (attrs: Record<string, string | number | boolean>) => void;
  addEvent: (
    name: string,
    attrs?: Record<string, string | number | boolean>,
  ) => void;
  setStatus: (status: { code: number; message?: string }) => void;
  end: () => void;
};

type OtelApi = {
  trace: {
    getTracer: (name: string) => {
      startSpan: (
        name: string,
        options?: { attributes?: Record<string, string | number | boolean> },
      ) => OtelSpanImpl;
    };
  };
  metrics: {
    getMeter: (name: string) => {
      createCounter: (name: string) => OtelCounter;
      createHistogram: (name: string) => OtelHistogram;
    };
  };
  SpanStatusCode?: {
    OK?: number;
    ERROR?: number;
  };
};

const require = createRequire(import.meta.url);

function loadOpenTelemetryApi(): OtelApi {
  try {
    return require("@opentelemetry/api") as OtelApi;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown dependency error";
    throw new Error(
      `AGENT_OBS_SINK=otel requires optional dependency @opentelemetry/api (${message})`,
    );
  }
}

function normalizeAttributes(
  attributes?: ObsAttributes,
): Record<string, string | number | boolean> {
  return compactAttributes(attributes) as Record<
    string,
    string | number | boolean
  >;
}

class OTelSpan implements ObsSpan {
  constructor(
    private readonly span: OtelSpanImpl,
    private readonly spanStatusCode?: { OK?: number; ERROR?: number },
  ) {}

  setAttributes(attributes: ObsAttributes): void {
    this.span.setAttributes(normalizeAttributes(attributes));
  }

  addEvent(name: string, attributes?: ObsAttributes): void {
    this.span.addEvent(name, normalizeAttributes(attributes));
  }

  end(status?: SpanStatus): void {
    if (status && this.spanStatusCode) {
      const code = status.ok
        ? (this.spanStatusCode.OK ?? 1)
        : (this.spanStatusCode.ERROR ?? 2);
      this.span.setStatus({
        code,
        ...(status.error ? { message: status.error } : {}),
      });
    }
    this.span.end();
  }
}

function flattenPayload(payload: Record<string, unknown>): ObsAttributes {
  const flattened: ObsAttributes = {};

  for (const [key, value] of Object.entries(payload)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      flattened[key] = value;
    } else if (value !== null && value !== undefined) {
      flattened[key] = JSON.stringify(value);
    }
  }

  return flattened;
}

export class OTelSink implements ObsSink {
  private readonly tracer: ReturnType<OtelApi["trace"]["getTracer"]>;
  private readonly meter: ReturnType<OtelApi["metrics"]["getMeter"]>;
  private readonly counters = new Map<string, OtelCounter>();
  private readonly histograms = new Map<string, OtelHistogram>();

  constructor(serviceName = process.env["OTEL_SERVICE_NAME"] ?? "mcp-squared") {
    const api = loadOpenTelemetryApi();
    this.tracer = api.trace.getTracer(serviceName);
    this.meter = api.metrics.getMeter(serviceName);
    this.spanStatusCode = api.SpanStatusCode;
  }

  private readonly spanStatusCode: { OK?: number; ERROR?: number } | undefined;

  startSpan(name: string, attributes?: ObsAttributes): ObsSpan {
    const span = this.tracer.startSpan(name, {
      attributes: normalizeAttributes(attributes),
    });
    return new OTelSpan(span, this.spanStatusCode);
  }

  emit(event: string, payload: Record<string, unknown>): void {
    const span = this.tracer.startSpan("agent.event", {
      attributes: normalizeAttributes({ event }),
    });
    try {
      span.addEvent(event, normalizeAttributes(flattenPayload(payload)));
    } finally {
      span.end();
    }
  }

  increment(metric: string, value = 1, attributes?: ObsAttributes): void {
    const counter = this.getCounter(metric);
    counter.add(value, normalizeAttributes(attributes));
  }

  observe(metric: string, value: number, attributes?: ObsAttributes): void {
    const histogram = this.getHistogram(metric);
    histogram.record(value, normalizeAttributes(attributes));
  }

  private getCounter(name: string): OtelCounter {
    const existing = this.counters.get(name);
    if (existing) {
      return existing;
    }

    const created = this.meter.createCounter(name);
    this.counters.set(name, created);
    return created;
  }

  private getHistogram(name: string): OtelHistogram {
    const existing = this.histograms.get(name);
    if (existing) {
      return existing;
    }

    const created = this.meter.createHistogram(name);
    this.histograms.set(name, created);
    return created;
  }
}
