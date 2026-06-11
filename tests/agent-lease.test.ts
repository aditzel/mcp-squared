import { describe, expect, test } from "bun:test";
import type { UpstreamServerConfig } from "@/config/schema";
import { AgentLeaseManager } from "@/runtime/agent-lease";
import { UpstreamCallSupervisor } from "@/runtime/supervisor";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
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

describe("AgentLeaseManager", () => {
  test("acquires a lease on an unleased upstream", () => {
    const manager = new AgentLeaseManager();
    const lease = manager.acquire("local", "agent-a", { ttlMs: 60_000 });

    expect(lease.upstreamKey).toBe("local");
    expect(lease.agentId).toBe("agent-a");
    expect(lease.expiresAt).toBeGreaterThan(Date.now());
  });

  test("rejects acquisition when another agent holds the lease", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 60_000 });

    expect(() =>
      manager.acquire("local", "agent-b", { ttlMs: 60_000 }),
    ).toThrow("Upstream 'local' is already leased by agent-a");
  });

  test("allows same agent to re-acquire (renew)", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 60_000 });
    const second = manager.acquire("local", "agent-a", { ttlMs: 120_000 });

    expect(second.agentId).toBe("agent-a");
    expect(second.expiresAt).toBeGreaterThan(Date.now());
  });

  test("release frees the upstream for other agents", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 60_000 });
    manager.release("local", "agent-a");

    const lease = manager.acquire("local", "agent-b", { ttlMs: 60_000 });
    expect(lease.agentId).toBe("agent-b");
  });

  test("release by non-holder is a no-op", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 60_000 });
    manager.release("local", "agent-b");

    expect(manager.isLeased("local")).toBe(true);
    expect(manager.getLease("local")?.agentId).toBe("agent-a");
  });

  test("lease expires after TTL", async () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 50 });

    await Bun.sleep(80);

    expect(manager.isLeased("local")).toBe(false);
    expect(manager.getLease("local")).toBeNull();
  });

  test("expired lease allows new acquisition", async () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 50 });

    await Bun.sleep(80);

    const lease = manager.acquire("local", "agent-b", { ttlMs: 60_000 });
    expect(lease.agentId).toBe("agent-b");
  });

  test("different upstreams have independent leases", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local-a", "agent-a", { ttlMs: 60_000 });
    manager.acquire("local-b", "agent-b", { ttlMs: 60_000 });

    expect(manager.getLease("local-a")?.agentId).toBe("agent-a");
    expect(manager.getLease("local-b")?.agentId).toBe("agent-b");
  });

  test("leases across different upstreams are independent", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local-a", "agent-a", { ttlMs: 60_000 });

    expect(manager.isLeased("local-a")).toBe(true);
    expect(manager.isLeased("local-b")).toBe(false);
  });

  test("lease holder check works", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 60_000 });

    expect(manager.isLeaseHolder("local", "agent-a")).toBe(true);
    expect(manager.isLeaseHolder("local", "agent-b")).toBe(false);
  });

  test("lease holder check returns false for unleased upstream", () => {
    const manager = new AgentLeaseManager();
    expect(manager.isLeaseHolder("local", "agent-a")).toBe(false);
  });

  test("renew extends lease TTL", async () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 50 });

    await Bun.sleep(30);
    manager.renew("local", "agent-a", 200);

    await Bun.sleep(80);
    expect(manager.isLeased("local")).toBe(true);

    await Bun.sleep(150);
    expect(manager.isLeased("local")).toBe(false);
  });

  test("renew by non-holder is a no-op", async () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 50 });

    manager.renew("local", "agent-b", 200);

    await Bun.sleep(80);
    expect(manager.isLeased("local")).toBe(false);
  });

  test("releaseLease returns true when lease existed", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 60_000 });

    expect(manager.releaseLease("local")).toBe(true);
    expect(manager.isLeased("local")).toBe(false);
  });

  test("releaseLease returns false when no lease existed", () => {
    const manager = new AgentLeaseManager();
    expect(manager.releaseLease("local")).toBe(false);
  });

  test("dispose releases all leases for an upstream", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local", "agent-a", { ttlMs: 60_000 });

    manager.dispose("local");

    expect(manager.isLeased("local")).toBe(false);
  });

  test("dispose all releases all leases", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local-a", "agent-a", { ttlMs: 60_000 });
    manager.acquire("local-b", "agent-b", { ttlMs: 60_000 });

    manager.disposeAll();

    expect(manager.isLeased("local-a")).toBe(false);
    expect(manager.isLeased("local-b")).toBe(false);
  });

  test("getLease returns null for unleased upstream", () => {
    const manager = new AgentLeaseManager();
    expect(manager.getLease("local")).toBeNull();
  });

  test("getLeases returns all active leases", () => {
    const manager = new AgentLeaseManager();
    manager.acquire("local-a", "agent-a", { ttlMs: 60_000 });
    manager.acquire("local-b", "agent-b", { ttlMs: 60_000 });

    const leases = manager.getLeases();
    expect(leases).toHaveLength(2);
  });
});

