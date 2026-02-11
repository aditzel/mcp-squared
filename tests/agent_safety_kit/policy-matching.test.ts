import { describe, expect, test } from "bun:test";
import {
  extractCommandCandidates,
  extractDomainCandidates,
  extractPathCandidates,
  matchesGlob,
  pickMostSpecificRule,
  valuesConstrainedByGlob,
} from "../../agent_safety_kit/policy/matchers.js";

describe("agent safety policy matching", () => {
  test("supports wildcard glob matching", () => {
    expect(matchesGlob("filesystem:*", "filesystem:read_file")).toBe(true);
    expect(matchesGlob("*:read_*", "github:read_file")).toBe(true);
    expect(matchesGlob("*:write_*", "github:read_file")).toBe(false);
  });

  test("selects the most specific matching rule", () => {
    const best = pickMostSpecificRule(
      [
        { agent: "*", tool: "*", action: "*" },
        { agent: "mcp-squared", tool: "*", action: "call" },
        { agent: "mcp-squared", tool: "filesystem:*", action: "call" },
      ],
      {
        agent: "mcp-squared",
        tool: "filesystem:write_file",
        action: "call",
      },
    );

    expect(best?.tool).toBe("filesystem:*");
  });

  test("extracts paths, domains, and commands from params", () => {
    const params = {
      path: "/tmp/demo.txt",
      url: "https://api.github.com/repos/aditzel/mcp-squared",
      command: "git status",
      nested: {
        cwd: "/Users/allan/projects/personal/mcp-squared",
      },
    };

    expect(extractPathCandidates(params)).toContain("/tmp/demo.txt");
    expect(extractDomainCandidates(params)).toContain("api.github.com");
    expect(extractCommandCandidates(params)).toContain("git status");
  });

  test("validates value allowlists with globs", () => {
    const allowed = valuesConstrainedByGlob(
      ["/tmp/a.txt", "/tmp/b.txt"],
      ["/tmp/*"],
    );
    const blocked = valuesConstrainedByGlob(["/etc/passwd"], ["/tmp/*"]);

    expect(allowed).toBe(true);
    expect(blocked).toBe(false);
  });
});
