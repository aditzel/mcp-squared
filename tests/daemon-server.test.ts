import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { connect, createServer } from "node:net";
import { DEFAULT_CONFIG } from "@/config/schema.js";
import { DaemonServer } from "@/daemon/server.js";
import { SocketClientTransport } from "@/daemon/transport.js";
import { McpSquaredServer } from "@/server/index.js";
import { MonitorClient } from "@/tui/monitor-client.js";
import { withTempConfigHome } from "./helpers/config-home.js";

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const SOCKET_LISTEN_SUPPORTED = await new Promise<boolean>((resolve) => {
  const server = createServer();
  server.once("error", () => resolve(false));
  server.listen({ host: "127.0.0.1", port: 0 }, () => {
    server.close(() => resolve(true));
  });
});

if (!SOCKET_LISTEN_SUPPORTED) {
  test.skip("DaemonServer (socket listen unsupported)", () => {});
} else {
  describe("DaemonServer", () => {
    let restoreEnv: () => void;

    beforeEach(async () => {
      const ctx = await withTempConfigHome();
      restoreEnv = ctx.restore;
    });

    afterEach(() => {
      restoreEnv();
    });

    test("accepts connections and assigns owner", async () => {
      const socketPath = "tcp://127.0.0.1:0";
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const daemon = new DaemonServer({
        runtime,
        socketPath,
        idleTimeoutMs: 100,
        heartbeatTimeoutMs: 1000,
      });

      await daemon.start();

      const client = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      await client.start();
      await client.sendControl({ type: "hello", clientId: "client-1" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(daemon.getSessionCount()).toBe(1);
      expect(daemon.getOwnerSessionId()).not.toBeNull();

      await client.close();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(daemon.getSessionCount()).toBe(0);
      expect(daemon.getSocketPath()).toContain("tcp://");

      await daemon.stop();
    });

    test("rejects non-loopback TCP daemon endpoints", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://0.0.0.0:0",
      });

      await expect(daemon.start()).rejects.toThrow(
        "Refusing non-loopback daemon TCP endpoint",
      );
    });

    test("rejects non-numeric 127-prefixed hostnames", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.internal.example:45000",
      });

      await expect(daemon.start()).rejects.toThrow(
        "Refusing non-loopback daemon TCP endpoint",
      );
    });

    test("accepts IPv4-mapped IPv6 loopback addresses in guard", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://[::ffff:127.0.0.1]:0",
      });

      let started = false;
      try {
        await daemon.start();
        started = true;
      } finally {
        if (started) {
          await daemon.stop();
        }
      }
    });

    test("rejects IPv4-mapped IPv6 non-loopback addresses", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://[::ffff:192.168.0.10]:0",
      });

      await expect(daemon.start()).rejects.toThrow(
        "Refusing non-loopback daemon TCP endpoint",
      );
    });

    test("enforces shared secret during hello handshake", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        sharedSecret: "top-secret",
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 1000,
      });

      await daemon.start();

      const unauthorized = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let unauthorizedError: string | null = null;
      unauthorized.oncontrol = (message) => {
        if (message.type === "error") {
          unauthorizedError = message.message;
        }
      };
      await unauthorized.start();
      await unauthorized.sendControl({
        type: "hello",
        clientId: "unauthorized",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const unauthorizedMessage = unauthorizedError ?? "";
      expect(unauthorizedMessage.includes("invalid shared secret")).toBe(true);
      expect(daemon.getSessionCount()).toBe(0);
      await unauthorized.close().catch(() => {});

      const authorized = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let authorizedSession: string | null = null;
      authorized.oncontrol = (message) => {
        if (message.type === "helloAck") {
          authorizedSession = message.sessionId;
        }
      };
      await authorized.start();
      await authorized.sendControl({
        type: "hello",
        clientId: "authorized",
        sharedSecret: "top-secret",
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(authorizedSession).not.toBeNull();
      expect(daemon.getSessionCount()).toBe(1);

      await authorized.close();
      await daemon.stop();
    });

    test("elects owner from authenticated sessions only", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 1000,
      });
      await daemon.start();

      const parsed = new URL(daemon.getSocketPath());
      const rawSocket = connect({
        host: parsed.hostname.replace(/^\[|\]$/g, ""),
        port: Number.parseInt(parsed.port, 10),
      });
      await new Promise<void>((resolve) => {
        rawSocket.once("connect", () => resolve());
      });

      const authenticated = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let ackOwner = false;
      authenticated.oncontrol = (message) => {
        if (message.type === "helloAck") {
          ackOwner = message.isOwner;
        }
      };
      await authenticated.start();
      await authenticated.sendControl({
        type: "hello",
        clientId: "auth-client",
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(ackOwner).toBe(true);
      expect(daemon.getOwnerSessionId()).not.toBeNull();

      rawSocket.destroy();
      await authenticated.close();
      await daemon.stop();
    });

    test("transfers ownership on disconnect", async () => {
      const socketPath = "tcp://127.0.0.1:0";
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const daemon = new DaemonServer({
        runtime,
        socketPath,
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 1000,
      });

      const waitFor = async (
        condition: () => boolean,
        timeoutMs = 500,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for condition");
      };

      await daemon.start();

      const client1 = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let session1: string | null = null;
      client1.oncontrol = (message) => {
        if (message.type === "helloAck") {
          session1 = message.sessionId;
        }
      };
      await client1.start();
      await client1.sendControl({ type: "hello", clientId: "client-1" });

      const client2 = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let session2: string | null = null;
      let ownerChange: string | null = null;
      client2.oncontrol = (message) => {
        if (message.type === "helloAck") {
          session2 = message.sessionId;
        }
        if (message.type === "ownerChanged") {
          ownerChange = message.ownerSessionId;
        }
      };
      await client2.start();
      await client2.sendControl({ type: "hello", clientId: "client-2" });

      await waitFor(() => session1 !== null && session2 !== null);

      expect(daemon.getOwnerSessionId()).toBe(session1);

      await client1.close();
      await waitFor(() => daemon.getOwnerSessionId() === session2);
      await waitFor(() => ownerChange === session2);

      await client2.close();
      await daemon.stop();
    });

    test("reassigns owner before disconnected session cleanup finishes", async () => {
      const closingGate = createDeferred();
      const closedSessionIds: string[] = [];
      let closeCount = 0;
      const activeConnections = { count: 0 };

      const runtime = {
        async startCore() {},
        async stopCore() {},
        setMonitorClientProvider() {},
        createSessionServer() {
          const sessionIndex = closeCount;
          return {
            async connect() {},
            async close() {
              closeCount += 1;
              closedSessionIds.push(`session-${sessionIndex}`);
              if (sessionIndex === 0) {
                await closingGate.promise;
              }
            },
          };
        },
        getStatsCollector() {
          return {
            incrementActiveConnections() {
              activeConnections.count += 1;
            },
            decrementActiveConnections() {
              activeConnections.count -= 1;
            },
          };
        },
      } as unknown as McpSquaredServer;

      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 1000,
      });

      const waitFor = async (
        condition: () => boolean,
        timeoutMs = 500,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for condition");
      };

      await daemon.start();

      const client1 = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let session1: string | null = null;
      client1.oncontrol = (message) => {
        if (message.type === "helloAck") {
          session1 = message.sessionId;
        }
      };
      await client1.start();
      await client1.sendControl({ type: "hello", clientId: "client-1" });
      await waitFor(() => session1 !== null);

      const client2 = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let session2: string | null = null;
      let ownerChange: string | null = null;
      client2.oncontrol = (message) => {
        if (message.type === "helloAck") {
          session2 = message.sessionId;
        }
        if (message.type === "ownerChanged") {
          ownerChange = message.ownerSessionId;
        }
      };
      await client2.start();
      await client2.sendControl({ type: "hello", clientId: "client-2" });
      await waitFor(() => session2 !== null);

      expect(daemon.getOwnerSessionId()).toBe(session1);
      expect(activeConnections.count).toBe(2);

      await client1.close();
      await waitFor(() => closedSessionIds.length === 1);

      expect(daemon.getSessionCount()).toBe(1);
      expect(daemon.getOwnerSessionId()).toBe(session2);
      await waitFor(() => ownerChange === session2);
      expect(activeConnections.count).toBe(1);

      closingGate.resolve();

      await client2.close();
      await daemon.stop();
    });

    test("replaces a stale owner session when the same client reconnects", async () => {
      const closingGate = createDeferred();
      const closedSessionIds: string[] = [];
      let closeCount = 0;
      const activeConnections = { count: 0 };

      const runtime = {
        async startCore() {},
        async stopCore() {},
        setMonitorClientProvider() {},
        createSessionServer() {
          const sessionIndex = closeCount;
          return {
            async connect() {},
            async close() {
              closeCount += 1;
              closedSessionIds.push(`session-${sessionIndex}`);
              if (sessionIndex === 0) {
                await closingGate.promise;
              }
            },
          };
        },
        getStatsCollector() {
          return {
            incrementActiveConnections() {
              activeConnections.count += 1;
            },
            decrementActiveConnections() {
              activeConnections.count -= 1;
            },
          };
        },
      } as unknown as McpSquaredServer;

      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 60_000,
      });

      const waitFor = async (
        condition: () => boolean,
        timeoutMs = 500,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for condition");
      };

      await daemon.start();

      const client1 = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let session1: string | null = null;
      let ack1IsOwner = false;
      client1.oncontrol = (message) => {
        if (message.type === "helloAck") {
          session1 = message.sessionId;
          ack1IsOwner = message.isOwner;
        }
      };
      await client1.start();
      await client1.sendControl({ type: "hello", clientId: "shared-client" });
      await waitFor(() => session1 !== null);

      const client2 = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let session2: string | null = null;
      let ack2IsOwner = false;
      client2.oncontrol = (message) => {
        if (message.type === "helloAck") {
          session2 = message.sessionId;
          ack2IsOwner = message.isOwner;
        }
      };
      await client2.start();
      await client2.sendControl({ type: "hello", clientId: "shared-client" });

      await waitFor(() => closedSessionIds.length === 1);
      await waitFor(() => session2 !== null);

      expect(ack1IsOwner).toBe(true);
      expect(daemon.getSessionCount()).toBe(1);
      expect(daemon.getOwnerSessionId()).toBe(session2);
      expect(ack2IsOwner).toBe(true);
      expect(activeConnections.count).toBe(1);

      closingGate.resolve();

      await client2.close();
      await daemon.stop();
    });

    test("keeps ownership with the reconnecting client during delayed cleanup", async () => {
      const closingGate = createDeferred();
      let closeCount = 0;
      const activeConnections = { count: 0 };

      const runtime = {
        async startCore() {},
        async stopCore() {},
        setMonitorClientProvider() {},
        createSessionServer() {
          const sessionIndex = closeCount;
          return {
            async connect() {},
            async close() {
              closeCount += 1;
              if (sessionIndex === 0) {
                await closingGate.promise;
              }
            },
          };
        },
        getStatsCollector() {
          return {
            incrementActiveConnections() {
              activeConnections.count += 1;
            },
            decrementActiveConnections() {
              activeConnections.count -= 1;
            },
          };
        },
      } as unknown as McpSquaredServer;

      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 60_000,
      });

      const waitFor = async (
        condition: () => boolean,
        timeoutMs = 500,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for condition");
      };

      await daemon.start();

      const ownerClient = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let originalOwnerSession: string | null = null;
      ownerClient.oncontrol = (message) => {
        if (message.type === "helloAck") {
          originalOwnerSession = message.sessionId;
        }
      };
      await ownerClient.start();
      await ownerClient.sendControl({
        type: "hello",
        clientId: "shared-client",
      });
      await waitFor(() => originalOwnerSession !== null);

      const observerClient = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let observerSession: string | null = null;
      let observerOwnerChange: string | null = null;
      observerClient.oncontrol = (message) => {
        if (message.type === "helloAck") {
          observerSession = message.sessionId;
        }
        if (message.type === "ownerChanged") {
          observerOwnerChange = message.ownerSessionId;
        }
      };
      await observerClient.start();
      await observerClient.sendControl({
        type: "hello",
        clientId: "observer-client",
      });
      await waitFor(() => observerSession !== null);

      const reconnectingOwner = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let replacementOwnerSession: string | null = null;
      let replacementAckIsOwner = false;
      reconnectingOwner.oncontrol = (message) => {
        if (message.type === "helloAck") {
          replacementOwnerSession = message.sessionId;
          replacementAckIsOwner = message.isOwner;
        }
      };
      await reconnectingOwner.start();
      await reconnectingOwner.sendControl({
        type: "hello",
        clientId: "shared-client",
      });

      await waitFor(() => replacementOwnerSession !== null);

      expect(daemon.getSessionCount()).toBe(2);
      expect(activeConnections.count).toBe(2);
      expect(replacementAckIsOwner).toBe(true);
      expect(daemon.getOwnerSessionId()).toBe(replacementOwnerSession);
      await waitFor(() => observerOwnerChange === replacementOwnerSession);
      expect(observerOwnerChange).not.toBe(observerSession);

      closingGate.resolve();

      await reconnectingOwner.close();
      await observerClient.close();
      await daemon.stop();
    });

    test("restores ownership to a quickly reconnecting prior owner after disconnect", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });

      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 60_000,
      });

      const waitFor = async (
        condition: () => boolean,
        timeoutMs = 500,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for condition");
      };

      await daemon.start();

      const ownerClient = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let ownerSession: string | null = null;
      ownerClient.oncontrol = (message) => {
        if (message.type === "helloAck") {
          ownerSession = message.sessionId;
        }
      };
      await ownerClient.start();
      await ownerClient.sendControl({
        type: "hello",
        clientId: "shared-client",
      });
      await waitFor(() => ownerSession !== null);

      const observerClient = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let observerSession: string | null = null;
      const observerOwnerChanges: string[] = [];
      observerClient.oncontrol = (message) => {
        if (message.type === "helloAck") {
          observerSession = message.sessionId;
        }
        if (message.type === "ownerChanged") {
          observerOwnerChanges.push(message.ownerSessionId);
        }
      };
      await observerClient.start();
      await observerClient.sendControl({
        type: "hello",
        clientId: "observer-client",
      });
      await waitFor(() => observerSession !== null);

      await ownerClient.close();
      await waitFor(() => daemon.getOwnerSessionId() === observerSession);

      const reconnectingOwner = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let replacementOwnerSession: string | null = null;
      let replacementAckIsOwner = false;
      const reconnectingOwnerControlSequence: string[] = [];
      reconnectingOwner.oncontrol = (message) => {
        reconnectingOwnerControlSequence.push(message.type);
        if (message.type === "helloAck") {
          replacementOwnerSession = message.sessionId;
          replacementAckIsOwner = message.isOwner;
        }
      };
      await reconnectingOwner.start();
      await reconnectingOwner.sendControl({
        type: "hello",
        clientId: "shared-client",
      });

      await waitFor(() => replacementOwnerSession !== null);

      expect(replacementAckIsOwner).toBe(true);
      expect(daemon.getOwnerSessionId()).toBe(replacementOwnerSession);
      expect(reconnectingOwnerControlSequence).toEqual(["helloAck"]);
      await waitFor(() =>
        observerOwnerChanges.includes(replacementOwnerSession as string),
      );

      await reconnectingOwner.close();
      await observerClient.close();
      await daemon.stop();
    });

    test("broadcasts the expected owner-change sequence across a three-client reconnect flap", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });

      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        idleTimeoutMs: 5000,
        heartbeatTimeoutMs: 60_000,
      });

      const waitFor = async (
        condition: () => boolean,
        timeoutMs = 500,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for condition");
      };

      await daemon.start();

      const ownerClient = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      const originalOwnerControlSequence: string[] = [];
      let originalOwnerSession: string | null = null;
      ownerClient.oncontrol = (message) => {
        originalOwnerControlSequence.push(message.type);
        if (message.type === "helloAck") {
          originalOwnerSession = message.sessionId;
        }
      };
      await ownerClient.start();
      await ownerClient.sendControl({
        type: "hello",
        clientId: "shared-client",
      });
      await waitFor(() => originalOwnerSession !== null);

      const temporaryOwnerClient = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let temporaryOwnerSession: string | null = null;
      const temporaryOwnerChanges: string[] = [];
      temporaryOwnerClient.oncontrol = (message) => {
        if (message.type === "helloAck") {
          temporaryOwnerSession = message.sessionId;
        }
        if (message.type === "ownerChanged") {
          temporaryOwnerChanges.push(message.ownerSessionId);
        }
      };
      await temporaryOwnerClient.start();
      await temporaryOwnerClient.sendControl({
        type: "hello",
        clientId: "temporary-owner-client",
      });
      await waitFor(() => temporaryOwnerSession !== null);

      const observerClient = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let observerSession: string | null = null;
      const observerOwnerChanges: string[] = [];
      observerClient.oncontrol = (message) => {
        if (message.type === "helloAck") {
          observerSession = message.sessionId;
        }
        if (message.type === "ownerChanged") {
          observerOwnerChanges.push(message.ownerSessionId);
        }
      };
      await observerClient.start();
      await observerClient.sendControl({
        type: "hello",
        clientId: "observer-client",
      });
      await waitFor(() => observerSession !== null);

      await ownerClient.close();
      await waitFor(() => daemon.getOwnerSessionId() === temporaryOwnerSession);
      await waitFor(() =>
        temporaryOwnerChanges.includes(temporaryOwnerSession as string),
      );
      await waitFor(() =>
        observerOwnerChanges.includes(temporaryOwnerSession as string),
      );

      const reconnectingOwner = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let replacementOwnerSession: string | null = null;
      let replacementAckIsOwner = false;
      const reconnectingOwnerControlSequence: string[] = [];
      reconnectingOwner.oncontrol = (message) => {
        reconnectingOwnerControlSequence.push(message.type);
        if (message.type === "helloAck") {
          replacementOwnerSession = message.sessionId;
          replacementAckIsOwner = message.isOwner;
        }
      };
      await reconnectingOwner.start();
      await reconnectingOwner.sendControl({
        type: "hello",
        clientId: "shared-client",
      });
      await waitFor(() => replacementOwnerSession !== null);

      expect(replacementAckIsOwner).toBe(true);
      expect(daemon.getOwnerSessionId()).toBe(replacementOwnerSession);
      expect(reconnectingOwnerControlSequence).toEqual(["helloAck"]);
      await waitFor(() =>
        temporaryOwnerChanges.includes(replacementOwnerSession as string),
      );
      await waitFor(() =>
        observerOwnerChanges.includes(replacementOwnerSession as string),
      );

      await temporaryOwnerClient.close();
      await waitFor(() => daemon.getSessionCount() === 2);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(originalOwnerControlSequence).toEqual(["helloAck"]);
      expect(temporaryOwnerSession).not.toBeNull();
      expect(replacementOwnerSession).not.toBeNull();
      expect(observerOwnerChanges).toContain(replacementOwnerSession ?? "");
      expect(temporaryOwnerChanges).toEqual([
        temporaryOwnerSession ?? "",
        replacementOwnerSession ?? "",
      ]);
      expect(observerOwnerChanges).toEqual([
        temporaryOwnerSession ?? "",
        replacementOwnerSession ?? "",
      ]);
      expect(daemon.getOwnerSessionId()).toBe(replacementOwnerSession);

      await reconnectingOwner.close();
      await observerClient.close();
      await daemon.stop();
    });

    test("surfaces owner promotion and stale-session cleanup through monitor clients during a reconnect flap", async () => {
      const runtime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const daemon = new DaemonServer({
        runtime,
        socketPath: "tcp://127.0.0.1:0",
        idleTimeoutMs: 2_000,
        heartbeatTimeoutMs: 2_000,
      });
      const waitFor = async (
        condition: () => boolean,
        timeoutMs = 2_000,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for condition");
      };
      const waitForAsync = async (
        condition: () => Promise<boolean>,
        timeoutMs = 2_000,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (await condition()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for condition");
      };

      await daemon.start();

      const monitorClient = new MonitorClient({
        socketPath: runtime.getMonitorSocketPath(),
      });
      await monitorClient.connect();

      const getClientOwnerIds = async (): Promise<string[]> => {
        const clients = await monitorClient.getClients();
        return clients
          .filter((client) => client.isOwner)
          .map((client) => client.sessionId);
      };

      const ownerClient = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let originalOwnerSession: string | null = null;
      ownerClient.oncontrol = (message) => {
        if (message.type === "helloAck") {
          originalOwnerSession = message.sessionId;
        }
      };
      await ownerClient.start();
      await ownerClient.sendControl({
        type: "hello",
        clientId: "shared-client",
      });
      await waitFor(() => originalOwnerSession !== null);

      const temporaryOwnerClient = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let temporaryOwnerSession: string | null = null;
      temporaryOwnerClient.oncontrol = (message) => {
        if (message.type === "helloAck") {
          temporaryOwnerSession = message.sessionId;
        }
      };
      await temporaryOwnerClient.start();
      await temporaryOwnerClient.sendControl({
        type: "hello",
        clientId: "temporary-owner-client",
      });
      await waitFor(() => temporaryOwnerSession !== null);

      const observerClient = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let observerSession: string | null = null;
      observerClient.oncontrol = (message) => {
        if (message.type === "helloAck") {
          observerSession = message.sessionId;
        }
      };
      await observerClient.start();
      await observerClient.sendControl({
        type: "hello",
        clientId: "observer-client",
      });
      await waitFor(() => observerSession !== null);

      await waitForAsync(async () => {
        const clients = await monitorClient.getClients();
        return (
          clients.length === 3 &&
          clients.some(
            (client) =>
              client.sessionId === originalOwnerSession && client.isOwner,
          ) &&
          clients.some(
            (client) =>
              client.sessionId === temporaryOwnerSession && !client.isOwner,
          ) &&
          clients.some(
            (client) => client.sessionId === observerSession && !client.isOwner,
          )
        );
      });

      await ownerClient.close();
      await waitFor(() => daemon.getOwnerSessionId() === temporaryOwnerSession);
      await waitForAsync(async () => {
        const clients = await monitorClient.getClients();
        return (
          clients.length === 2 &&
          clients.some(
            (client) =>
              client.sessionId === temporaryOwnerSession && client.isOwner,
          ) &&
          clients.some(
            (client) => client.sessionId === observerSession && !client.isOwner,
          ) &&
          !clients.some((client) => client.sessionId === originalOwnerSession)
        );
      });

      const reconnectingOwner = new SocketClientTransport({
        endpoint: daemon.getSocketPath(),
      });
      let replacementOwnerSession: string | null = null;
      reconnectingOwner.oncontrol = (message) => {
        if (message.type === "helloAck") {
          replacementOwnerSession = message.sessionId;
        }
      };
      await reconnectingOwner.start();
      await reconnectingOwner.sendControl({
        type: "hello",
        clientId: "shared-client",
      });
      await waitFor(() => replacementOwnerSession !== null);
      await waitFor(
        () => daemon.getOwnerSessionId() === replacementOwnerSession,
      );

      await waitForAsync(async () => {
        const clients = await monitorClient.getClients();
        return (
          clients.length === 3 &&
          clients.some(
            (client) =>
              client.sessionId === replacementOwnerSession && client.isOwner,
          ) &&
          clients.some(
            (client) =>
              client.sessionId === temporaryOwnerSession && !client.isOwner,
          ) &&
          clients.some(
            (client) => client.sessionId === observerSession && !client.isOwner,
          ) &&
          !clients.some((client) => client.sessionId === originalOwnerSession)
        );
      });

      await temporaryOwnerClient.close();
      await waitForAsync(async () => {
        const clients = await monitorClient.getClients();
        return (
          clients.length === 2 &&
          clients.some(
            (client) =>
              client.sessionId === replacementOwnerSession && client.isOwner,
          ) &&
          clients.some(
            (client) => client.sessionId === observerSession && !client.isOwner,
          ) &&
          !clients.some((client) => client.sessionId === temporaryOwnerSession)
        );
      });

      expect(await getClientOwnerIds()).toEqual([
        replacementOwnerSession ?? "",
      ]);

      monitorClient.disconnect();
      await reconnectingOwner.close();
      await observerClient.close();
      await daemon.stop();
    });

    test("reattaches a monitor client across full daemon replacement without leaking stale sessions", async () => {
      const configHash = "monitor-restart-recovery";
      const firstRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const firstDaemon = new DaemonServer({
        runtime: firstRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 2_000,
        heartbeatTimeoutMs: 2_000,
      });
      const waitFor = async (
        condition: () => boolean,
        timeoutMs = 2_000,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for condition");
      };
      const waitForAsync = async (
        condition: () => Promise<boolean>,
        timeoutMs = 2_000,
      ): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (await condition()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for condition");
      };

      const startClient = async (args: {
        endpoint: string;
        clientId: string;
      }): Promise<{ transport: SocketClientTransport; sessionId: string }> => {
        const transport = new SocketClientTransport({
          endpoint: args.endpoint,
        });
        let sessionId: string | null = null;
        transport.oncontrol = (message) => {
          if (message.type === "helloAck") {
            sessionId = message.sessionId;
          }
        };
        await transport.start();
        await transport.sendControl({
          type: "hello",
          clientId: args.clientId,
        });
        await waitFor(() => sessionId !== null);
        return {
          transport,
          sessionId: sessionId ?? "",
        };
      };

      await firstDaemon.start();

      const monitorClient = new MonitorClient({
        socketPath: firstRuntime.getMonitorSocketPath(),
      });
      await monitorClient.connect();

      const originalOwner = await startClient({
        endpoint: firstDaemon.getSocketPath(),
        clientId: "restart-shared-client",
      });
      const observerA = await startClient({
        endpoint: firstDaemon.getSocketPath(),
        clientId: "restart-observer-a",
      });
      const observerB = await startClient({
        endpoint: firstDaemon.getSocketPath(),
        clientId: "restart-observer-b",
      });

      await waitForAsync(async () => {
        const clients = await monitorClient.getClients();
        return (
          clients.length === 3 &&
          clients.some(
            (client) =>
              client.sessionId === originalOwner.sessionId && client.isOwner,
          ) &&
          clients.some(
            (client) =>
              client.sessionId === observerA.sessionId && !client.isOwner,
          ) &&
          clients.some(
            (client) =>
              client.sessionId === observerB.sessionId && !client.isOwner,
          )
        );
      });

      await firstDaemon.stop();
      monitorClient.disconnect();

      const secondRuntime = new McpSquaredServer({
        config: DEFAULT_CONFIG,
        monitorSocketPath: "tcp://127.0.0.1:0",
      });
      const replacementDaemon = new DaemonServer({
        runtime: secondRuntime,
        socketPath: "tcp://127.0.0.1:0",
        configHash,
        idleTimeoutMs: 2_000,
        heartbeatTimeoutMs: 2_000,
      });

      await replacementDaemon.start();

      const replacementMonitorClient = new MonitorClient({
        socketPath: secondRuntime.getMonitorSocketPath(),
      });
      await replacementMonitorClient.connect();

      const replacementOwner = await startClient({
        endpoint: replacementDaemon.getSocketPath(),
        clientId: "restart-shared-client",
      });
      const replacementObserverA = await startClient({
        endpoint: replacementDaemon.getSocketPath(),
        clientId: "restart-observer-a",
      });
      const replacementObserverB = await startClient({
        endpoint: replacementDaemon.getSocketPath(),
        clientId: "restart-observer-b",
      });

      await waitForAsync(async () => {
        const clients = await replacementMonitorClient.getClients();
        return (
          clients.length === 3 &&
          clients.some(
            (client) =>
              client.sessionId === replacementOwner.sessionId && client.isOwner,
          ) &&
          clients.some(
            (client) =>
              client.sessionId === replacementObserverA.sessionId &&
              !client.isOwner,
          ) &&
          clients.some(
            (client) =>
              client.sessionId === replacementObserverB.sessionId &&
              !client.isOwner,
          ) &&
          !clients.some(
            (client) => client.sessionId === originalOwner.sessionId,
          ) &&
          !clients.some((client) => client.sessionId === observerA.sessionId) &&
          !clients.some((client) => client.sessionId === observerB.sessionId)
        );
      }, 4_000);

      expect(replacementDaemon.getOwnerSessionId()).toBe(
        replacementOwner.sessionId,
      );

      replacementMonitorClient.disconnect();
      await replacementOwner.transport.close();
      await replacementObserverA.transport.close();
      await replacementObserverB.transport.close();
      await replacementDaemon.stop();
    });
  });
}
