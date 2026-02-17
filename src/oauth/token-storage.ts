/**
 * File-based OAuth token storage.
 *
 * Stores OAuth tokens persistently in the filesystem so they survive
 * process restarts. Tokens are stored per-upstream in JSON files.
 *
 * @module oauth/token-storage
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

// Re-export for convenience
export type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Data stored for each upstream's OAuth state.
 */
export interface StoredTokenData {
  /** OAuth tokens (access_token, refresh_token, etc.) */
  tokens?: OAuthTokens;
  /** Unix timestamp (ms) when access token expires */
  expiresAt?: number;
  /** PKCE code verifier for authorization_code flow */
  codeVerifier?: string;
  /** OAuth state parameter for CSRF protection */
  state?: string;
  /** When tokens were last updated */
  updatedAt?: number;
  /** Dynamically registered client information (client_id, etc.) */
  clientInfo?: OAuthClientInformationMixed;
}

/**
 * Default directory for token storage.
 * Located at ~/.config/mcp-squared/tokens/
 */
function getDefaultTokenDir(): string {
  const configDir =
    process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config");
  return join(configDir, "mcp-squared", "tokens");
}

/**
 * Sanitizes an upstream name for use as a filename.
 * Replaces unsafe characters with underscores.
 */
function sanitizeUpstreamName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * File-based OAuth token storage.
 *
 * Stores tokens in JSON files with secure permissions:
 * - Directory: 0700 (owner rwx only)
 * - Files: 0600 (owner rw only)
 */
export class TokenStorage {
  private readonly baseDir: string;

  /**
   * Creates a new TokenStorage instance.
   *
   * @param baseDir - Directory for token files (default: ~/.config/mcp-squared/tokens/)
   */
  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? getDefaultTokenDir();
    this.ensureDir();
  }

  /**
   * Ensures the token directory exists with secure permissions.
   */
  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }

    // Enforce secure permissions even when the directory already existed.
    try {
      chmodSync(this.baseDir, 0o700);
    } catch {
      // Best effort only; don't block auth flow on chmod failures.
    }
  }

  /**
   * Gets the file path for an upstream's token data.
   */
  private getFilePath(upstreamName: string): string {
    const safeName = sanitizeUpstreamName(upstreamName);
    return join(this.baseDir, `${safeName}.json`);
  }

  /**
   * Loads token data for an upstream.
   *
   * @param upstreamName - Name of the upstream server
   * @returns Token data if exists, undefined otherwise
   */
  load(upstreamName: string): StoredTokenData | undefined {
    const filePath = this.getFilePath(upstreamName);

    if (!existsSync(filePath)) {
      return undefined;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content) as StoredTokenData;
    } catch {
      // File exists but couldn't be read/parsed
      return undefined;
    }
  }

  /**
   * Saves token data for an upstream.
   * Sets secure file permissions (0600).
   *
   * @param upstreamName - Name of the upstream server
   * @param data - Token data to save
   */
  save(upstreamName: string, data: StoredTokenData): void {
    this.ensureDir();
    const filePath = this.getFilePath(upstreamName);

    const dataWithTimestamp: StoredTokenData = {
      ...data,
      updatedAt: Date.now(),
    };

    writeFileSync(filePath, JSON.stringify(dataWithTimestamp, null, 2), {
      mode: 0o600,
    });

    // writeFileSync mode is only guaranteed on create; enforce on existing files too.
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Best effort only; file may live on a filesystem that ignores mode bits.
    }
  }

  /**
   * Deletes token data for an upstream.
   *
   * @param upstreamName - Name of the upstream server
   */
  delete(upstreamName: string): void {
    const filePath = this.getFilePath(upstreamName);

    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  /**
   * Checks if stored tokens are expired or will expire soon.
   *
   * @param upstreamName - Name of the upstream server
   * @param bufferMs - Buffer time before expiry to consider expired (default: 60000ms = 1 min)
   * @returns True if tokens are expired or will expire within buffer, false otherwise
   */
  isExpired(upstreamName: string, bufferMs = 60_000): boolean {
    const data = this.load(upstreamName);

    if (!data?.tokens || !data.expiresAt) {
      // No tokens or no expiry info - consider expired
      return true;
    }

    return Date.now() >= data.expiresAt - bufferMs;
  }

  /**
   * Updates just the tokens (and expiry) for an upstream.
   * Preserves other stored data like codeVerifier and state.
   *
   * @param upstreamName - Name of the upstream server
   * @param tokens - New OAuth tokens
   */
  updateTokens(upstreamName: string, tokens: OAuthTokens): void {
    const existing = this.load(upstreamName) ?? {};

    // Calculate expiry timestamp
    const updatedData: StoredTokenData = {
      ...existing,
      tokens,
    };

    if (tokens.expires_in) {
      updatedData.expiresAt = Date.now() + tokens.expires_in * 1000;
    }

    this.save(upstreamName, updatedData);
  }

  /**
   * Stores the PKCE code verifier for an upstream.
   *
   * @param upstreamName - Name of the upstream server
   * @param codeVerifier - PKCE code verifier
   */
  saveCodeVerifier(upstreamName: string, codeVerifier: string): void {
    const existing = this.load(upstreamName) ?? {};
    this.save(upstreamName, {
      ...existing,
      codeVerifier,
    });
  }

  /**
   * Retrieves and clears the PKCE code verifier for an upstream.
   * Verifier is cleared after retrieval for security.
   *
   * @param upstreamName - Name of the upstream server
   * @returns Code verifier if exists, undefined otherwise
   */
  getAndClearCodeVerifier(upstreamName: string): string | undefined {
    const data = this.load(upstreamName);
    const verifier = data?.codeVerifier;

    if (verifier && data) {
      // Clear the verifier after retrieval
      const { codeVerifier: _, ...rest } = data;
      this.save(upstreamName, rest);
    }

    return verifier;
  }

  /**
   * Stores the OAuth state parameter for CSRF protection.
   *
   * @param upstreamName - Name of the upstream server
   * @param state - OAuth state parameter
   */
  saveState(upstreamName: string, state: string): void {
    const existing = this.load(upstreamName) ?? {};
    this.save(upstreamName, {
      ...existing,
      state,
    });
  }

  /**
   * Verifies and clears the OAuth state parameter.
   *
   * @param upstreamName - Name of the upstream server
   * @param state - State to verify
   * @returns True if state matches, false otherwise
   */
  verifyAndClearState(upstreamName: string, state: string): boolean {
    const data = this.load(upstreamName);
    const storedState = data?.state;

    if (storedState && data) {
      // Clear the state after verification
      const { state: _, ...rest } = data;
      this.save(upstreamName, rest);
    }

    return storedState === state;
  }
}
