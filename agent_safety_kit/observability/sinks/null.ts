import type { ObsAttributes, ObsSink, ObsSpan, SpanStatus } from "./base.js";

class NullSpan implements ObsSpan {
  setAttributes(_attributes: ObsAttributes): void {
    // no-op
  }

  addEvent(_name: string, _attributes?: ObsAttributes): void {
    // no-op
  }

  end(_status?: SpanStatus): void {
    // no-op
  }
}

export class NullSink implements ObsSink {
  startSpan(_name: string, _attributes?: ObsAttributes): ObsSpan {
    return new NullSpan();
  }

  emit(_event: string, _payload: Record<string, unknown>): void {
    // no-op
  }

  increment(_metric: string, _value = 1, _attributes?: ObsAttributes): void {
    // no-op
  }

  observe(_metric: string, _value: number, _attributes?: ObsAttributes): void {
    // no-op
  }
}
