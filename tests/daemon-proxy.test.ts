import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { DEFAULT_CONFIG } from "@/config/schema";
import { computeConfigHash } from "@/daemon/config-hash";
import { createProxyBridge } from "@/daemon/proxy";
import {
  deleteDaemonRegistry,
  readDaemonRegistry,
  writeDaemonRegistry,
} from "@/daemon/registry";
import { DaemonServer } from "@/daemon/server";
import { SocketClientTransport } from "@/daemon/transport";
import { McpSquaredServer } from "@/server";
import { MonitorClient } from "@/tui/monitor-client";
import { withTempConfigHome } from "./helpers/config-home";

function mockCapabilitySurface(runtime: McpSquaredServer): void {
  const cataloger = runtime.getCataloger();
  spyOn(cataloger, "getStatus").mockReturnValue(
    new Map([["time", { status: "connected", error: undefined }]]),
  );
  spyOn(cataloger, "getToolsForServer").mockImplementation((key: string) => {
    if (key === "time") {
      return [
        {
          name: "convert_time",
          description: "Convert time values",
          serverKey: "time",
          inputSchema: { type: "object" },
        },
      ];
    }
    return [];
  });
}

function parseToolPayload(result: unknown): Record<string, unknown> {
  const content =
    typeof result === "object" && result !== null && "content" in result
      ? (result as { content?: Array<{ type?: string; text?: string }> })
          .content
      : undefined;
  const text = content?.[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

async function waitFor<T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await producer();
      if (predicate(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error("Timed out waiting for condition");
}

const SOCKET_LISTEN_SUPPORTED = await new Promise<boolean>((resolve) => {
  const server = createServer();
  server.once("error", () => resolve(false));
  server.listen({ host: "127.0.0.1", port: 0 }, () => {
    server.close(() => resolve(true));
  });
});

if (!SOCKET_LISTEN_SUPPORTED) {
  test.skip("Daemon proxy bridge (socket listen unsupported)", () => {});
} else {
  describe.serial("daemon proxy bridge", () => {
    let restoreEnv: () => void;

    beforeEach(async () => {
      const ctx = await withTempConfigHome();
      restoreEnv = ctx.restore;
    });

    afterEach(() => {
      restoreEnv();
    });

    test("forwards MCP traffic through the proxy bridge", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(runtime);
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await daemon.start();

      const [clientTransport, proxyTransport] =
        InMemoryTransport.createLinkedPair();

      const bridge = await createProxyBridge({
        stdioTransport: proxyTransport,
        endpoint: daemon.getSocketPath(),
        heartbeatIntervalMs: 50,
      });

      const client = new Client({
        name: "proxy-test",
        version: "0.0.0",
      });

      try {
        await client.connect(clientTransport);
        const { tools } = await client.listTools();
        const toolNames = tools.map((tool) => tool.name);
        expect(toolNames).toContain("time_util");
        expect(toolNames).not.toContain("find_tools");
      } finally {
        await client.close().catch(() => {});
        await bridge.stop().catch(() => {});
        await daemon.stop().catch(() => {});
      }
    });

    test("uses shared secret from daemon registry when auto-discovering endpoint", async () => {
      const configHash = computeConfigHash(DEFAULT_CONFIG);
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(runtime);
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        sharedSecret: "registry-secret",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await daemon.start();

      const [clientTransport, proxyTransport] =
        InMemoryTransport.createLinkedPair();

      const bridge = await createProxyBridge({
        stdioTransport: proxyTransport,
        configHash,
        noSpawn: true,
        heartbeatIntervalMs: 50,
      });

      const client = new Client({
        name: "proxy-test-registry-secret",
        version: "0.0.0",
      });

      try {
        await client.connect(clientTransport);
        const { tools } = await client.listTools();
        const toolNames = tools.map((tool) => tool.name);
        expect(toolNames).toContain("time_util");
        expect(toolNames).not.toContain("find_tools");
      } finally {
        await client.close().catch(() => {});
        await bridge.stop().catch(() => {});
        await daemon.stop().catch(() => {});
      }
    });

    test("passes shared secret into daemon auto-spawn path", async () => {
      const configHash = computeConfigHash(DEFAULT_CONFIG);
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(runtime);
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        sharedSecret: "spawn-secret",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });
      await daemon.start();

      deleteDaemonRegistry(configHash);

      let spawnedSecret: string | undefined;
      const [clientTransport, proxyTransport] =
        InMemoryTransport.createLinkedPair();
      const bridge = await createProxyBridge({
        stdioTransport: proxyTransport,
        configHash,
        sharedSecret: "spawn-secret",
        heartbeatIntervalMs: 50,
        spawnDaemon: (secret) => {
          spawnedSecret = secret;
          writeDaemonRegistry({
            daemonId: "spawn-test-daemon",
            endpoint: daemon.getSocketPath(),
            pid: process.pid,
            startedAt: Date.now(),
            configHash,
            ...(secret ? { sharedSecret: secret } : {}),
          });
        },
      });

      const client = new Client({
        name: "proxy-test-spawn-secret",
        version: "0.0.0",
      });

      try {
        await client.connect(clientTransport);
        const { tools } = await client.listTools();
        const toolNames = tools.map((tool) => tool.name);
        expect(spawnedSecret).toBe("spawn-secret");
        expect(toolNames).toContain("time_util");
        expect(toolNames).not.toContain("find_tools");
      } finally {
        await client.close().catch(() => {});
        await bridge.stop().catch(() => {});
        await daemon.stop().catch(() => {});
      }
    });

    test("long-lived proxy clients observe refreshed capability routing", async () => {
      const config = {
        ...DEFAULT_CONFIG,
        security: {
          tools: {
            allow: ["code_search:*"],
            block: [],
            confirm: [],
          },
        },
      };
      const runtime = new McpSquaredServer({
        config,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const cataloger = runtime.getCataloger();
      let phase: "initial" | "updated" = "initial";

      spyOn(cataloger, "getStatus").mockReturnValue(
        new Map([["dynamic", { status: "connected", error: undefined }]]),
      );
      spyOn(cataloger, "getToolsForServer").mockImplementation(() => {
        if (phase === "initial") {
          return [
            {
              name: "codebase-retrieval",
              description: "Search source code",
              serverKey: "dynamic",
              inputSchema: { type: "object" },
            },
          ];
        }
        return [
          {
            name: "symbol-search",
            description: "Search symbols",
            serverKey: "dynamic",
            inputSchema: { type: "object" },
          },
        ];
      });

      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await daemon.start();

      const [clientTransport, proxyTransport] =
        InMemoryTransport.createLinkedPair();
      const bridge = await createProxyBridge({
        stdioTransport: proxyTransport,
        endpoint: daemon.getSocketPath(),
        heartbeatIntervalMs: 50,
      });

      const client = new Client({
        name: "proxy-test-routing-refresh",
        version: "0.0.0",
      });

      try {
        await client.connect(clientTransport);
        const initial = parseToolPayload(
          await client.callTool({
            name: "code_search",
            arguments: {
              action: "__describe_actions",
              arguments: {},
            },
          }),
        );
        expect(initial["actions"]).toEqual([
          {
            action: "codebase_retrieval",
            summary: "Search source code",
            inputSchema: { type: "object" },
            requiresConfirmation: false,
          },
        ]);

        phase = "updated";

        const refreshed = parseToolPayload(
          await client.callTool({
            name: "code_search",
            arguments: {
              action: "__describe_actions",
              arguments: {},
            },
          }),
        );
        expect(refreshed["actions"]).toEqual([
          {
            action: "symbol_search",
            summary: "Search symbols",
            inputSchema: { type: "object" },
            requiresConfirmation: false,
          },
        ]);
      } finally {
        await client.close().catch(() => {});
        await bridge.stop().catch(() => {});
        await daemon.stop().catch(() => {});
      }
    });

    test("reconnects active proxy clients after daemon restart", async () => {
      const configHash = computeConfigHash(DEFAULT_CONFIG);
      const firstRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(firstRuntime);

      const firstDaemon = new DaemonServer({
        runtime: firstRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await firstDaemon.start();

      const [clientTransport, proxyTransport] =
        InMemoryTransport.createLinkedPair();
      const bridge = await createProxyBridge({
        stdioTransport: proxyTransport,
        configHash,
        heartbeatIntervalMs: 50,
      });

      const client = new Client({
        name: "proxy-test-daemon-restart",
        version: "0.0.0",
      });

      const secondRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(secondRuntime);

      const secondDaemon = new DaemonServer({
        runtime: secondRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      try {
        await client.connect(clientTransport);
        const initialTools = (await client.listTools()).tools.map(
          (tool) => tool.name,
        );
        expect(initialTools).toContain("time_util");

        await firstDaemon.stop();
        await secondDaemon.start();
        await new Promise((resolve) => setTimeout(resolve, 250));

        const recoveredTools = (await client.listTools()).tools.map(
          (tool) => tool.name,
        );
        expect(recoveredTools).toContain("time_util");
      } finally {
        await client.close().catch(() => {});
        await bridge.stop().catch(() => {});
        await firstDaemon.stop().catch(() => {});
        await secondDaemon.stop().catch(() => {});
      }
    });

    test("retries transient reconnect failures after daemon restart", async () => {
      const configHash = computeConfigHash(DEFAULT_CONFIG);
      const firstRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(firstRuntime);

      const firstDaemon = new DaemonServer({
        runtime: firstRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await firstDaemon.start();

      const [clientTransport, proxyTransport] =
        InMemoryTransport.createLinkedPair();
      const bridge = await createProxyBridge({
        stdioTransport: proxyTransport,
        configHash,
        heartbeatIntervalMs: 50,
      });

      const client = new Client({
        name: "proxy-test-daemon-restart-retry",
        version: "0.0.0",
      });

      const secondRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(secondRuntime);

      const secondDaemon = new DaemonServer({
        runtime: secondRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      const originalStart = SocketClientTransport.prototype.start;
      let startCalls = 0;
      const startSpy = spyOn(
        SocketClientTransport.prototype,
        "start",
      ).mockImplementation(function (
        this: SocketClientTransport,
      ): Promise<void> {
        startCalls += 1;
        if (startCalls === 1) {
          return Promise.reject(new Error("Transient reconnect failure"));
        }
        return originalStart.call(this);
      });

      try {
        await client.connect(clientTransport);
        const initialTools = (await client.listTools()).tools.map(
          (tool) => tool.name,
        );
        expect(initialTools).toContain("time_util");

        await firstDaemon.stop();
        await secondDaemon.start();

        const recoveredTools = await waitFor(
          async () => {
            const { tools } = await Promise.race([
              client.listTools(),
              new Promise<never>((_, reject) => {
                setTimeout(
                  () => reject(new Error("Timed out waiting for tools")),
                  150,
                );
              }),
            ]);
            return tools.map((tool) => tool.name);
          },
          (toolNames) => toolNames.includes("time_util") && startCalls >= 2,
          3000,
        );
        expect(recoveredTools).toContain("time_util");
        expect(startCalls).toBeGreaterThanOrEqual(2);
      } finally {
        startSpy.mockRestore();
        await client.close().catch(() => {});
        await bridge.stop().catch(() => {});
        await firstDaemon.stop().catch(() => {});
        await secondDaemon.stop().catch(() => {});
      }
    });

    test("deduplicates concurrent replacement-daemon spawn attempts across active proxy clients", async () => {
      const configHash = computeConfigHash(DEFAULT_CONFIG);
      const firstRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(firstRuntime);

      const firstDaemon = new DaemonServer({
        runtime: firstRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await firstDaemon.start();

      const [, firstProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, secondProxyTransport] = InMemoryTransport.createLinkedPair();

      const secondRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(secondRuntime);

      const replacementDaemon = new DaemonServer({
        runtime: secondRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      let spawnCalls = 0;
      let replacementStartPromise: Promise<void> | null = null;
      const spawnReplacementDaemon = (): void => {
        spawnCalls += 1;
        if (!replacementStartPromise) {
          replacementStartPromise = replacementDaemon.start();
        }
      };

      process.env["MCP_CLIENT_NAME"] = "proxy-concurrent-recovery-1";
      const firstBridge = await createProxyBridge({
        stdioTransport: firstProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-concurrent-recovery-2";
      const secondBridge = await createProxyBridge({
        stdioTransport: secondProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });

      try {
        await waitFor(
          async () => firstDaemon.getSessionCount(),
          (sessionCount) => sessionCount === 2,
          1000,
        );

        await firstDaemon.stop();

        await waitFor(
          async () => {
            await replacementStartPromise;
            return {
              sessionCount: replacementDaemon.getSessionCount(),
              spawnCalls,
            };
          },
          ({ sessionCount, spawnCalls: attempts }) =>
            attempts >= 1 && sessionCount === 2,
          3000,
        );

        expect(replacementDaemon.getSessionCount()).toBe(2);
        expect(spawnCalls).toBe(1);
      } finally {
        await firstBridge.stop().catch(() => {});
        await secondBridge.stop().catch(() => {});
        await firstDaemon.stop().catch(() => {});
        await replacementDaemon.stop().catch(() => {});
      }
    });

    test("recovers three active proxy bridges onto one replacement daemon during restart flapping", async () => {
      const configHash = computeConfigHash(DEFAULT_CONFIG);
      const firstRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(firstRuntime);

      const firstDaemon = new DaemonServer({
        runtime: firstRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await firstDaemon.start();

      const [, firstProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, secondProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, thirdProxyTransport] = InMemoryTransport.createLinkedPair();

      const secondRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(secondRuntime);

      const replacementDaemon = new DaemonServer({
        runtime: secondRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      let spawnCalls = 0;
      let replacementStartPromise: Promise<void> | null = null;
      const spawnReplacementDaemon = (): void => {
        spawnCalls += 1;
        if (!replacementStartPromise) {
          replacementStartPromise = replacementDaemon.start();
        }
      };

      process.env["MCP_CLIENT_NAME"] = "proxy-three-client-recovery-1";
      const firstBridge = await createProxyBridge({
        stdioTransport: firstProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-three-client-recovery-2";
      const secondBridge = await createProxyBridge({
        stdioTransport: secondProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-three-client-recovery-3";
      const thirdBridge = await createProxyBridge({
        stdioTransport: thirdProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });

      try {
        await waitFor(
          async () => firstDaemon.getSessionCount(),
          (sessionCount) => sessionCount === 3,
          1000,
        );

        await firstDaemon.stop();

        await waitFor(
          async () => {
            await replacementStartPromise;
            return {
              sessionCount: replacementDaemon.getSessionCount(),
              spawnCalls,
            };
          },
          ({ sessionCount, spawnCalls: attempts }) =>
            attempts >= 1 && sessionCount === 3,
          3000,
        );

        expect(replacementDaemon.getSessionCount()).toBe(3);
        expect(spawnCalls).toBe(1);
      } finally {
        await firstBridge.stop().catch(() => {});
        await secondBridge.stop().catch(() => {});
        await thirdBridge.stop().catch(() => {});
        await firstDaemon.stop().catch(() => {});
        await replacementDaemon.stop().catch(() => {});
      }
    });

    test("reattaches a monitor client after full daemon replacement while three proxy bridges recover", async () => {
      const configHash = computeConfigHash(DEFAULT_CONFIG);
      const firstRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(firstRuntime);

      const firstDaemon = new DaemonServer({
        runtime: firstRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await firstDaemon.start();

      const [, firstProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, secondProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, thirdProxyTransport] = InMemoryTransport.createLinkedPair();

      const firstMonitorClient = new MonitorClient({
        socketPath: firstRuntime.getMonitorSocketPath(),
      });
      await firstMonitorClient.connect();

      const secondRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(secondRuntime);

      const replacementDaemon = new DaemonServer({
        runtime: secondRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      let spawnCalls = 0;
      let replacementStartPromise: Promise<void> | null = null;
      const spawnReplacementDaemon = (): void => {
        spawnCalls += 1;
        if (!replacementStartPromise) {
          replacementStartPromise = replacementDaemon.start();
        }
      };

      process.env["MCP_CLIENT_NAME"] = "proxy-monitor-recovery-1";
      const firstBridge = await createProxyBridge({
        stdioTransport: firstProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-monitor-recovery-2";
      const secondBridge = await createProxyBridge({
        stdioTransport: secondProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-monitor-recovery-3";
      const thirdBridge = await createProxyBridge({
        stdioTransport: thirdProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });

      try {
        const initialClients = await waitFor(
          async () => firstMonitorClient.getClients(),
          (clients) =>
            clients.length === 3 && clients.some((client) => client.isOwner),
          2000,
        );
        const initialSessionIds = new Set(
          initialClients.map((client) => client.sessionId),
        );
        const initialOwner = initialClients.find((client) => client.isOwner);

        expect(initialOwner?.clientId).toStartWith("proxy-monitor-recovery-1-");

        await firstDaemon.stop();
        firstMonitorClient.disconnect();

        await waitFor(
          async () => {
            await replacementStartPromise;
            return replacementDaemon.getSessionCount();
          },
          (sessionCount) => sessionCount === 3,
          4000,
        );

        const replacementMonitorClient = new MonitorClient({
          socketPath: secondRuntime.getMonitorSocketPath(),
        });
        await replacementMonitorClient.connect();

        const recoveredClients = await waitFor(
          async () => replacementMonitorClient.getClients(),
          (clients) =>
            clients.length === 3 &&
            clients.some((client) => client.isOwner) &&
            clients.every((client) => !initialSessionIds.has(client.sessionId)),
          4000,
        );

        const recoveredOwner = recoveredClients.find(
          (client) => client.isOwner,
        );
        expect(replacementDaemon.getSessionCount()).toBe(3);
        expect(spawnCalls).toBe(1);
        expect(recoveredOwner?.clientId).toStartWith(
          "proxy-monitor-recovery-1-",
        );
        expect(
          recoveredClients.map((client) => client.clientId).sort(),
        ).toEqual([
          expect.stringMatching(/^proxy-monitor-recovery-1-/),
          expect.stringMatching(/^proxy-monitor-recovery-2-/),
          expect.stringMatching(/^proxy-monitor-recovery-3-/),
        ]);

        replacementMonitorClient.disconnect();
      } finally {
        await firstBridge.stop().catch(() => {});
        await secondBridge.stop().catch(() => {});
        await thirdBridge.stop().catch(() => {});
        await firstDaemon.stop().catch(() => {});
        await replacementDaemon.stop().catch(() => {});
      }
    });

    test("rebinds recovering proxy bridges only to the matching config identity during daemon replacement", async () => {
      const configHash = computeConfigHash(DEFAULT_CONFIG);
      const mismatchedConfigHash = `${configHash}-mismatch`;

      const firstRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(firstRuntime);

      const firstDaemon = new DaemonServer({
        runtime: firstRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await firstDaemon.start();

      const [, firstProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, secondProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, thirdProxyTransport] = InMemoryTransport.createLinkedPair();

      const firstMonitorClient = new MonitorClient({
        socketPath: firstRuntime.getMonitorSocketPath(),
      });
      await firstMonitorClient.connect();

      const mismatchedRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(mismatchedRuntime);

      const mismatchedDaemon = new DaemonServer({
        runtime: mismatchedRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash: mismatchedConfigHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      const replacementRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(replacementRuntime);

      const replacementDaemon = new DaemonServer({
        runtime: replacementRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      let spawnCalls = 0;
      let replacementStartPromise: Promise<void> | null = null;
      const spawnReplacementDaemon = (): void => {
        spawnCalls += 1;
        if (!replacementStartPromise) {
          replacementStartPromise = replacementDaemon.start();
        }
      };

      process.env["MCP_CLIENT_NAME"] = "proxy-config-recovery-1";
      const firstBridge = await createProxyBridge({
        stdioTransport: firstProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-config-recovery-2";
      const secondBridge = await createProxyBridge({
        stdioTransport: secondProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-config-recovery-3";
      const thirdBridge = await createProxyBridge({
        stdioTransport: thirdProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });

      try {
        const initialClients = await waitFor(
          async () => firstMonitorClient.getClients(),
          (clients) =>
            clients.length === 3 && clients.some((client) => client.isOwner),
          2000,
        );
        const initialSessionIds = new Set(
          initialClients.map((client) => client.sessionId),
        );
        expect(initialClients.some((client) => client.isOwner)).toBe(true);

        await firstDaemon.stop();
        await mismatchedDaemon.start();

        const mismatchedMonitorClient = new MonitorClient({
          socketPath: mismatchedRuntime.getMonitorSocketPath(),
        });
        await mismatchedMonitorClient.connect();

        await waitFor(
          async () => {
            await replacementStartPromise;
            return replacementDaemon.getSessionCount();
          },
          (sessionCount) => sessionCount === 3,
          4000,
        );

        const replacementMonitorClient = new MonitorClient({
          socketPath: replacementRuntime.getMonitorSocketPath(),
        });
        await replacementMonitorClient.connect();

        const recoveredClients = await waitFor(
          async () => replacementMonitorClient.getClients(),
          (clients) =>
            clients.length === 3 &&
            clients.some((client) => client.isOwner) &&
            clients.every((client) => !initialSessionIds.has(client.sessionId)),
          4000,
        );

        const mismatchedClients = await waitFor(
          async () => mismatchedMonitorClient.getClients(),
          (clients) => clients.length === 0,
          1000,
        );

        const recoveredOwner = recoveredClients.find(
          (client) => client.isOwner,
        );

        expect(spawnCalls).toBe(1);
        expect(replacementDaemon.getSessionCount()).toBe(3);
        expect(mismatchedDaemon.getSessionCount()).toBe(0);
        expect(mismatchedClients).toEqual([]);
        expect(recoveredOwner?.clientId).toMatch(
          /^proxy-config-recovery-[123]-/,
        );
        expect(
          recoveredClients.map((client) => client.clientId).sort(),
        ).toEqual([
          expect.stringMatching(/^proxy-config-recovery-1-/),
          expect.stringMatching(/^proxy-config-recovery-2-/),
          expect.stringMatching(/^proxy-config-recovery-3-/),
        ]);

        replacementMonitorClient.disconnect();
        mismatchedMonitorClient.disconnect();
      } finally {
        await firstBridge.stop().catch(() => {});
        await secondBridge.stop().catch(() => {});
        await thirdBridge.stop().catch(() => {});
        await firstDaemon.stop().catch(() => {});
        await mismatchedDaemon.stop().catch(() => {});
        await replacementDaemon.stop().catch(() => {});
      }
    });

    test("prunes a stale matching-config registry entry before rebinding proxies during daemon replacement", async () => {
      const configHash = computeConfigHash(DEFAULT_CONFIG);
      const mismatchedConfigHash = `${configHash}-mismatch`;

      const firstRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(firstRuntime);

      const firstDaemon = new DaemonServer({
        runtime: firstRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await firstDaemon.start();

      const [, firstProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, secondProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, thirdProxyTransport] = InMemoryTransport.createLinkedPair();

      const firstMonitorClient = new MonitorClient({
        socketPath: firstRuntime.getMonitorSocketPath(),
      });
      await firstMonitorClient.connect();

      const mismatchedRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(mismatchedRuntime);

      const mismatchedDaemon = new DaemonServer({
        runtime: mismatchedRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash: mismatchedConfigHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      const replacementRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(replacementRuntime);

      const replacementDaemon = new DaemonServer({
        runtime: replacementRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      let spawnCalls = 0;
      let replacementStartPromise: Promise<void> | null = null;
      const spawnReplacementDaemon = (): void => {
        spawnCalls += 1;
        if (!replacementStartPromise) {
          replacementStartPromise = replacementDaemon.start();
        }
      };

      process.env["MCP_CLIENT_NAME"] = "proxy-stale-registry-recovery-1";
      const firstBridge = await createProxyBridge({
        stdioTransport: firstProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-stale-registry-recovery-2";
      const secondBridge = await createProxyBridge({
        stdioTransport: secondProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-stale-registry-recovery-3";
      const thirdBridge = await createProxyBridge({
        stdioTransport: thirdProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });

      try {
        const initialClients = await waitFor(
          async () => firstMonitorClient.getClients(),
          (clients) =>
            clients.length === 3 && clients.some((client) => client.isOwner),
          2000,
        );
        const initialSessionIds = new Set(
          initialClients.map((client) => client.sessionId),
        );
        const initialOwner = initialClients.find((client) => client.isOwner);

        expect(initialOwner?.clientId).toStartWith(
          "proxy-stale-registry-recovery-1-",
        );

        const staleMatchingEntry = {
          daemonId: "stale-matching-daemon",
          endpoint: firstDaemon.getSocketPath(),
          pid: 999999,
          startedAt: Date.now() - 1000,
          configHash,
        };

        await firstDaemon.stop();
        writeDaemonRegistry(staleMatchingEntry);
        await mismatchedDaemon.start();

        const mismatchedMonitorClient = new MonitorClient({
          socketPath: mismatchedRuntime.getMonitorSocketPath(),
        });
        await mismatchedMonitorClient.connect();

        await waitFor(
          async () => {
            await replacementStartPromise;
            return replacementDaemon.getSessionCount();
          },
          (sessionCount) => sessionCount === 3,
          4000,
        );

        const replacementMonitorClient = new MonitorClient({
          socketPath: replacementRuntime.getMonitorSocketPath(),
        });
        await replacementMonitorClient.connect();

        const recoveredClients = await waitFor(
          async () => replacementMonitorClient.getClients(),
          (clients) =>
            clients.length === 3 &&
            clients.some((client) => client.isOwner) &&
            clients.every((client) => !initialSessionIds.has(client.sessionId)),
          4000,
        );

        const mismatchedClients = await waitFor(
          async () => mismatchedMonitorClient.getClients(),
          (clients) => clients.length === 0,
          1000,
        );

        const recoveredOwner = recoveredClients.find(
          (client) => client.isOwner,
        );

        expect(spawnCalls).toBe(1);
        expect(replacementDaemon.getSessionCount()).toBe(3);
        expect(mismatchedDaemon.getSessionCount()).toBe(0);
        expect(mismatchedClients).toEqual([]);
        expect(readDaemonRegistry(configHash)?.endpoint).toBe(
          replacementDaemon.getSocketPath(),
        );
        expect(readDaemonRegistry(mismatchedConfigHash)?.endpoint).toBe(
          mismatchedDaemon.getSocketPath(),
        );
        expect(recoveredOwner?.clientId).toStartWith(
          "proxy-stale-registry-recovery-1-",
        );
        expect(
          recoveredClients.map((client) => client.clientId).sort(),
        ).toEqual([
          expect.stringMatching(/^proxy-stale-registry-recovery-1-/),
          expect.stringMatching(/^proxy-stale-registry-recovery-2-/),
          expect.stringMatching(/^proxy-stale-registry-recovery-3-/),
        ]);

        replacementMonitorClient.disconnect();
        mismatchedMonitorClient.disconnect();
      } finally {
        await firstBridge.stop().catch(() => {});
        await secondBridge.stop().catch(() => {});
        await thirdBridge.stop().catch(() => {});
        await firstDaemon.stop().catch(() => {});
        await mismatchedDaemon.stop().catch(() => {});
        await replacementDaemon.stop().catch(() => {});
      }
    });

    test("converges on one fresh matching daemon when stale recovery triggers overlap during replacement", async () => {
      const configHash = computeConfigHash(DEFAULT_CONFIG);
      const mismatchedConfigHash = `${configHash}-mismatch`;

      const firstRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(firstRuntime);

      const firstDaemon = new DaemonServer({
        runtime: firstRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await firstDaemon.start();

      const [, firstProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, secondProxyTransport] = InMemoryTransport.createLinkedPair();
      const [, thirdProxyTransport] = InMemoryTransport.createLinkedPair();

      const firstMonitorClient = new MonitorClient({
        socketPath: firstRuntime.getMonitorSocketPath(),
      });
      await firstMonitorClient.connect();

      const mismatchedRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(mismatchedRuntime);

      const mismatchedDaemon = new DaemonServer({
        runtime: mismatchedRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash: mismatchedConfigHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      const replacementRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      mockCapabilitySurface(replacementRuntime);

      const replacementDaemon = new DaemonServer({
        runtime: replacementRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      let spawnCalls = 0;
      let replacementStartPromise: Promise<void> | null = null;
      const spawnReplacementDaemon = (): void => {
        spawnCalls += 1;
        if (!replacementStartPromise) {
          replacementStartPromise = replacementDaemon.start();
        }
      };

      process.env["MCP_CLIENT_NAME"] = "proxy-convergence-recovery-1";
      const firstBridge = await createProxyBridge({
        stdioTransport: firstProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-convergence-recovery-2";
      const secondBridge = await createProxyBridge({
        stdioTransport: secondProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });
      process.env["MCP_CLIENT_NAME"] = "proxy-convergence-recovery-3";
      const thirdBridge = await createProxyBridge({
        stdioTransport: thirdProxyTransport,
        endpoint: firstDaemon.getSocketPath(),
        configHash,
        heartbeatIntervalMs: 50,
        spawnDaemon: spawnReplacementDaemon,
      });

      try {
        const initialClients = await waitFor(
          async () => firstMonitorClient.getClients(),
          (clients) =>
            clients.length === 3 && clients.some((client) => client.isOwner),
          2000,
        );
        const initialSessionIds = new Set(
          initialClients.map((client) => client.sessionId),
        );

        await firstDaemon.stop();
        await mismatchedDaemon.start();

        writeDaemonRegistry({
          daemonId: "stale-convergence-daemon",
          endpoint: firstDaemon.getSocketPath(),
          pid: 999999,
          startedAt: Date.now() - 1000,
          configHash,
        });

        const mismatchedMonitorClient = new MonitorClient({
          socketPath: mismatchedRuntime.getMonitorSocketPath(),
        });
        await mismatchedMonitorClient.connect();

        await new Promise((resolve) => setTimeout(resolve, 25));
        void secondProxyTransport.send({
          jsonrpc: "2.0",
          id: "recovery-kick-2",
          method: "ping",
        });
        void thirdProxyTransport.send({
          jsonrpc: "2.0",
          id: "recovery-kick-3",
          method: "ping",
        });

        await waitFor(
          async () => {
            await replacementStartPromise;
            return replacementDaemon.getSessionCount();
          },
          (sessionCount) => sessionCount === 3,
          4000,
        );

        const replacementMonitorClient = new MonitorClient({
          socketPath: replacementRuntime.getMonitorSocketPath(),
        });
        await replacementMonitorClient.connect();

        const recoveredClients = await waitFor(
          async () => replacementMonitorClient.getClients(),
          (clients) =>
            clients.length === 3 &&
            clients.some((client) => client.isOwner) &&
            clients.every((client) => !initialSessionIds.has(client.sessionId)),
          4000,
        );

        const mismatchedClients = await waitFor(
          async () => mismatchedMonitorClient.getClients(),
          (clients) => clients.length === 0,
          1000,
        );

        expect(spawnCalls).toBe(1);
        expect(replacementDaemon.getSessionCount()).toBe(3);
        expect(mismatchedDaemon.getSessionCount()).toBe(0);
        expect(mismatchedClients).toEqual([]);
        expect(readDaemonRegistry(configHash)?.endpoint).toBe(
          replacementDaemon.getSocketPath(),
        );
        expect(readDaemonRegistry(mismatchedConfigHash)?.endpoint).toBe(
          mismatchedDaemon.getSocketPath(),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(readDaemonRegistry(configHash)?.endpoint).toBe(
          replacementDaemon.getSocketPath(),
        );
        expect(
          recoveredClients.map((client) => client.clientId).sort(),
        ).toEqual([
          expect.stringMatching(/^proxy-convergence-recovery-1-/),
          expect.stringMatching(/^proxy-convergence-recovery-2-/),
          expect.stringMatching(/^proxy-convergence-recovery-3-/),
        ]);

        replacementMonitorClient.disconnect();
        mismatchedMonitorClient.disconnect();
      } finally {
        await firstBridge.stop().catch(() => {});
        await secondBridge.stop().catch(() => {});
        await thirdBridge.stop().catch(() => {});
        await firstDaemon.stop().catch(() => {});
        await mismatchedDaemon.stop().catch(() => {});
        await replacementDaemon.stop().catch(() => {});
      }
    });

    test("serializes stdio shutdown when daemon close and bridge stop overlap", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 5000,
      });

      await daemon.start();

      let closeCalls = 0;
      let resolveClose: (() => void) | null = null;
      const stdioTransport: Transport = {
        close: async () => {
          closeCalls += 1;
          await new Promise<void>((resolve) => {
            resolveClose = () => {
              stdioTransport.onclose?.();
              resolve();
            };
          });
        },
        send: async () => {},
        start: async () => {},
      };

      const bridge = await createProxyBridge({
        stdioTransport,
        endpoint: daemon.getSocketPath(),
        heartbeatIntervalMs: 50,
      });

      try {
        const stopPromise = bridge.stop();
        await new Promise((resolve) => setTimeout(resolve, 25));

        expect(closeCalls).toBe(1);

        resolveClose?.();
        await stopPromise;
      } finally {
        resolveClose?.();
        await bridge.stop().catch(() => {});
        await daemon.stop().catch(() => {});
      }
    });
  });
}
