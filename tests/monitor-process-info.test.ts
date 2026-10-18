import { describe, expect, mock, test } from "bun:test";
import { createProcessInfoAugmenter } from "@/cli/run-monitor";
import type { InstanceRegistryEntry } from "@/config";

function entry(
  pid: number,
  extra: Partial<InstanceRegistryEntry> = {},
): InstanceRegistryEntry {
  return {
    id: `instance-${pid}`,
    pid,
    socketPath: `/tmp/${pid}.sock`,
    startedAt: 1,
    ...extra,
  };
}

function query(
  ...results: Array<{ status: number | null; stdout: string | null }>
) {
  return mock(
    (_command: string, _args: string[], _options: { encoding: "utf8" }) => {
      const result = results.shift();
      if (!result) throw new Error("Unexpected process query");
      return result;
    },
  );
}

describe("monitor process metadata", () => {
  test("does not query processes on Windows, for empty entries or without positive PIDs", () => {
    const ps = query();
    createProcessInfoAugmenter({ platform: "win32", query: ps })([entry(1)]);
    createProcessInfoAugmenter({ platform: "linux", query: ps })([]);
    createProcessInfoAugmenter({ platform: "linux", query: ps })([
      entry(0),
      entry(-1),
    ]);
    expect(ps).not.toHaveBeenCalled();
  });

  test("keeps existing metadata when ps fails or returns no output", () => {
    for (const result of [
      { status: 1, stdout: "failure" },
      { status: 0, stdout: "" },
      { status: null, stdout: null },
    ]) {
      const entries = [entry(42, { launcher: "known" })];
      const before = structuredClone(entries);
      createProcessInfoAugmenter({ platform: "linux", query: query(result) })(
        entries,
      );
      expect(entries).toEqual(before);
    }
  });

  test("enriches recognized processes and parents, deduplicates PIDs and preserves known launchers", () => {
    const ps = query(
      {
        status: 0,
        stdout:
          "malformed\n999 1 ignored other other command\n42 10 alice bun bun src/index.ts\n43 10 bob node node worker.js\n44 0 root worker worker\n45 11 user child child --flag\n",
      },
      { status: 0, stdout: "bad parent\n10 shell shell --login\n" },
    );
    const entries = [
      entry(42),
      entry(43, { launcher: "explicit" }),
      entry(44),
      entry(45),
    ];
    createProcessInfoAugmenter({ platform: "linux", query: ps })(entries);
    expect(entries[0]).toMatchObject({
      ppid: 10,
      user: "alice",
      processName: "bun",
      command: "bun src/index.ts",
      parentProcessName: "shell",
      parentCommand: "shell --login",
      launcher: "shell",
    });
    expect(entries[1]).toMatchObject({
      launcher: "explicit",
      parentProcessName: "shell",
    });
    expect(entries[2]?.parentCommand).toBeUndefined();
    expect(entries[3]?.parentCommand).toBeUndefined();
    expect(ps.mock.calls[0]).toEqual([
      "ps",
      ["-p", "42,43,44,45", "-o", "pid=,ppid=,user=,comm=,command="],
      { encoding: "utf8" },
    ]);
    expect(ps.mock.calls[1]).toEqual([
      "ps",
      ["-p", "10,11", "-o", "pid=,comm=,command="],
      { encoding: "utf8" },
    ]);
  });

  test("does not query a parent when there is none, and tolerates failed parent lookup", () => {
    const noParent = query({
      status: 0,
      stdout: "42 0 user bun bun server.ts",
    });
    const entries = [entry(42)];
    createProcessInfoAugmenter({ platform: "linux", query: noParent })(entries);
    expect(noParent).toHaveBeenCalledTimes(1);
    expect(entries[0]?.processName).toBe("bun");
    for (const result of [
      { status: 1, stdout: "failure" },
      { status: 0, stdout: "" },
    ]) {
      const ps = query(
        { status: 0, stdout: "42 10 user bun bun server.ts" },
        result,
      );
      const entries = [entry(42)];
      createProcessInfoAugmenter({ platform: "linux", query: ps })(entries);
      expect(entries[0]?.processName).toBe("bun");
      expect(entries[0]?.parentCommand).toBeUndefined();
    }
  });
});
