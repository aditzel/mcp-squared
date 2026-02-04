import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { type Socket, connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MonitorServer } from "@/server/monitor-server";
import { StatsCollector } from "@/server/stats";

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
  test.skip("MonitorServer (socket listen unsupported in this environment)", () => {});
} else {
  describe("MonitorServer", () => {
    let tempDir: string;
    let socketPath: string;
    let statsCollector: StatsCollector;
    let monitorServer: MonitorServer;

    beforeEach(() => {
      tempDir = join(tmpdir(), `mcp-squared-monitor-test-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      socketPath = UDS_SUPPORTED
        ? join(tempDir, "monitor.sock")
        : "tcp://127.0.0.1:0";
      statsCollector = new StatsCollector();
      monitorServer = new MonitorServer({
        socketPath,
        statsCollector,
      });
    });

    afterEach(async () => {
      if (monitorServer.isServerRunning()) {
        await monitorServer.stop();
      }
      rmSync(tempDir, { recursive: true, force: true });
    });

    describe("constructor", () => {
      test("creates server with options", () => {
        expect(monitorServer).toBeDefined();
        expect(monitorServer.getSocketPath()).toBe(socketPath);
      });
    });

    describe("start and stop", () => {
      test("starts server successfully", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        // Wait a bit for server to actually start
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(monitorServer.isServerRunning()).toBe(true);
      });

      test("stops server successfully", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await monitorServer.stop();
        expect(monitorServer.isServerRunning()).toBe(false);
      });

      test("idempotent start", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await monitorServer.start(); // Should not throw
        expect(monitorServer.isServerRunning()).toBe(true);
      });

      test("idempotent stop", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await monitorServer.stop();
        await monitorServer.stop(); // Should not throw
        expect(monitorServer.isServerRunning()).toBe(false);
      });

      test("cleans up existing socket file on start", async () => {
        if (isTcpEndpoint(socketPath)) return;

        // Create a dummy socket file
        Bun.write(socketPath, "dummy");

        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(monitorServer.isServerRunning()).toBe(true);
      });
    });

    describe("client connection", () => {
      test("accepts client connection", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const client = await connectToEndpoint(socketPath);

        expect(client).toBeDefined();
        client.destroy();
      });

      test("handles multiple concurrent connections", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const clients = await Promise.all(
          Array.from({ length: 5 }, () => connectToEndpoint(socketPath)),
        );

        expect(clients.length).toBe(5);
        for (const client of clients) {
          client.destroy();
        }
      });
    });

    describe("command handling", () => {
      test("handles ping command", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const response = await sendCommand(socketPath, "ping");
        expect(response.status).toBe("success");
        expect(response.data).toEqual({ message: "pong" });
      });

      test("handles stats command", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Add some stats
        const requestId = statsCollector.startRequest();
        statsCollector.endRequest(requestId, true, 100);

        const response = await sendCommand(socketPath, "stats");
        expect(response.status).toBe("success");
        expect(response.data).toBeDefined();
        const data = response.data as { requests?: unknown };
        expect(data.requests).toBeDefined();
      });

      test("handles tools command", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const response = await sendCommand(socketPath, "tools");
        expect(response.status).toBe("success");
        expect(Array.isArray(response.data)).toBe(true);
      });

      test("handles tools command with limit", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const response = await sendCommand(socketPath, "tools 5");
        expect(response.status).toBe("success");
        expect(Array.isArray(response.data)).toBe(true);
      });

      test("handles tools command with invalid limit", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const response = await sendCommand(socketPath, "tools invalid");
        expect(response.status).toBe("success");
        expect(Array.isArray(response.data)).toBe(true);
      });

      test("returns error for unknown command", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const response = await sendCommand(socketPath, "unknown");
        expect(response.status).toBe("error");
        expect(response.error).toContain("Unknown command");
      });

      test("handles upstreams command when unavailable", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const response = await sendCommand(socketPath, "upstreams");
        expect(response.status).toBe("error");
        expect(response.error).toContain("Upstream information not available");
      });

      test("handles clients command when unavailable", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const response = await sendCommand(socketPath, "clients");
        expect(response.status).toBe("error");
        expect(response.error).toContain("Client information not available");
      });

      test("handles multiple commands from same connection", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const client = await connectToEndpoint(socketPath);

        const responses: unknown[] = [];
        const dataPromise = new Promise<void>((resolve) => {
          let buffer = "";
          client.on("data", (data) => {
            buffer += data.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.trim()) {
                responses.push(JSON.parse(line));
              }
            }

            if (responses.length === 3) {
              resolve();
            }
          });
        });

        client.write("ping\n");
        client.write("stats\n");
        client.write("tools\n");

        await dataPromise;
        expect(responses.length).toBe(3);

        client.destroy();
      });
    });

    describe("stats integration", () => {
      test("returns current stats from collector", async () => {
        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Add some stats
        const id1 = statsCollector.startRequest();
        const id2 = statsCollector.startRequest();
        statsCollector.endRequest(id1, true, 100);
        statsCollector.endRequest(id2, false, 50);

        const response = await sendCommand(socketPath, "stats");
        expect(response.status).toBe("success");
        const data = response.data as {
          requests?: { total?: number; successful?: number; failed?: number };
        };
        expect(data.requests?.total).toBe(2);
        expect(data.requests?.successful).toBe(1);
        expect(data.requests?.failed).toBe(1);
      });

      test("returns tool stats when tracking enabled", async () => {
        const collectorWithTracking = new StatsCollector({
          enableToolTracking: true,
        });
        const serverWithTracking = new MonitorServer({
          socketPath,
          statsCollector: collectorWithTracking,
        });

        await serverWithTracking.start();
        socketPath = serverWithTracking.getSocketPath();
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Add some tool stats
        const id = collectorWithTracking.startRequest();
        collectorWithTracking.endRequest(
          id,
          true,
          100,
          "test_tool",
          "test_server",
        );

        const response = await sendCommand(socketPath, "tools");
        expect(response.status).toBe("success");
        expect(Array.isArray(response.data)).toBe(true);
        const tools = response.data as unknown[];
        expect(tools.length).toBeGreaterThan(0);

        await serverWithTracking.stop();
      });
    });

    describe("error handling", () => {
      test("handles connection errors", async () => {
        // Don't start server
        expect(monitorServer.isServerRunning()).toBe(false);

        await expect(sendCommand(socketPath, "ping")).rejects.toThrow();
      });
    });

    describe("socket cleanup", () => {
      test("removes socket file on stop", async () => {
        if (isTcpEndpoint(socketPath)) return;

        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        // Wait longer for socket file to be created
        await new Promise((resolve) => setTimeout(resolve, 200));
        const existsBefore = existsSync(socketPath);
        expect(existsBefore).toBe(true);

        await monitorServer.stop();
        const existsAfter = existsSync(socketPath);
        expect(existsAfter).toBe(false);
      });

      test("handles socket file removal failure gracefully", async () => {
        if (isTcpEndpoint(socketPath)) return;

        await monitorServer.start();
        socketPath = monitorServer.getSocketPath();
        // Wait longer for socket file to be created
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Manually remove socket file
        await Bun.file(socketPath).delete();

        // Stop should not throw
        await monitorServer.stop();
        expect(monitorServer.isServerRunning()).toBe(false);
      });
    });
  });

  function connectToEndpoint(endpoint: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = isTcpEndpoint(endpoint)
        ? connect(parseTcpEndpoint(endpoint))
        : connect(endpoint);
      socket.once("connect", () => resolve(socket));
      socket.on("error", reject);
    });
  }

  /**
   * Helper function to send a command to monitor server.
   */
  async function sendCommand(
    socketPath: string,
    command: string,
  ): Promise<{
    status: string;
    data?: unknown;
    error?: string;
    timestamp: number;
  }> {
    return new Promise((resolve, reject) => {
      const client = isTcpEndpoint(socketPath)
        ? connect(parseTcpEndpoint(socketPath))
        : connect(socketPath);

      client.once("connect", () => {
        client.write(`${command}\n`);
      });

      let buffer = "";

      client.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              client.destroy();
              resolve(response);
            } catch (error) {
              reject(new Error(`Failed to parse response: ${error}`));
            }
          }
        }
      });

      client.on("error", (error) => {
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        client.destroy();
        reject(new Error("Command timeout"));
      }, 5000);
    });
  }
}
