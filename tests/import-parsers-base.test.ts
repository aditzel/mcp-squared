import { describe, expect, test } from "bun:test";
import {
  BaseConfigParser,
  detectParser,
  getAllParsers,
  getParser,
  getRegisteredToolIds,
  isValidToolId,
  StandardMcpServersParser,
} from "@/import/parsers";
import type { ExternalServer, ParseResult } from "@/import/types";

class ExposedBaseParser extends BaseConfigParser {
  readonly toolId = "cursor" as const;
  readonly displayName = "Exposed Base";
  readonly configKey = "servers";

  canParse(content: unknown): boolean {
    return this.getServersSection(content) !== undefined;
  }

  parse(_content: unknown, _filePath: string): ParseResult {
    return this.emptyResult();
  }

  parseEntry(name: string, config: unknown): ExternalServer | undefined {
    return this.parseServerEntry(name, config);
  }

  parseRecord(obj: unknown): Record<string, string> {
    return this.parseStringRecord(obj);
  }

  getSection(content: unknown): Record<string, unknown> | undefined {
    return this.getServersSection(content);
  }

  empty(): ParseResult {
    return this.emptyResult();
  }
}

class TestStandardParser extends StandardMcpServersParser {
  readonly toolId = "cursor" as const;
  readonly displayName = "Test Standard";
}

describe("BaseConfigParser helpers", () => {
  const parser = new ExposedBaseParser();

  test("getServersSection returns undefined for invalid/missing content", () => {
    expect(parser.getSection(null)).toBeUndefined();
    expect(parser.getSection("nope")).toBeUndefined();
    expect(parser.getSection({})).toBeUndefined();
    expect(parser.getSection({ servers: null })).toBeUndefined();
  });

  test("getServersSection returns nested server map", () => {
    expect(parser.getSection({ servers: { a: { command: "npx" } } })).toEqual({
      a: { command: "npx" },
    });
  });

  test("parseServerEntry rejects invalid entries", () => {
    expect(parser.parseEntry("bad", null)).toBeUndefined();
    expect(parser.parseEntry("bad", { args: ["--help"] })).toBeUndefined();
  });

  test("parseServerEntry parses stdio and sse fields with filtering", () => {
    const server = parser.parseEntry("mixed", {
      command: "npx",
      args: ["-y", 123, "--flag", null],
      cwd: "/tmp/work",
      url: "https://example.com/sse",
      httpUrl: "https://example.com/http",
      headers: {
        Authorization: "Bearer token",
        "X-Ignore": 42,
      },
      env: {
        TOKEN: "abc",
        RETRIES: 3,
      },
      alwaysAllow: ["read_file", 1, "search"],
      disabled: true,
    });

    expect(server).toEqual({
      name: "mixed",
      command: "npx",
      args: ["-y", "--flag"],
      cwd: "/tmp/work",
      url: "https://example.com/sse",
      httpUrl: "https://example.com/http",
      headers: { Authorization: "Bearer token" },
      env: { TOKEN: "abc" },
      alwaysAllow: ["read_file", "search"],
      disabled: true,
    });
  });

  test("parseServerEntry derives disabled from enabled when disabled is absent", () => {
    expect(
      parser.parseEntry("enabled-true", {
        command: "node",
        enabled: true,
      }),
    ).toEqual({
      name: "enabled-true",
      command: "node",
      disabled: false,
    });

    expect(
      parser.parseEntry("enabled-false", {
        command: "node",
        enabled: false,
      }),
    ).toEqual({
      name: "enabled-false",
      command: "node",
      disabled: true,
    });
  });

  test("parseServerEntry prioritizes explicit disabled over enabled", () => {
    expect(
      parser.parseEntry("explicit-disabled", {
        command: "node",
        enabled: true,
        disabled: true,
      }),
    ).toEqual({
      name: "explicit-disabled",
      command: "node",
      disabled: true,
    });
  });

  test("parseStringRecord returns only string values", () => {
    expect(parser.parseRecord(null)).toEqual({});
    expect(parser.parseRecord("str")).toEqual({});
    expect(parser.parseRecord({ A: "1", B: 2, C: true, D: "ok" })).toEqual({
      A: "1",
      D: "ok",
    });
  });

  test("emptyResult returns canonical empty shape", () => {
    expect(parser.empty()).toEqual({ servers: [], warnings: [] });
  });
});

describe("StandardMcpServersParser", () => {
  const parser = new TestStandardParser();

  test("canParse returns true only when mcpServers key exists", () => {
    expect(parser.canParse(null)).toBe(false);
    expect(parser.canParse("str")).toBe(false);
    expect(parser.canParse({})).toBe(false);
    expect(parser.canParse({ mcpServers: {} })).toBe(true);
  });

  test("parse returns empty result when servers section is unavailable", () => {
    expect(parser.parse({}, "/tmp/config.json")).toEqual({
      servers: [],
      warnings: [],
    });
  });

  test("parse collects valid servers and warnings for invalid ones", () => {
    const result = parser.parse(
      {
        mcpServers: {
          valid: { command: "node", args: ["server.js"] },
          remote: { url: "https://api.example.com/mcp" },
          invalid: { args: ["--missing-command"] },
        },
      },
      "/tmp/config.json",
    );

    expect(result.servers).toEqual([
      { name: "valid", command: "node", args: ["server.js"] },
      { name: "remote", url: "https://api.example.com/mcp" },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Skipped invalid server "invalid"');
    expect(result.warnings[0]).toContain("/tmp/config.json");
  });
});

describe("import parser registry", () => {
  test("getParser and list helpers expose the registry", () => {
    const codexParser = getParser("codex");
    expect(codexParser).toBeDefined();
    expect(codexParser?.toolId).toBe("codex");

    const toolIds = getRegisteredToolIds();
    expect(toolIds.length).toBeGreaterThan(10);
    expect(toolIds).toContain("codex");
    expect(toolIds).toContain("vscode");

    const parsers = getAllParsers();
    expect(parsers.length).toBe(toolIds.length);
  });

  test("detectParser prioritizes custom parsers over standard mcpServers parsers", () => {
    const parser = detectParser({
      servers: {},
      mcpServers: {},
    });
    expect(parser?.toolId).toBe("vscode");
  });

  test("detectParser recognizes zed, opencode, codex, and standard formats", () => {
    expect(detectParser({ context_servers: {} })?.toolId).toBe("zed");
    expect(detectParser({ mcp: {} })?.toolId).toBe("opencode");
    expect(detectParser({ mcp_servers: {} })?.toolId).toBe("codex");

    const standardParser = detectParser({ mcpServers: {} });
    expect(standardParser).toBeDefined();
    expect(["vscode", "zed", "opencode", "codex"]).not.toContain(
      standardParser?.toolId,
    );
  });

  test("detectParser returns undefined for unsupported content", () => {
    expect(detectParser({ random: "value" })).toBeUndefined();
    expect(detectParser("not-an-object")).toBeUndefined();
  });

  test("isValidToolId validates registry members", () => {
    expect(isValidToolId("codex")).toBe(true);
    expect(isValidToolId("vscode")).toBe(true);
    expect(isValidToolId("definitely-not-a-tool")).toBe(false);
  });
});
