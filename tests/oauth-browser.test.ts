import { afterEach, describe, expect, mock, test } from "bun:test";

const spawnMock = mock(
  (_command: string, _args: string[], _options: Record<string, unknown>) => {
    const handlers = new Map<string, () => void>();
    const child = {
      on: (event: string, handler: () => void) => {
        handlers.set(event, handler);
        return child;
      },
      unref: mock(() => {}),
    };

    queueMicrotask(() => {
      const spawnHandler = handlers.get("spawn");
      if (spawnHandler) {
        spawnHandler();
      }
    });

    return child;
  },
);

mock.module("node:child_process", () => ({
  spawn: spawnMock,
}));

import { openBrowser } from "../src/oauth/browser.js";

function setPlatformForTest(platform: NodeJS.Platform): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");

  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(process, "platform", descriptor);
    }
  };
}

describe("openBrowser", () => {
  afterEach(() => {
    spawnMock.mockClear();
  });

  test("uses open on macOS", async () => {
    const restorePlatform = setPlatformForTest("darwin");

    const url = "https://example.com/oauth?state=abc";
    const result = await openBrowser(url);

    expect(result).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("open", [url], {
      detached: true,
      stdio: "ignore",
    });

    restorePlatform();
  });

  test("uses xdg-open on Linux", async () => {
    const restorePlatform = setPlatformForTest("linux");

    const url = "https://example.com/oauth?state=linux";
    const result = await openBrowser(url);

    expect(result).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("xdg-open", [url], {
      detached: true,
      stdio: "ignore",
    });

    restorePlatform();
  });

  test("uses PowerShell Start-Process on Windows instead of cmd.exe", async () => {
    const restorePlatform = setPlatformForTest("win32");

    const url = "https://example.com/oauth?state=windows";
    const result = await openBrowser(url);

    expect(result).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Start-Process ${JSON.stringify(url)}`,
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    );

    const [command] = spawnMock.mock.calls[0] ?? [];
    expect(command).not.toBe("cmd");

    restorePlatform();
  });

  test("preserves special URL characters in argument array", async () => {
    const restorePlatform = setPlatformForTest("win32");

    const url = "https://example.com/cb?x=1&y=2#frag";
    const result = await openBrowser(url);

    expect(result).toBe(true);

    const call = spawnMock.mock.calls[0];
    expect(call).toBeDefined();

    const args = call?.[1] as string[];
    expect(args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Start-Process ${JSON.stringify(url)}`,
    ]);

    restorePlatform();
  });
});
