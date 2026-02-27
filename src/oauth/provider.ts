/**
 * OAuth provider implementation for MCP² upstream servers.
 *
 * This provider implements the MCP SDK's OAuthClientProvider interface
 * with support for OAuth 2.0 Dynamic Client Registration (RFC 7591).
 *
 * The flow is:
 * 1. Client connects to MCP server → gets 401
 * 2. SDK discovers OAuth metadata from /.well-known/oauth-authorization-server
 * 3. SDK dynamically registers client (no pre-configured clientId needed)
 * 4. SDK opens browser for user authorization
 * 5. User logs in, SDK exchanges code for tokens
 * 6. Provider stores registered client info + tokens for future use
 *
 * @module oauth/provider
 */

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { logAuthorizationUrl, openBrowser } from "./browser.js";
import type { TokenStorage } from "./token-storage.js";

/** Default callback port for OAuth redirects */
export const DEFAULT_OAUTH_CALLBACK_PORT = 8089;

/** Default client name for dynamic registration */
export const DEFAULT_OAUTH_CLIENT_NAME = "MCP²";

/**
 * Configuration options for McpOAuthProvider.
 */
export interface McpOAuthProviderOptions {
  /** Port for local OAuth callback server (default: 8089) */
  callbackPort?: number;
  /** Client name to use during dynamic registration (default: "MCP²") */
  clientName?: string;
  /**
   * If true, throw an error instead of opening browser for authorization.
   * Use this in server mode where interactive auth isn't possible.
   */
  nonInteractive?: boolean;
}

export type OAuthAuthConfigInput =
  | boolean
  | {
      callbackPort?: number;
      clientName?: string;
    }
  | undefined;

export interface ResolvedOAuthProviderOptions {
  callbackPort: number;
  clientName: string;
}

function isValidCallbackPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function isValidClientName(value: string): boolean {
  return value.trim().length > 0;
}

export function resolveOAuthProviderOptions(
  authConfig: OAuthAuthConfigInput,
): ResolvedOAuthProviderOptions {
  if (!authConfig || typeof authConfig !== "object") {
    return {
      callbackPort: DEFAULT_OAUTH_CALLBACK_PORT,
      clientName: DEFAULT_OAUTH_CLIENT_NAME,
    };
  }

  const callbackPort = authConfig.callbackPort ?? DEFAULT_OAUTH_CALLBACK_PORT;
  if (!isValidCallbackPort(callbackPort)) {
    throw new RangeError(`Invalid OAuth callbackPort: ${callbackPort}`);
  }

  const clientName = authConfig.clientName ?? DEFAULT_OAUTH_CLIENT_NAME;
  if (typeof clientName !== "string" || !isValidClientName(clientName)) {
    throw new TypeError(`Invalid OAuth clientName: ${String(clientName)}`);
  }

  return {
    callbackPort,
    clientName,
  };
}

/**
 * OAuth provider for MCP² using Dynamic Client Registration.
 *
 * This provider handles the full OAuth lifecycle:
 * - Dynamic client registration (no pre-configured clientId needed)
 * - Browser-based authorization
 * - Token storage and retrieval
 * - PKCE code verifier management
 *
 * @example
 * ```ts
 * const storage = new TokenStorage();
 * const provider = new McpOAuthProvider("my-server", storage);
 *
 * const transport = new StreamableHTTPClientTransport(serverUrl, {
 *   authProvider: provider,
 * });
 * ```
 */
export class McpOAuthProvider implements OAuthClientProvider {
  private readonly upstreamName: string;
  private readonly storage: TokenStorage;
  private readonly callbackPort: number;
  private readonly _clientName: string;
  private readonly _nonInteractive: boolean;
  private _state: string | undefined;

  /**
   * Creates a new OAuth provider for an upstream server.
   *
   * @param upstreamName - Unique identifier for the upstream (used for storage)
   * @param storage - Token storage instance for persistence
   * @param options - Optional configuration (callbackPort, clientName, nonInteractive)
   */
  constructor(
    upstreamName: string,
    storage: TokenStorage,
    options: McpOAuthProviderOptions = {},
  ) {
    this.upstreamName = upstreamName;
    this.storage = storage;
    this.callbackPort = options.callbackPort ?? DEFAULT_OAUTH_CALLBACK_PORT;
    this._clientName = options.clientName ?? DEFAULT_OAUTH_CLIENT_NAME;
    this._nonInteractive = options.nonInteractive ?? false;
  }

  /**
   * The redirect URL for OAuth callbacks.
   * Returns the local callback server URL.
   */
  get redirectUrl(): string {
    return `http://localhost:${this.callbackPort}/callback`;
  }

