import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverConfigs,
  discoverToolConfig,
  formatDiscoveredConfigs,
} from "@/import/discovery";
import {
  expandPath,
  getAppData,
  getMacApplicationSupport,
  getVSCodeExtensionGlobalStorage,
  getVSCodeUserDataDir,
  getXdgConfigHome,
  safePath,
} from "@/import/discovery/paths";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("configuration discovery file probes", () => {
  test("finds project files in deterministic tool order and skips missing or unreadable paths", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mcp-import-discovery-"));
    directories.push(cwd);
    mkdirSync(join(cwd, ".cursor"));
    writeFileSync(join(cwd, ".cursor/mcp.json"), "{}");
    writeFileSync(join(cwd, ".mcp.json"), "{}");
    mkdirSync(join(cwd, ".gemini/settings.json"), { recursive: true });
    const result = await discoverConfigs({
      cwd,
      scope: "project",
      tools: ["gemini-cli", "cursor", "claude-code", "jetbrains"],
    });
    expect(
      result.map(({ tool, scope, exists, readable }) => ({
        tool,
        scope,
        exists,
        readable,
      })),
    ).toEqual([
      { tool: "claude-code", scope: "project", exists: true, readable: true },
      { tool: "cursor", scope: "project", exists: true, readable: true },
    ]);
    expect(result.every((config) => config.lastModified instanceof Date)).toBe(
      true,
    );
    expect(
      await discoverToolConfig("cursor", { cwd, scope: "project" }),
    ).toHaveLength(1);
  });

  test("reports zero, singular and plural discoveries with scope and optional server counts", () => {
    expect(formatDiscoveredConfigs([])).toBe("No MCP configurations found.");
    const one = {
      tool: "cursor" as const,
      path: "/fixture.json",
      scope: "user" as const,
      exists: true,
      readable: true,
      serverCount: 1,
    };
    expect(formatDiscoveredConfigs([one])).toContain(
      "Found 1 MCP configuration:",
    );
    expect(formatDiscoveredConfigs([one])).toContain(
      "[user] /fixture.json (1 server)",
    );
    const output = formatDiscoveredConfigs([
      one,
      { ...one, scope: "project", serverCount: 2 },
      {
        tool: "claude-code",
        path: "/other.json",
        scope: "project",
        exists: true,
        readable: true,
      },
    ]);
    expect(output).toContain("Found 3 MCP configurations:");
    expect(output).toContain("[project] /fixture.json (2 servers)");
    expect(output).toContain("[project] /other.json");
  });

  test("expands documented variables and joins empty path segments safely", () => {
    expect(expandPath("~/config")).toBe(join(homedir(), "config"));
    expect(expandPath("$HOME/config")).toBe(join(homedir(), "config"));
    expect(expandPath("$XDG_CONFIG_HOME/config")).toBe(
      join(getXdgConfigHome(), "config"),
    );
    expect(expandPath("%APPDATA%/config")).toBe(`${getAppData()}/config`);
    expect(expandPath("%USERPROFILE%/config")).toBe(`${homedir()}/config`);
    expect(expandPath("relative/config")).toBe("relative/config");
    expect(safePath("", "one", "", "two")).toBe(join("one", "two"));
    expect(safePath("", "")).toBe("");
    expect(getMacApplicationSupport()).toBe(
      join(homedir(), "Library", "Application Support"),
    );
    expect(getVSCodeExtensionGlobalStorage("fixture")).toBe(
      join(getVSCodeUserDataDir(), "globalStorage", "fixture"),
    );
  });
});
