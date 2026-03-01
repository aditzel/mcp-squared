import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { generateConfigToml, runInit } from "../src/init/runner.js";

describe("generateConfigToml", () => {
  test("hardened profile produces confirm-all config", () => {
    const toml = generateConfigToml("hardened");
    const parsed = parseToml(toml) as Record<string, unknown>;
    const security = parsed["security"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(security["tools"]!["allow"]).toEqual([]);
    expect(security["tools"]!["block"]).toEqual([]);
    expect(security["tools"]!["confirm"]).toEqual(["*:*"]);
  });

  test("permissive profile produces allow-all config", () => {
    const toml = generateConfigToml("permissive");
    const parsed = parseToml(toml) as Record<string, unknown>;
    const security = parsed["security"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(security["tools"]!["allow"]).toEqual(["*:*"]);
    expect(security["tools"]!["block"]).toEqual([]);
    expect(security["tools"]!["confirm"]).toEqual([]);
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
    expect(ops["findTools"]!["defaultLimit"]).toBe(5);
    expect(ops["findTools"]!["defaultMode"]).toBe("fast");
    expect(ops["logging"]!["level"]).toBe("info");
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

describe("runInit", () => {
  let tmpDir: string;
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mcp2-init-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes hardened config to project-local path", async () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await runInit({ security: "hardened", project: true, force: false });
      const configPath = join(tmpDir, "mcp-squared.toml");
      expect(existsSync(configPath)).toBe(true);
      const content = readFileSync(configPath, "utf-8");
      const parsed = parseToml(content) as Record<string, unknown>;
      const security = parsed["security"] as Record<
        string,
        Record<string, unknown>
      >;
      expect(security["tools"]!["allow"]).toEqual([]);
      expect(security["tools"]!["confirm"]).toEqual(["*:*"]);
    } finally {
      process.chdir(origCwd);
    }
  });

  test("writes permissive config to project-local path", async () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await runInit({ security: "permissive", project: true, force: false });
      const configPath = join(tmpDir, "mcp-squared.toml");
      expect(existsSync(configPath)).toBe(true);
      const content = readFileSync(configPath, "utf-8");
      const parsed = parseToml(content) as Record<string, unknown>;
      const security = parsed["security"] as Record<
        string,
        Record<string, unknown>
      >;
      expect(security["tools"]!["allow"]).toEqual(["*:*"]);
      expect(security["tools"]!["confirm"]).toEqual([]);
    } finally {
      process.chdir(origCwd);
    }
  });

  test("exits with error when config already exists (no --force)", async () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    const exitSpy = spyOn(process, "exit").mockImplementation(
      (() => {}) as never,
    );
    try {
      // Write initial config
      await runInit({ security: "hardened", project: true, force: false });
      // Try again without --force
      await runInit({ security: "hardened", project: true, force: false });
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("already exists"),
      );
    } finally {
      exitSpy.mockRestore();
      process.chdir(origCwd);
    }
  });

  test("overwrites existing config with --force", async () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      // Write initial hardened config
      await runInit({ security: "hardened", project: true, force: false });
      // Overwrite with permissive
      await runInit({ security: "permissive", project: true, force: true });
      const configPath = join(tmpDir, "mcp-squared.toml");
      const content = readFileSync(configPath, "utf-8");
      const parsed = parseToml(content) as Record<string, unknown>;
      const security = parsed["security"] as Record<
        string,
        Record<string, unknown>
      >;
      expect(security["tools"]!["allow"]).toEqual(["*:*"]);
    } finally {
      process.chdir(origCwd);
    }
  });

  test("prints next steps after writing config", async () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await runInit({ security: "hardened", project: true, force: false });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Created"),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("hardened"),
      );
    } finally {
      process.chdir(origCwd);
    }
  });
});
