import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import {
  SocketClientTransport,
  SocketServerTransport,
} from "@/daemon/transport";

const SOCKET_LISTEN_SUPPORTED = await new Promise<boolean>((resolve) => {
  const server = createServer();
  server.once("error", () => resolve(false));
  server.listen({ host: "127.0.0.1", port: 0 }, () => {
    server.close(() => resolve(true));
  });
});

if (!SOCKET_LISTEN_SUPPORTED) {
  test.skip("Daemon transport (socket listen unsupported)", () => {});
} else {
  describe("daemon transport", () => {
    let server: ReturnType<typeof createServer> | null = null;
    let endpoint: string;
    let client: SocketClientTransport | null = null;

    beforeEach(() => {
      endpoint = "";
    });

    afterEach(async () => {
      if (client) {
        await client.close();
        client = null;
      }
      if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = null;
      }
      // no temp dir cleanup needed
    });

    test("exchanges MCP and control messages", async () => {
      let serverControl: { type?: string } | null = null;
      let serverMessage: unknown = null;

      server = createServer((socket) => {
        const transport = new SocketServerTransport(socket);
        transport.oncontrol = (msg) => {
          serverControl = msg;
        };
        transport.onmessage = (msg) => {
          serverMessage = msg;
        };
        transport.start().catch((err) => {
          console.error("Server transport start failed:", err);
        });
        setTimeout(() => {
          void transport.sendControl({
            type: "helloAck",
            sessionId: "s-1",
            isOwner: true,
          });
          void transport.send({
            jsonrpc: "2.0",
            id: 2,
            method: "pong",
          });
        }, 25);
      });

      await new Promise<void>((resolve) =>
        server?.listen({ host: "127.0.0.1", port: 0 }, resolve),
      );
      const address = server?.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to get TCP address");
      }
      endpoint = `tcp://${address.address}:${address.port}`;

      client = new SocketClientTransport({ endpoint });
      let clientControl: { type?: string } | null = null;
      let clientMessage: unknown = null;
      client.oncontrol = (msg) => {
        clientControl = msg;
      };
      client.onmessage = (msg) => {
        clientMessage = msg;
      };
      await client.start();

      await client.sendControl({ type: "hello", clientId: "client-1" });
      await client.send({ jsonrpc: "2.0", id: 1, method: "ping" });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(serverControl).toMatchObject({ type: "hello" });
      expect(serverMessage).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(clientControl).toMatchObject({ type: "helloAck" });
      expect(clientMessage).toEqual({
        jsonrpc: "2.0",
        id: 2,
        method: "pong",
      });

      await client.close();
      client = null;
    });
  });
}
