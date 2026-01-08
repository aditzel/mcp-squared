import { describe, expect, test } from "bun:test";
import { parseArgs } from "@/cli/index";

describe("parseArgs", () => {
  test("defaults to server mode with no args", () => {
    const result = parseArgs([]);
    expect(result.mode).toBe("server");
    expect(result.help).toBe(false);
    expect(result.version).toBe(false);
  });

  test("parses 'config' command", () => {
    const result = parseArgs(["config"]);
    expect(result.mode).toBe("config");
  });

  test("parses '--config' flag", () => {
    const result = parseArgs(["--config"]);
    expect(result.mode).toBe("config");
  });

  test("parses '-c' flag", () => {
    const result = parseArgs(["-c"]);
    expect(result.mode).toBe("config");
  });

  test("parses '--help' flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  test("parses '-h' flag", () => {
    const result = parseArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("parses '--version' flag", () => {
    const result = parseArgs(["--version"]);
    expect(result.version).toBe(true);
  });

  test("parses '-v' flag", () => {
    const result = parseArgs(["-v"]);
    expect(result.version).toBe(true);
  });
});
