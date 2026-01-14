import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "@/cli";
import {
  StandardMcpServersWriter,
  VSCodeWriter,
  ZedWriter,
  createBackup,
  discoverAvailableTools,
  getToolDisplayName,
  getWriter,
  isValidInstallMode,
  isValidInstallScope,
  performInstallation,
} from "@/install";
import type { McpServerEntry } from "@/install";

describe("isValidInstallMode", () => {
  test("accepts 'replace'", () => {
    expect(isValidInstallMode("replace")).toBe(true);
  });

  test("accepts 'add'", () => {
    expect(isValidInstallMode("add")).toBe(true);
  });

  test("rejects invalid modes", () => {
    expect(isValidInstallMode("invalid")).toBe(false);
    expect(isValidInstallMode("")).toBe(false);
    expect(isValidInstallMode("skip")).toBe(false);
    expect(isValidInstallMode("REPLACE")).toBe(false);
  });
});

describe("isValidInstallScope", () => {
  test("accepts 'user'", () => {
    expect(isValidInstallScope("user")).toBe(true);
  });

  test("accepts 'project'", () => {
    expect(isValidInstallScope("project")).toBe(true);
  });

  test("rejects invalid scopes", () => {
    expect(isValidInstallScope("invalid")).toBe(false);
    expect(isValidInstallScope("")).toBe(false);
    expect(isValidInstallScope("both")).toBe(false);
    expect(isValidInstallScope("USER")).toBe(false);
  });
});

