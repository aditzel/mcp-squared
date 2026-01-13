#!/usr/bin/env bun
/**
 * MCP² (Mercury Control Plane) - Main entry point.
 *
 * MCP² is a local-first meta-server that aggregates multiple upstream MCP servers
 * and provides unified tool discovery and execution. It supports:
 *
 * - Multi-scope configuration (env, project, user)
 * - Security policies (allow/block/confirm)
 * - Full-text tool search via SQLite FTS5
 * - stdio and SSE transport types
 *
 * @module mcp-squared
 */

import { parseArgs, printHelp } from "./cli/index.js";
import { type McpSquaredConfig, loadConfig } from "./config/index.js";
import type { UpstreamSseServerConfig } from "./config/schema.js";
import { runImport } from "./import/runner.js";
import {
  McpOAuthProvider,
  OAuthCallbackServer,
  TokenStorage,
} from "./oauth/index.js";
import { McpSquaredServer } from "./server/index.js";
import { runConfigTui } from "./tui/config.js";
import { type TestResult, testUpstreamConnection } from "./upstream/index.js";

/** Current version of MCP² */
export const VERSION = "0.1.0";

/**
 * Starts the MCP server in stdio mode.
 * Loads configuration, sets up signal handlers, and begins listening.
 * @internal
 */
async function startServer(): Promise<void> {
  // Load configuration
  const { config } = await loadConfig();

  const server = new McpSquaredServer({ config });

  // Track if shutdown is already in progress to prevent double cleanup
  let isShuttingDown = false;

  const gracefulShutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      await server.stop();
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error during shutdown: ${message}`);
      process.exit(1);
    }
  };

  // Use void operator to explicitly mark the promise as intentionally not awaited
  process.on("SIGINT", () => {
    void gracefulShutdown();
  });

  process.on("SIGTERM", () => {
    void gracefulShutdown();
  });

  await server.start();
}

/**
 * Formats and prints a test result to stdout.
 * Shows success/failure status, server info, and available tools.
 *
 * @param name - The upstream server name
 * @param result - The test result to format
 * @param verbose - Whether to show additional details
 * @internal
 */
function formatTestResult(name: string, result: TestResult, verbose = false): void {
  const status = result.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`\n${status} ${name}`);

  if (result.success) {
    if (result.serverName) {
      console.log(
        `  Server: ${result.serverName}${result.serverVersion ? ` v${result.serverVersion}` : ""}`,
      );
    }
    console.log(`  Tools: ${result.tools.length} available`);
    for (const tool of result.tools.slice(0, 10)) {
      const desc = tool.description
        ? ` - ${tool.description.slice(0, 50)}${tool.description.length > 50 ? "..." : ""}`
        : "";
      console.log(`    • ${tool.name}${desc}`);
    }
    if (result.tools.length > 10) {
      console.log(`    ... and ${result.tools.length - 10} more`);
    }
    console.log(`  Time: ${result.durationMs}ms`);
  } else {
    console.log(`  Error: ${result.error}`);
    console.log(`  Time: ${result.durationMs}ms`);
    // Show stderr in non-verbose mode for failed connections (verbose mode prints in real-time)
    if (!verbose && result.stderr) {
      console.log(`  Stderr output:`);
      for (const line of result.stderr.split("\n").slice(0, 10)) {
        if (line.trim()) {
          console.log(`    ${line}`);
        }
      }
      const lines = result.stderr.split("\n").filter((l) => l.trim());
      if (lines.length > 10) {
        console.log(`    ... and ${lines.length - 10} more lines`);
      }
    }
  }
}

/**
 * Runs connection tests against upstream servers.
 * Tests a specific server if name provided, or all enabled servers.
 *
 * @param targetName - Optional specific server name to test
 * @param verbose - Whether to show detailed connection info
 * @internal
 */
async function runTest(targetName: string | undefined, verbose = false): Promise<void> {
  let config: McpSquaredConfig;
  try {
    const loaded = await loadConfig();
    config = loaded.config;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error loading configuration: ${message}`);
    console.error(
      "Run 'mcp-squared config' to create or fix your configuration.",
    );
    process.exit(1);
  }

  const upstreamEntries = Object.entries(config.upstreams);

  if (upstreamEntries.length === 0) {
    console.error(
      "Error: No upstreams configured. Run 'mcp-squared config' to add one.",
    );
    process.exit(1);
  }

  if (targetName) {
    const upstream = config.upstreams[targetName];
    if (!upstream) {
      console.error(`Error: Upstream '${targetName}' not found.`);
      console.error(
        `Available upstreams: ${Object.keys(config.upstreams).join(", ")}`,
      );
      process.exit(1);
    }

    console.log(`Testing upstream: ${targetName}...`);
    const result = await testUpstreamConnection(targetName, upstream, { verbose });
    formatTestResult(targetName, result, verbose);
    process.exit(result.success ? 0 : 1);
  }

  console.log(`Testing ${upstreamEntries.length} upstream(s)...`);

  let allSuccess = true;
  for (const [name, upstream] of upstreamEntries) {
    if (!upstream.enabled) {
      console.log(`\n⊘ ${name} (disabled)`);
      continue;
    }

    const result = await testUpstreamConnection(name, upstream, { verbose });
    formatTestResult(name, result, verbose);
    if (!result.success) allSuccess = false;
  }

  console.log("");
  process.exit(allSuccess ? 0 : 1);
}

