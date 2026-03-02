import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { runMigrate } from "@/migrate/runner.js";

type EnvSnapshot = {
  mcpSquaredConfig?: string;
  xdgConfigHome?: string;
};

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env[key];
    delete process.env[key];
    return;
  }
  Bun.env[key] = value;
  process.env[key] = value;
}

describe("runMigrate", () => {
  let tmpDir: string;
  let configPath: string;
  let originalEnv: EnvSnapshot;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mcp2-migrate-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, "config.toml");

    originalEnv = {
      mcpSquaredConfig: Bun.env["MCP_SQUARED_CONFIG"],
      xdgConfigHome: Bun.env["XDG_CONFIG_HOME"],
    };

    setEnv("MCP_SQUARED_CONFIG", configPath);
    setEnv("XDG_CONFIG_HOME", join(tmpDir, ".xdg"));

    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();

    setEnv("MCP_SQUARED_CONFIG", originalEnv.mcpSquaredConfig);
    setEnv("XDG_CONFIG_HOME", originalEnv.xdgConfigHome);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("seeds code-search defaults when preferences are empty", async () => {
    writeFileSync(
      configPath,
      [
        "schemaVersion = 1",
        "[operations.findTools.preferredNamespacesByIntent]",
        "codeSearch = []",
      ].join("\n"),
      "utf-8",
    );

    await runMigrate({ dryRun: false });

    const parsed = parseToml(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const operations = parsed["operations"] as Record<string, unknown>;
    const findTools = operations["findTools"] as Record<string, unknown>;
    const preferences = findTools["preferredNamespacesByIntent"] as Record<
      string,
      unknown
    >;
    expect(preferences["codeSearch"]).toEqual(["auggie", "ctxdb"]);
  });

  test("skips migration when code-search preferences are already set", async () => {
    const original = [
      "schemaVersion = 1",
      "[operations.findTools.preferredNamespacesByIntent]",
      'codeSearch = ["custom-search"]',
    ].join("\n");
    writeFileSync(configPath, original, "utf-8");

    await runMigrate({ dryRun: false });

    expect(readFileSync(configPath, "utf-8")).toBe(original);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("No migration needed"),
    );
  });

  test("supports dry-run without modifying config", async () => {
    const original = [
      "schemaVersion = 1",
      "[operations.findTools.preferredNamespacesByIntent]",
      "codeSearch = []",
    ].join("\n");
    writeFileSync(configPath, original, "utf-8");

    await runMigrate({ dryRun: true });

    expect(readFileSync(configPath, "utf-8")).toBe(original);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[dry-run] Would update"),
    );
  });

  test("exits with error when no config is discoverable", async () => {
    setEnv("MCP_SQUARED_CONFIG", undefined);
    const emptyXdg = join(tmpDir, ".xdg-empty");
    mkdirSync(emptyXdg, { recursive: true });
    setEnv("XDG_CONFIG_HOME", emptyXdg);

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    try {
      try {
        await runMigrate({ dryRun: false });
      } catch {
        // Expected via mocked process.exit
      }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("No configuration file found"),
      );
    } finally {
      exitSpy.mockRestore();
      process.chdir(origCwd);
    }
  });
});