describe("createBackup", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `mcp-squared-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns undefined for non-existent file", () => {
    const result = createBackup(join(tempDir, "nonexistent.json"));
    expect(result).toBeUndefined();
  });

  test("creates .bak file for existing file", () => {
    const filePath = join(tempDir, "config.json");
    writeFileSync(filePath, '{"test": true}');

    const backupPath = createBackup(filePath);

    expect(backupPath).toBe(`${filePath}.bak`);
    expect(readFileSync(backupPath!, "utf-8")).toBe('{"test": true}');
  });

  test("creates timestamped backup if .bak exists", () => {
    const filePath = join(tempDir, "config.json");
    writeFileSync(filePath, '{"version": 1}');
    writeFileSync(`${filePath}.bak`, '{"version": 0}');

    const backupPath = createBackup(filePath);

    expect(backupPath).toBeDefined();
    expect(backupPath).not.toBe(`${filePath}.bak`);
    expect(backupPath).toContain(".bak");
    expect(readFileSync(backupPath!, "utf-8")).toBe('{"version": 1}');
  });
});

describe("StandardMcpServersWriter", () => {
  test("uses 'mcpServers' config key", () => {
    const writer = new StandardMcpServersWriter("cursor");
    expect(writer.configKey).toBe("mcpServers");
  });

  test("creates empty config", () => {
    const writer = new StandardMcpServersWriter("cursor");
    const config = writer.createEmptyConfig();
    expect(config).toEqual({ mcpServers: {} });
  });

  test("writes server entry in add mode", () => {
    const writer = new StandardMcpServersWriter("cursor");
    const entry: McpServerEntry = { command: "mcp-squared" };

    const result = writer.write(null, entry, "mcp-squared", "add");

    expect(result).toEqual({
      mcpServers: {
        "mcp-squared": { command: "mcp-squared" },
      },
    });
  });

  test("preserves existing servers in add mode", () => {
    const writer = new StandardMcpServersWriter("cursor");
    const existing = {
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      },
    };
    const entry: McpServerEntry = { command: "mcp-squared" };

    const result = writer.write(existing, entry, "mcp-squared", "add");

    expect(result).toEqual({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
        "mcp-squared": { command: "mcp-squared" },
      },
    });
  });

  test("replaces all servers in replace mode", () => {
    const writer = new StandardMcpServersWriter("cursor");
    const existing = {
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
        slack: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-slack"],
        },
      },
    };
    const entry: McpServerEntry = { command: "mcp-squared" };

    const result = writer.write(existing, entry, "mcp-squared", "replace");

    expect(result).toEqual({
      mcpServers: {
        "mcp-squared": { command: "mcp-squared" },
      },
    });
  });

  test("hasServer returns true for existing server", () => {
    const writer = new StandardMcpServersWriter("cursor");
    const config = {
      mcpServers: {
        "mcp-squared": { command: "mcp-squared" },
      },
    };

    expect(writer.hasServer(config, "mcp-squared")).toBe(true);
    expect(writer.hasServer(config, "other")).toBe(false);
  });

  test("getServer returns existing server entry", () => {
    const writer = new StandardMcpServersWriter("cursor");
    const config = {
      mcpServers: {
        "mcp-squared": { command: "mcp-squared", args: ["--debug"] },
      },
    };

    const server = writer.getServer(config, "mcp-squared");
    expect(server).toEqual({ command: "mcp-squared", args: ["--debug"] });
  });
});

describe("VSCodeWriter", () => {
  test("uses 'servers' config key", () => {
    const writer = new VSCodeWriter();
    expect(writer.configKey).toBe("servers");
  });

  test("creates empty config with servers key", () => {
    const writer = new VSCodeWriter();
    const config = writer.createEmptyConfig();
    expect(config).toEqual({ servers: {} });
  });

  test("writes server entry", () => {
    const writer = new VSCodeWriter();
    const entry: McpServerEntry = { command: "mcp-squared" };

    const result = writer.write(null, entry, "mcp-squared", "add");

    expect(result).toEqual({
      servers: {
        "mcp-squared": { command: "mcp-squared" },
      },
    });
  });
});

describe("ZedWriter", () => {
  test("uses 'context_servers' config key", () => {
    const writer = new ZedWriter();
    expect(writer.configKey).toBe("context_servers");
  });

  test("creates config with context_servers key", () => {
    const writer = new ZedWriter();
    const config = writer.createEmptyConfig();
    expect(config).toEqual({ context_servers: {} });
  });

  test("preserves other Zed settings when writing", () => {
    const writer = new ZedWriter();
    const existing = {
      theme: "One Dark",
      telemetry: { diagnostics: false },
      context_servers: {},
    };
    const entry: McpServerEntry = { command: "mcp-squared" };

    const result = writer.write(existing, entry, "mcp-squared", "add");

    expect(result).toEqual({
      theme: "One Dark",
      telemetry: { diagnostics: false },
      context_servers: {
        "mcp-squared": { command: "mcp-squared" },
      },
    });
  });
});

describe("getWriter", () => {
  test("returns VSCodeWriter for vscode", () => {
    const writer = getWriter("vscode");
    expect(writer).toBeInstanceOf(VSCodeWriter);
  });

  test("returns ZedWriter for zed", () => {
    const writer = getWriter("zed");
    expect(writer).toBeInstanceOf(ZedWriter);
  });

  test("returns StandardMcpServersWriter for other tools", () => {
    const cursorWriter = getWriter("cursor");
    expect(cursorWriter).toBeInstanceOf(StandardMcpServersWriter);
    expect(cursorWriter.configKey).toBe("mcpServers");

    const claudeWriter = getWriter("claude-desktop");
    expect(claudeWriter).toBeInstanceOf(StandardMcpServersWriter);
  });
});

describe("getToolDisplayName", () => {
  test("returns display names for known tools", () => {
    expect(getToolDisplayName("claude-desktop")).toBe("Claude Desktop");
    expect(getToolDisplayName("cursor")).toBe("Cursor");
    expect(getToolDisplayName("vscode")).toBe("VS Code");
    expect(getToolDisplayName("zed")).toBe("Zed");
    expect(getToolDisplayName("factory")).toBe("Factory.ai");
  });
});

describe("discoverAvailableTools", () => {
  test("returns list of tools", () => {
    const tools = discoverAvailableTools();

    expect(Array.isArray(tools)).toBe(true);
    // Should have at least some tools available
    expect(tools.length).toBeGreaterThan(0);

    // Each tool should have required properties
    for (const tool of tools) {
      expect(tool.tool).toBeDefined();
      expect(tool.displayName).toBeDefined();
      expect(tool.scopes.length).toBeGreaterThan(0);
      expect(tool.paths).toBeDefined();
    }
  });

  test("tools have valid scopes", () => {
    const tools = discoverAvailableTools();

    for (const tool of tools) {
      for (const scope of tool.scopes) {
        expect(["user", "project"]).toContain(scope);
      }
    }
  });
});

describe("performInstallation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `mcp-squared-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates new config file if it doesn't exist", () => {
    const configPath = join(tempDir, "mcp.json");

    const result = performInstallation({
      tool: "cursor",
      path: configPath,
      scope: "user",
      mode: "add",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.backupPath).toBeUndefined();

    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content).toEqual({
      mcpServers: {
        "mcp-squared": { command: "mcp-squared" },
      },
    });
  });

  test("modifies existing config file in add mode", () => {
    const configPath = join(tempDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", args: ["-y", "github-mcp"] },
        },
      }),
    );

    const result = performInstallation({
      tool: "cursor",
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

    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.mcpServers["github"]).toBeDefined();
    expect(content.mcpServers["mcp-squared"]).toEqual({
      command: "mcp-squared",
    });
  });

  test("replaces all servers in replace mode", () => {
    const configPath = join(tempDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", args: ["-y", "github-mcp"] },
          slack: { command: "npx", args: ["-y", "slack-mcp"] },
        },
      }),
    );

    const result = performInstallation({
      tool: "cursor",
      path: configPath,
      scope: "user",
      mode: "replace",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: false,
    });

    expect(result.success).toBe(true);

    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(Object.keys(content.mcpServers)).toEqual(["mcp-squared"]);
  });

  test("dry run doesn't modify file", () => {
    const configPath = join(tempDir, "mcp.json");
    const original = JSON.stringify({
      mcpServers: { existing: { command: "test" } },
    });
    writeFileSync(configPath, original);

    const result = performInstallation({
      tool: "cursor",
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

  test("creates parent directories if needed", () => {
    const configPath = join(tempDir, "subdir", "nested", "mcp.json");

    const result = performInstallation({
      tool: "cursor",
      path: configPath,
      scope: "user",
      mode: "add",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);

    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.mcpServers["mcp-squared"]).toBeDefined();
  });

  test("handles invalid JSON gracefully", () => {
    const configPath = join(tempDir, "mcp.json");
    writeFileSync(configPath, "invalid json content");

    const result = performInstallation({
      tool: "cursor",
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

  test("reports when server already exists with same config", () => {
    const configPath = join(tempDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          "mcp-squared": { command: "mcp-squared" },
        },
      }),
    );

    const result = performInstallation({
      tool: "cursor",
      path: configPath,
      scope: "user",
      mode: "add",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.error).toContain("already exists");
  });

  test("works with VS Code format", () => {
    const configPath = join(tempDir, "mcp.json");

    const result = performInstallation({
      tool: "vscode",
      path: configPath,
      scope: "user",
      mode: "add",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: false,
    });

    expect(result.success).toBe(true);

    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.servers["mcp-squared"]).toBeDefined();
  });

  test("works with Zed format", () => {
    const configPath = join(tempDir, "settings.json");

    const result = performInstallation({
      tool: "zed",
      path: configPath,
      scope: "user",
      mode: "add",
      serverName: "mcp-squared",
      command: "mcp-squared",
      dryRun: false,
    });

    expect(result.success).toBe(true);

    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.context_servers["mcp-squared"]).toBeDefined();
  });
});

describe("CLI argument parsing for install", () => {
  test("parses 'install' command", () => {
    const result = parseArgs(["install"]);
    expect(result.mode).toBe("install");
  });

  test("parses install with --tool option", () => {
    const result = parseArgs(["install", "--tool=cursor"]);
    expect(result.mode).toBe("install");
    expect(result.install.tool).toBe("cursor");
  });

  test("parses install with --scope option", () => {
    const result = parseArgs(["install", "--scope=user"]);
    expect(result.mode).toBe("install");
    expect(result.install.scope).toBe("user");
  });

  test("parses install with --mode option", () => {
    const result = parseArgs(["install", "--mode=replace"]);
    expect(result.mode).toBe("install");
    expect(result.install.mode).toBe("replace");
  });

  test("parses install with --name option", () => {
    const result = parseArgs(["install", "--name=my-mcp"]);
    expect(result.mode).toBe("install");
    expect(result.install.serverName).toBe("my-mcp");
  });

  test("parses install with --command option", () => {
    const result = parseArgs([
      "install",
      "--command=/usr/local/bin/mcp-squared",
    ]);
    expect(result.mode).toBe("install");
    expect(result.install.command).toBe("/usr/local/bin/mcp-squared");
  });

  test("parses install with --dry-run option", () => {
    const result = parseArgs(["install", "--dry-run"]);
    expect(result.mode).toBe("install");
    expect(result.install.dryRun).toBe(true);
  });

  test("parses install with --no-interactive option", () => {
    const result = parseArgs(["install", "--no-interactive"]);
    expect(result.mode).toBe("install");
    expect(result.install.interactive).toBe(false);
  });

  test("parses full non-interactive install command", () => {
    const result = parseArgs([
      "install",
      "--tool=cursor",
      "--scope=user",
      "--mode=add",
      "--name=mcp2",
      "--no-interactive",
    ]);

    expect(result.mode).toBe("install");
    expect(result.install.tool).toBe("cursor");
    expect(result.install.scope).toBe("user");
    expect(result.install.mode).toBe("add");
    expect(result.install.serverName).toBe("mcp2");
    expect(result.install.interactive).toBe(false);
  });

  test("has correct defaults for install", () => {
    const result = parseArgs(["install"]);

    expect(result.install.interactive).toBe(true);
    expect(result.install.dryRun).toBe(false);
    expect(result.install.serverName).toBe("mcp-squared");
    expect(result.install.command).toBe("mcp-squared");
    expect(result.install.tool).toBeUndefined();
    expect(result.install.scope).toBeUndefined();
    expect(result.install.mode).toBeUndefined();
  });
});
