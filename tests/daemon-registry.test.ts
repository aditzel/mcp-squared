import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import {
  deleteDaemonRegistry,
  loadLiveDaemonRegistry,
  readDaemonRegistry,
  writeDaemonRegistry,
} from "@/daemon/registry";
import { withTempConfigHome } from "./helpers/config-home";

const SOCKET_LISTEN_SUPPORTED = await new Promise<boolean>((resolve) => {
  const server = createServer();
  server.once("error", () => resolve(false));
  server.listen({ host: "127.0.0.1", port: 0 }, () => {
    server.close(() => resolve(true));
  });
});

if (!SOCKET_LISTEN_SUPPORTED) {
  test.skip("Daemon registry (socket listen unsupported)", () => {});
} else {
  describe("daemon registry", () => {
    let restoreEnv: () => void;

    beforeEach(async () => {
      const ctx = await withTempConfigHome();
      restoreEnv = ctx.restore;
    });

    afterEach(() => {
      deleteDaemonRegistry();
      restoreEnv();
    });

    test("writes and reads registry entries", () => {
      const entry = {
        daemonId: "daemon-1",
        endpoint: "tcp://127.0.0.1:0",
        pid: process.pid,
        startedAt: Date.now(),
        version: "0.1.0",
      };

      writeDaemonRegistry(entry);
      const readBack = readDaemonRegistry();
      expect(readBack).toEqual(entry);
    });

    test("returns null for stale registry", async () => {
      const entry = {
        daemonId: "daemon-2",
        endpoint: "tcp://127.0.0.1:0",
        pid: 999999,
        startedAt: Date.now(),
      };

      writeDaemonRegistry(entry);
      const live = await loadLiveDaemonRegistry();
      expect(live).toBeNull();
    });

    test("detects live daemon registry", async () => {
      const server = createServer();
      server.listen({ host: "127.0.0.1", port: 0 });

      await new Promise((resolve) => setTimeout(resolve, 10));
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to get TCP address");
      }
      const socketPath = `tcp://${address.address}:${address.port}`;

      const entry = {
        daemonId: "daemon-3",
        endpoint: socketPath,
        pid: process.pid,
        startedAt: Date.now(),
      };
      writeDaemonRegistry(entry);

      const live = await loadLiveDaemonRegistry();
      expect(live?.daemonId).toBe("daemon-3");

      server.close();
      // TCP listener closed above
    });
  });
}
