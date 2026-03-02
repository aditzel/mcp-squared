import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigNotFoundError,
  ConfigParseError,
  ConfigValidationError,
  loadConfig,
  loadConfigFromPath,
  loadConfigFromPathSync,
  loadConfigSync,
} from "@/config/load";
import { ConfigSaveError, saveConfig, saveConfigSync } from "@/config/save";
import { DEFAULT_CONFIG } from "@/config/schema";

describe("config load/save io", () => {
  let tempRoot = "";
  let originalXdgConfigHome: string | undefined;
  let originalMcpSquaredConfig: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "mcp-squared-config-io-"));
    originalXdgConfigHome = process.env["XDG_CONFIG_HOME"];
    originalMcpSquaredConfig = process.env["MCP_SQUARED_CONFIG"];

    process.env["XDG_CONFIG_HOME"] = join(tempRoot, "xdg");
    mkdirSync(process.env["XDG_CONFIG_HOME"], { recursive: true });
    delete process.env["MCP_SQUARED_CONFIG"];
  });

  afterEach(() => {
    if (originalXdgConfigHome === undefined) {
      delete process.env["XDG_CONFIG_HOME"];
    } else {
      process.env["XDG_CONFIG_HOME"] = originalXdgConfigHome;
    }

    if (originalMcpSquaredConfig === undefined) {
      delete process.env["MCP_SQUARED_CONFIG"];
    } else {
      process.env["MCP_SQUARED_CONFIG"] = originalMcpSquaredConfig;
    }

    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("saveConfig and saveConfigSync write TOML files", async () => {
    const asyncPath = join(tempRoot, "nested", "config-async.toml");
    const syncPath = join(tempRoot, "nested", "config-sync.toml");

    await saveConfig(asyncPath, DEFAULT_CONFIG);
    saveConfigSync(syncPath, DEFAULT_CONFIG);

    const asyncContent = readFileSync(asyncPath, "utf-8");
    const syncContent = readFileSync(syncPath, "utf-8");

    expect(asyncContent).toContain("schemaVersion = 1");
    expect(syncContent).toContain("schemaVersion = 1");
  });

  test("saveConfig and saveConfigSync wrap write failures in ConfigSaveError", async () => {
    const dirPath = join(tempRoot, "not-a-file");
    mkdirSync(dirPath, { recursive: true });

    await expect(saveConfig(dirPath, DEFAULT_CONFIG)).rejects.toBeInstanceOf(
      ConfigSaveError,
    );
    expect(() => saveConfigSync(dirPath, DEFAULT_CONFIG)).toThrow(
      ConfigSaveError,
    );
  });

  test("loadConfigFromPath and loadConfigFromPathSync throw when file is missing", async () => {
    const missing = join(tempRoot, "missing.toml");

    await expect(loadConfigFromPath(missing, "project")).rejects.toBeInstanceOf(
      ConfigNotFoundError,
    );
    expect(() => loadConfigFromPathSync(missing, "project")).toThrow(
      ConfigNotFoundError,
    );
  });

  test("loadConfigFromPath and loadConfigFromPathSync throw parse errors for invalid TOML", async () => {
    const filePath = join(tempRoot, "invalid.toml");
    writeFileSync(filePath, "schemaVersion = 1\n[broken", "utf-8");

    await expect(
      loadConfigFromPath(filePath, "project"),
    ).rejects.toBeInstanceOf(ConfigParseError);
    expect(() => loadConfigFromPathSync(filePath, "project")).toThrow(
      ConfigParseError,
    );
  });

  test("loadConfigFromPath and loadConfigFromPathSync throw validation errors for invalid shape", async () => {
    const filePath = join(tempRoot, "invalid-schema.toml");
    writeFileSync(
      filePath,
      'schemaVersion = 1\nupstreams = "invalid"\n',
      "utf-8",
    );

    await expect(
      loadConfigFromPath(filePath, "project"),
    ).rejects.toBeInstanceOf(ConfigValidationError);
    expect(() => loadConfigFromPathSync(filePath, "project")).toThrow(
      ConfigValidationError,
    );
  });

  test("loadConfigFromPath and loadConfigFromPathSync return validated config for valid TOML", async () => {
    const filePath = join(tempRoot, "valid.toml");
    saveConfigSync(filePath, DEFAULT_CONFIG);

    const asyncResult = await loadConfigFromPath(filePath, "project");
    const syncResult = loadConfigFromPathSync(filePath, "project");

    expect(asyncResult.source).toBe("project");
    expect(syncResult.source).toBe("project");
    expect(asyncResult.path).toBe(filePath);
    expect(syncResult.path).toBe(filePath);
    expect(asyncResult.config).toEqual(DEFAULT_CONFIG);
    expect(syncResult.config).toEqual(DEFAULT_CONFIG);
  });

  test("loadConfig and loadConfigSync return default config when no file is discovered", async () => {
    const cwd = join(tempRoot, "workspace");
    mkdirSync(cwd, { recursive: true });

    const asyncResult = await loadConfig(cwd);
    const syncResult = loadConfigSync(cwd);

    expect(asyncResult.source).toBe("user");
    expect(syncResult.source).toBe("user");
    expect(asyncResult.path).toContain("mcp-squared/config.toml");
    expect(syncResult.path).toContain("mcp-squared/config.toml");
    expect(asyncResult.config).toEqual(DEFAULT_CONFIG);
    expect(syncResult.config).toEqual(DEFAULT_CONFIG);
  });
});
