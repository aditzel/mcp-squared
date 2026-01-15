import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigSchema,
  ConfigValidationError,
  DEFAULT_CONFIG,
  type McpSquaredConfig,
  UnknownSchemaVersionError,
  discoverConfigPath,
  loadConfig,
  loadConfigFromPath,
  migrateConfig,
  saveConfig,
} from "@/config";
import { ZodError } from "zod";

describe("ConfigSchema", () => {
  test("parses empty object with defaults", () => {
    const result = ConfigSchema.parse({});
    expect(result.schemaVersion).toBe(1);
    expect(result.upstreams).toEqual({});
    expect(result.security.tools.allow).toEqual(["*:*"]);
    expect(result.security.tools.block).toEqual([]);
    expect(result.operations.findTools.defaultLimit).toBe(5);
    expect(result.operations.logging.level).toBe("info");
  });

  test("parses valid stdio upstream", () => {
    const config = ConfigSchema.parse({
      upstreams: {
        github: {
          transport: "stdio",
          stdio: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
          },
        },
      },
    });
    expect(config.upstreams["github"]).toBeDefined();
    const upstream = config.upstreams["github"];
    expect(upstream?.transport).toBe("stdio");
    if (upstream?.transport === "stdio") {
      expect(upstream.stdio.command).toBe("npx");
    }
  });

  test("parses valid sse upstream", () => {
    const config = ConfigSchema.parse({
      upstreams: {
        remote: {
          transport: "sse",
          sse: {
            url: "https://example.com/mcp/sse",
          },
        },
      },
    });
    const upstream = config.upstreams["remote"];
    expect(upstream?.transport).toBe("sse");
    if (upstream?.transport === "sse") {
      expect(upstream.sse.url).toBe("https://example.com/mcp/sse");
    }
  });

  test("rejects invalid upstream transport", () => {
    expect(() =>
      ConfigSchema.parse({
        upstreams: {
          bad: {
            transport: "invalid",
          },
        },
      }),
    ).toThrow();
  });

  test("rejects invalid log level", () => {
    expect(() =>
      ConfigSchema.parse({
        operations: {
          logging: {
            level: "invalid",
          },
        },
      }),
    ).toThrow();
  });
});

describe("DEFAULT_CONFIG", () => {
  test("has expected structure", () => {
    expect(DEFAULT_CONFIG.schemaVersion).toBe(1);
    expect(DEFAULT_CONFIG.upstreams).toEqual({});
    expect(DEFAULT_CONFIG.security.tools.allow).toEqual(["*:*"]);
    expect(DEFAULT_CONFIG.operations.findTools.defaultLimit).toBe(5);
  });
});

describe("migrateConfig", () => {
  test("sets schemaVersion to latest", () => {
    const result = migrateConfig({});
    expect(result["schemaVersion"]).toBe(1);
  });

  test("preserves existing config", () => {
    const input = {
      schemaVersion: 1,
      operations: { logging: { level: "debug" } },
    };
    const result = migrateConfig(input);
    expect(result["operations"]).toEqual({ logging: { level: "debug" } });
  });

  test("throws UnknownSchemaVersionError for future schema version", () => {
    expect(() => migrateConfig({ schemaVersion: 999 })).toThrow(
      UnknownSchemaVersionError,
    );
  });

  test("UnknownSchemaVersionError includes version details", () => {
    try {
      migrateConfig({ schemaVersion: 999 });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownSchemaVersionError);
      const err = e as UnknownSchemaVersionError;
      expect(err.version).toBe(999);
      expect(err.latestVersion).toBe(1);
      expect(err.message).toContain("999");
      expect(err.message).toContain("1");
    }
  });

  test("migrates from version 0 (no schemaVersion)", () => {
    const result = migrateConfig({ upstreams: {} });
    expect(result["schemaVersion"]).toBe(1);
  });
});

