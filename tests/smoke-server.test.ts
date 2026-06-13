import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpSquaredServer } from "@/server/index";
import { HealthTracker } from "@/runtime/health-tracker";
import { AgentLeaseManager } from "@/runtime/agent-lease";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "@/config/schema";

describe("Smoke test: mcp-squared server with health tracking", () => {
  let tempDir: string;
  let healthTracker: HealthTracker;
  let leaseManager: AgentLeaseManager;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp2-smoke-"));
    healthTracker = new HealthTracker({
      enabled: true,
      maxAuditEvents: 100,
      dataDir: tempDir,
    });
    leaseManager = new AgentLeaseManager();
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("server creates with health tracker and lease manager", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        test: {
          transport: "stdio",
          enabled: true,
          env: {},
          stdio: {
            command: "echo",
            args: ["test"],
          },
        },
      },
    };

    const server = new McpSquaredServer({
      config,
    });

    expect(server).toBeDefined();
  });

  test("health tracker records connection lifecycle", () => {
    healthTracker.recordConnected("test-upstream");
    healthTracker.recordToolCall("test-upstream", 100, {
      agentId: "smoke-agent",
      sessionId: "sess-1",
    });
    healthTracker.recordDisconnected("test-upstream");

    const health = healthTracker.getHealth("test-upstream");
    expect(health).not.toBeNull();
    expect(health!.status).toBe("unhealthy");
    expect(health!.lastConnectedAt).toBeGreaterThan(0);
    expect(health!.lastDisconnectedAt).toBeGreaterThan(0);
    expect(health!.totalToolCalls).toBe(1);

    const events = healthTracker.getAuditEvents();
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  test("lease manager works independently", () => {
    const lease = leaseManager.acquire("test-upstream", "smoke-agent", {
      ttlMs: 5000,
    });
    expect(lease.agentId).toBe("smoke-agent");
    expect(leaseManager.isLeased("test-upstream")).toBe(true);
    expect(leaseManager.isLeaseHolder("test-upstream", "smoke-agent")).toBe(
      true,
    );

    leaseManager.release("test-upstream", "smoke-agent");
    expect(leaseManager.isLeased("test-upstream")).toBe(false);
  });

  test("audit events include lease events", () => {
    healthTracker.recordLeaseEvent("lease_acquired", "test-upstream", "agent-a");
    healthTracker.recordLeaseEvent("lease_released", "test-upstream", "agent-a");

    const events = healthTracker.getAuditEvents({ type: "lease_acquired" });
    expect(events).toHaveLength(1);
    expect(events[0].agentId).toBe("agent-a");

    const releaseEvents = healthTracker.getAuditEvents({
      type: "lease_released",
    });
    expect(releaseEvents).toHaveLength(1);
  });

  test("health persists across tracker instances", async () => {
    await healthTracker.save();

    const newTracker = new HealthTracker({
      enabled: true,
      maxAuditEvents: 100,
      dataDir: tempDir,
    });
    await newTracker.load();

    const health = newTracker.getHealth("test-upstream");
    expect(health).not.toBeNull();
    expect(health!.totalToolCalls).toBe(1);

    const events = newTracker.getAuditEvents();
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  test("multiple upstreams tracked independently", () => {
    const tracker = new HealthTracker({
      enabled: true,
      maxAuditEvents: 100,
      dataDir: tempDir,
    });

    tracker.recordConnected("upstream-a");
    tracker.recordConnected("upstream-b");

    tracker.recordToolCall("upstream-a", 50);
    tracker.recordToolCall("upstream-b", 100);

    const healthA = tracker.getHealth("upstream-a");
    const healthB = tracker.getHealth("upstream-b");

    expect(healthA).not.toBeNull();
    expect(healthB).not.toBeNull();
    expect(healthA!.totalToolCalls).toBe(1);
    expect(healthB!.totalToolCalls).toBe(1);

    const eventsA = tracker.getAuditEvents({ upstreamKey: "upstream-a" });
    const eventsB = tracker.getAuditEvents({ upstreamKey: "upstream-b" });
    expect(eventsA.length).toBeGreaterThanOrEqual(1);
    expect(eventsB.length).toBeGreaterThanOrEqual(1);
  });
});
