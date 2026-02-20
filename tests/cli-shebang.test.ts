/**
 * Tests for CLI entry point shebang line.
 *
 * When the package is installed globally, the bin wrapper is executed
 * directly. It must have a shebang line to tell the shell to use bun as
 * the interpreter.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("CLI entry point", () => {
  const entryPointPath = join(import.meta.dirname, "../bin/mcp-squared");

  it("should have a shebang line as the first line", () => {
    const content = readFileSync(entryPointPath, "utf-8");
    const firstLine = content.split("\n")[0];

    expect(firstLine).toBe("#!/usr/bin/env bun");
  });

  it("should be executable when run directly", async () => {
    // Run the entry point with --help to verify it works
    // Use process.execPath so tests work regardless of whether bun is on $PATH
    const proc = Bun.spawn([process.execPath, "run", entryPointPath, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("MCP²");
    expect(stdout).toContain("import");
  });

  it("should handle import --list without error", async () => {
    // This was the failing command
    const proc = Bun.spawn([process.execPath, "run", entryPointPath, "import", "--list"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    // Exit code 0 means success (even if no configs found)
    expect(exitCode).toBe(0);
  });
});
