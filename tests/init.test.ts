import { describe, expect, test } from "bun:test";
import { parse as parseToml } from "smol-toml";
import { generateConfigToml } from "../src/init/runner.js";

describe("generateConfigToml", () => {
  test("hardened profile produces confirm-all config", () => {
    const toml = generateConfigToml("hardened");
    const parsed = parseToml(toml) as Record<string, unknown>;
    const security = parsed["security"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(security["tools"]["allow"]).toEqual([]);
    expect(security["tools"]["block"]).toEqual([]);
    expect(security["tools"]["confirm"]).toEqual(["*:*"]);
  });

  test("permissive profile produces allow-all config", () => {
    const toml = generateConfigToml("permissive");
    const parsed = parseToml(toml) as Record<string, unknown>;
    const security = parsed["security"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(security["tools"]["allow"]).toEqual(["*:*"]);
    expect(security["tools"]["block"]).toEqual([]);
    expect(security["tools"]["confirm"]).toEqual([]);
  });

  test("hardened config has schemaVersion 1", () => {
    const toml = generateConfigToml("hardened");
    const parsed = parseToml(toml) as Record<string, unknown>;
    expect(parsed["schemaVersion"]).toBe(1);
  });

  test("config includes operations defaults", () => {
    const toml = generateConfigToml("hardened");
    const parsed = parseToml(toml) as Record<string, unknown>;
    const ops = parsed["operations"] as Record<string, Record<string, unknown>>;
    expect(ops["findTools"]["defaultLimit"]).toBe(5);
    expect(ops["findTools"]["defaultMode"]).toBe("fast");
    expect(ops["logging"]["level"]).toBe("info");
  });

  test("hardened config contains explanatory comments", () => {
    const toml = generateConfigToml("hardened");
    expect(toml).toContain("# Hardened");
    expect(toml).toContain("require confirmation");
  });

  test("permissive config contains explanatory comments", () => {
    const toml = generateConfigToml("permissive");
    expect(toml).toContain("# Permissive");
    expect(toml).toContain("allowed without confirmation");
  });

  test("generated TOML is parseable without errors", () => {
    for (const profile of ["hardened", "permissive"] as const) {
      const toml = generateConfigToml(profile);
      expect(() => parseToml(toml)).not.toThrow();
    }
  });
});
