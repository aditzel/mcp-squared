import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HealthTracker,
  type HealthTrackerConfig,
} from "@/runtime/health-tracker";

function makeConfig(dataDir: string): HealthTrackerConfig {
  return {
    enabled: true,
    maxAuditEvents: 100,
    dataDir,
  };
}

function disabledConfig(dataDir: string): HealthTrackerConfig {
  return {
    enabled: false,
    maxAuditEvents: 100,
    dataDir,
  };
}

describe("HealthTracker", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp2-health-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("health state", () => {
    test("starts with no health data", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      expect(tracker.getHealth("local")).toBeNull();
      expect(tracker.getAllHealth()).toEqual([]);
    });

    test("records connection", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordConnected("local");

      const health = tracker.getHealth("local");
      expect(health).not.toBeNull();
      expect(health?.status).toBe("healthy");
      expect(health?.lastConnectedAt).toBeGreaterThan(0);
    });

    test("records disconnection", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordConnected("local");
      tracker.recordDisconnected("local");

      const health = tracker.getHealth("local");
      expect(health?.status).toBe("unhealthy");
      expect(health?.lastDisconnectedAt).toBeGreaterThan(0);
    });

    test("records error with message", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordError("local", "connection refused");

      const health = tracker.getHealth("local");
      expect(health?.status).toBe("unhealthy");
      expect(health?.lastErrorMessage).toBe("connection refused");
      expect(health?.totalErrors).toBe(1);
    });

    test("increments restart count", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordRestart("local");
      tracker.recordRestart("local");

      const health = tracker.getHealth("local");
      expect(health?.restartCount).toBe(2);
    });

    test("records tool call metrics", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordToolCall("local", 100);
      tracker.recordToolCall("local", 200);

      const health = tracker.getHealth("local");
      expect(health?.totalToolCalls).toBe(2);
      expect(health?.totalResponseTimeMs).toBe(300);
    });

    test("records tool error metrics", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordToolError("local", "timeout", 5000);

      const health = tracker.getHealth("local");
      expect(health?.totalToolCalls).toBe(1);
      expect(health?.totalErrors).toBe(1);
      expect(health?.totalResponseTimeMs).toBe(5000);
    });

    test("tracks multiple upstreams independently", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordConnected("local-a");
      tracker.recordError("local-b", "fail");

      const all = tracker.getAllHealth();
      expect(all).toHaveLength(2);

      const healthA = tracker.getHealth("local-a");
      const healthB = tracker.getHealth("local-b");
      expect(healthA?.status).toBe("healthy");
      expect(healthB?.status).toBe("unhealthy");
    });
  });

  describe("audit events", () => {
    test("records connection events", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordConnected("local");

      const events = tracker.getAuditEvents();
      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event).toBeDefined();
      expect(event?.type).toBe("upstream_connected");
      expect(event?.upstreamKey).toBe("local");
    });

    test("records tool call events with context", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordToolCall("local", 50, {
        agentId: "agent-a",
        sessionId: "sess-1",
        requestId: "req-1",
      });

      const events = tracker.getAuditEvents();
      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event).toBeDefined();
      expect(event?.type).toBe("tool_call");
      expect(event?.agentId).toBe("agent-a");
      expect(event?.sessionId).toBe("sess-1");
      expect(event?.requestId).toBe("req-1");
      expect(event?.durationMs).toBe(50);
    });

    test("records lease events", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordLeaseEvent("lease_acquired", "local", "agent-a");
      tracker.recordLeaseEvent("lease_released", "local", "agent-a");

      const events = tracker.getAuditEvents();
      expect(events).toHaveLength(2);
      expect(events[0]).toBeDefined();
      expect(events[1]).toBeDefined();
      expect(events[0]?.type).toBe("lease_released");
      expect(events[1]?.type).toBe("lease_acquired");
    });

    test("filters events by upstream key", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordConnected("local-a");
      tracker.recordConnected("local-b");

      const events = tracker.getAuditEvents({ upstreamKey: "local-a" });
      expect(events).toHaveLength(1);
      expect(events[0]).toBeDefined();
      expect(events[0]?.upstreamKey).toBe("local-a");
    });

    test("filters events by type", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordConnected("local");
      tracker.recordToolCall("local", 10);
      tracker.recordError("local", "fail");

      const errors = tracker.getAuditEvents({ type: "upstream_error" });
      expect(errors).toHaveLength(1);
    });

    test("filters events by timestamp", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordConnected("local");
      tracker.recordDisconnected("local");

      // Get the timestamp of the first event and filter for events after it
      const allEvents = tracker.getAuditEvents();
      const firstEvent = allEvents[allEvents.length - 1];
      expect(firstEvent).toBeDefined();
      const firstTimestamp = firstEvent?.timestamp ?? 0;

      const events = tracker.getAuditEvents({ since: firstTimestamp + 1 });
      // Only the second event (disconnected) should be after the first
      expect(events.length).toBeLessThanOrEqual(1);
      if (events.length === 1) {
        expect(events[0]).toBeDefined();
        expect(events[0]?.type).toBe("upstream_disconnected");
      }
    });

    test("limits returned events", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      for (let i = 0; i < 10; i++) {
        tracker.recordConnected("local");
      }

      const events = tracker.getAuditEvents({ limit: 5 });
      expect(events).toHaveLength(5);
    });

    test("returns events most recent first", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordConnected("local");
      tracker.recordDisconnected("local");

      const events = tracker.getAuditEvents();
      expect(events[0]).toBeDefined();
      expect(events[1]).toBeDefined();
      expect(events[0]?.type).toBe("upstream_disconnected");
      expect(events[1]?.type).toBe("upstream_connected");
    });

    test("trims events to maxAuditEvents", () => {
      // Override max to 5
      const smallTracker = new HealthTracker({
        enabled: true,
        maxAuditEvents: 5,
        dataDir: tempDir,
      });

      for (let i = 0; i < 10; i++) {
        smallTracker.recordConnected("local");
      }

      const events = smallTracker.getAuditEvents();
      expect(events).toHaveLength(5);
    });

    test("event IDs are sequential", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      tracker.recordConnected("local");
      tracker.recordDisconnected("local");

      const events = tracker.getAuditEvents();
      expect(events[0]).toBeDefined();
      expect(events[1]).toBeDefined();
      expect(events[0]?.id).not.toBe(events[1]?.id);
    });

    test("events have timestamps", () => {
      const tracker = new HealthTracker(makeConfig(tempDir));
      const before = Date.now();
      tracker.recordConnected("local");
      const after = Date.now();

      const events = tracker.getAuditEvents();
      expect(events[0]).toBeDefined();
      expect(events[0]?.timestamp).toBeGreaterThanOrEqual(before);
      expect(events[0]?.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("persistence", () => {
    test("saves and loads health state", async () => {
      const config = makeConfig(tempDir);
      const tracker1 = new HealthTracker(config);
      tracker1.recordConnected("local");
      tracker1.recordToolCall("local", 100);
      await tracker1.save();

      const tracker2 = new HealthTracker(config);
      await tracker2.load();

      const health = tracker2.getHealth("local");
      expect(health).not.toBeNull();
      expect(health?.status).toBe("healthy");
      expect(health?.totalToolCalls).toBe(1);
    });

    test("saves and loads audit events", async () => {
      const config = makeConfig(tempDir);
      const tracker1 = new HealthTracker(config);
      tracker1.recordConnected("local");
      tracker1.recordToolCall("local", 50, { agentId: "agent-a" });
      await tracker1.save();

      const tracker2 = new HealthTracker(config);
      await tracker2.load();

      const events = tracker2.getAuditEvents();
      expect(events).toHaveLength(2);
    });

    test("load is no-op when persistence disabled", async () => {
      const config = disabledConfig(tempDir);
      const tracker = new HealthTracker(config);
      tracker.recordConnected("local");
      await tracker.save(); // no-op

      const tracker2 = new HealthTracker(config);
      await tracker2.load();
      expect(tracker2.getHealth("local")).toBeNull();
    });

    test("load handles missing file gracefully", async () => {
      const config = makeConfig(tempDir);
      const tracker = new HealthTracker(config);
      await tracker.load(); // no file exists yet
      expect(tracker.getAllHealth()).toEqual([]);
    });

    test("load handles corrupt file gracefully", async () => {
      const { writeFile } = await import("node:fs/promises");
      const config = makeConfig(tempDir);
      await writeFile(join(tempDir, "health.json"), "not json", "utf-8");

      const tracker = new HealthTracker(config);
      await tracker.load();
      expect(tracker.getAllHealth()).toEqual([]);
    });

    test("saves only the most recent events up to maxAuditEvents", async () => {
      const config = { enabled: true, maxAuditEvents: 3, dataDir: tempDir };
      const tracker = new HealthTracker(config);
      for (let i = 0; i < 5; i++) {
        tracker.recordConnected("local");
      }
      await tracker.save();

      const tracker2 = new HealthTracker(config);
      await tracker2.load();
      const events = tracker2.getAuditEvents();
      expect(events).toHaveLength(3);
    });
  });
});
