import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstallRunner, performInstallation } from "@/install/runner";
import type { DiscoveredTool, InstallArgs } from "@/install/types";

const directories: string[] = [];
afterEach(() => {
  mock.restore();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

function scenario(answers: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "mcp-install-runner-"));
  directories.push(directory);
  const path = join(directory, "mcp.json");
  const tools: DiscoveredTool[] = [
    {
      tool: "cursor",
      displayName: "Cursor",
      scopes: ["user", "project"],
      paths: { user: path, project: join(directory, "project.json") },
    },
  ];
  const prompt = mock(async () => {
    const answer = answers.shift();
    if (answer === undefined) throw new Error("Unexpected prompt");
    return answer;
  });
  const install = mock(performInstallation);
  const discover = mock(() => tools);
  const log = spyOn(console, "log").mockImplementation(() => {});
  const run = createInstallRunner({
    prompt,
    discover,
    install,
    exit: (code) => {
      throw new Exit(code);
    },
  });
  const args: InstallArgs = {
    tool: "cursor",
    scope: "user",
    mode: "add",
    interactive: false,
    dryRun: false,
    serverName: "mcp-squared",
    command: "mcp-squared",
    args: ["--stdio"],
  };
  return { directory, path, tools, prompt, install, discover, log, run, args };
}

describe("installation orchestration", () => {
  test("writes the selected entry, preserves existing servers and reports its backup", async () => {
    const s = scenario();
    writeFileSync(
      s.path,
      JSON.stringify({ mcpServers: { existing: { command: "keep" } } }),
    );
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 0 });
    expect(JSON.parse(readFileSync(s.path, "utf8")).mcpServers).toEqual({
      existing: { command: "keep" },
      "mcp-squared": { command: "mcp-squared", args: ["--stdio"] },
    });
    expect(
      JSON.parse(readFileSync(`${s.path}.bak`, "utf8")).mcpServers,
    ).toEqual({ existing: { command: "keep" } });
    expect(s.log.mock.calls.flat().join("\n")).toContain("Backup created");
    expect(s.prompt).not.toHaveBeenCalled();
  });

  test("dry run reports create/modify without writing or confirming", async () => {
    const s = scenario();
    const args = { ...s.args, interactive: true, dryRun: true };
    await expect(s.run(args)).rejects.toMatchObject({ code: 0 });
    expect(s.log.mock.calls.flat().join("\n")).toContain("Would create");
    writeFileSync(s.path, "{}");
    await expect(s.run(args)).rejects.toMatchObject({ code: 0 });
    expect(readFileSync(s.path, "utf8")).toBe("{}");
    expect(s.log.mock.calls.flat().join("\n")).toContain("Would modify");
    expect(s.prompt).not.toHaveBeenCalled();
  });

  test("rejects missing selection and unavailable tools or scopes before any write", async () => {
    const s = scenario();
    const { tool: _tool, scope: _scope, mode: _mode, ...base } = s.args;
    for (const args of [
      base,
      { ...s.args, tool: "codex" as const },
      { ...base, tool: "cursor" as const },
      { ...base, tool: "cursor" as const, scope: "user" as const },
    ]) {
      await expect(s.run(args)).rejects.toMatchObject({ code: 1 });
    }
    const tool = s.tools[0];
    if (!tool) throw new Error("Missing tool fixture");
    tool.scopes = ["project"];
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 1 });
    s.discover.mockReturnValue([]);
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 1 });
    expect(s.install).not.toHaveBeenCalled();
  });

  test("interactive selection retries invalid answers and cancellation leaves files untouched", async () => {
    const s = scenario(["0", "1", "9", "2", "x", "1", "bad", "2", "n"]);
    await expect(
      s.run({
        interactive: true,
        dryRun: false,
        serverName: "mcp-squared",
        command: "mcp-squared",
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(s.install).not.toHaveBeenCalled();
    expect(s.prompt).toHaveBeenCalledTimes(9);
    expect(s.log.mock.calls.flat().join("\n")).toContain(
      "Installation cancelled",
    );
  });

  test("single scope and automatic mode install without inventing args", async () => {
    const s = scenario(["2", "1", ""]);
    const tool = s.tools[0];
    if (!tool) throw new Error("Missing tool fixture");
    tool.scopes = ["user"];
    await expect(
      s.run({
        tool: "cursor",
        interactive: true,
        dryRun: false,
        serverName: "custom",
        command: "mcp-squared",
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(JSON.parse(readFileSync(s.path, "utf8")).mcpServers.custom).toEqual({
      command: "mcp-squared",
    });
    expect(s.log.mock.calls.flat().join("\n")).toContain("Created:");
  });

  test("reports unchanged entries and parse failures without overwriting a corrupt file", async () => {
    const s = scenario();
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 0 });
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 0 });
    expect(s.log.mock.calls.flat().join("\n")).toContain("already exists");
    writeFileSync(s.path, "not json");
    await expect(s.run(s.args)).rejects.toMatchObject({ code: 1 });
    expect(readFileSync(s.path, "utf8")).toBe("not json");
    expect(s.log.mock.calls.flat().join("\n")).toContain(
      "Failed to parse existing config",
    );
  });
});
