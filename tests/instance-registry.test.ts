import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  deleteInstanceEntry,
  type InstanceRegistryEntry,
  listActiveInstanceEntries,
  listInstanceEntries,
  readInstanceEntry,
  writeInstanceEntry,
} from "@/config/instance-registry";
import { getInstanceRegistryDir } from "@/config/paths";
import * as pidModule from "@/config/pid";
import { withTempConfigHome } from "./helpers/config-home";

describe("instance registry", () => {
  let restoreConfigHome: (() => void) | null = null;
  let processRunningSpy: ReturnType<typeof spyOn> | null = null;

  beforeEach(async () => {
    const cfg = await withTempConfigHome();
    restoreConfigHome = cfg.restore;
  });

  afterEach(() => {
    if (processRunningSpy) {
      processRunningSpy.mockRestore();
      processRunningSpy = null;
    }
    if (restoreConfigHome) {
      restoreConfigHome();
      restoreConfigHome = null;
    }
  });

  test("write/read roundtrip and list entries", () => {
    const entry: InstanceRegistryEntry = {
      id: "instance-1",
      pid: 12345,
      socketPath: "/tmp/mcp-squared.sock",
      startedAt: 1700000000000,
      role: "server",
      cwd: "/tmp",
    };

    const entryPath = writeInstanceEntry(entry);
    expect(existsSync(entryPath)).toBe(true);

    const parsed = readInstanceEntry(entryPath);
    expect(parsed).toEqual(entry);

    const listed = listInstanceEntries();
    expect(listed.length).toBe(1);
    expect(listed[0]?.entryPath).toBe(entryPath);
    expect(listed[0]?.id).toBe("instance-1");
  });

  test("read/list handles invalid JSON and pruneInvalid removes bad files", () => {
    const dir = getInstanceRegistryDir();
    mkdirSync(dir, { recursive: true });
    const invalidPath = join(dir, "invalid.json");
    writeFileSync(invalidPath, "{ bad json", "utf8");

    expect(readInstanceEntry(invalidPath)).toBeNull();

    const listedWithoutPrune = listInstanceEntries({ pruneInvalid: false });
    expect(listedWithoutPrune).toEqual([]);
    expect(existsSync(invalidPath)).toBe(true);

    const listedWithPrune = listInstanceEntries({ pruneInvalid: true });
    expect(listedWithPrune).toEqual([]);
    expect(existsSync(invalidPath)).toBe(false);
  });

  test("delete entry succeeds for existing and missing files", () => {
    const entry: InstanceRegistryEntry = {
      id: "delete-me",
      pid: 123,
      socketPath: "/tmp/delete.sock",
      startedAt: Date.now(),
    };
    const entryPath = writeInstanceEntry(entry);

    expect(deleteInstanceEntry(entryPath)).toBe(true);
    expect(existsSync(entryPath)).toBe(false);
    expect(deleteInstanceEntry(entryPath)).toBe(true);
  });

  test("listActiveInstanceEntries keeps alive proxy and connected server entries", async () => {
    processRunningSpy = spyOn(pidModule, "isProcessRunning").mockReturnValue(
      true,
    );

    const tcpServer = createServer();
    await new Promise<void>((resolve, reject) => {
      tcpServer.once("error", reject);
      tcpServer.listen(0, "127.0.0.1", () => resolve());
    });

    const address = tcpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP address");
    }

    const connectedEntry: InstanceRegistryEntry = {
      id: "connected",
      pid: 1001,
      socketPath: `tcp://127.0.0.1:${address.port}`,
      startedAt: 200,
      role: "server",
    };
    const proxyEntry: InstanceRegistryEntry = {
      id: "proxy",
      pid: 1002,
      socketPath: "/does/not/need/socket",
      startedAt: 300,
      role: "proxy",
    };

    writeInstanceEntry(connectedEntry);
    writeInstanceEntry(proxyEntry);

    const active = await listActiveInstanceEntries({
      prune: false,
      timeoutMs: 200,
    });

    expect(active.map((entry) => entry.id)).toEqual(["proxy", "connected"]);

    await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
  });

  test("listActiveInstanceEntries prunes stale entries when process is not running", async () => {
    processRunningSpy = spyOn(pidModule, "isProcessRunning").mockReturnValue(
      false,
    );

    const stale: InstanceRegistryEntry = {
      id: "stale",
      pid: 9999,
      socketPath: "/tmp/stale.sock",
      startedAt: 1,
      role: "server",
    };

    const stalePath = writeInstanceEntry(stale);
    const active = await listActiveInstanceEntries({
      prune: true,
      timeoutMs: 50,
    });

    expect(active).toEqual([]);
    expect(existsSync(stalePath)).toBe(false);
  });

  test("listActiveInstanceEntries handles invalid tcp endpoint gracefully", async () => {
    processRunningSpy = spyOn(pidModule, "isProcessRunning").mockReturnValue(
      true,
    );

    const invalidTcp: InstanceRegistryEntry = {
      id: "invalid-tcp",
      pid: 4242,
      socketPath: "tcp://127.0.0.1:notaport",
      startedAt: 10,
      role: "server",
    };

    const invalidPath = writeInstanceEntry(invalidTcp);

    const activeNoPrune = await listActiveInstanceEntries({
      prune: false,
      timeoutMs: 50,
    });
    expect(activeNoPrune).toEqual([]);
    expect(existsSync(invalidPath)).toBe(true);

    const activeWithPrune = await listActiveInstanceEntries({
      prune: true,
      timeoutMs: 50,
    });
    expect(activeWithPrune).toEqual([]);
    expect(existsSync(invalidPath)).toBe(false);
  });
});
