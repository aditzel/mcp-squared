import { describe, expect, test } from "bun:test";
import {
  resolveDefaultServerMode,
  resolveOAuthProviderOptions,
} from "../src/index.js";

describe("resolveDefaultServerMode", () => {
  test("uses daemon mode when both stdio streams are TTY", () => {
    expect(resolveDefaultServerMode(true, true)).toBe("daemon");
  });

  test("uses proxy mode when stdin is not a TTY", () => {
    expect(resolveDefaultServerMode(false, true)).toBe("proxy");
  });

  test("uses proxy mode when stdout is not a TTY", () => {
    expect(resolveDefaultServerMode(true, false)).toBe("proxy");
  });
});

describe("resolveOAuthProviderOptions", () => {
  test("returns defaults when auth config is undefined", () => {
    expect(resolveOAuthProviderOptions(undefined)).toEqual({
      callbackPort: 8089,
      clientName: "MCP²",
    });
  });

  test("respects callbackPort override", () => {
    expect(
      resolveOAuthProviderOptions({
        callbackPort: 9321,
      }),
    ).toEqual({
      callbackPort: 9321,
      clientName: "MCP²",
    });
  });

  test("respects clientName override", () => {
    expect(
      resolveOAuthProviderOptions({
        clientName: "Acme Agent",
      }),
    ).toEqual({
      callbackPort: 8089,
      clientName: "Acme Agent",
    });
  });

  test("respects both callbackPort and clientName overrides", () => {
    expect(
      resolveOAuthProviderOptions({
        callbackPort: 9010,
        clientName: "Workbench",
      }),
    ).toEqual({
      callbackPort: 9010,
      clientName: "Workbench",
    });
  });
});
