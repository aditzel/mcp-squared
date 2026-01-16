import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkForRunningInstance,
  deletePidFile,
  readPidFile,
  writePidFile,
} from "@/config/pid";
import { MonitorServer } from "@/server/monitor-server";
import { StatsCollector } from "@/server/stats";
import { MonitorClient } from "@/tui/monitor-client";

const UDS_SUPPORTED = await new Promise<boolean>((resolve) => {
  const testPath = join(
    tmpdir(),
    `mcp-squared-uds-capability-${Date.now()}.sock`,
  );
  const server = createServer();
  server.once("error", () => resolve(false));
  server.listen(testPath, () => {
    server.close(() => {
      try {
        rmSync(testPath, { force: true });
      } catch {}
      resolve(true);
    });
  });
});
if (!UDS_SUPPORTED) {
  test.skip("Monitor System Integration (UDS listen unsupported in this environment)", () => {});
} else {
  describe("Monitor System Integration", () => {
    let tempDir: string;
    let socketPath: string;
    let pidPath: string;
    let statsCollector: StatsCollector;
    let monitorServer: MonitorServer;

    beforeEach(() => {
      // Use a shorter temp directory name to avoid socket path length issues
      tempDir = join(tmpdir(), `mcp-test-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      socketPath = join(tempDir, "monitor.sock");
      pidPath = join(tempDir, "server.pid");
      statsCollector = new StatsCollector({ enableToolTracking: true });
      monitorServer = new MonitorServer({
        socketPath,
        statsCollector,
      });
    });

    afterEach(async () => {
      if (monitorServer.isServerRunning()) {
        await monitorServer.stop();
      }
      deletePidFile(pidPath);
      rmSync(tempDir, { recursive: true, force: true });
    });

    describe("complete workflow", () => {
      test("start server → PID file created → Socket server started", async () => {
        // Write PID file
        const pid = writePidFile(pidPath);
        expect(pid).toBe(process.pid);
        expect(readPidFile(pidPath)).toBe(process.pid);

        // Start monitor server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(monitorServer.isServerRunning()).toBe(true);

        // Verify socket file exists
        expect(existsSync(socketPath)).toBe(true);
      });

      test("launch monitor → Connect to socket → Display stats", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Add some stats
        const id1 = statsCollector.startRequest();
        const id2 = statsCollector.startRequest();
        statsCollector.endRequest(id1, true, 100);
        statsCollector.endRequest(id2, false, 50);

        // Connect client
        const client = new MonitorClient({ socketPath });
        await client.connect();
        expect(client.isClientConnected()).toBe(true);

        // Get stats
        const stats = await client.getStats();
        expect(stats.requests.total).toBe(2);
        expect(stats.requests.successful).toBe(1);
        expect(stats.requests.failed).toBe(1);

        // Ping server
        const pong = await client.ping();
        expect(pong.message).toBe("pong");

        // Get tools
        const tools = await client.getTools();
        expect(Array.isArray(tools)).toBe(true);

        client.disconnect();
      });

      test("stop server → PID file deleted → Socket server stopped", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));
        writePidFile(pidPath);

        // Verify everything is running
        expect(monitorServer.isServerRunning()).toBe(true);
        expect(readPidFile(pidPath)).toBe(process.pid);
        expect(existsSync(socketPath)).toBe(true);

        // Stop server
        await monitorServer.stop();
        deletePidFile(pidPath);

        // Verify cleanup
        expect(monitorServer.isServerRunning()).toBe(false);
        expect(readPidFile(pidPath)).toBeNull();
        expect(existsSync(socketPath)).toBe(false);
      });
    });

    describe("edge cases", () => {
      test("server not running when monitor is launched", async () => {
        // Don't start server
        expect(monitorServer.isServerRunning()).toBe(false);

        // Try to connect client
        const client = new MonitorClient({ socketPath });
        await expect(client.connect()).rejects.toThrow();
      });

      test("socket connection failures are handled gracefully", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Try to connect to non-existent socket
        const client = new MonitorClient({
          socketPath: join(tempDir, "non-existent.sock"),
        });
        await expect(client.connect()).rejects.toThrow();
      });

      test("multiple monitor connections", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Create multiple clients
        const clients = await Promise.all(
          Array.from(
            { length: 5 },
            () =>
              new Promise<MonitorClient>((resolve, reject) => {
                const client = new MonitorClient({ socketPath });
                client
                  .connect()
                  .then(() => resolve(client))
                  .catch(reject);
              }),
          ),
        );

        // All clients should be connected
        expect(clients.every((c) => c.isClientConnected())).toBe(true);

        // All clients should be able to get stats
        const statsPromises = clients.map((c) => c.getStats());
        const statsResults = await Promise.all(statsPromises);
        expect(statsResults.every((s) => s !== undefined)).toBe(true);

        // Disconnect all clients
        for (const client of clients) {
          client.disconnect();
        }
        // Wait for disconnect to complete
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(clients.every((c) => !c.isClientConnected())).toBe(true);
      });

      test("PID file cleanup on crash", async () => {
        // Write PID file
        writePidFile(pidPath);
        expect(readPidFile(pidPath)).toBe(process.pid);

        // Simulate crash by not stopping server properly
        // (In real scenario, process would crash here)

        // Check for running instance should detect stale PID
        // Since current process is still running, it will return the PID
        const runningPid = checkForRunningInstance(pidPath);
        expect(runningPid).toBe(process.pid);

        // If we had a different PID, it would clean up
        // For testing, we can simulate this by writing a fake PID
        writeFileSync(pidPath, "9999999");
        const stalePid = checkForRunningInstance(pidPath);
        expect(stalePid).toBeNull();
        expect(readPidFile(pidPath)).toBeNull();
      });
    });

    describe("stats collection and retrieval", () => {
      test("comprehensive stats tracking", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Add various stats
        const id1 = statsCollector.startRequest();
        const id2 = statsCollector.startRequest();
        const id3 = statsCollector.startRequest();
        const id4 = statsCollector.startRequest();
        const id5 = statsCollector.startRequest();

        statsCollector.endRequest(id1, true, 50, "tool_a", "server_1");
        statsCollector.endRequest(id2, true, 100, "tool_a", "server_1");
        statsCollector.endRequest(id3, false, 75, "tool_b", "server_1");
        statsCollector.endRequest(id4, true, 150, "tool_c", "server_2");
        statsCollector.endRequest(id5, true, 200, "tool_a", "server_1");

        statsCollector.incrementActiveConnections();
        statsCollector.incrementActiveConnections();
        statsCollector.recordCacheHit();
        statsCollector.recordCacheHit();
        statsCollector.recordCacheMiss();
        statsCollector.updateCacheSize(100);
        statsCollector.updateIndexRefreshTime(Date.now());

        // Connect client and get stats
        const client = new MonitorClient({ socketPath });
        await client.connect();

        const stats = await client.getStats();
        expect(stats.requests.total).toBe(5);
        expect(stats.requests.successful).toBe(4);
        expect(stats.requests.failed).toBe(1);
        expect(stats.activeConnections).toBe(2);
        expect(stats.cache.hits).toBe(2);
        expect(stats.cache.misses).toBe(1);
        expect(stats.cache.size).toBe(100);
        expect(stats.index.lastRefreshTime).toBeGreaterThan(0);

        // Get tool stats
        const tools = await client.getTools();
        expect(tools.length).toBeGreaterThan(0);

        const toolA = tools.find((t) => t.name === "tool_a");
        expect(toolA?.callCount).toBe(3);
        expect(toolA?.successCount).toBe(3);
        expect(toolA?.failureCount).toBe(0);

        client.disconnect();
      });

      test("stats update in real-time", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Connect client
        const client = new MonitorClient({ socketPath });
        await client.connect();

        // Get initial stats
        const stats1 = await client.getStats();
        expect(stats1.requests.total).toBe(0);

        // Add more stats
        const id = statsCollector.startRequest();
        statsCollector.endRequest(id, true, 100);

        // Get updated stats
        const stats2 = await client.getStats();
        expect(stats2.requests.total).toBe(1);

        client.disconnect();
      });
    });

    describe("concurrent operations", () => {
      test("handles concurrent client requests", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Add some stats
        for (let i = 0; i < 10; i++) {
          const id = statsCollector.startRequest();
          statsCollector.endRequest(id, true, 100);
        }

        // Create multiple clients
        const clients = await Promise.all(
          Array.from(
            { length: 3 },
            () =>
              new Promise<MonitorClient>((resolve, reject) => {
                const client = new MonitorClient({ socketPath });
                client
                  .connect()
                  .then(() => resolve(client))
                  .catch(reject);
              }),
          ),
        );

        // All clients make concurrent requests
        const requests = clients.flatMap((client) => [
          client.getStats(),
          client.ping(),
          client.getTools(5),
        ]);

        const results = await Promise.all(requests);
        expect(results.length).toBe(9);

        // Disconnect all clients
        for (const client of clients) {
          client.disconnect();
        }
      });

      test("handles rapid stats updates", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Connect client
        const client = new MonitorClient({ socketPath });
        await client.connect();

        // Rapidly update stats
        const updatePromises = Array.from({ length: 20 }, (_, i) => {
          const id = statsCollector.startRequest();
          statsCollector.endRequest(id, i % 2 === 0, 50 + i * 10);
          return client.getStats();
        });

        const results = await Promise.all(updatePromises);
        expect(results.length).toBe(20);

        // Verify stats are increasing
        for (let i = 1; i < results.length; i++) {
          expect(results[i]?.requests.total).toBeGreaterThanOrEqual(
            results[i - 1]?.requests.total ?? 0,
          );
        }

        client.disconnect();
      });
    });

    describe("error recovery", () => {
      test("recovers from temporary connection loss", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Connect client
        const client = new MonitorClient({ socketPath });
        await client.connect();

        // Get initial stats
        const stats1 = await client.getStats();
        expect(stats1).toBeDefined();

        // Disconnect client
        client.disconnect();
        expect(client.isClientConnected()).toBe(false);

        // Reconnect
        await client.connect();
        expect(client.isClientConnected()).toBe(true);

        // Get stats again
        const stats2 = await client.getStats();
        expect(stats2).toBeDefined();

        client.disconnect();
      });

      test("handles server restart", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Connect client
        const client = new MonitorClient({ socketPath });
        await client.connect();

        // Get initial stats
        const stats1 = await client.getStats();
        expect(stats1).toBeDefined();

        // Stop server
        await monitorServer.stop();

        // Wait for client to detect disconnection
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Client should be disconnected
        expect(client.isClientConnected()).toBe(false);

        // Restart server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Reconnect client
        await client.connect();
        expect(client.isClientConnected()).toBe(true);

        // Get stats again
        const stats2 = await client.getStats();
        expect(stats2).toBeDefined();

        client.disconnect();
        await monitorServer.stop();
      });
    });

    describe("resource cleanup", () => {
      test("cleans up all resources on shutdown", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));
        writePidFile(pidPath);

        // Verify resources exist
        expect(monitorServer.isServerRunning()).toBe(true);
        expect(readPidFile(pidPath)).toBe(process.pid);
        expect(existsSync(socketPath)).toBe(true);

        // Stop server and delete PID
        await monitorServer.stop();
        deletePidFile(pidPath);

        // Verify cleanup
        expect(monitorServer.isServerRunning()).toBe(false);
        expect(readPidFile(pidPath)).toBeNull();
        expect(existsSync(socketPath)).toBe(false);
      });

      test("handles cleanup errors gracefully", async () => {
        // Start server
        await monitorServer.start();
        // Wait for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Manually remove socket file
        await Bun.file(socketPath).delete();

        // Stop should not throw
        try {
          await monitorServer.stop();
          // If we reach here, no error was thrown
          expect(true).toBe(true);
        } catch (error) {
          // If an error was thrown, fail the test
          expect(false).toBe(true);
        }

        // Delete non-existent PID file should return true
        const deleteResult = deletePidFile(join(tempDir, "non-existent.pid"));
        expect(deleteResult).toBe(true);
      });
    });
  });
}
