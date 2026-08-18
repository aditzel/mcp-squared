import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpstreamServerConfig } from "@/config/schema";
import { AgentLeaseManager } from "@/runtime/agent-lease";
import { HealthTracker } from "@/runtime/health-tracker";
import { UpstreamCallSupervisor } from "@/runtime/supervisor";
import {
  createAuthInjectionMiddleware,
  createRetryMiddleware,
  createSessionAffinityMiddleware,
  type MiddlewareContext,
  ProxyMiddleware,
} from "@/upstream/proxy-middleware";

function expectPresent<T>(
  value: T | null | undefined,
  label: string,
): NonNullable<T> {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  if (value == null) {
    throw new Error(`${label} should be present`);
  }
  return value;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  const resolved = expectPresent(resolve, "deferred resolver");
  return { promise, resolve: resolved };
}

function makeStdioConfig(
  runtime: UpstreamServerConfig["runtime"] = {},
): UpstreamServerConfig {
  return {
    transport: "stdio",
    enabled: true,
    env: {},
    runtime,
    stdio: {
      command: "mcp-server-local",
      args: [],
    },
  };
}

function makeSseConfig(
  runtime: UpstreamServerConfig["runtime"] = {},
): UpstreamServerConfig {
  return {
    transport: "sse",
    enabled: true,
    env: {},
    runtime,
    sse: {
      url: "https://example.com/mcp",
      headers: {},
    },
  };
}

