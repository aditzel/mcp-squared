import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_CONFIG } from "@/config";
import type { CallbackResult } from "@/oauth/callback-server";
import { OAuthCallbackServer } from "@/oauth/callback-server";
import { performPreflightAuth } from "@/oauth/preflight";
import { McpOAuthProvider } from "@/oauth/provider";
import { TokenStorage } from "@/oauth/token-storage";
import { withTempConfigHome } from "./helpers/config-home";

let restore: (() => void) | undefined;
beforeEach(async () => {
  restore = (await withTempConfigHome()).restore;
  spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  mock.restore();
  restore?.();
});
function fixture() {
  const config = structuredClone(DEFAULT_CONFIG);
  config.upstreams = {
    remote: {
      transport: "sse",
      enabled: true,
      env: {},
      sse: { url: "https://example.test/mcp", headers: {}, auth: true },
    },
  };
  const connect = spyOn(Client.prototype, "connect").mockRejectedValue(
    new UnauthorizedError("authenticate"),
  );
  const close = spyOn(Client.prototype, "close").mockResolvedValue();
  const stop = spyOn(OAuthCallbackServer.prototype, "stop").mockImplementation(
    () => {},
  );
  const wait = spyOn(
    OAuthCallbackServer.prototype,
    "waitForCallback",
  ).mockResolvedValue({ code: "fixture-code", state: "fixture-state" });
  const finish = spyOn(
    StreamableHTTPClientTransport.prototype,
    "finishAuth",
  ).mockResolvedValue();
  return { config, connect, close, stop, wait, finish };
}

describe("OAuth preflight orchestration", () => {
  test("skips disabled, non-HTTP and non-OAuth servers without connecting", async () => {
    const s = fixture();
    s.config.upstreams = {
      disabled: {
        transport: "sse",
        enabled: false,
        env: {},
        sse: { url: "https://example.test", headers: {}, auth: true },
      },
      local: {
        transport: "stdio",
        enabled: true,
        env: {},
        stdio: { command: "unused", args: [] },
      },
      public: {
        transport: "sse",
        enabled: true,
        env: {},
        sse: { url: "https://example.test", headers: {} },
      },
    };
    expect(await performPreflightAuth(s.config)).toEqual({
      authenticated: [],
      alreadyValid: [],
      failed: [],
    });
    expect(s.connect).not.toHaveBeenCalled();
  });

  test("retains valid tokens without opening a connection", async () => {
    const s = fixture();
    new TokenStorage().updateTokens("remote", {
      access_token: "fixture-token",
      token_type: "Bearer",
      expires_in: 3600,
    });
    expect(await performPreflightAuth(s.config)).toEqual({
      authenticated: [],
      alreadyValid: ["remote"],
      failed: [],
    });
    expect(s.connect).not.toHaveBeenCalled();
  });

  test("cleans up a connection that is already authenticated, tolerating close failures", async () => {
    const s = fixture();
    s.connect.mockResolvedValue();
    s.close.mockRejectedValue(new Error("close failed"));
    expect(await performPreflightAuth(s.config)).toEqual({
      authenticated: ["remote"],
      alreadyValid: [],
      failed: [],
    });
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(s.wait).not.toHaveBeenCalled();
  });

  test("exchanges a verified authorization code and clears the verifier", async () => {
    const s = fixture();
    const verify = spyOn(
      McpOAuthProvider.prototype,
      "verifyState",
    ).mockReturnValue(true);
    const clear = spyOn(
      McpOAuthProvider.prototype,
      "clearCodeVerifier",
    ).mockImplementation(() => {});
    expect(await performPreflightAuth(s.config)).toEqual({
      authenticated: ["remote"],
      alreadyValid: [],
      failed: [],
    });
    expect(verify).toHaveBeenCalledWith("fixture-state");
    expect(s.finish).toHaveBeenCalledWith("fixture-code");
    expect(clear).toHaveBeenCalledTimes(1);
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      { error: "denied", errorDescription: "declined" },
      "OAuth error: denied: declined",
    ],
    [{ error: "denied" }, "OAuth error: denied"],
    [{}, "No authorization code received"],
    [{ code: "code" }, "OAuth state mismatch - possible CSRF attack"],
    [
      { code: "code", state: "wrong" },
      "OAuth state mismatch - possible CSRF attack",
    ],
  ] as Array<
    [CallbackResult, string]
  >)("rejects callback %j and closes its resources", async (callback, error) => {
    const s = fixture();
    s.wait.mockResolvedValue(callback);
    expect(await performPreflightAuth(s.config)).toEqual({
      authenticated: [],
      alreadyValid: [],
      failed: [{ name: "remote", error }],
    });
    expect(s.finish).not.toHaveBeenCalled();
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  test("reports non-OAuth connection rejection without waiting for a callback", async () => {
    const s = fixture();
    s.connect.mockRejectedValue("network unavailable");
    expect(await performPreflightAuth(s.config)).toEqual({
      authenticated: [],
      alreadyValid: [],
      failed: [{ name: "remote", error: "network unavailable" }],
    });
    expect(s.wait).not.toHaveBeenCalled();
    expect(s.stop).toHaveBeenCalledTimes(1);
  });
});