/**
 * Runs OAuth authentication for an upstream server.
 * Opens browser for authorization_code flow and waits for callback.
 *
 * @param targetName - Name of the upstream server to authenticate
 * @internal
 */
async function runAuth(targetName: string): Promise<void> {
  let config: McpSquaredConfig;
  try {
    const loaded = await loadConfig();
    config = loaded.config;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error loading configuration: ${message}`);
    console.error(
      "Run 'mcp-squared config' to create or fix your configuration.",
    );
    process.exit(1);
  }

  const upstream = config.upstreams[targetName];
  if (!upstream) {
    console.error(`Error: Upstream '${targetName}' not found.`);
    console.error(
      `Available upstreams: ${Object.keys(config.upstreams).join(", ")}`,
    );
    process.exit(1);
  }

  if (upstream.transport !== "sse") {
    console.error(`Error: Upstream '${targetName}' uses ${upstream.transport} transport.`);
    console.error("OAuth authentication is only supported for SSE/HTTP upstreams.");
    process.exit(1);
  }

  const sseConfig = upstream as UpstreamSseServerConfig;
  if (!sseConfig.sse.oauth) {
    console.error(`Error: Upstream '${targetName}' does not have OAuth configured.`);
    console.error(
      "Add an [upstreams.<name>.sse.oauth] section to your configuration.",
    );
    process.exit(1);
  }

  if (sseConfig.sse.oauth.grantType !== "authorization_code") {
    console.error(
      `Error: Upstream '${targetName}' uses ${sseConfig.sse.oauth.grantType} grant type.`,
    );
    console.error(
      "Only authorization_code flow requires browser authentication.",
    );
    console.error(
      "client_credentials flow authenticates automatically on connection.",
    );
    process.exit(1);
  }

  console.log(`\nAuthenticating with '${targetName}'...`);
  console.log(`Grant type: ${sseConfig.sse.oauth.grantType}`);

  // Create OAuth provider and storage
  const tokenStorage = new TokenStorage();
  const authProvider = new McpOAuthProvider(
    targetName,
    sseConfig.sse.oauth,
    tokenStorage,
  );

  // Check if we already have valid tokens
  const existingTokens = authProvider.tokens();
  if (existingTokens) {
    console.log("\nExisting tokens found.");
    console.log("Run 'mcp-squared test " + targetName + "' to verify the connection.");
    process.exit(0);
  }

  // Start callback server
  const callbackServer = new OAuthCallbackServer({
    port: sseConfig.sse.oauth.callbackPort,
    path: "/callback",
    timeoutMs: 300_000, // 5 minutes
  });

  console.log(`\nCallback URL: ${callbackServer.getCallbackUrl()}`);

  // Build authorization URL manually since we're not using the transport
  const authEndpoint = sseConfig.sse.oauth.authorizationEndpoint;
  if (!authEndpoint) {
    console.error(
      "Error: authorizationEndpoint is required for authorization_code flow.",
    );
    process.exit(1);
  }

  // Generate state and code verifier using PKCE
  const state = authProvider.state();
  const pkce = await import("pkce-challenge");
  const challenge = await pkce.default();
  const codeVerifier = challenge.code_verifier;
  const codeChallenge = challenge.code_challenge;
  authProvider.saveCodeVerifier(codeVerifier);

  // Build authorization URL
  const authUrl = new URL(authEndpoint);
  authUrl.searchParams.set("client_id", sseConfig.sse.oauth.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", sseConfig.sse.oauth.redirectUrl);
  authUrl.searchParams.set("state", state);
  if (sseConfig.sse.oauth.usePkce) {
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
  }
  if (sseConfig.sse.oauth.scope) {
    authUrl.searchParams.set("scope", sseConfig.sse.oauth.scope);
  }

  console.log("\nOpening browser for authorization...");
  await authProvider.redirectToAuthorization(authUrl);

  console.log("\nWaiting for authorization callback...");

  try {
    const result = await callbackServer.waitForCallback();

    if (result.error) {
      console.error(
        `\nOAuth error: ${result.error}${result.errorDescription ? `: ${result.errorDescription}` : ""}`,
      );
      process.exit(1);
    }

    if (!result.code) {
      console.error("\nError: No authorization code received.");
      process.exit(1);
    }

    // Verify state
    if (result.state && !authProvider.verifyState(result.state)) {
      console.error("\nError: OAuth state mismatch - possible CSRF attack.");
      process.exit(1);
    }

    console.log("\nAuthorization code received. Exchanging for token...");

    // Exchange code for tokens
    const tokenEndpoint = sseConfig.sse.oauth.tokenEndpoint;
    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("code", result.code);
    params.set("redirect_uri", sseConfig.sse.oauth.redirectUrl);
    params.set("client_id", sseConfig.sse.oauth.clientId);
    if (sseConfig.sse.oauth.usePkce) {
      params.set("code_verifier", codeVerifier);
    }

    const headers = new Headers();
    headers.set("Content-Type", "application/x-www-form-urlencoded");

    // Add client authentication if secret is provided
    authProvider.addClientAuthentication(headers, params);

    const tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers,
      body: params,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`\nToken exchange failed: ${tokenResponse.status}`);
      console.error(errorText);
      process.exit(1);
    }

    const tokens = (await tokenResponse.json()) as import("@modelcontextprotocol/sdk/shared/auth.js").OAuthTokens;
    authProvider.saveTokens(tokens);
    authProvider.clearCodeVerifier();

    console.log("\n\x1b[32m✓\x1b[0m Authentication successful!");
    console.log(
      `\nTokens saved to: ~/.config/mcp-squared/tokens/${targetName}.json`,
    );
    console.log(
      `Run 'mcp-squared test ${targetName}' to verify the connection.`,
    );
  } finally {
    callbackServer.stop();
  }
}

/**
 * Main entry point for the MCP² CLI.
 * Parses arguments and dispatches to the appropriate mode.
 * @internal
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(`MCP² v${VERSION}`);
    process.exit(0);
  }

  switch (args.mode) {
    case "config":
      await runConfigTui();
      break;
    case "test":
      await runTest(args.testTarget, args.testVerbose);
      break;
    case "import":
      await runImport(args.import);
      break;
    case "auth":
      if (!args.authTarget) {
        console.error("Error: auth command requires an upstream name.");
        console.error("Usage: mcp-squared auth <upstream>");
        process.exit(1);
      }
      await runAuth(args.authTarget);
      break;
    default:
      await startServer();
  }
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