describe("UpstreamCallSupervisor with leases", () => {
  test("lease holder calls proceed while lease is active", async () => {
    const leaseManager = new AgentLeaseManager();
    const supervisor = new UpstreamCallSupervisor({ leaseManager });
    const config = makeStdioConfig();
    const releaseFirst = deferred();
    const order: string[] = [];

    leaseManager.acquire("local", "agent-a", { ttlMs: 60_000 });

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
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("non-holder calls are blocked while lease is active", async () => {
    const leaseManager = new AgentLeaseManager();
    const supervisor = new UpstreamCallSupervisor({ leaseManager });
    const config = makeStdioConfig();
    const order: string[] = [];

    leaseManager.acquire("local", "agent-a", { ttlMs: 60_000 });

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
  });

  test("non-holder calls execute after lease expires", async () => {
    const leaseManager = new AgentLeaseManager();
    const supervisor = new UpstreamCallSupervisor({ leaseManager });
    const config = makeStdioConfig();
    const order: string[] = [];

    leaseManager.acquire("local", "agent-a", { ttlMs: 30 });

    const blocked = supervisor.run(
      "local",
      config,
      async () => {
        order.push("blocked:start");
        return "blocked";
      },
      { agentId: "agent-b" },
    );

    const result = await blocked;
    expect(result).toBe("blocked");
    expect(order).toEqual(["blocked:start"]);
  });

  test("calls without agent id use exclusive serialization (no lease check)", async () => {
    const leaseManager = new AgentLeaseManager();
    const supervisor = new UpstreamCallSupervisor({ leaseManager });
    const config = makeStdioConfig();
    const releaseFirst = deferred();
    const order: string[] = [];

    leaseManager.acquire("local", "agent-a", { ttlMs: 60_000 });

    const first = supervisor.run("local", config, async () => {
      order.push("first:start");
      await releaseFirst.promise;
      order.push("first:end");
      return "first";
    });
    await Bun.sleep(0);

    const second = supervisor.run("local", config, async () => {
      order.push("second:start");
      return "second";
    });
    await Bun.sleep(0);

    expect(order).toEqual(["first:start"]);

    releaseFirst.resolve();
    expect(await Promise.all([first, second])).toEqual(["first", "second"]);
  });

  test("lease-aware mode respects agent identity for lease checks", async () => {
    const leaseManager = new AgentLeaseManager();
    const supervisor = new UpstreamCallSupervisor({ leaseManager });
    const config = makeStdioConfig({ concurrency: "exclusive" });
    const order: string[] = [];

    leaseManager.acquire("local", "agent-a", { ttlMs: 60_000 });

    const holder = supervisor.run(
      "local",
      config,
      async () => {
        order.push("holder:start");
        return "holder";
      },
      { agentId: "agent-a" },
    );
    await Bun.sleep(0);

    const nonHolder = supervisor.run(
      "local",
      config,
      async () => {
        order.push("non-holder:start");
        return "non-holder";
      },
      { agentId: "agent-b" },
    );
    await Bun.sleep(0);

    expect(order).toEqual(["holder:start"]);

    leaseManager.release("local", "agent-a");
    const results = await Promise.all([holder, nonHolder]);
    expect(results).toEqual(["holder", "non-holder"]);
  });

  test("upstream without lease config works normally", async () => {
    const supervisor = new UpstreamCallSupervisor();
    const config = makeStdioConfig();
    const releaseFirst = deferred();
    const order: string[] = [];

    const first = supervisor.run("local", config, async () => {
      order.push("first:start");
      await releaseFirst.promise;
      order.push("first:end");
      return "first";
    });
    await Bun.sleep(0);

    const second = supervisor.run("local", config, async () => {
      order.push("second:start");
      return "second";
    });
    await Bun.sleep(0);

    expect(order).toEqual(["first:start"]);

    releaseFirst.resolve();
    expect(await Promise.all([first, second])).toEqual(["first", "second"]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });
});
