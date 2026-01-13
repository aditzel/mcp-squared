/**
 * OAuth client provider implementation for MCP upstreams.
 *
 * Implements the MCP SDK's OAuthClientProvider interface to handle
 * OAuth authentication for SSE/HTTP upstream servers.
 *
 * @module oauth/provider
 */

import { randomBytes } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthConfig } from "../config/schema.js";
import { openBrowser } from "./browser.js";
import type { TokenStorage } from "./token-storage.js";

/**
 * Resolves environment variable references in strings.
 * Supports $VAR and ${VAR} syntax.
 *
 * @param value - String that may contain env var references
 * @returns Resolved string with env vars substituted
 */
function resolveEnvVar(value: string | undefined): string | undefined {
  if (!value) return value;

  // Handle $VAR and ${VAR} syntax
  return value.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, varName) => {
    return process.env[varName] ?? "";
  });
}

/**
 * Generates a cryptographically random state parameter.
 * Used for CSRF protection in authorization_code flow.
 */
function generateState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * OAuth client provider for MCP upstream servers.
 *
 * Implements the OAuthClientProvider interface from the MCP SDK,
 * supporting both authorization_code and client_credentials flows.
 *
 * Features:
 * - File-based token persistence
 * - Browser-based authorization
 * - PKCE support for authorization_code
 * - Environment variable resolution for secrets
 */
export class McpOAuthProvider implements OAuthClientProvider {
  private readonly upstreamName: string;
  private readonly config: OAuthConfig;
  private readonly storage: TokenStorage;
  private readonly resolvedClientSecret: string | undefined;

  /**
   * Creates a new OAuth provider for an upstream server.
   *
   * @param upstreamName - Name of the upstream server (for token storage)
   * @param config - OAuth configuration from config file
   * @param storage - Token storage instance
   */
  constructor(
    upstreamName: string,
    config: OAuthConfig,
    storage: TokenStorage,
  ) {
    this.upstreamName = upstreamName;
    this.config = config;
    this.storage = storage;
    this.resolvedClientSecret = resolveEnvVar(config.clientSecret);
  }

  /**
   * Returns the redirect URL for authorization callbacks.
   * Returns undefined for client_credentials flow (non-interactive).
   */
  get redirectUrl(): string | URL | undefined {
    if (this.config.grantType === "client_credentials") {
      return undefined;
    }
    return this.config.redirectUrl;
  }

  /**
   * Returns OAuth client metadata for dynamic registration.
   */
  get clientMetadata(): OAuthClientMetadata {
    const metadata: OAuthClientMetadata = {
      redirect_uris: [this.config.redirectUrl],
    };

    // Set grant types based on configuration
    if (this.config.grantType === "client_credentials") {
      metadata.grant_types = ["client_credentials"];
    } else {
      metadata.grant_types = ["authorization_code", "refresh_token"];
      metadata.response_types = ["code"];
    }

    // Add scope if configured
    if (this.config.scope) {
      metadata.scope = this.config.scope;
    }

    return metadata;
  }

  /**
   * Generates and stores an OAuth state parameter.
   * Used for CSRF protection in authorization_code flow.
   */
  state(): string {
    const stateValue = generateState();
    this.storage.saveState(this.upstreamName, stateValue);
    return stateValue;
  }

  /**
   * Returns client information (ID and optionally secret).
   * This is used for token requests.
   */
  clientInformation(): OAuthClientInformationMixed | undefined {
    const info: OAuthClientInformationMixed = {
      client_id: this.config.clientId,
    };

    if (this.resolvedClientSecret) {
      info.client_secret = this.resolvedClientSecret;
    }

    return info;
  }

  /**
   * Loads existing OAuth tokens from storage.
   * Returns undefined if no tokens exist or they're expired without refresh token.
   */
  tokens(): OAuthTokens | undefined {
    const data = this.storage.load(this.upstreamName);

    if (!data?.tokens) {
      return undefined;
    }

    // If tokens are expired and we have no refresh token, return undefined
    if (this.storage.isExpired(this.upstreamName) && !data.tokens.refresh_token) {
      return undefined;
    }

    return data.tokens;
  }

  /**
   * Saves OAuth tokens to persistent storage.
   */
  saveTokens(tokens: OAuthTokens): void {
    this.storage.updateTokens(this.upstreamName, tokens);
  }

  /**
   * Opens the browser to the authorization URL.
   * Called by the MCP SDK during authorization_code flow.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    console.error(`\nOpening browser for authorization...`);
    console.error(`URL: ${authorizationUrl.toString()}\n`);
    await openBrowser(authorizationUrl.toString());
  }

  /**
   * Saves the PKCE code verifier for the current authorization flow.
   */
  saveCodeVerifier(codeVerifier: string): void {
    this.storage.saveCodeVerifier(this.upstreamName, codeVerifier);
  }

  /**
   * Retrieves the PKCE code verifier for token exchange.
   * Note: This does NOT clear the verifier - the SDK may call this multiple times.
   */
  codeVerifier(): string {
    const data = this.storage.load(this.upstreamName);
    return data?.codeVerifier ?? "";
  }

  /**
   * Prepares token request parameters for non-interactive flows.
   * Used for client_credentials grant type.
   */
  prepareTokenRequest(scope?: string): URLSearchParams | undefined {
    if (this.config.grantType !== "client_credentials") {
      // Let SDK handle authorization_code flow
      return undefined;
    }

    const params = new URLSearchParams();
    params.set("grant_type", "client_credentials");

    // Add scope from parameter or config
    const requestScope = scope ?? this.config.scope;
    if (requestScope) {
      params.set("scope", requestScope);
    }

    return params;
  }

  /**
   * Adds client authentication to token requests.
   * Handles both client_secret_basic and client_secret_post methods.
   */
  addClientAuthentication = (
    headers: Headers,
    params: URLSearchParams,
  ): void => {
    const clientId = this.config.clientId;
    const clientSecret = this.resolvedClientSecret;

    if (!clientSecret) {
      // Public client - just add client_id to params
      params.set("client_id", clientId);
      return;
    }

    // Use client_secret_basic (preferred) - Base64 encode credentials in Authorization header
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    headers.set("Authorization", `Basic ${credentials}`);
  };

  /**
   * Invalidates stored credentials when the server indicates they're no longer valid.
   */
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): void {
    switch (scope) {
      case "all":
      case "tokens":
        this.storage.delete(this.upstreamName);
        break;
      case "verifier":
        this.storage.getAndClearCodeVerifier(this.upstreamName);
        break;
      case "client":
        // We don't store client registration info separately
        break;
    }
  }

  /**
   * Verifies the OAuth state parameter from the callback.
   * Returns true if state matches, false otherwise.
   */
  verifyState(state: string): boolean {
    return this.storage.verifyAndClearState(this.upstreamName, state);
  }

  /**
   * Clears the PKCE code verifier after successful token exchange.
   */
  clearCodeVerifier(): void {
    this.storage.getAndClearCodeVerifier(this.upstreamName);
  }

  /**
   * Checks if the provider is configured for interactive (browser-based) auth.
   */
  isInteractive(): boolean {
    return this.config.grantType === "authorization_code";
  }

  /**
   * Gets the token endpoint URL from config.
   */
  getTokenEndpoint(): string {
    return this.config.tokenEndpoint;
  }

  /**
   * Gets the authorization endpoint URL from config.
   * Only valid for authorization_code flow.
   */
  getAuthorizationEndpoint(): string | undefined {
    return this.config.authorizationEndpoint;
  }
}
