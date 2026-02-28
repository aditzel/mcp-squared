import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { VERSION } from "@/index";

const PACKAGE_VERSION = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

describe("mcp-squared", () => {
  test("VERSION is defined", () => {
    expect(VERSION).toBeDefined();
    expect(typeof VERSION).toBe("string");
  });

  test("VERSION matches semver pattern", () => {
    const semverRegex = /^\d+\.\d+\.\d+$/;
    expect(VERSION).toMatch(semverRegex);
  });

  test("VERSION matches package.json version", () => {
    expect(VERSION).toBe(PACKAGE_VERSION);
  });
});
