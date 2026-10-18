import { describe, expect, test } from "bun:test";
import {
  generateUniqueName,
  getBaseName,
  hasConflict,
  isValidServerName,
  normalizeServerName,
  normalizeServerNames,
} from "@/import/transform/normalizer";

describe("import name normalization", () => {
  test.each([
    ["My.Server !!", "my-server"],
    ["###", "server"],
    ["123 Worker", "s-123-worker"],
    ["_local", "_local"],
    [`${"a".repeat(63)}-tail`, "a".repeat(63)],
  ])("normalizes %s to a valid bounded key", (input, expected) => {
    expect(normalizeServerName(input)).toBe(expected);
    expect(isValidServerName(expected)).toBe(true);
  });
  test("rejects invalid keys and allocates stable unique names without mutating the caller set", () => {
    for (const name of ["", "1abc", "space here", "a".repeat(65)])
      expect(isValidServerName(name)).toBe(false);
    const existing = new Set(["server", "server-2"]);
    expect(generateUniqueName("server", existing)).toBe("server-3");
    expect(generateUniqueName("other", existing)).toBe("other");
    expect([...normalizeServerNames(["Server", "SERVER"], existing)]).toEqual([
      ["Server", "server-3"],
      ["SERVER", "server-4"],
    ]);
    expect(existing.size).toBe(2);
    expect([...normalizeServerNames(["One"])]).toEqual([["One", "one"]]);
    expect(hasConflict("SERVER", existing)).toBe(true);
    expect(hasConflict("free", existing)).toBe(false);
  });
  test("fails bounded name exhaustion and distinguishes numeric suffixes from original names", () => {
    const names = new Set([
      "server",
      ...Array.from({ length: 1000 }, (_, index) => `server-${index + 2}`),
    ]);
    expect(() => generateUniqueName("server", names)).toThrow(
      'Could not generate unique name for "server"',
    );
    expect(getBaseName("server-2")).toBe("server");
    expect(getBaseName("server-1")).toBe("server-1");
    expect(getBaseName("server-name")).toBe("server-name");
  });
});
