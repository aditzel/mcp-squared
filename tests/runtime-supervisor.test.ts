import { describe, expect, test } from "bun:test";
import type { UpstreamServerConfig } from "@/config/schema";
import {
  UpstreamCallSupervisor,
  UpstreamRuntimeSupervisor,
} from "@/runtime/supervisor";

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

describe("UpstreamRuntimeSupervisor", () => {
  test("reuses singleton runtime handles by upstream key", async () => {
    let created = 0;
    const supervisor = new UpstreamRuntimeSupervisor<{ id: number }>({
      createRuntime: async () => ({ id: ++created }),
    });

    const first = await supervisor.getRuntime("local", makeStdioConfig());
    const second = await supervisor.getRuntime("local", makeStdioConfig());

    expect(first).toBe(second);
    expect(first.id).toBe(1);
    expect(created).toBe(1);
  });

  test("creates a fresh runtime handle for ephemeral upstreams", async () => {
    let created = 0;
    const supervisor = new UpstreamRuntimeSupervisor<{ id: number }>({
      createRuntime: async () => ({ id: ++created }),
    });
    const config = makeStdioConfig({ lifecycle: "ephemeral" });

    const first = await supervisor.getRuntime("local", config);
    const second = await supervisor.getRuntime("local", config);

    expect(first).not.toBe(second);
    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
  });

  test("disposes retained runtime handles", async () => {
    const disposed: number[] = [];
    const supervisor = new UpstreamRuntimeSupervisor<{ id: number }>({
      createRuntime: async () => ({ id: 1 }),
      disposeRuntime: async (runtime) => {
        disposed.push(runtime.id);
      },
    });

    await supervisor.getRuntime("local", makeStdioConfig());
    await supervisor.dispose("local");

    expect(disposed).toEqual([1]);
  });
});

describe("UpstreamCallSupervisor", () => {
  test("stdio upstreams remain globally exclusive by default", async () => {
    const supervisor = new UpstreamCallSupervisor();
    const releaseFirst = deferred();
    const order: string[] = [];
    const config = makeStdioConfig();

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

  test("session-affine calls only serialize within the same session", async () => {
    const supervisor = new UpstreamCallSupervisor();
    const releaseFirst = deferred();
    const order: string[] = [];
    const config = makeSseConfig({ concurrency: "session_affine" });

    const first = supervisor.run(
      "remote",
      config,
      async () => {
        order.push("session-a:first:start");
        await releaseFirst.promise;
        order.push("session-a:first:end");
        return "first";
      },
      { sessionId: "session-a" },
    );
    await Bun.sleep(0);

    const sameSession = supervisor.run(
      "remote",
      config,
      async () => {
        order.push("session-a:second:start");
        return "same";
      },
      { sessionId: "session-a" },
    );
    const differentSession = supervisor.run(
      "remote",
      config,
      async () => {
        order.push("session-b:start");
        return "different";
      },
      { sessionId: "session-b" },
    );
    await Bun.sleep(0);

    expect(order).toEqual(["session-a:first:start", "session-b:start"]);

    releaseFirst.resolve();
    expect(await Promise.all([first, sameSession, differentSession])).toEqual([
      "first",
      "same",
      "different",
    ]);
    expect(order).toEqual([
      "session-a:first:start",
      "session-b:start",
      "session-a:first:end",
      "session-a:second:start",
    ]);
  });

  test("session-affine calls serialize by agent identity when session id is absent", async () => {
    const supervisor = new UpstreamCallSupervisor();
    const releaseFirst = deferred();
    const order: string[] = [];
    const config = makeSseConfig({ concurrency: "session_affine" });

    const first = supervisor.run(
      "remote",
      config,
      async () => {
        order.push("agent-a:first:start");
        await releaseFirst.promise;
        order.push("agent-a:first:end");
        return "first";
      },
      { agentId: "agent-a" },
    );
    await Bun.sleep(0);

    const sameAgent = supervisor.run(
      "remote",
      config,
      async () => {
        order.push("agent-a:second:start");
        return "same-agent";
      },
      { agentId: "agent-a" },
    );
    const differentAgent = supervisor.run(
      "remote",
      config,
      async () => {
        order.push("agent-b:start");
        return "different-agent";
      },
      { agentId: "agent-b" },
    );
    await Bun.sleep(0);

    expect(order).toEqual(["agent-a:first:start", "agent-b:start"]);

    releaseFirst.resolve();
    expect(await Promise.all([first, sameAgent, differentAgent])).toEqual([
      "first",
      "same-agent",
      "different-agent",
    ]);
    expect(order).toEqual([
      "agent-a:first:start",
      "agent-b:start",
      "agent-a:first:end",
      "agent-a:second:start",
    ]);
  });

  test("session-affine remote calls without identity remain parallel", async () => {
    const supervisor = new UpstreamCallSupervisor();
    const releaseBoth = deferred();
    const order: string[] = [];
    const config = makeSseConfig({ concurrency: "session_affine" });

    const first = supervisor.run("remote", config, async () => {
      order.push("first:start");
      await releaseBoth.promise;
      order.push("first:end");
      return "first";
    });
    const second = supervisor.run("remote", config, async () => {
      order.push("second:start");
      await releaseBoth.promise;
      order.push("second:end");
      return "second";
    });
    await Bun.sleep(0);

    expect(order).toEqual(["first:start", "second:start"]);

    releaseBoth.resolve();
    expect(await Promise.all([first, second])).toEqual(["first", "second"]);
    expect(order).toEqual([
      "first:start",
      "second:start",
      "first:end",
      "second:end",
    ]);
  });
});
