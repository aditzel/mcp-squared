import { describe, expect, test } from "bun:test";
import { PolicyDenied } from "../../agent_safety_kit/guard/errors.js";
import { Guard, redactSecrets } from "../../agent_safety_kit/guard/guard.js";
import type {
  ObsAttributes,
  ObsSink,
  ObsSpan,
  SpanStatus,
} from "../../agent_safety_kit/observability/sinks/base.js";
import type { LoadedPolicy } from "../../agent_safety_kit/policy/load.js";

class TestSpan implements ObsSpan {
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

class TestSink implements ObsSink {
  events: Array<{ event: string; payload: Record<string, unknown> }> = [];

  startSpan(_name: string, _attributes?: ObsAttributes): ObsSpan {
    return new TestSpan();
  }

  emit(event: string, payload: Record<string, unknown>): void {
    this.events.push({ event, payload });
  }

  increment(_metric: string, _value = 1, _attributes?: ObsAttributes): void {
    // no-op
  }

  observe(_metric: string, _value: number, _attributes?: ObsAttributes): void {
    // no-op
  }
}

function makePolicy(reportOnly: boolean): LoadedPolicy {
  return {
    version: 1,
    sourcePath: "/tmp/policy.yaml",
    playbook: "test",
    agentEnv: "DEV",
    reportOnly,
    denyByDefault: true,
    rules: [
      {
        agent: "mcp-squared",
        tool: "filesystem:*",
        action: "call",
        paths_allow: ["/tmp/*"],
        rate_limit_per_min: 1,
      },
    ],
  };
}

describe("Guard", () => {
  test("throws PolicyDenied when report-only is disabled", () => {
    const sink = new TestSink();
    const guard = new Guard({
      enabled: true,
      policy: makePolicy(false),
      sink,
    });

    expect(() =>
      guard.enforce({
        agent: "mcp-squared",
        tool: "filesystem:write_file",
        action: "call",
        params: { path: "/etc/passwd" },
      }),
    ).toThrow(PolicyDenied);
  });

  test("returns allowed=true with wouldDeny in report-only mode", () => {
    const sink = new TestSink();
    const guard = new Guard({
      enabled: true,
      policy: makePolicy(true),
      sink,
    });

    const decision = guard.enforce({
      agent: "mcp-squared",
      tool: "filesystem:write_file",
      action: "call",
      params: { path: "/etc/passwd" },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.wouldDeny).toBe(true);
    expect(sink.events.length).toBe(1);
  });

  test("enforces rate limit per agent+tool+action", () => {
    const sink = new TestSink();
    const guard = new Guard({
      enabled: true,
      policy: makePolicy(true),
      sink,
    });

    const first = guard.enforce({
      agent: "mcp-squared",
      tool: "filesystem:write_file",
      action: "call",
      params: { path: "/tmp/a.txt" },
    });

    const second = guard.enforce({
      agent: "mcp-squared",
      tool: "filesystem:write_file",
      action: "call",
      params: { path: "/tmp/b.txt" },
    });

    expect(first.wouldDeny).toBe(false);
    expect(second.wouldDeny).toBe(true);
  });
});

describe("redactSecrets", () => {
  test("redacts nested secret-like keys", () => {
    const value = redactSecrets({
      token: "abc",
      nested: {
        password: "def",
        headers: {
          authorization: "Bearer xyz",
        },
      },
      safe: "ok",
    });

    const objectValue = value as {
      token: string;
      nested: { password: string; headers: { authorization: string } };
      safe: string;
    };

    expect(objectValue.token).toBe("[REDACTED]");
    expect(objectValue.nested.password).toBe("[REDACTED]");
    expect(objectValue.nested.headers.authorization).toBe("[REDACTED]");
    expect(objectValue.safe).toBe("ok");
  });
});
