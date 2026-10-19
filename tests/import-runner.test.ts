import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportArgs } from "@/cli";
import { DEFAULT_CONFIG, loadConfigFromPath, saveConfig } from "@/config";
import type { ConfigPathResult } from "@/config/paths";
import type { DiscoveredConfig } from "@/import/discovery";
import { createImportRunner } from "@/import/runner";

const directories: string[] = [];
afterEach(() => {
  mock.restore();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function scenario(answers: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "mcp-import-runner-"));
  directories.push(directory);
  const target = join(directory, "mcp-squared.toml");
  const input = join(directory, "external.json");
  const config = structuredClone(DEFAULT_CONFIG);
  const load = mock(async () => ({
    config,
    path: target,
    source: "user" as const,
  }));
  const save = mock(saveConfig);
  const discover = mock(async (): Promise<DiscoveredConfig[]> => []);
  const locate = mock((): ConfigPathResult | null => null);
  const prompt = mock(async () => {
    const answer = answers.shift();
    if (answer === undefined) throw new Error("Unexpected conflict prompt");
    return answer;
  });
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  const run = createImportRunner({
    load,
    save,
    discover,
    locate,
    defaultPath: () => ({ path: target, source: "user" }),
    prompt,
    exit: (code) => {
      throw Object.assign(new Error("exit"), { code });
    },
  });
  const args: ImportArgs = {
    scope: "both",
    strategy: "skip",
    interactive: false,
    dryRun: false,
    list: false,
    verbose: false,
    path: input,
  };
  return {
    directory,
    target,
    input,
    config,
    load,
    save,
    discover,
    locate,
    prompt,
    log,
    error,
    run,
    args,
  };
}

