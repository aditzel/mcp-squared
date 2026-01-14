import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigSchema,
  DEFAULT_CONFIG,
  type McpSquaredConfig,
  discoverConfigPath,
  formatValidationIssues,
  loadConfig,
  loadConfigFromPath,
  migrateConfig,
  saveConfig,
  validateConfig,
  validateStdioUpstream,
} from "@/config";

describe("ConfigSchema", () => {
  test("parses empty object with defaults", () => {
    const result = ConfigSchema.parse({});
    expect(result.schemaVersion).toBe(1);
    expect(result.upstreams).toEqual({});
    expect(result.security.tools.allow).toEqual(["*:*"]);
    expect(result.security.tools.block).toEqual([]);
    expect(result.operations.findTools.defaultLimit).toBe(5);
    expect(result.operations.findTools.defaultDetailLevel).toBe("L1");
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
    expect(DEFAULT_CONFIG.operations.findTools.defaultDetailLevel).toBe("L1");
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

  test("returns null or user config when no project config exists", () => {
    const result = discoverConfigPath(tempDir);
    // Either no config or user config is acceptable
    // (depends on whether ~/.config/mcp-squared/config.toml exists)
    if (result !== null) {
      expect(result.source).toBe("user");
    }
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

  test("returns default or user config when no project config exists", async () => {
    const result = await loadConfig(tempDir);
    // If a user config exists, it will be loaded
    // Otherwise, default config is returned
    if (result.source) {
      expect(result.source).toBe("user");
    } else {
      expect(result.config).toEqual(DEFAULT_CONFIG);
    }
    // Config should always be valid
    expect(result.config.schemaVersion).toBe(1);
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

describe("validateStdioUpstream", () => {
  test("detects npx with empty args", () => {
    const issues = validateStdioUpstream("test-upstream", {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: {
        command: "npx",
        args: [],
      },
    });
    expect(issues.length).toBe(1);
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain("requires arguments");
    expect(issues[0]?.upstream).toBe("test-upstream");
  });

  test("detects bunx with empty args", () => {
    const issues = validateStdioUpstream("test", {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: {
        command: "bunx",
        args: [],
      },
    });
    expect(issues.length).toBe(1);
    expect(issues[0]?.severity).toBe("error");
  });

  test("detects node with empty args", () => {
    const issues = validateStdioUpstream("test", {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: {
        command: "node",
        args: [],
      },
    });
    expect(issues.length).toBe(1);
    expect(issues[0]?.severity).toBe("error");
  });

  test("detects bash with empty args", () => {
    const issues = validateStdioUpstream("test", {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: {
        command: "bash",
        args: [],
      },
    });
    expect(issues.length).toBe(1);
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain("read from stdin");
  });

  test("detects docker with empty args", () => {
    const issues = validateStdioUpstream("test", {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: {
        command: "docker",
        args: [],
      },
    });
    expect(issues.length).toBe(1);
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain("docker");
  });

  test("accepts valid npx config", () => {
    const issues = validateStdioUpstream("test", {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
      },
    });
    expect(issues.length).toBe(0);
  });

  test("accepts command with empty args when appropriate", () => {
    const issues = validateStdioUpstream("test", {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: {
        command: "/path/to/my-mcp-server",
        args: [],
      },
    });
    expect(issues.length).toBe(0);
  });
});

describe("validateConfig", () => {
  test("finds issues in multiple upstreams", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        broken1: {
          transport: "stdio",
          enabled: true,
          env: {},
          stdio: { command: "npx", args: [] },
        },
        broken2: {
          transport: "stdio",
          enabled: true,
          env: {},
          stdio: { command: "bash", args: [] },
        },
        working: {
          transport: "stdio",
          enabled: true,
          env: {},
          stdio: { command: "npx", args: ["-y", "some-package"] },
        },
      },
    };
    const issues = validateConfig(config);
    expect(issues.length).toBe(2);
    expect(issues.map((i) => i.upstream).sort()).toEqual(["broken1", "broken2"]);
  });

  test("skips disabled upstreams", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        disabled: {
          transport: "stdio",
          enabled: false,
          env: {},
          stdio: { command: "npx", args: [] },
        },
      },
    };
    const issues = validateConfig(config);
    expect(issues.length).toBe(0);
  });

  test("handles SSE upstreams without issues", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        remote: {
          transport: "sse",
          enabled: true,
          env: {},
          sse: { url: "https://example.com/mcp", headers: {} },
        },
      },
    };
    const issues = validateConfig(config);
    expect(issues.length).toBe(0);
  });
});

describe("formatValidationIssues", () => {
  test("formats errors", () => {
    const output = formatValidationIssues([
      {
        severity: "error",
        upstream: "test",
        message: "Test error",
        suggestion: "Fix it",
      },
    ]);
    expect(output).toContain("Configuration Errors");
    expect(output).toContain("test");
    expect(output).toContain("Test error");
    expect(output).toContain("Fix it");
  });

  test("returns empty string for no issues", () => {
    const output = formatValidationIssues([]);
    expect(output).toBe("");
  });
});