  /**
   * Client metadata for dynamic registration.
   * This is sent to the authorization server during registration.
   */
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this._clientName,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // Public client
    };
  }

  /**
   * Generates and returns an OAuth state parameter.
   * Used to prevent CSRF attacks during authorization.
   */
  state(): string {
    if (!this._state) {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      this._state = Array.from(array, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    }
    return this._state;
  }

  /**
   * Verifies that a received state matches the expected state.
   */
  verifyState(receivedState: string): boolean {
    return this._state === receivedState;
  }

  /**
   * Returns stored client information from dynamic registration.
   * Returns undefined if no registration has occurred yet.
   */
  clientInformation(): OAuthClientInformationMixed | undefined {
    const data = this.storage.load(this.upstreamName);
    return data?.clientInfo;
  }

  /**
   * Saves client information after dynamic registration.
   * Called by the SDK after successful registration.
   */
  saveClientInformation(clientInfo: OAuthClientInformationMixed): void {
    const data = this.storage.load(this.upstreamName) ?? {};
    data.clientInfo = clientInfo;
    this.storage.save(this.upstreamName, data);
  }

  /**
   * Returns stored OAuth tokens for the current session.
   * Returns undefined if no tokens are stored.
   */
  tokens(): OAuthTokens | undefined {
    const data = this.storage.load(this.upstreamName);
    return data?.tokens;
  }

  /**
   * Saves OAuth tokens after successful authorization.
   */
  saveTokens(tokens: OAuthTokens): void {
    const data = this.storage.load(this.upstreamName) ?? {};
    data.tokens = tokens;
    // Calculate expiry time if expires_in is provided
    if (tokens.expires_in) {
      data.expiresAt = Date.now() + tokens.expires_in * 1000;
    }
    this.storage.save(this.upstreamName, data);
  }

  /**
   * Opens the browser to begin authorization.
   * Falls back to logging the URL if browser can't be opened.
   * In non-interactive mode, throws an error instead.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this._nonInteractive) {
      // In server mode, we can't do interactive browser auth
      // Throw to signal that manual auth is required
      throw new Error(
        `OAuth authorization required. Run: mcp-squared auth ${this.upstreamName}`,
      );
    }

    const urlString = authorizationUrl.toString();
    console.error("\nOpening browser for authorization...");
    console.error(`URL: ${urlString}\n`);
    const opened = await openBrowser(urlString);
    if (!opened) {
      logAuthorizationUrl(urlString);
    }
  }

  /**
   * Saves the PKCE code verifier for the current authorization flow.
   */
  saveCodeVerifier(codeVerifier: string): void {
    const data = this.storage.load(this.upstreamName) ?? {};
    data.codeVerifier = codeVerifier;
    this.storage.save(this.upstreamName, data);
  }

  /**
   * Returns the stored PKCE code verifier.
   * Throws if no code verifier is stored.
   */
  async codeVerifier(): Promise<string> {
    const data = this.storage.load(this.upstreamName);
    if (!data?.codeVerifier) {
      throw new Error("No code verifier stored");
    }
    return data.codeVerifier;
  }

  /**
   * Clears the stored code verifier after authorization is complete.
   */
  clearCodeVerifier(): void {
    const data = this.storage.load(this.upstreamName);
    if (data) {
      const { codeVerifier: _, ...rest } = data;
      this.storage.save(this.upstreamName, rest);
    }
  }

  /**
   * Invalidates stored credentials.
   * Called by the SDK when credentials are no longer valid.
   */
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): void {
    const data = this.storage.load(this.upstreamName);
    if (!data) return;

    switch (scope) {
      case "all":
        this.storage.delete(this.upstreamName);
        break;
      case "client": {
        const { clientInfo: _, ...rest } = data;
        this.storage.save(this.upstreamName, rest);
        break;
      }
      case "tokens": {
        const { tokens: _, expiresAt: __, ...rest } = data;
        this.storage.save(this.upstreamName, rest);
        break;
      }
      case "verifier": {
        const { codeVerifier: _, ...rest } = data;
        this.storage.save(this.upstreamName, rest);
        break;
      }
    }
  }

  /**
   * Returns whether this provider requires user interaction.
   * Always true since we use authorization_code flow.
   */
  isInteractive(): boolean {
    return true;
  }

  /**
   * Returns whether this provider is in non-interactive (server) mode.
   * If true, it cannot open a browser and will throw errors instead.
   */
  isNonInteractive(): boolean {
    return this._nonInteractive;
  }

  /**
   * Checks if the stored access token is expired.
   * Returns true if expired or no expiry information is available.
   */
  isTokenExpired(bufferMs = 60_000): boolean {
    const data = this.storage.load(this.upstreamName);
    if (!data?.expiresAt) return true;
    return Date.now() >= data.expiresAt - bufferMs;
  }

  /**
   * Clears all stored data for this upstream.
   */
  clearAll(): void {
    this.storage.delete(this.upstreamName);
    this._state = undefined;
  }
}
