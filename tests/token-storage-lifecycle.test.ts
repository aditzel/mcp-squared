import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenStorage } from "@/oauth/token-storage";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "mcp-token-storage-"));
  directories.push(directory);
  const base = join(directory, "tokens");
  return { base, storage: new TokenStorage(base) };
}

describe("OAuth token file lifecycle", () => {
  test("sanitizes filenames and enforces private permissions on existing files", () => {
    const { base, storage } = fixture();
    const name = "../upstream:name";
    storage.save(name, { state: "fixture-state" });
    const path = join(base, "___upstream_name.json");
    expect(existsSync(path)).toBe(true);
    expect(storage.load(name)).toMatchObject({
      state: "fixture-state",
      updatedAt: expect.any(Number),
    });
    if (process.platform !== "win32") {
      chmodSync(base, 0o755);
      chmodSync(path, 0o644);
      storage.save(name, { state: "replacement" });
      expect(statSync(base).mode & 0o777).toBe(0o700);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    storage.delete(name);
    storage.delete(name);
    expect(storage.load(name)).toBeUndefined();
  });

  test("treats absent, invalid and unreadable token files as absent", () => {
    const { base, storage } = fixture();
    expect(storage.load("absent")).toBeUndefined();
    writeFileSync(join(base, "broken.json"), "not JSON");
    mkdirSync(join(base, "directory.json"));
    expect(storage.load("broken")).toBeUndefined();
    expect(storage.load("directory")).toBeUndefined();
  });

  test("refreshes tokens without losing single-use state or PKCE data", () => {
    const { storage } = fixture();
    storage.saveCodeVerifier("upstream", "verifier");
    storage.saveState("upstream", "csrf");
    const before = Date.now();
    storage.updateTokens("upstream", {
      access_token: "fixture-token",
      token_type: "Bearer",
      expires_in: 3600,
    });
    expect(storage.load("upstream")).toMatchObject({
      codeVerifier: "verifier",
      state: "csrf",
      tokens: { access_token: "fixture-token" },
    });
    expect(storage.load("upstream")?.expiresAt).toBeGreaterThanOrEqual(
      before + 3_600_000,
    );
    expect(storage.isExpired("upstream")).toBe(false);
    expect(storage.isExpired("upstream", 3_700_000)).toBe(true);
    expect(storage.getAndClearCodeVerifier("upstream")).toBe("verifier");
    expect(storage.getAndClearCodeVerifier("upstream")).toBeUndefined();
    expect(storage.verifyAndClearState("upstream", "wrong")).toBe(false);
    expect(storage.verifyAndClearState("upstream", "csrf")).toBe(false);
    storage.saveState("upstream", "new-csrf");
    expect(storage.verifyAndClearState("upstream", "new-csrf")).toBe(true);
    expect(storage.load("upstream")?.tokens?.access_token).toBe(
      "fixture-token",
    );
  });

  test("handles fresh state and unknown expiry conservatively", () => {
    const { base, storage } = fixture();
    expect(storage.getAndClearCodeVerifier("absent")).toBeUndefined();
    expect(storage.verifyAndClearState("absent", "csrf")).toBe(false);
    expect(storage.isExpired("absent")).toBe(true);
    storage.saveState("state-only", "csrf");
    expect(storage.isExpired("state-only")).toBe(true);
    storage.updateTokens("fresh", {
      access_token: "fixture",
      token_type: "Bearer",
    });
    expect(storage.isExpired("fresh")).toBe(true);
    expect(readFileSync(join(base, "fresh.json"), "utf8")).not.toContain(
      "expiresAt",
    );
  });
});