describe("import orchestration", () => {
  test("writes imported commands and HTTP servers while preserving existing configuration", async () => {
    const s = scenario();
    s.config.upstreams["keep"] = {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: { command: "keep", args: [] },
    };
    writeFileSync(
      s.input,
      JSON.stringify({
        mcpServers: {
          added: { command: "worker", args: ["--mode", "local"] },
          remote: { url: "https://example.test/mcp" },
        },
      }),
    );
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 0 });
    const saved = (await loadConfigFromPath(s.target, "user")).config;
    expect(saved.upstreams["keep"]).toEqual(s.config.upstreams["keep"]);
    expect(saved.upstreams["added"]).toMatchObject({
      transport: "stdio",
      stdio: { command: "worker", args: ["--mode", "local"] },
    });
    expect(saved.upstreams["remote"]).toMatchObject({
      transport: "sse",
      sse: { url: "https://example.test/mcp" },
    });
    expect(s.prompt).not.toHaveBeenCalled();
  });

  test("verbose dry run previews a merge without creating or modifying the target", async () => {
    const s = scenario();
    writeFileSync(
      s.input,
      JSON.stringify({ mcpServers: { added: { command: "worker" } } }),
    );
    writeFileSync(s.target, "preserve these bytes");
    await expect(
      s.run({ ...s.args, dryRun: true, verbose: true }),
    ).rejects.toMatchObject({ code: 0 });
    expect(readFileSync(s.target, "utf8")).toBe("preserve these bytes");
    expect(s.save).not.toHaveBeenCalled();
    expect(s.log.mock.calls.flat().join("\n")).toContain(
      "Merged configuration preview",
    );
  });

  test("distinguishes no discovered files, unreadable files, empty configurations and parse failures", async () => {
    const s = scenario();
    const { path: _path, ...discoveryArgs } = s.args;
    await expect(s.run(discoveryArgs)).rejects.toMatchObject({ code: 0 });
    s.discover.mockResolvedValue([
      {
        tool: "cursor",
        path: s.input,
        scope: "project",
        exists: true,
        readable: false,
      },
    ]);
    await expect(s.run(discoveryArgs)).rejects.toMatchObject({ code: 0 });
    writeFileSync(s.input, "{}");
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 0 });
    writeFileSync(s.input, "invalid JSON");
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 0 });
    expect(s.error.mock.calls.flat().join("\n")).toContain("Failed to parse");
    expect(s.save).not.toHaveBeenCalled();
    expect(existsSync(s.target)).toBe(false);
  });

  test("list mode parses explicit TOML and reports discovered scopes without loading or saving MCP config", async () => {
    const s = scenario();
    const toml = join(s.directory, "external.toml");
    writeFileSync(toml, '[mcp_servers.local]\ncommand = "worker"\n');
    await s.run({
      ...s.args,
      path: toml,
      source: "codex",
      list: true,
      verbose: true,
    });
    writeFileSync(
      s.input,
      JSON.stringify({
        mcpServers: {
          remote: { url: "https://example.test/mcp", disabled: true },
        },
      }),
    );
    s.discover.mockResolvedValue([
      {
        tool: "cursor",
        path: s.input,
        scope: "user",
        exists: true,
        readable: true,
      },
      {
        tool: "cursor",
        path: s.input,
        scope: "project",
        exists: true,
        readable: true,
      },
    ]);
    const { path: _path, ...args } = s.args;
    await s.run({ ...args, source: "cursor", list: true, verbose: true });
    expect(s.discover).toHaveBeenCalledWith({
      tools: ["cursor"],
      scope: "both",
    });
    const output = s.log.mock.calls.flat().join("\n");
    expect(output).toContain("(user)");
    expect(output).toContain("(project)");
    expect(output).toContain("local (stdio)");
    expect(output).toContain("remote (sse)");
    expect(s.load).not.toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
  });

  test("only ENOENT may bootstrap defaults; other load errors propagate before import", async () => {
    const s = scenario();
    writeFileSync(
      s.input,
      JSON.stringify({ mcpServers: { added: { command: "worker" } } }),
    );
    s.load.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 0 });
    expect(existsSync(s.target)).toBe(true);
    const alternate = join(s.directory, "project.toml");
    s.locate.mockReturnValue({ path: alternate, source: "project" });
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 0 });
    expect(existsSync(alternate)).toBe(true);
    for (const error of [
      Object.assign(new Error("denied"), { code: "EACCES" }),
      new Error("malformed config"),
      "unexpected failure",
    ]) {
      s.load.mockRejectedValue(error);
      await expect(s.run(s.args)).rejects.toBe(error);
    }
    expect(s.save).toHaveBeenCalledTimes(2);
  });

  test.each([
    "skip",
    "replace",
    "rename",
  ] as const)("applies noninteractive %s conflicts and preserves unrelated entries", async (strategy) => {
    const s = scenario();
    s.config.upstreams["shared"] = {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: { command: "original", args: [] },
    };
    writeFileSync(
      s.input,
      JSON.stringify({ mcpServers: { shared: { command: "incoming" } } }),
    );
    await expect(s.run({ ...s.args, strategy })).rejects.toMatchObject({
      code: 0,
    });
    const upstreams = (await loadConfigFromPath(s.target, "user")).config
      .upstreams;
    const commands = Object.values(upstreams).flatMap((value) =>
      value.transport === "stdio" ? [value.stdio.command] : [],
    );
    expect(commands).toEqual(
      strategy === "skip"
        ? ["original"]
        : strategy === "replace"
          ? ["incoming"]
          : ["original", "incoming"],
    );
    expect(s.prompt).not.toHaveBeenCalled();
  });

  test("uppercase conflict choice applies to remaining conflicts and displays both transports", async () => {
    const s = scenario(["R"]);
    s.config.upstreams["first"] = {
      transport: "stdio",
      enabled: true,
      env: {},
      stdio: { command: "original", args: ["--old"] },
    };
    s.config.upstreams["second"] = {
      transport: "sse",
      enabled: true,
      env: {},
      sse: { url: "https://old.test/mcp", headers: {} },
    };
    writeFileSync(
      s.input,
      JSON.stringify({
        mcpServers: {
          first: { url: "https://new.test/mcp" },
          second: { command: "incoming" },
        },
      }),
    );
    await expect(s.run({ ...s.args, interactive: true })).rejects.toMatchObject(
      { code: 0 },
    );
    expect(s.prompt).toHaveBeenCalledTimes(1);
    const saved = (await loadConfigFromPath(s.target, "user")).config.upstreams;
    expect(saved["first"]).toMatchObject({
      transport: "sse",
      sse: { url: "https://new.test/mcp" },
    });
    expect(saved["second"]).toMatchObject({
      transport: "stdio",
      stdio: { command: "incoming" },
    });
    expect(s.log.mock.calls.flat().join("\n")).toContain("args: --old");
    expect(s.log.mock.calls.flat().join("\n")).toContain(
      "url: https://new.test/mcp",
    );
  });

  test("per-conflict rename and default skip are independent; save errors propagate", async () => {
    const s = scenario(["n", ""]);
    for (const name of ["first", "second"])
      s.config.upstreams[name] = {
        transport: "stdio",
        enabled: true,
        env: {},
        stdio: { command: "original", args: [] },
      };
    writeFileSync(
      s.input,
      JSON.stringify({
        mcpServers: {
          first: { command: "incoming" },
          second: { command: "incoming" },
        },
      }),
    );
    await expect(s.run({ ...s.args, interactive: true })).rejects.toMatchObject(
      { code: 0 },
    );
    const saved = (await loadConfigFromPath(s.target, "user")).config.upstreams;
    expect(Object.keys(saved)).toHaveLength(3);
    expect(saved["second"]).toMatchObject({ stdio: { command: "original" } });
    const error = new Error("disk write failed");
    s.save.mockRejectedValue(error);
    await expect(s.run(s.args)).rejects.toBe(error);
  });
});