describe("Integration: Full call path with leases, health, and middleware", () => {
  let tempDir: string;
  let leaseManager: AgentLeaseManager;
  let healthTracker: HealthTracker;
  let supervisor: UpstreamCallSupervisor;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp2-integration-"));
    leaseManager = new AgentLeaseManager();
    healthTracker = new HealthTracker({
      enabled: true,
      maxAuditEvents: 100,
      dataDir: tempDir,
    });
    supervisor = new UpstreamCallSupervisor({
      leaseManager,
      healthTracker,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("successful tool call records health metrics and audit events", async () => {
    const config = makeStdioConfig();
    const result = await supervisor.run(
      "local",
      config,
      async () => ({ content: [{ type: "text", text: "ok" }] }),
      { agentId: "agent-a", sessionId: "sess-1", requestId: "req-1" },
    );

    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });

    const health = expectPresent(
      healthTracker.getHealth("local"),
      "local health",
    );
    expect(health.totalToolCalls).toBe(1);
    expect(health.totalErrors).toBe(0);
    expect(health.totalResponseTimeMs).toBeGreaterThanOrEqual(0);

    const events = healthTracker.getAuditEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const toolCallEvent = expectPresent(
      events.find((e) => e.type === "tool_call"),
      "tool call audit event",
    );
    expect(toolCallEvent.upstreamKey).toBe("local");
    expect(toolCallEvent.agentId).toBe("agent-a");
    expect(toolCallEvent.sessionId).toBe("sess-1");
    expect(toolCallEvent.requestId).toBe("req-1");
  });

  test("health tracker records tool errors", async () => {
    healthTracker.recordToolError("local", "upstream timeout", 100, {
      agentId: "agent-a",
      sessionId: "sess-1",
      requestId: "req-1",
    });

    const health = expectPresent(
      healthTracker.getHealth("local"),
      "local health",
    );
    expect(health.totalToolCalls).toBe(1);
    expect(health.totalErrors).toBe(1);
    expect(health.totalResponseTimeMs).toBe(100);

    const events = healthTracker.getAuditEvents({ type: "tool_error" });
    expect(events).toHaveLength(1);
    const event = expectPresent(events[0], "tool error audit event");
    expect(event.upstreamKey).toBe("local");
    expect(event.agentId).toBe("agent-a");
    expect(event.durationMs).toBe(100);
    expect(event.details).toEqual({ message: "upstream timeout" });
  });

  test("lease holder calls proceed while lease is active", async () => {
    const config = makeStdioConfig();
    leaseManager.acquire("local", "agent-a", { ttlMs: 60_000 });

    const order: string[] = [];
    const releaseFirst = deferred();

    const first = supervisor.run(
      "local",
      config,
      async () => {
        order.push("first:start");
        await releaseFirst.promise;
        order.push("first:end");
        return "first";
      },
      { agentId: "agent-a" },
    );
    await Bun.sleep(0);

    const second = supervisor.run(
      "local",
      config,
      async () => {
        order.push("second:start");
        return "second";
      },
      { agentId: "agent-a" },
    );
    await Bun.sleep(0);

    expect(order).toEqual(["first:start"]);

    releaseFirst.resolve();
    expect(await Promise.all([first, second])).toEqual(["first", "second"]);

    const health = expectPresent(
      healthTracker.getHealth("local"),
      "local health",
    );
    expect(health.totalToolCalls).toBe(2);
  });

  test("non-holder calls queue until lease is released", async () => {
    const config = makeStdioConfig();
    leaseManager.acquire("local", "agent-a", { ttlMs: 60_000 });

    const order: string[] = [];

    const blocked = supervisor.run(
      "local",
      config,
      async () => {
        order.push("blocked:start");
        return "blocked";
      },
      { agentId: "agent-b" },
    );
    await Bun.sleep(10);

    expect(order).toEqual([]);

    leaseManager.release("local", "agent-a");
    const result = await blocked;
    expect(result).toBe("blocked");
    expect(order).toEqual(["blocked:start"]);

    const events = healthTracker.getAuditEvents({ type: "tool_call" });
    expect(events).toHaveLength(1);
    const event = expectPresent(events[0], "tool call audit event");
    expect(event.agentId).toBe("agent-b");
  });

  test("health tracking persists across tracker instances", async () => {
    const config = makeStdioConfig();

    await supervisor.run("local", config, async () => "ok", {
      agentId: "agent-a",
    });

    await healthTracker.save();

    const newTracker = new HealthTracker({
      enabled: true,
      maxAuditEvents: 100,
      dataDir: tempDir,
    });
    await newTracker.load();

    const health = expectPresent(
      newTracker.getHealth("local"),
      "persisted health",
    );
    expect(health.totalToolCalls).toBe(1);

    const events = newTracker.getAuditEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test("middleware executes in order during call path", async () => {
    const config = makeStdioConfig();
    const middleware = new ProxyMiddleware();
    const order: string[] = [];

    middleware.use(
      "first",
      () => {
        order.push("first");
      },
      { phases: ["before_call"], priority: 100 },
    );
    middleware.use(
      "second",
      () => {
        order.push("second");
      },
      { phases: ["before_call"], priority: 200 },
    );

    await middleware.execute("before_call", {
      upstreamKey: "local",
      callContext: { agentId: "agent-a" },
      state: {},
    });

    expect(order).toEqual(["first", "second"]);

    const result = await supervisor.run("local", config, async () => "ok", {
      agentId: "agent-a",
    });

    expect(result).toBe("ok");
  });

  test("session affinity middleware detects conflicts", async () => {
    const config = makeSseConfig({ concurrency: "session_affine" });
    const middleware = new ProxyMiddleware();
    const affinity = createSessionAffinityMiddleware();
    middleware.use(affinity.name, affinity.fn, affinity.options);

    const ctx1: MiddlewareContext = {
      upstreamKey: "remote-a",
      callContext: { agentId: "agent-a", sessionId: "sess-1" },
      state: {},
    };
    await middleware.execute("before_call", ctx1);

    const ctx2: MiddlewareContext = {
      upstreamKey: "remote-b",
      callContext: { agentId: "agent-b", sessionId: "sess-1" },
      state: {},
    };
    await middleware.execute("before_call", ctx2);

    expect(ctx2.state["sessionAffinityConflict"]).toBe(true);
    expect(ctx2.state["previousUpstream"]).toBe("remote-a");

    const result = await supervisor.run("remote-a", config, async () => "ok", {
      sessionId: "sess-1",
    });
    expect(result).toBe("ok");
  });

  test("retry middleware tracks retry state", async () => {
    const middleware = new ProxyMiddleware();
    const retry = createRetryMiddleware(3, 100);
    middleware.use(retry.name, retry.fn, retry.options);

    const ctx: MiddlewareContext = {
      upstreamKey: "local",
      callContext: { agentId: "agent-a" },
      state: {},
      response: { error: new Error("timeout") },
    };
    await middleware.execute("after_call", ctx);

    expect(ctx.state["shouldRetry"]).toBe(true);
    expect(ctx.state["retryCount"]).toBe(1);
    expect(ctx.state["retryDelayMs"]).toBe(100);
  });

  test("auth injection middleware adds tokens", async () => {
    const middleware = new ProxyMiddleware();
    const auth = createAuthInjectionMiddleware();
    middleware.use(auth.name, auth.fn, auth.options);

    const ctx: MiddlewareContext = {
      upstreamKey: "local",
      callContext: { agentId: "agent-a" },
      state: { authToken: "secret-token" },
      request: { method: "tools/call" },
    };
    await middleware.execute("before_call", ctx);

    expect(ctx.state["headers"]).toEqual({
      Authorization: "Bearer secret-token",
    });
  });

  test("multiple upstreams tracked independently", async () => {
    const configA = makeStdioConfig();
    const configB = makeSseConfig();

    await supervisor.run("local-a", configA, async () => "a", {
      agentId: "agent-a",
    });
    await supervisor.run("remote-b", configB, async () => "b", {
      agentId: "agent-b",
    });

    const healthA = expectPresent(
      healthTracker.getHealth("local-a"),
      "local-a health",
    );
    const healthB = expectPresent(
      healthTracker.getHealth("remote-b"),
      "remote-b health",
    );

    expect(healthA.totalToolCalls).toBe(1);
    expect(healthB.totalToolCalls).toBe(1);

    const eventsA = healthTracker.getAuditEvents({ upstreamKey: "local-a" });
    const eventsB = healthTracker.getAuditEvents({ upstreamKey: "remote-b" });
    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(1);
  });

  test("health tracker records connection lifecycle", async () => {
    healthTracker.recordConnected("local");
    healthTracker.recordToolCall("local", 100);
    healthTracker.recordDisconnected("local");

    const health = expectPresent(
      healthTracker.getHealth("local"),
      "local health",
    );
    expect(health.status).toBe("unhealthy");
    expect(health.lastConnectedAt).toBeGreaterThan(0);
    expect(health.lastDisconnectedAt).toBeGreaterThan(0);
    expect(health.totalToolCalls).toBe(1);

    const events = healthTracker.getAuditEvents();
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  test("lease + health + middleware full flow", async () => {
    const config = makeStdioConfig();
    const middleware = new ProxyMiddleware();
    const affinity = createSessionAffinityMiddleware();
    middleware.use(affinity.name, affinity.fn, affinity.options);

    leaseManager.acquire("local", "agent-a", { ttlMs: 60_000 });
    healthTracker.recordConnected("local");

    const ctx: MiddlewareContext = {
      upstreamKey: "local",
      callContext: { agentId: "agent-a", sessionId: "sess-1" },
      state: {},
    };
    await middleware.execute("before_call", ctx);

    const result = await supervisor.run(
      "local",
      config,
      async () => {
        return { content: [{ type: "text", text: "done" }] };
      },
      { agentId: "agent-a", sessionId: "sess-1" },
    );

    expect(result).toEqual({ content: [{ type: "text", text: "done" }] });

    const health = expectPresent(
      healthTracker.getHealth("local"),
      "local health",
    );
    expect(health.status).toBe("healthy");
    expect(health.totalToolCalls).toBe(1);

    const lease = expectPresent(leaseManager.getLease("local"), "local lease");
    expect(lease.agentId).toBe("agent-a");

    await healthTracker.save();

    const newTracker = new HealthTracker({
      enabled: true,
      maxAuditEvents: 100,
      dataDir: tempDir,
    });
    await newTracker.load();
    const persistedHealth = expectPresent(
      newTracker.getHealth("local"),
      "persisted local health",
    );
    expect(persistedHealth.totalToolCalls).toBe(1);
  });
});
