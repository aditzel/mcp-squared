import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  UpstreamServerConfig,
  UpstreamSseServerConfig,
  UpstreamStdioServerConfig,
} from "../config/schema.js";
import {
  McpOAuthProvider,
  OAuthCallbackServer,
  TokenStorage,
} from "../oauth/index.js";
import { safelyCloseTransport } from "../utils/transport.js";

export interface ToolInfo {
  name: string;
  description: string | undefined;
}

export interface TestResult {
  success: boolean;
  serverName: string | undefined;
  serverVersion: string | undefined;
  tools: ToolInfo[];
  error: string | undefined;
  durationMs: number;
  /** Stderr output from the server process (verbose mode only) */
  stderr: string | undefined;
}

export interface TestOptions {
  /** Connection timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Override Client construction (testing only) */
  clientFactory?: () => Client;
  /** Override stdio transport construction (testing only) */
  stdioTransportFactory?: (
    config: UpstreamStdioServerConfig,
    log: (msg: string) => void,
    verbose: boolean,
    onStderr: (text: string) => void,
  ) => Transport;
}

function resolveEnvVars(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value.startsWith("$")) {
      const envKey = value.slice(1);
      resolved[key] = process.env[envKey] || "";
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Creates a stdio transport for testing.
 */
function createStdioTransport(
  config: UpstreamStdioServerConfig,
  log: (msg: string) => void,
  verbose: boolean,
  onStderr: (text: string) => void,
): StdioClientTransport {
  const fullCommand = [config.stdio.command, ...config.stdio.args].join(" ");
  log(`Command: ${fullCommand}`);
  if (config.stdio.cwd) {
    log(`Working dir: ${config.stdio.cwd}`);
  }

  const resolvedEnv = resolveEnvVars(config.env || {});
  if (verbose && Object.keys(resolvedEnv).length > 0) {
    log(`Environment: ${Object.keys(resolvedEnv).join(", ")}`);
  }
  const envWithDefaults = { ...process.env, ...resolvedEnv } as Record<
    string,
    string
  >;

  log("Creating stdio transport...");
  const transport = new StdioClientTransport({
    command: config.stdio.command,
    args: config.stdio.args,
    env: envWithDefaults,
    ...(config.stdio.cwd ? { cwd: config.stdio.cwd } : {}),
    stderr: "pipe",
  });

  // Capture stderr output
  if (transport.stderr) {
    transport.stderr.on("data", (chunk: Buffer) => {
      onStderr(chunk.toString());
    });
  }

  return transport;
}

/**
 * Creates an HTTP streaming transport for testing.
 * Uses StreamableHTTPClientTransport which is the modern MCP protocol.
 *
 * @param config - SSE server configuration
 * @param log - Logging function
 * @param verbose - Whether to log verbose output
 * @param authProvider - Optional OAuth provider for authentication
 */
function createHttpTransport(
  config: UpstreamSseServerConfig,
  log: (msg: string) => void,
  verbose: boolean,
  authProvider?: McpOAuthProvider,
): StreamableHTTPClientTransport {
  log(`URL: ${config.sse.url}`);

  const headers = { ...config.sse.headers };
  if (verbose && Object.keys(headers).length > 0) {
    log(`Headers: ${Object.keys(headers).join(", ")}`);
  }

  if (authProvider) {
    log("OAuth: dynamic client registration enabled");
  }

  log("Creating HTTP streaming transport...");

  // Build options conditionally to avoid passing undefined authProvider
  const transportOptions: {
    authProvider?: OAuthClientProvider;
    requestInit?: RequestInit;
  } = {
    requestInit: {
      headers,
    },
  };
  if (authProvider) {
    transportOptions.authProvider = authProvider;
  }

  const transport = new StreamableHTTPClientTransport(
    new URL(config.sse.url),
    transportOptions,
  );

  return transport;
}

/**
 * Handles OAuth authorization_code flow by opening browser and waiting for callback.
 */
async function handleOAuthCallback(
  transport: StreamableHTTPClientTransport,
  provider: McpOAuthProvider,
  log: (msg: string) => void,
): Promise<void> {
  // Start callback server to receive the authorization code
  const callbackServer = new OAuthCallbackServer({
    port: 8089,
    path: "/callback",
    timeoutMs: 300_000, // 5 minutes
  });

  log("Waiting for browser authorization...");
  log(`Callback URL: ${callbackServer.getCallbackUrl()}`);

  try {
    const result = await callbackServer.waitForCallback();

    if (result.error) {
      throw new Error(
        `OAuth error: ${result.error}${result.errorDescription ? `: ${result.errorDescription}` : ""}`,
      );
    }

    if (!result.code) {
      throw new Error("No authorization code received");
    }

    // Verify state if present
    if (result.state && !provider.verifyState(result.state)) {
      throw new Error("OAuth state mismatch - possible CSRF attack");
    }

    log("Received authorization code, exchanging for token...");
    await transport.finishAuth(result.code);
    provider.clearCodeVerifier();
    log("OAuth authentication complete");
  } finally {
    callbackServer.stop();
  }
}

export async function testUpstreamConnection(
  name: string,
  config: UpstreamServerConfig,
  options: TestOptions = {},
): Promise<TestResult> {
  const { timeoutMs = 30_000, verbose = false } = options;
  const startTime = Date.now();
  const log = (msg: string) => verbose && console.log(`  [${name}] ${msg}`);
  let stderrOutput = "";

  let client: Client | null = null;
  let transport: Transport | null = null;
  let httpTransport: StreamableHTTPClientTransport | null = null;
  let authProvider: McpOAuthProvider | undefined;

  try {
    client =
      options.clientFactory?.() ??
      new Client({
        name: "mcp-squared-test",
        version: "1.0.0",
      });

    // Create appropriate transport based on config
    if (config.transport === "stdio") {
      const transportFactory =
        options.stdioTransportFactory ?? createStdioTransport;
      transport = transportFactory(
        config as UpstreamStdioServerConfig,
        log,
        verbose,
        (text) => {
          stderrOutput += text;
          if (verbose) {
            for (const line of text.split("\n").filter((l) => l.trim())) {
              console.log(`  [${name}] stderr: ${line}`);
            }
          }
        },
      );
    } else if (config.transport === "sse") {
      const sseConfig = config as UpstreamSseServerConfig;

      // Create OAuth provider if auth is enabled OR if stored tokens exist
      const tokenStorage = new TokenStorage();
      const hasStoredTokens = tokenStorage.load(name)?.tokens !== undefined;
      if (sseConfig.sse.auth || hasStoredTokens) {
        const authOptions =
          typeof sseConfig.sse.auth === "object" ? sseConfig.sse.auth : {};
        authProvider = new McpOAuthProvider(name, tokenStorage, authOptions);
      }

      httpTransport = createHttpTransport(
        sseConfig,
        log,
        verbose,
        authProvider,
      );
      transport = httpTransport as Transport;
    } else {
      // TypeScript exhaustively checks transport types, but keep this for safety
      const unknownConfig = config as { transport: string };
      return {
        success: false,
        serverName: undefined,
        serverVersion: undefined,
        tools: [],
        error: `Unknown transport type: ${unknownConfig.transport}`,
        durationMs: Date.now() - startTime,
        stderr: undefined,
      };
    }

    log(`Connecting (timeout: ${timeoutMs}ms)...`);
    const connectStart = Date.now();
    // biome-ignore lint/style/noNonNullAssertion: transport is assigned above for all code paths
    const connectPromise = client.connect(transport!);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Connection timeout")),
        timeoutMs,
      );
    });

    try {
      await Promise.race([connectPromise, timeoutPromise]);
    } catch (err) {
      // Handle OAuth authorization required
      if (err instanceof UnauthorizedError && authProvider && httpTransport) {
        if (authProvider.isInteractive()) {
          log("OAuth authorization required, opening browser...");
          await handleOAuthCallback(httpTransport, authProvider, log);

          // Retry connection after auth
          log("Retrying connection after OAuth...");
          // biome-ignore lint/style/noNonNullAssertion: transport is assigned above for all code paths
          await Promise.race([client.connect(transport!), timeoutPromise]);
        } else {
          // client_credentials should have worked automatically
          throw err;
        }
      } else {
        throw err;
      }
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
    log(`Connected in ${Date.now() - connectStart}ms`);

    const serverInfo = client.getServerVersion();
    if (serverInfo) {
      log(`Server: ${serverInfo.name} v${serverInfo.version}`);
    }

    log("Fetching tools...");
    const toolsStart = Date.now();
    const { tools } = await client.listTools();
    log(`Got ${tools.length} tools in ${Date.now() - toolsStart}ms`);

    const toolInfos: ToolInfo[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));

    return {
      success: true,
      serverName: serverInfo?.name,
      serverVersion: serverInfo?.version,
      tools: toolInfos,
      error: undefined,
      durationMs: Date.now() - startTime,
      stderr: stderrOutput || undefined,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Error: ${errorMessage}`);
    return {
      success: false,
      serverName: undefined,
      serverVersion: undefined,
      tools: [],
      error: errorMessage,
      durationMs: Date.now() - startTime,
      stderr: stderrOutput || undefined,
    };
  } finally {
    log("Cleaning up...");
    if (transport) {
      await safelyCloseTransport(transport);
    }
    if (client) {
      try {
        await client.close();
      } catch {}
    }
    log("Done");
  }
}
