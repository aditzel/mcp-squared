import { describe, expect, test } from "bun:test";
import {
  DEFAULT_OAUTH_CALLBACK_PORT,
  DEFAULT_OAUTH_CLIENT_NAME,
  resolveOAuthProviderOptions,
} from "@/oauth/index.js";

describe("resolveOAuthProviderOptions", () => {
  test("uses defaults when auth config is undefined", () => {
    expect(resolveOAuthProviderOptions(undefined)).toEqual({
      callbackPort: DEFAULT_OAUTH_CALLBACK_PORT,
      clientName: DEFAULT_OAUTH_CLIENT_NAME,
    });
  });

  test("uses defaults when auth config is boolean", () => {
    expect(resolveOAuthProviderOptions(true)).toEqual({
      callbackPort: DEFAULT_OAUTH_CALLBACK_PORT,
      clientName: DEFAULT_OAUTH_CLIENT_NAME,
    });
    expect(resolveOAuthProviderOptions(false)).toEqual({
      callbackPort: DEFAULT_OAUTH_CALLBACK_PORT,
      clientName: DEFAULT_OAUTH_CLIENT_NAME,
    });
  });

  test("uses callbackPort and clientName overrides", () => {
    expect(
      resolveOAuthProviderOptions({
        callbackPort: 9321,
        clientName: "Acme Agent",
      }),
    ).toEqual({
      callbackPort: 9321,
      clientName: "Acme Agent",
    });
  });

  test("uses default clientName when only callbackPort is provided", () => {
    expect(resolveOAuthProviderOptions({ callbackPort: 4321 })).toEqual({
      callbackPort: 4321,
      clientName: DEFAULT_OAUTH_CLIENT_NAME,
    });
  });

  test("uses default callbackPort when only clientName is provided", () => {
    expect(resolveOAuthProviderOptions({ clientName: "OnlyName" })).toEqual({
      callbackPort: DEFAULT_OAUTH_CALLBACK_PORT,
      clientName: "OnlyName",
    });
  });

  test("throws on invalid callbackPort values", () => {
    expect(() =>
      resolveOAuthProviderOptions({ callbackPort: 0 }),
    ).toThrowError();
    expect(() =>
      resolveOAuthProviderOptions({ callbackPort: -1 }),
    ).toThrowError();
    expect(() =>
      resolveOAuthProviderOptions({ callbackPort: 65_536 }),
    ).toThrowError();
    expect(() =>
      resolveOAuthProviderOptions({ callbackPort: Number.NaN }),
    ).toThrowError();
    expect(() =>
      resolveOAuthProviderOptions({ callbackPort: 1234.5 }),
    ).toThrowError();
  });
});
