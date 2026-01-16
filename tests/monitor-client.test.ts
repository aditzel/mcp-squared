import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import {
  type AddressInfo,
  type Server,
  createServer,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatsCollector } from "@/server/stats";
import { MonitorClient } from "@/tui/monitor-client";

function isTcpEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("tcp://");
}

function parseTcpEndpoint(endpoint: string): { host: string; port: number } {
  const url = new URL(endpoint);
  if (url.protocol !== "tcp:") {
    throw new Error(`Invalid TCP endpoint protocol: ${url.protocol}`);
  }
  const host = url.hostname;
  const port = Number.parseInt(url.port, 10);
  if (!host || Number.isNaN(port)) {
    throw new Error(`Invalid TCP endpoint: ${endpoint}`);
  }
  return { host, port };
}

const SOCKET_LISTEN_SUPPORTED = await new Promise<boolean>((resolve) => {
  const server = createServer();
  server.once("error", () => resolve(false));
  server.listen({ host: "127.0.0.1", port: 0 }, () => {
    server.close(() => resolve(true));
  });
});

const UDS_SUPPORTED = SOCKET_LISTEN_SUPPORTED
  ? await new Promise<boolean>((resolve) => {
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
    })
  : false;

if (!SOCKET_LISTEN_SUPPORTED) {
  test.skip("MonitorClient (socket listen unsupported in this environment)", () => {});
} else {
  describe("MonitorClient", () => {
    let tempDir: string;
    let socketPath: string;
    let mockServer: Server | null = null;
    let statsCollector: StatsCollector;
    let monitorClient: MonitorClient;

    beforeEach(() => {
      tempDir = join(tmpdir(), `mcp-squared-client-test-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      socketPath = UDS_SUPPORTED
        ? join(tempDir, "monitor.sock")
        : "tcp://127.0.0.1:0";
      statsCollector = new StatsCollector();
      monitorClient = new MonitorClient({ socketPath });
    });

    afterEach(async () => {
      monitorClient.disconnect();
      if (mockServer) {
        await new Promise<void>((resolve) => {
          mockServer?.close(() => resolve());
        });
        mockServer = null;
      }
      rmSync(tempDir, { recursive: true, force: true });
    });

    /**
     * Helper to create a mock monitor server.
     */
    async function listenServer(server: Server): Promise<void> {
      if (isTcpEndpoint(socketPath)) {
        const { host, port } = parseTcpEndpoint(socketPath);
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen({ host, port }, () => resolve());
        });

        const address = server.address();
        if (address && typeof address !== "string") {
          const info = address as AddressInfo;
          socketPath = `tcp://${host}:${info.port}`;
          monitorClient = new MonitorClient({ socketPath });
        }
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => resolve());
      });
    }

    async function createMockServer(): Promise<Server> {
      const server = createServer((socket) => {
        socket.on("data", (data) => {
          const command = data.toString().trim();
          let response: string;

          if (command.startsWith("ping")) {
            response = JSON.stringify({
              status: "success",
              data: { message: "pong" },
              timestamp: Date.now(),
            });
          } else if (command.startsWith("stats")) {
            response = JSON.stringify({
              status: "success",
              data: statsCollector.getStats(),
              timestamp: Date.now(),
            });
          } else if (command.startsWith("tools")) {
            // Extract limit from command like "tools 10"
            const parts = command.split(" ");
            const limit = parts[1] ? Number.parseInt(parts[1], 10) : 100;
            response = JSON.stringify({
              status: "success",
              data: statsCollector.getToolStats(limit),
              timestamp: Date.now(),
            });
          } else {
            response = JSON.stringify({
              status: "error",
              error: `Unknown command: ${command}`,
              timestamp: Date.now(),
            });
          }

          socket.write(`${response}\n`);
        });
      });

      await listenServer(server);
      mockServer = server;
      return server;
    }

    describe("constructor", () => {
      test("creates client with default timeout", () => {
        const client = new MonitorClient({ socketPath });
        expect(client).toBeDefined();
        expect(client.getSocketPath()).toBe(socketPath);
      });

      test("creates client with custom timeout", () => {
        const client = new MonitorClient({ socketPath, timeout: 10000 });
        expect(client).toBeDefined();
      });
    });

    describe("connect", () => {
      test("connects to server successfully", async () => {
        await createMockServer();
        await monitorClient.connect();
        expect(monitorClient.isClientConnected()).toBe(true);
      });

      test("idempotent connect", async () => {
        await createMockServer();
        await monitorClient.connect();
        await monitorClient.connect(); // Should not throw
        expect(monitorClient.isClientConnected()).toBe(true);
      });

      test("throws error when server not running", async () => {
        await expect(monitorClient.connect()).rejects.toThrow(
          "Failed to connect to monitor server",
        );
      });
    });

    describe("disconnect", () => {
      test("disconnects from server", async () => {
        await createMockServer();
        await monitorClient.connect();
        expect(monitorClient.isClientConnected()).toBe(true);

        monitorClient.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(monitorClient.isClientConnected()).toBe(false);
      });

      test("idempotent disconnect", async () => {
        await createMockServer();
        await monitorClient.connect();
        monitorClient.disconnect();
        monitorClient.disconnect(); // Should not throw
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(monitorClient.isClientConnected()).toBe(false);
      });

      test("disconnects when not connected", () => {
        expect(() => monitorClient.disconnect()).not.toThrow();
      });
    });

    describe("ping", () => {
      test("sends ping and receives pong", async () => {
        await createMockServer();
        await monitorClient.connect();

        const response = await monitorClient.ping();
        expect(response.message).toBe("pong");
      });

      test("throws error when not connected", async () => {
        await expect(monitorClient.ping()).rejects.toThrow(
          "Not connected to monitor server",
        );
      });
    });

    describe("getStats", () => {
      test("retrieves server statistics", async () => {
        await createMockServer();
        await monitorClient.connect();

        // Add some stats
        const id = statsCollector.startRequest();
        statsCollector.endRequest(id, true, 100);

        const stats = await monitorClient.getStats();
        expect(stats).toBeDefined();
        expect(stats.requests.total).toBe(1);
        expect(stats.requests.successful).toBe(1);
      });

      test("throws error when not connected", async () => {
        await expect(monitorClient.getStats()).rejects.toThrow(
          "Not connected to monitor server",
        );
      });

      test("throws error on server error response", async () => {
        const server = createServer((socket) => {
          socket.once("data", () => {
            socket.write(
              `${JSON.stringify({
                status: "error",
                error: "Test error",
                timestamp: Date.now(),
              })}\n`,
            );
            socket.end();
          });
        });
        await listenServer(server);

        await monitorClient.connect();
        await expect(monitorClient.getStats()).rejects.toThrow("Test error");

        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      });
    });

    describe("getTools", () => {
      test("retrieves tool statistics with default limit", async () => {
        await createMockServer();
        await monitorClient.connect();

        const tools = await monitorClient.getTools();
        expect(Array.isArray(tools)).toBe(true);
      });

      test("retrieves tool statistics with custom limit", async () => {
        await createMockServer();
        await monitorClient.connect();

        const tools = await monitorClient.getTools(5);
        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBeLessThanOrEqual(5);
      });

      test("throws error when not connected", async () => {
        await expect(monitorClient.getTools()).rejects.toThrow(
          "Not connected to monitor server",
        );
      });
    });

    describe("isClientConnected", () => {
      test("returns false when not connected", () => {
        expect(monitorClient.isClientConnected()).toBe(false);
      });

      test("returns true when connected", async () => {
        await createMockServer();
        await monitorClient.connect();
        expect(monitorClient.isClientConnected()).toBe(true);
      });

      test("returns false after disconnect", async () => {
        await createMockServer();
        await monitorClient.connect();
        monitorClient.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(monitorClient.isClientConnected()).toBe(false);
      });
    });

    describe("getSocketPath", () => {
      test("returns configured socket path", () => {
        expect(monitorClient.getSocketPath()).toBe(socketPath);
      });
    });

    describe("multiple commands", () => {
      test("sends multiple commands sequentially", async () => {
        await createMockServer();
        await monitorClient.connect();

        const pong1 = await monitorClient.ping();
        expect(pong1.message).toBe("pong");

        const stats = await monitorClient.getStats();
        expect(stats).toBeDefined();

        const pong2 = await monitorClient.ping();
        expect(pong2.message).toBe("pong");
      });

      test("handles rapid command succession", async () => {
        await createMockServer();
        await monitorClient.connect();

        const promises = Array.from({ length: 10 }, () => monitorClient.ping());

        const results = await Promise.all(promises);
        expect(results.length).toBe(10);
        expect(results.every((r) => r.message === "pong")).toBe(true);
      });
    });

    describe("error handling", () => {
      test("handles malformed response", async () => {
        const server = createServer((socket) => {
          socket.once("data", () => {
            socket.write("invalid json\n");
            socket.end();
          });
        });
        await listenServer(server);

        await monitorClient.connect();
        await expect(monitorClient.ping()).rejects.toThrow(
          "Failed to parse response",
        );

        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      });

      test("handles connection close before response", async () => {
        const server = createServer((socket) => {
          socket.on("data", () => {
            // Close immediately without sending response
            socket.destroy();
          });
        });
        await listenServer(server);

        await monitorClient.connect();
        await expect(monitorClient.ping()).rejects.toThrow(
          "Connection closed before receiving response",
        );

        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      });

      test("handles socket error", async () => {
        const server = createServer((socket) => {
          socket.once("data", () => {
            socket.destroy(new Error("Socket error"));
          });
          socket.on("error", () => {
            // Ignore socket errors in test
          });
        });
        await listenServer(server);

        await monitorClient.connect();
        await expect(monitorClient.ping()).rejects.toThrow(
          "Connection closed before receiving response",
        );

        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      });
    });

    describe("reconnection", () => {
      test("can reconnect after disconnect", async () => {
        await createMockServer();
        await monitorClient.connect();
        expect(monitorClient.isClientConnected()).toBe(true);

        monitorClient.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(monitorClient.isClientConnected()).toBe(false);

        await monitorClient.connect();
        expect(monitorClient.isClientConnected()).toBe(true);

        const pong = await monitorClient.ping();
        expect(pong.message).toBe("pong");
      });
    });
  });
}
