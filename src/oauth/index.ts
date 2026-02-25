/**
 * OAuth module exports.
 *
 * This module provides complete OAuth support for MCP² upstream servers:
 * - Browser-based authorization (authorization_code flow)
 * - Machine-to-machine auth (client_credentials flow)
 * - File-based token persistence
 * - PKCE support for secure authorization
 *
 * @module oauth
 */

export { logAuthorizationUrl, openBrowser } from "./browser.js";

export {
  type CallbackResult,
  type CallbackServerOptions,
  OAuthCallbackServer,
} from "./callback-server.js";
export {
  type PreflightAuthResult,
  performPreflightAuth,
} from "./preflight.js";
export {
  DEFAULT_OAUTH_CALLBACK_PORT,
  DEFAULT_OAUTH_CLIENT_NAME,
  McpOAuthProvider,
  type OAuthAuthConfigInput,
  type ResolvedOAuthProviderOptions,
  resolveOAuthProviderOptions,
} from "./provider.js";
export {
  type OAuthTokens,
  type StoredTokenData,
  TokenStorage,
} from "./token-storage.js";
