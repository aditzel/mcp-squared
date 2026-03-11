import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { loadConfig, type McpSquaredConfig } from "../config/index.js";
import {
  McpOAuthProvider,
  OAuthCallbackServer,
  resolveOAuthProviderOptions,
  TokenStorage,
} from "../oauth/index.js";
import { VERSION } from "../version.js";

interface LoadConfigResult {
  config: McpSquaredConfig;
  path: string;
}

interface OAuthProviderLike {
  tokens(): unknown;
  isTokenExpired(): boolean;
  verifyState(state: string): boolean;
  clearCodeVerifier(): void;
}

interface OAuthCallbackServerLike {
  getCallbackUrl(): string;
  waitForCallback(): Promise<{
    code?: string;
    error?: string;
    errorDescription?: string;
    state?: string;
  }>;
  stop(): void;
}

interface AuthClientLike {
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
}

export interface RunAuthDependencies {
  createAuthProvider: (options: {
    callbackPort: number;
    clientName: string;
    targetName: string;
    tokenStorage: TokenStorage;
  }) => OAuthProviderLike;
  createCallbackServer: (options: {
    path: string;
    port: number;
    timeoutMs: number;
  }) => OAuthCallbackServerLike;
  createClient: () => AuthClientLike;
  createTokenStorage: () => TokenStorage;
  createTransport: (options: {
    authProvider: OAuthProviderLike;
    headers?: Record<string, string>;
    url: string;
  }) => { finishAuth(code: string): Promise<void> };
  loadConfig: () => Promise<LoadConfigResult>;
  processRef: Pick<typeof process, "exit">;
  resolveOAuthProviderOptions: typeof resolveOAuthProviderOptions;
}

export function createRunAuthDependencies(): RunAuthDependencies {
  return {
    createAuthProvider: ({
      callbackPort,
      clientName,
      targetName,
      tokenStorage,
    }) =>
      new McpOAuthProvider(targetName, tokenStorage, {
        callbackPort,
        clientName,
      }),
    createCallbackServer: (options) => new OAuthCallbackServer(options),
    createClient: () =>
      new Client({
        name: "mcp-squared-auth",
        version: VERSION,
      }),
    createTokenStorage: () => new TokenStorage(),
    createTransport: ({ authProvider, headers, url }) =>
      new StreamableHTTPClientTransport(new URL(url), {
        authProvider,
        requestInit: { headers: { ...headers } },
      }),
    loadConfig,
    processRef: process,
    resolveOAuthProviderOptions,
  };
}

export async function runAuthCommand(
  targetName: string,
  dependencies: RunAuthDependencies,
): Promise<void> {
  const {
    createAuthProvider,
    createCallbackServer,
    createClient,
    createTokenStorage,
    createTransport,
    loadConfig,
    processRef,
    resolveOAuthProviderOptions,
  } = dependencies;

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
    processRef.exit(1);
    return;
  }

  const upstream = config.upstreams[targetName];
  if (!upstream) {
    console.error(`Error: Upstream '${targetName}' not found.`);
    console.error(
      `Available upstreams: ${Object.keys(config.upstreams).join(", ")}`,
    );
    processRef.exit(1);
    return;
  }

  if (upstream.transport !== "sse") {
    console.error(
      `Error: Upstream '${targetName}' uses ${upstream.transport} transport.`,
    );
    console.error(
      "OAuth authentication is only supported for SSE/HTTP upstreams.",
    );
    processRef.exit(1);
    return;
  }

  console.log(`\nAuthenticating with '${targetName}'...`);
  console.log(`Server URL: ${upstream.sse.url}`);

  const tokenStorage = createTokenStorage();
  let callbackPort: number;
  let clientName: string;
  try {
    ({ callbackPort, clientName } = resolveOAuthProviderOptions(
      upstream.sse.auth,
    ));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `Error: Invalid OAuth configuration for '${targetName}': ${message}`,
    );
    processRef.exit(1);
    return;
  }

  const authProvider = createAuthProvider({
    callbackPort,
    clientName,
    targetName,
    tokenStorage,
  });

  const existingTokens = authProvider.tokens();
  if (existingTokens && !authProvider.isTokenExpired()) {
    console.log("\nExisting valid tokens found.");
    console.log(
      `Run 'mcp-squared test ${targetName}' to verify the connection.`,
    );
    processRef.exit(0);
    return;
  }

  const callbackServer = createCallbackServer({
    path: "/callback",
    port: callbackPort,
    timeoutMs: 300_000,
  });
  console.log(`\nCallback URL: ${callbackServer.getCallbackUrl()}`);

  const transport = createTransport({
    authProvider,
    headers: upstream.sse.headers,
    url: upstream.sse.url,
  });
  const client = createClient();

  console.log("\nConnecting to server...");
  console.log("(This will trigger OAuth discovery and browser authorization)");

  try {
    await client.connect(transport as unknown as Transport);
    console.log("\n\x1b[32m✓\x1b[0m Already authenticated!");
    console.log(
      `Run 'mcp-squared test ${targetName}' to verify the connection.`,
    );
    await client.close();
    callbackServer.stop();
    processRef.exit(0);
    return;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nConnection error: ${message}`);
      callbackServer.stop();
      processRef.exit(1);
      return;
    }

    console.log("\nWaiting for browser authorization...");
  }

  try {
    const result = await callbackServer.waitForCallback();

    if (result.error) {
      console.error(
        `\nOAuth error: ${result.error}${result.errorDescription ? `: ${result.errorDescription}` : ""}`,
      );
      processRef.exit(1);
      return;
    }

    if (!result.code) {
      console.error("\nError: No authorization code received.");
      processRef.exit(1);
      return;
    }

    if (result.state && !authProvider.verifyState(result.state)) {
      console.error("\nError: OAuth state mismatch - possible CSRF attack.");
      processRef.exit(1);
      return;
    }

    console.log("\nAuthorization code received. Completing authentication...");
    await transport.finishAuth(result.code);
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
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }
}
