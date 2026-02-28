import { describe, expect, test } from "bun:test";
import { resolveVersion } from "@/version.js";

describe("resolveVersion", () => {
  test("returns manifest version when available", () => {
    const version = resolveVersion({
      readManifest: () => ({ version: "9.8.7" }),
      readBundledManifest: () => ({}),
      fallbackVersion: "1.0.0",
      env: {},
    });

    expect(version).toBe("9.8.7");
  });

  test("falls back to env version when manifest read fails", () => {
    const version = resolveVersion({
      readManifest: () => {
        throw new Error("missing package.json");
      },
      readBundledManifest: () => ({}),
      env: { npm_package_version: "4.3.2" },
      fallbackVersion: "1.0.0",
    });

    expect(version).toBe("4.3.2");
  });

  test("falls back to provided fallback version when manifest/env are unavailable", () => {
    const version = resolveVersion({
      readManifest: () => {
        throw new Error("missing package.json");
      },
      readBundledManifest: () => ({}),
      env: {},
      fallbackVersion: "2.0.1",
    });

    expect(version).toBe("2.0.1");
  });

  test("ignores blank env values", () => {
    const version = resolveVersion({
      readManifest: () => {
        throw new Error("missing package.json");
      },
      readBundledManifest: () => ({}),
      env: { npm_package_version: "   " },
      fallbackVersion: "3.1.4",
    });

    expect(version).toBe("3.1.4");
  });
});
