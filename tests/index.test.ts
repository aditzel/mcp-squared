import { describe, expect, test } from "bun:test";
import { VERSION } from "../src/index";

describe("mcp-squared", () => {
  test("VERSION is defined", () => {
    expect(VERSION).toBeDefined();
    expect(typeof VERSION).toBe("string");
  });

  test("VERSION matches semver pattern", () => {
    const semverRegex = /^\d+\.\d+\.\d+$/;
    expect(VERSION).toMatch(semverRegex);
  });
});
