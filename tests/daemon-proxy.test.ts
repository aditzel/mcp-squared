import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { DEFAULT_CONFIG } from "@/config/schema";
import { computeConfigHash } from "@/daemon/config-hash";
import { createProxyBridge } from "@/daemon/proxy";
import { deleteDaemonRegistry, writeDaemonRegistry } from "@/daemon/registry";
import { DaemonServer } from "@/daemon/server";
import { SocketClientTransport } from "@/daemon/transport";
import { McpSquaredServer } from "@/server";
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
