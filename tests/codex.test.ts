import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";

import { CodexParser } from "@/import/parsers/codex";
import { getParser } from "@/import/parsers";
import { CodexWriter, getWriter } from "@/install/writers";
import { performInstallation } from "@/install";
import type { McpServerEntry } from "@/install";

describe("CodexParser", () => {
  const parser = new CodexParser();

  describe("canParse", () => {
    test("returns true for object with mcp_servers key", () => {
      expect(parser.canParse({ mcp_servers: {} })).toBe(true);
    });

    test("returns true for object with mcp_servers and other keys", () => {
      expect(
        parser.canParse({
          mcp_servers: {},
          model: "gpt-4",
        }),
      ).toBe(true);
    });

    test("returns false for object without mcp_servers key", () => {
      expect(parser.canParse({ mcpServers: {} })).toBe(false);
      expect(parser.canParse({ servers: {} })).toBe(false);
    });

    test("returns false for non-object input", () => {
      expect(parser.canParse(null)).toBe(false);
      expect(parser.canParse(undefined)).toBe(false);
      expect(parser.canParse("string")).toBe(false);
      expect(parser.canParse(123)).toBe(false);
    });
  });

  describe("parse - stdio transport", () => {
    test("parses basic stdio server", () => {
      const content = {
        mcp_servers: {
          "my-server": {
            command: "npx",
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]).toEqual({
        name: "my-server",
        command: "npx",
      });
      expect(result.warnings).toHaveLength(0);
    });

    test("parses stdio server with args and env", () => {
      const content = {
        mcp_servers: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_TOKEN: "token123" },
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]).toEqual({
        name: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "token123" },
      });
    });

    test("parses stdio server with cwd", () => {
      const content = {
        mcp_servers: {
          local: {
            command: "./run.sh",
            cwd: "/home/user/project",
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers[0]?.cwd).toBe("/home/user/project");
    });

    test("handles enabled=false as disabled=true", () => {
      const content = {
        mcp_servers: {
          disabled: {
            command: "npx",
            enabled: false,
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers[0]?.disabled).toBe(true);
    });

    test("handles enabled=true correctly", () => {
      const content = {
        mcp_servers: {
          enabled: {
            command: "npx",
            enabled: true,
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers[0]?.disabled).toBeUndefined();
    });
  });

  describe("parse - HTTP transport", () => {
    test("parses basic HTTP server with url", () => {
      const content = {
        mcp_servers: {
          remote: {
            url: "https://mcp.example.com/api",
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]).toEqual({
        name: "remote",
        url: "https://mcp.example.com/api",
      });
    });

    test("converts bearer_token_env_var to Authorization header", () => {
      const content = {
        mcp_servers: {
          remote: {
            url: "https://mcp.example.com/api",
            bearer_token_env_var: "API_TOKEN",
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers[0]?.headers).toEqual({
        Authorization: "Bearer $API_TOKEN",
      });
    });

    test("merges http_headers into headers", () => {
      const content = {
        mcp_servers: {
          remote: {
            url: "https://mcp.example.com/api",
            http_headers: {
              "X-Custom-Header": "value",
              "Content-Type": "application/json",
            },
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers[0]?.headers).toEqual({
        "X-Custom-Header": "value",
        "Content-Type": "application/json",
      });
    });

    test("converts env_http_headers to $VAR format", () => {
      const content = {
        mcp_servers: {
          remote: {
            url: "https://mcp.example.com/api",
            env_http_headers: {
              "X-API-Key": "MY_API_KEY",
            },
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers[0]?.headers).toEqual({
        "X-API-Key": "$MY_API_KEY",
      });
    });

    test("combines all header sources correctly", () => {
      const content = {
        mcp_servers: {
          remote: {
            url: "https://mcp.example.com/api",
            bearer_token_env_var: "BEARER_TOKEN",
            http_headers: {
              "X-Custom": "static-value",
            },
            env_http_headers: {
              "X-API-Key": "API_KEY_ENV",
            },
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers[0]?.headers).toEqual({
        Authorization: "Bearer $BEARER_TOKEN",
        "X-Custom": "static-value",
        "X-API-Key": "$API_KEY_ENV",
      });
    });
  });

  describe("parse - edge cases", () => {
    test("handles empty mcp_servers section", () => {
      const content = { mcp_servers: {} };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test("skips invalid server entries (no command or url)", () => {
      const content = {
        mcp_servers: {
          invalid: {
            args: ["--help"],
          },
          valid: {
            command: "npx",
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]?.name).toBe("valid");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("invalid");
    });

    test("generates warnings for enabled_tools/disabled_tools", () => {
      const content = {
        mcp_servers: {
          filtered: {
            command: "npx",
            enabled_tools: ["tool1", "tool2"],
            disabled_tools: ["slow-tool"],
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("enabled_tools/disabled_tools");
    });

    test("handles mixed stdio and HTTP servers", () => {
      const content = {
        mcp_servers: {
          local: {
            command: "npx",
            args: ["-y", "local-mcp"],
          },
          remote: {
            url: "https://remote.example.com",
          },
        },
      };

      const result = parser.parse(content, "/path/to/config.toml");

      expect(result.servers).toHaveLength(2);
      expect(result.servers.find((s) => s.name === "local")?.command).toBe(
        "npx",
      );
      expect(result.servers.find((s) => s.name === "remote")?.url).toBe(
        "https://remote.example.com",
      );
    });

    test("returns empty result if content is not an object", () => {
      const result = parser.parse(null, "/path/to/config.toml");
      expect(result.servers).toHaveLength(0);
    });

    test("returns empty result if mcp_servers is missing", () => {
      const result = parser.parse({ model: "gpt-4" }, "/path/to/config.toml");
      expect(result.servers).toHaveLength(0);
    });
  });

  describe("parser properties", () => {
    test("has correct toolId", () => {
      expect(parser.toolId).toBe("codex");
    });

    test("has correct displayName", () => {
      expect(parser.displayName).toBe("Codex CLI");
    });

    test("has correct configKey", () => {
      expect(parser.configKey).toBe("mcp_servers");
    });
  });
});

describe("CodexWriter", () => {
  const writer = new CodexWriter();

  test("uses 'mcp_servers' config key", () => {
    expect(writer.configKey).toBe("mcp_servers");
  });

  test("has correct toolId", () => {
    expect(writer.toolId).toBe("codex");
  });

  test("creates empty config with mcp_servers key", () => {
    const config = writer.createEmptyConfig();
    expect(config).toEqual({ mcp_servers: {} });
  });

  test("writes server entry in add mode", () => {
    const entry: McpServerEntry = { command: "mcp-squared" };

    const result = writer.write(null, entry, "mcp-squared", "add");

    expect(result).toEqual({
      mcp_servers: {
        "mcp-squared": { command: "mcp-squared" },
      },
    });
  });

  test("preserves existing servers in add mode", () => {
    const existing = {
      mcp_servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      },
    };
    const entry: McpServerEntry = { command: "mcp-squared" };

    const result = writer.write(existing, entry, "mcp-squared", "add");

    expect(result).toEqual({
      mcp_servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
        "mcp-squared": { command: "mcp-squared" },
      },
    });
  });

  test("replaces all servers in replace mode", () => {
    const existing = {
      mcp_servers: {
        github: { command: "npx" },
        slack: { command: "npx" },
      },
    };
    const entry: McpServerEntry = { command: "mcp-squared" };

    const result = writer.write(existing, entry, "mcp-squared", "replace");

    expect(result).toEqual({
      mcp_servers: {
        "mcp-squared": { command: "mcp-squared" },
      },
    });
  });

  test("preserves other Codex config sections", () => {
    const existing = {
      model: "gpt-4",
      api_key_env_var: "OPENAI_API_KEY",
      mcp_servers: {},
    };
    const entry: McpServerEntry = { command: "mcp-squared" };

    const result = writer.write(existing, entry, "mcp-squared", "add");

    expect(result).toEqual({
      model: "gpt-4",
      api_key_env_var: "OPENAI_API_KEY",
      mcp_servers: {
        "mcp-squared": { command: "mcp-squared" },
      },
    });
  });

  test("includes args if present", () => {
    const entry: McpServerEntry = {
      command: "mcp-squared",
      args: ["--debug"],
    };

    const result = writer.write(null, entry, "mcp-squared", "add");

    expect(result).toEqual({
      mcp_servers: {
        "mcp-squared": {
          command: "mcp-squared",
          args: ["--debug"],
        },
      },
    });
  });

  test("includes env if present", () => {
    const entry: McpServerEntry = {
      command: "mcp-squared",
      env: { DEBUG: "true" },
    };

    const result = writer.write(null, entry, "mcp-squared", "add");

    expect(result).toEqual({
      mcp_servers: {
        "mcp-squared": {
          command: "mcp-squared",
          env: { DEBUG: "true" },
        },
      },
    });
  });

  test("omits empty args array", () => {
    const entry: McpServerEntry = {
      command: "mcp-squared",
      args: [],
    };

    const result = writer.write(null, entry, "mcp-squared", "add");

    expect(result).toEqual({
      mcp_servers: {
        "mcp-squared": {
          command: "mcp-squared",
        },
      },
    });
  });

  test("omits empty env object", () => {
    const entry: McpServerEntry = {
      command: "mcp-squared",
      env: {},
    };

    const result = writer.write(null, entry, "mcp-squared", "add");

    expect(result).toEqual({
      mcp_servers: {
        "mcp-squared": {
          command: "mcp-squared",
        },
      },
    });
  });

  test("hasServer returns true for existing server", () => {
    const config = {
      mcp_servers: {
        "mcp-squared": { command: "mcp-squared" },
      },
    };

    expect(writer.hasServer(config, "mcp-squared")).toBe(true);
    expect(writer.hasServer(config, "other")).toBe(false);
  });

  test("getServer returns existing server entry", () => {
    const config = {
      mcp_servers: {
        "mcp-squared": { command: "mcp-squared", args: ["--debug"] },
      },
    };

    const server = writer.getServer(config, "mcp-squared");
    expect(server).toEqual({ command: "mcp-squared", args: ["--debug"] });
  });
});

describe("getWriter for codex", () => {
  test("returns CodexWriter for codex", () => {
    const writer = getWriter("codex");
    expect(writer).toBeInstanceOf(CodexWriter);
  });
});

describe("getParser for codex", () => {
  test("returns CodexParser for codex", () => {
    const parser = getParser("codex");
    expect(parser).toBeInstanceOf(CodexParser);
  });
});

describe("performInstallation for Codex", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `mcp-squared-codex-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates new TOML config file for codex", () => {
    const configPath = join(tempDir, "config.toml");

    const result = performInstallation({
      tool: "codex",
      path: configPath,
      scope: "user",
      mode: "add",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);

    const content = readFileSync(configPath, "utf-8");
    // TOML format check
    expect(content).toContain("[mcp_servers");
    expect(content).toContain("mcp-squared");
    expect(content).toContain('command = "mcp-squared"');
  });

  test("modifies existing TOML config in add mode", () => {
    const configPath = join(tempDir, "config.toml");
    const existingToml = stringifyToml({
      model: "gpt-4",
      mcp_servers: {
        github: { command: "npx", args: ["-y", "github-mcp"] },
      },
    });
    writeFileSync(configPath, existingToml);

    const result = performInstallation({
      tool: "codex",
      path: configPath,
      scope: "user",
      mode: "add",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.created).toBe(false);
    expect(result.backupPath).toBeDefined();

    const content = readFileSync(configPath, "utf-8");
    // Should preserve existing server
    expect(content).toContain("github");
    // Should add new server
    expect(content).toContain("mcp-squared");
    // Should preserve other settings
    expect(content).toContain("model");
  });

  test("replaces all servers in replace mode for codex", () => {
    const configPath = join(tempDir, "config.toml");
    const existingToml = stringifyToml({
      mcp_servers: {
        github: { command: "npx" },
        slack: { command: "npx" },
      },
    });
    writeFileSync(configPath, existingToml);

    const result = performInstallation({
      tool: "codex",
      path: configPath,
      scope: "user",
      mode: "replace",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: false,
    });

    expect(result.success).toBe(true);

    const content = readFileSync(configPath, "utf-8");
    // Only mcp-squared should remain
    expect(content).toContain("mcp-squared");
    expect(content).not.toContain("github");
    expect(content).not.toContain("slack");
  });

  test("handles invalid TOML gracefully", () => {
    const configPath = join(tempDir, "config.toml");
    writeFileSync(configPath, "invalid toml content [[[");

    const result = performInstallation({
      tool: "codex",
      path: configPath,
      scope: "user",
      mode: "add",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  test("dry run doesn't modify TOML file", () => {
    const configPath = join(tempDir, "config.toml");
    const original = stringifyToml({
      mcp_servers: { existing: { command: "test" } },
    });
    writeFileSync(configPath, original);

    const result = performInstallation({
      tool: "codex",
      path: configPath,
      scope: "user",
      mode: "replace",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(readFileSync(configPath, "utf-8")).toBe(original);
  });
});
