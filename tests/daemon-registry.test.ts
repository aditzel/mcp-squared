import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { createServer } from "node:net";
import { platform } from "node:os";
import { getDaemonDir, getDaemonRegistryPath } from "@/config/paths.js";
import {
  deleteDaemonRegistry,
  loadLiveDaemonRegistry,
  readDaemonRegistry,
  writeDaemonRegistry,
} from "@/daemon/registry.js";
import { VERSION } from "@/version.js";
import { withTempConfigHome } from "./helpers/config-home.js";

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
        version: VERSION,
        sharedSecret: "secret-token",
      };

      writeDaemonRegistry(entry);
      const readBack = readDaemonRegistry();
      expect(readBack).toEqual(entry);
    });

    test("writes daemon registry with restricted permissions", () => {
      const configHash = "perm-test";
      const entry = {
        daemonId: "daemon-perms",
        endpoint: "tcp://127.0.0.1:0",
        pid: process.pid,
        startedAt: Date.now(),
        configHash,
        sharedSecret: "secret-token",
      };

      writeDaemonRegistry(entry);

      if (platform() !== "win32") {
        const dirMode = statSync(getDaemonDir(configHash)).mode & 0o777;
        const fileMode =
          statSync(getDaemonRegistryPath(configHash)).mode & 0o777;
        expect(dirMode).toBe(0o700);
        expect(fileMode).toBe(0o600);
      }

      deleteDaemonRegistry(configHash);
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