describe("ConfigError classes", () => {
  test("ConfigError stores cause", () => {
    const cause = new Error("root cause");
    const err = new ConfigError("message", cause);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("ConfigError");
    expect(err.message).toBe("message");
  });

  test("ConfigError works without cause", () => {
    const err = new ConfigError("message only");
    expect(err.cause).toBeUndefined();
    expect(err.message).toBe("message only");
  });

  test("ConfigNotFoundError has correct name and message", () => {
    const err = new ConfigNotFoundError();
    expect(err.name).toBe("ConfigNotFoundError");
    expect(err.message).toBe("No configuration file found");
    expect(err).toBeInstanceOf(ConfigError);
  });

  test("ConfigParseError includes file path", () => {
    const cause = new Error("parse failed");
    const err = new ConfigParseError("/path/to/config.toml", cause);
    expect(err.name).toBe("ConfigParseError");
    expect(err.filePath).toBe("/path/to/config.toml");
    expect(err.message).toContain("/path/to/config.toml");
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(ConfigError);
  });

  test("ConfigValidationError formats Zod issues", () => {
    const zodError = new ZodError([
      {
        path: ["upstreams", "test", "stdio", "command"],
        message: "Required",
        code: "invalid_type",
        expected: "string",
      },
    ]);
    const err = new ConfigValidationError("/path/config.toml", zodError);
    expect(err.name).toBe("ConfigValidationError");
    expect(err.filePath).toBe("/path/config.toml");
    expect(err.zodError).toBe(zodError);
    expect(err.message).toContain("upstreams.test.stdio.command");
    expect(err.message).toContain("Required");
    expect(err).toBeInstanceOf(ConfigError);
  });

  test("ConfigValidationError handles multiple issues", () => {
    const zodError = new ZodError([
      { path: ["field1"], message: "Error 1", code: "custom" },
      { path: ["field2"], message: "Error 2", code: "custom" },
    ]);
    const err = new ConfigValidationError("/config.toml", zodError);
    expect(err.message).toContain("field1");
    expect(err.message).toContain("field2");
    expect(err.message).toContain("Error 1");
    expect(err.message).toContain("Error 2");
  });
});

describe("discoverConfigPath", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `mcp-squared-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns null when no config exists", () => {
    const result = discoverConfigPath(tempDir);
    expect(result).toBeNull();
  });

  test("finds project-local config", () => {
    const configPath = join(tempDir, "mcp-squared.toml");
    writeFileSync(configPath, "schemaVersion = 1\n");
    const result = discoverConfigPath(tempDir);
    expect(result).not.toBeNull();
    expect(result?.source).toBe("project");
    expect(result?.path).toBe(configPath);
  });

  test("finds hidden directory config", () => {
    const configDir = join(tempDir, ".mcp-squared");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    writeFileSync(configPath, "schemaVersion = 1\n");
    const result = discoverConfigPath(tempDir);
    expect(result).not.toBeNull();
    expect(result?.source).toBe("project");
  });
});

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `mcp-squared-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns default config when no file exists", async () => {
    const result = await loadConfig(tempDir);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  test("loads and validates config file", async () => {
    const configPath = join(tempDir, "mcp-squared.toml");
    writeFileSync(
      configPath,
      `
schemaVersion = 1

[operations.logging]
level = "debug"
`,
    );
    const result = await loadConfig(tempDir);
    expect(result.config.operations.logging.level).toBe("debug");
    expect(result.source).toBe("project");
  });

  test("throws on invalid TOML", async () => {
    const configPath = join(tempDir, "mcp-squared.toml");
    writeFileSync(configPath, "invalid [ toml");
    await expect(loadConfig(tempDir)).rejects.toThrow();
  });

  test("throws on invalid config values", async () => {
    const configPath = join(tempDir, "mcp-squared.toml");
    writeFileSync(
      configPath,
      `
schemaVersion = 1

[operations.logging]
level = "invalid"
`,
    );
    await expect(loadConfig(tempDir)).rejects.toThrow();
  });
});

describe("saveConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `mcp-squared-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("saves config to file", async () => {
    const configPath = join(tempDir, "config.toml");
    await saveConfig(configPath, DEFAULT_CONFIG);
    const result = await loadConfigFromPath(configPath, "user");
    expect(result.config.schemaVersion).toBe(1);
  });

  test("creates parent directories", async () => {
    const configPath = join(tempDir, "subdir", "nested", "config.toml");
    await saveConfig(configPath, DEFAULT_CONFIG);
    const result = await loadConfigFromPath(configPath, "user");
    expect(result.config.schemaVersion).toBe(1);
  });

  test("saves upstream configurations", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        test: {
          transport: "stdio",
          enabled: true,
          env: {},
          stdio: {
            command: "echo",
            args: ["hello"],
          },
        },
      },
    };
    const configPath = join(tempDir, "config.toml");
    await saveConfig(configPath, config);
    const result = await loadConfigFromPath(configPath, "user");
    expect(result.config.upstreams["test"]).toBeDefined();
  });
});
