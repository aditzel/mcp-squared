import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { DEFAULT_CONFIG } from "@/config/schema";
import { DaemonServer } from "@/daemon/server";
import { SocketClientTransport } from "@/daemon/transport";
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
  });
}
