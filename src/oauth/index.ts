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

export { openBrowser, logAuthorizationUrl } from "./browser.js";

export {
  OAuthCallbackServer,
  type CallbackResult,
  type CallbackServerOptions,
} from "./callback-server.js";

export { McpOAuthProvider } from "./provider.js";

export {
  TokenStorage,
  type OAuthTokens,
  type StoredTokenData,
} from "./token-storage.js";
