import { describe, expect, test } from "bun:test";
import { getPreflightClientMetadata } from "@/oauth/preflight.js";
import { VERSION } from "@/version.js";

describe("getPreflightClientMetadata", () => {
  test("returns client metadata with shared VERSION", () => {
    expect(getPreflightClientMetadata()).toEqual({
      name: "mcp-squared-preflight",
      version: VERSION,
    });
  });
});
