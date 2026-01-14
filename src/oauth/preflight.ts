/**
 * Pre-flight OAuth authentication for MCP² server startup.
 *
 * When MCP² is started by an agentic harness (Codex, Claude Code),
 * we need to handle OAuth authentication BEFORE entering server mode.
 * This module checks which SSE upstreams need OAuth and runs the
 * interactive browser flow during startup.
 *
 * @module oauth/preflight
 */

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpSquaredConfig } from "../config/index.js";
import type { UpstreamSseServerConfig } from "../config/schema.js";
import { McpOAuthProvider } from "./provider.js";
import { OAuthCallbackServer } from "./callback-server.js";
import { TokenStorage } from "./token-storage.js";

/** Result of pre-flight authentication */
export interface PreflightAuthResult {
  /** Upstreams that were successfully authenticated */
  authenticated: string[];
  /** Upstreams that already had valid tokens */
  alreadyValid: string[];
  /** Upstreams that failed authentication */
  failed: Array<{ name: string; error: string }>;
}

/**
 * Checks for SSE upstreams that need OAuth and performs interactive authentication.
 *
 * This should be called BEFORE starting the MCP server in stdio mode.
 * It allows users to complete OAuth flows interactively during startup,
 * rather than encountering errors after the server is running.
 *
 * @param config - The MCP² configuration
 * @returns Results indicating which upstreams were authenticated
 */
export async function performPreflightAuth(
  config: McpSquaredConfig,
): Promise<PreflightAuthResult> {
  const result: PreflightAuthResult = {
    authenticated: [],
    alreadyValid: [],
    failed: [],
  };

  const tokenStorage = new TokenStorage();

  // Find SSE upstreams with OAuth enabled
  const sseUpstreams: Array<{ name: string; config: UpstreamSseServerConfig }> =
    [];

  for (const [name, upstream] of Object.entries(config.upstreams)) {
    if (!upstream.enabled) continue;
    if (upstream.transport !== "sse") continue;

    const sseConfig = upstream as UpstreamSseServerConfig;
    if (!sseConfig.sse.auth) continue;

    sseUpstreams.push({ name, config: sseConfig });
  }

  if (sseUpstreams.length === 0) {
    return result;
  }

  // Check each upstream for valid tokens
  for (const { name, config: sseConfig } of sseUpstreams) {
    const authConfig =
      typeof sseConfig.sse.auth === "object" ? sseConfig.sse.auth : undefined;
    const callbackPort = authConfig?.callbackPort ?? 8089;
    const clientName = authConfig?.clientName ?? "MCP²";

    const authProvider = new McpOAuthProvider(name, tokenStorage, {
      callbackPort,
      clientName,
    });

    // Check if we already have valid tokens
    const existingTokens = authProvider.tokens();
    if (existingTokens && !authProvider.isTokenExpired()) {
      result.alreadyValid.push(name);
      continue;
    }

    // Need to authenticate - run interactive flow
    console.error(`\n[preflight] OAuth required for '${name}'`);
    console.error(`[preflight] Server URL: ${sseConfig.sse.url}`);

    try {
      await performInteractiveAuth(name, sseConfig, authProvider);
      result.authenticated.push(name);
      console.error(`[preflight] ✓ Authentication successful for '${name}'`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed.push({ name, error: message });
      console.error(`[preflight] ✗ Authentication failed for '${name}': ${message}`);
    }
  }

  return result;
}

/**
 * Performs interactive OAuth authentication for a single upstream.
 *
 * @param name - Upstream name
 * @param sseConfig - SSE configuration
 * @param authProvider - OAuth provider instance
 */
async function performInteractiveAuth(
  name: string,
  sseConfig: UpstreamSseServerConfig,
  authProvider: McpOAuthProvider,
): Promise<void> {
  const authConfig =
    typeof sseConfig.sse.auth === "object" ? sseConfig.sse.auth : undefined;
  const callbackPort = authConfig?.callbackPort ?? 8089;

  // Start callback server
  const callbackServer = new OAuthCallbackServer({
    port: callbackPort,
    path: "/callback",
    timeoutMs: 300_000, // 5 minutes
  });

  console.error(`[preflight:${name}] Callback URL: ${callbackServer.getCallbackUrl()}`);

  // Create transport with OAuth provider
  const transport = new StreamableHTTPClientTransport(
    new URL(sseConfig.sse.url),
    {
      authProvider,
      requestInit: {
        headers: { ...sseConfig.sse.headers },
      },
    },
  );

  // Create client
  const client = new Client({
    name: "mcp-squared-preflight",
    version: "0.1.0",
  });

  try {
    console.error(`[preflight:${name}] Connecting to server (will trigger OAuth)...`);

    // Attempt to connect - triggers OAuth flow and throws UnauthorizedError
    await client.connect(transport as unknown as Transport);

    // If we get here without error, already authenticated
    console.error(`[preflight:${name}] Already authenticated!`);
    return;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      callbackServer.stop();
      throw err;
    }

    // UnauthorizedError means SDK has opened browser, wait for callback
    console.error(`[preflight:${name}] Waiting for browser authorization...`);
  }

  try {
    // Wait for the OAuth callback
    const callbackResult = await callbackServer.waitForCallback();

    if (callbackResult.error) {
      throw new Error(
        `OAuth error: ${callbackResult.error}${callbackResult.errorDescription ? `: ${callbackResult.errorDescription}` : ""}`,
      );
    }

    if (!callbackResult.code) {
      throw new Error("No authorization code received");
    }

    // Verify state
    if (callbackResult.state && !authProvider.verifyState(callbackResult.state)) {
      throw new Error("OAuth state mismatch - possible CSRF attack");
    }

    console.error(`[preflight:${name}] Authorization code received, completing...`);

    // Complete the OAuth flow
    await transport.finishAuth(callbackResult.code);
    authProvider.clearCodeVerifier();
  } finally {
    callbackServer.stop();
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }
}
