import { describe, expect, test } from "bun:test";
import {
  DEFAULT_OAUTH_CALLBACK_PORT,
  DEFAULT_OAUTH_CLIENT_NAME,
  resolveOAuthProviderOptions,
} from "../src/oauth/provider.js";

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
});
