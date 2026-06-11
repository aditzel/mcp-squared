import { beforeEach, describe, expect, test } from "bun:test";
import {
  createAuthInjectionMiddleware,
  createRequestLoggingMiddleware,
  createRetryMiddleware,
  createSessionAffinityMiddleware,
  type MiddlewareContext,
  ProxyMiddleware,
} from "@/upstream/proxy-middleware";

function makeContext(
  overrides: Partial<MiddlewareContext> = {},
): MiddlewareContext {
  return {
    upstreamKey: "local",
    callContext: { agentId: "agent-a", sessionId: "sess-1" },
    state: {},
    ...overrides,
  };
}

describe("ProxyMiddleware", () => {
  let middleware: ProxyMiddleware;

  beforeEach(() => {
    middleware = new ProxyMiddleware();
  });

  test("registers and executes middleware", async () => {
    const executed: string[] = [];
    middleware.use(
      "test",
      (ctx) => {
        executed.push(ctx.upstreamKey);
      },
      { phases: ["before_call"] },
    );

    await middleware.execute("before_call", makeContext());
    expect(executed).toEqual(["local"]);
  });

  test("executes middleware in priority order", async () => {
    const executed: string[] = [];
    middleware.use(
      "second",
      () => {
        executed.push("second");
      },
      { phases: ["before_call"], priority: 200 },
    );
    middleware.use(
      "first",
      () => {
        executed.push("first");
      },
      { phases: ["before_call"], priority: 100 },
    );

    await middleware.execute("before_call", makeContext());
    expect(executed).toEqual(["first", "second"]);
  });

  test("skips middleware for wrong phase", async () => {
    const executed: string[] = [];
    middleware.use(
      "test",
      () => {
        executed.push("test");
      },
      { phases: ["after_call"] },
    );

    await middleware.execute("before_call", makeContext());
    expect(executed).toEqual([]);
  });

  test("respects filter function", async () => {
    const executed: string[] = [];
    middleware.use(
      "test",
      () => {
        executed.push("test");
      },
      {
        phases: ["before_call"],
        filter: (ctx) => ctx.upstreamKey === "remote",
      },
    );

    await middleware.execute("before_call", makeContext());
    expect(executed).toEqual([]);

    await middleware.execute(
      "before_call",
      makeContext({ upstreamKey: "remote" }),
    );
    expect(executed).toEqual(["test"]);
  });

  test("removes middleware by name", async () => {
    const executed: string[] = [];
    middleware.use(
      "test",
      () => {
        executed.push("test");
      },
      { phases: ["before_call"] },
    );

    middleware.remove("test");
    await middleware.execute("before_call", makeContext());
    expect(executed).toEqual([]);
  });

  test("clears all middleware", () => {
    middleware.use("a", () => {}, { phases: ["before_call"] });
    middleware.use("b", () => {}, { phases: ["before_call"] });

    middleware.clear();
    expect(middleware.size).toBe(0);
  });

  test("reports size", () => {
    expect(middleware.size).toBe(0);
    middleware.use("a", () => {}, { phases: ["before_call"] });
    expect(middleware.size).toBe(1);
  });
});

describe("Session Affinity Middleware", () => {
  test("tracks session to upstream mapping", async () => {
    const middleware = new ProxyMiddleware();
    const affinity = createSessionAffinityMiddleware();
    middleware.use(affinity.name, affinity.fn, affinity.options);

    const ctx = makeContext();
    await middleware.execute("before_call", ctx);

    expect(ctx.state["sessionAffinityConflict"]).toBeUndefined();
  });

  test("detects session affinity conflict", async () => {
    const middleware = new ProxyMiddleware();
    const affinity = createSessionAffinityMiddleware();
    middleware.use(affinity.name, affinity.fn, affinity.options);

    // First call on upstream "local"
    await middleware.execute(
      "before_call",
      makeContext({ upstreamKey: "local" }),
    );

    // Same session on different upstream
    const ctx = makeContext({ upstreamKey: "remote" });
    await middleware.execute("before_call", ctx);

    expect(ctx.state["sessionAffinityConflict"]).toBe(true);
    expect(ctx.state["previousUpstream"]).toBe("local");
  });
});

describe("Request Logging Middleware", () => {
  test("logs requests", async () => {
    const logs: string[] = [];
    const middleware = new ProxyMiddleware();
    const logging = createRequestLoggingMiddleware((msg) => logs.push(msg));
    middleware.use(logging.name, logging.fn, logging.options);

    const ctx = makeContext({
      request: { method: "tools/call" },
    });
    await middleware.execute("before_call", ctx);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("local");
    expect(logs[0]).toContain("agent-a");
    expect(logs[0]).toContain("tools/call");
  });

  test("logs errors", async () => {
    const logs: string[] = [];
    const middleware = new ProxyMiddleware();
    const logging = createRequestLoggingMiddleware((msg) => logs.push(msg));
    middleware.use(logging.name, logging.fn, logging.options);

    const ctx = makeContext({
      response: { error: new Error("connection failed") },
    });
    await middleware.execute("on_error", ctx);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("connection failed");
  });
});

describe("Retry Middleware", () => {
  test("sets retry state on error", async () => {
    const middleware = new ProxyMiddleware();
    const retry = createRetryMiddleware(3, 100);
    middleware.use(retry.name, retry.fn, retry.options);

    const ctx = makeContext({
      response: { error: new Error("timeout") },
    });
    await middleware.execute("after_call", ctx);

    expect(ctx.state["shouldRetry"]).toBe(true);
    expect(ctx.state["retryCount"]).toBe(1);
    expect(ctx.state["retryDelayMs"]).toBe(100);
  });

  test("exponential backoff", async () => {
    const middleware = new ProxyMiddleware();
    const retry = createRetryMiddleware(3, 100);
    middleware.use(retry.name, retry.fn, retry.options);

    // First retry
    const ctx1 = makeContext({
      response: { error: new Error("timeout") },
    });
    await middleware.execute("after_call", ctx1);
    expect(ctx1.state["retryDelayMs"]).toBe(100);

    // Second retry (using state from first)
    const ctx2 = makeContext({
      response: { error: new Error("timeout") },
      state: { retryCount: 1 },
    });
    await middleware.execute("after_call", ctx2);
    expect(ctx2.state["retryDelayMs"]).toBe(200);
  });

  test("stops retrying after max retries", async () => {
    const middleware = new ProxyMiddleware();
    const retry = createRetryMiddleware(2, 100);
    middleware.use(retry.name, retry.fn, retry.options);

    const ctx = makeContext({
      response: { error: new Error("timeout") },
      state: { retryCount: 2 },
    });
    await middleware.execute("after_call", ctx);

    expect(ctx.state["shouldRetry"]).toBeUndefined();
  });
});

describe("Auth Injection Middleware", () => {
  test("injects auth token when present", async () => {
    const middleware = new ProxyMiddleware();
    const auth = createAuthInjectionMiddleware();
    middleware.use(auth.name, auth.fn, auth.options);

    const ctx = makeContext({
      request: { method: "tools/call" },
      state: { authToken: "secret-token" },
    });
    await middleware.execute("before_call", ctx);

    expect(ctx.state["headers"]).toEqual({
      Authorization: "Bearer secret-token",
    });
  });

  test("skips injection when no token", async () => {
    const middleware = new ProxyMiddleware();
    const auth = createAuthInjectionMiddleware();
    middleware.use(auth.name, auth.fn, auth.options);

    const ctx = makeContext({
      request: { method: "tools/call" },
    });
    await middleware.execute("before_call", ctx);

    expect(ctx.state["headers"]).toBeUndefined();
  });
});
