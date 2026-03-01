import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEFAULT_CONFIG } from "@/config/schema";
import { computeConfigHash } from "@/daemon/config-hash";
import { createProxyBridge } from "@/daemon/proxy";
import { deleteDaemonRegistry, writeDaemonRegistry } from "@/daemon/registry";
import { DaemonServer } from "@/daemon/server";
import { McpSquaredServer } from "@/server";
import { withTempConfigHome } from "./helpers/config-home";

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
        expect(toolNames).toContain("find_tools");
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
        expect(toolNames).toContain("find_tools");
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
        expect(toolNames).toContain("find_tools");
      } finally {
        await client.close().catch(() => {});
        await bridge.stop().catch(() => {});
        await daemon.stop().catch(() => {});
      }
    });
  });
}
