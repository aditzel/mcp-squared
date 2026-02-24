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

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { type MonitorArgs, parseArgs, printHelp } from "./cli/index.js";
import type { DaemonArgs, ProxyArgs } from "./cli/index.js";
import {
  type InstanceRegistryEntry,
  type McpSquaredConfig,
  deleteInstanceEntry,
  ensureInstanceRegistryDir,
  ensureSocketDir,
  formatValidationIssues,
  listActiveInstanceEntries,
  loadConfig,
  validateConfig,
  validateUpstreamConfig,
  writeInstanceEntry,
} from "./config/index.js";
import { getSocketFilePath } from "./config/paths.js";
import type { UpstreamSseServerConfig } from "./config/schema.js";
import { computeConfigHash } from "./daemon/config-hash.js";
import { type ProxyBridge, runProxy } from "./daemon/proxy.js";
import { loadLiveDaemonRegistry } from "./daemon/registry.js";
import { DaemonServer } from "./daemon/server.js";
import { runImport } from "./import/runner.js";
import { runInstall } from "./install/runner.js";
import {
  McpOAuthProvider,
  OAuthCallbackServer,
  TokenStorage,
  performPreflightAuth,
} from "./oauth/index.js";
import { McpSquaredServer } from "./server/index.js";
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
  const { config, path: configPath } = await loadConfig();

  // Prune stale instance entries from previous runs
  await listActiveInstanceEntries({ prune: true });

  // Pre-flight OAuth: authenticate SSE upstreams before entering server mode
  // This allows interactive browser auth during startup, rather than failing later
  const preflightResult = await performPreflightAuth(config);

  if (preflightResult.authenticated.length > 0) {
    console.error(
      `[preflight] Authenticated ${preflightResult.authenticated.length} upstream(s): ${preflightResult.authenticated.join(", ")}`,
    );
  }

  if (preflightResult.failed.length > 0) {
    console.error(
      `[preflight] Warning: ${preflightResult.failed.length} upstream(s) failed authentication:`,
    );
    for (const { name, error } of preflightResult.failed) {
      console.error(`[preflight]   - ${name}: ${error}`);
    }
    // Continue anyway - the upstreams will be unavailable but others may work
  }

  const instanceId = randomUUID();
  const socketPath = getSocketFilePath(instanceId);

  ensureInstanceRegistryDir();
  ensureSocketDir();

  const server = new McpSquaredServer({
    config,
    monitorSocketPath: socketPath,
  });

  let instanceEntryPath: string | null = null;
  const launcher = resolveLauncherHint();
  const instanceEntry: InstanceRegistryEntry = {
    id: instanceId,
    pid: process.pid,
    socketPath,
    startedAt: Date.now(),
    cwd: process.cwd(),
    configPath,
    version: VERSION,
    command: process.argv.join(" "),
    role: "server",
    ...(launcher ? { launcher } : {}),
  };

  const registerInstance = (): void => {
    if (!instanceEntryPath) {
      instanceEntryPath = writeInstanceEntry(instanceEntry);
    }
  };

  const unregisterInstance = (): void => {
    if (instanceEntryPath) {
      deleteInstanceEntry(instanceEntryPath);
      instanceEntryPath = null;
    }
  };

  // Track if shutdown is already in progress to prevent double cleanup
  let isShuttingDown = false;

  const gracefulShutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      // Force exit if shutdown takes too long (e.g. hung upstream)
      const forceExitTimer = setTimeout(() => {
        console.error("Forcing shutdown after timeout");
        process.exit(1);
      }, 2000);
      forceExitTimer.unref();

      await server.stop();
      unregisterInstance();
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error during shutdown: ${message}`);
      unregisterInstance();
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

  // Exit when stdin closes (parent process died)
  // This prevents orphaned server processes when the MCP client terminates
  process.stdin.on("close", () => {
    void gracefulShutdown();
  });

  // Also handle stdin end event for additional coverage
  process.stdin.on("end", () => {
    void gracefulShutdown();
  });

  process.on("exit", () => {
    unregisterInstance();
  });

  await server.start();
  registerInstance();
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
function formatTestResult(
  name: string,
  result: TestResult,
  verbose = false,
): void {
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
      console.log("  Stderr output:");
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
async function runTest(
  targetName: string | undefined,
  verbose = false,
): Promise<void> {
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

  // Validate configuration before testing
  const validationIssues = validateConfig(config);
  const errorUpstreams = new Set(
    validationIssues
      .filter((i) => i.severity === "error")
      .map((i) => i.upstream),
  );

  if (validationIssues.length > 0) {
    console.error(formatValidationIssues(validationIssues));
    console.error("");
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

    // Check for validation errors on target upstream
    const targetIssues = validateUpstreamConfig(targetName, upstream);
    const targetErrors = targetIssues.filter((i) => i.severity === "error");
    if (targetErrors.length > 0) {
      console.error(`\n\x1b[31m✗\x1b[0m ${targetName}`);
      console.error(
        `  Error: Invalid configuration - ${targetErrors[0]?.message}`,
      );
      if (targetErrors[0]?.suggestion) {
        console.error(`  \x1b[90m→ ${targetErrors[0].suggestion}\x1b[0m`);
      }
      process.exit(1);
    }

    console.log(`Testing upstream: ${targetName}...`);
    const result = await testUpstreamConnection(targetName, upstream, {
      verbose,
    });
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

    // Skip upstreams with configuration errors
    if (errorUpstreams.has(name)) {
      console.log(`\n\x1b[31m✗\x1b[0m ${name}`);
      const issue = validationIssues.find(
        (i) => i.upstream === name && i.severity === "error",
      );
      console.log(`  Error: Invalid configuration - ${issue?.message}`);
      if (issue?.suggestion) {
        console.log(`  \x1b[90m→ ${issue.suggestion}\x1b[0m`);
      }
      allSuccess = false;
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
 * Uses the MCP SDK's OAuth flow with Dynamic Client Registration.
 *
 * The flow:
 * 1. Create transport with OAuth provider
 * 2. Attempt connection → triggers discovery + dynamic registration
 * 3. SDK opens browser for user authorization
 * 4. Wait for callback with authorization code
 * 5. Complete authentication with transport.finishAuth()
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
    console.error(
      `Error: Upstream '${targetName}' uses ${upstream.transport} transport.`,
    );
    console.error(
      "OAuth authentication is only supported for SSE/HTTP upstreams.",
    );
    process.exit(1);
  }

  const sseConfig = upstream as UpstreamSseServerConfig;

  console.log(`\nAuthenticating with '${targetName}'...`);
  console.log(`Server URL: ${sseConfig.sse.url}`);

  // Create OAuth provider and storage
  // Use auth config if provided, otherwise use defaults
  const tokenStorage = new TokenStorage();
  const authConfig =
    typeof sseConfig.sse.auth === "object" ? sseConfig.sse.auth : undefined;
  const callbackPort = authConfig?.callbackPort ?? 8089;
  const clientName = authConfig?.clientName ?? "MCP²";
  const authProvider = new McpOAuthProvider(targetName, tokenStorage, {
    callbackPort,
    clientName,
  });

  // Check if we already have valid tokens
  const existingTokens = authProvider.tokens();
  if (existingTokens && !authProvider.isTokenExpired()) {
    console.log("\nExisting valid tokens found.");
    console.log(
      `Run 'mcp-squared test ${targetName}' to verify the connection.`,
    );
    process.exit(0);
  }

  // Start callback server
  const callbackServer = new OAuthCallbackServer({
    port: callbackPort,
    path: "/callback",
    timeoutMs: 300_000, // 5 minutes
  });

  console.log(`\nCallback URL: ${callbackServer.getCallbackUrl()}`);

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
    name: "mcp-squared-auth",
    version: VERSION,
  });

  console.log("\nConnecting to server...");
  console.log("(This will trigger OAuth discovery and browser authorization)");

  try {
    // Attempt to connect - this will trigger OAuth flow and throw UnauthorizedError
    // after opening the browser for authorization
    // Cast needed due to exactOptionalPropertyTypes incompatibility
    await client.connect(transport as unknown as Transport);

    // If we get here without error, we're already authenticated
    console.log("\n\x1b[32m✓\x1b[0m Already authenticated!");
    console.log(
      `Run 'mcp-squared test ${targetName}' to verify the connection.`,
    );
    await client.close();
    callbackServer.stop();
    process.exit(0);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      // Not an auth error - something else went wrong
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nConnection error: ${message}`);
      callbackServer.stop();
      process.exit(1);
    }

    // UnauthorizedError means the SDK has opened the browser and we need to wait for callback
    console.log("\nWaiting for browser authorization...");
  }

  try {
    // Wait for the OAuth callback
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

    console.log("\nAuthorization code received. Completing authentication...");

    // Complete the OAuth flow - SDK handles token exchange
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

/**
 * Runs the server monitor TUI.
 * Resolves the shared daemon monitor socket and launches the monitor interface.
 *
 * @param options - Monitor options from CLI
 * @internal
 */
async function runMonitor(options: MonitorArgs): Promise<void> {
  let socketPath = options.socketPath;
  const instances: InstanceRegistryEntry[] = [];

  if (!socketPath) {
    const { config, path: configPath } = await loadConfig();
    const configHash = computeConfigHash(config);
    const daemonRegistry = await loadLiveDaemonRegistry(configHash);
    if (!daemonRegistry) {
      console.error(
        "Error: No running shared MCP² daemon found for the active configuration.",
      );
      console.error("Start the daemon first:");
      console.error("  mcp-squared daemon");
      console.error("");
      console.error(
        "Or connect directly with: mcp-squared monitor --socket=<path|tcp://host:port>",
      );
      process.exit(1);
    }

    const daemonEntry: InstanceRegistryEntry = {
      id: `daemon-${configHash}`,
      pid: daemonRegistry.pid,
      socketPath: getSocketFilePath(configHash),
      startedAt: daemonRegistry.startedAt,
      configPath,
      command: "mcp-squared daemon",
      role: "daemon",
      ...(daemonRegistry.version ? { version: daemonRegistry.version } : {}),
    };
    instances.push(daemonEntry);

    augmentProcessInfo(instances);

    const instanceId = options.instanceId;
    if (
      instanceId &&
      daemonEntry.id !== instanceId &&
      !daemonEntry.id.startsWith(instanceId)
    ) {
      console.error(
        `Error: Monitor is daemon-only. No daemon instance matches '${instanceId}'.`,
      );
      console.error(`Running daemon instance: ${daemonEntry.id}`);
      process.exit(1);
    }

    socketPath = daemonEntry.socketPath;
  }

  try {
    const monitorOptions: {
      socketPath: string;
      instances: InstanceRegistryEntry[];
      refreshInterval: number;
    } = {
      socketPath,
      instances,
      refreshInterval: options.noAutoRefresh ? 0 : options.refreshInterval,
    };
    const { runMonitorTui } = await import("./tui/monitor-loader.js");
    await runMonitorTui(monitorOptions);
  } catch (error) {
    if (isTuiModuleNotFoundError(error)) {
      printTuiUnavailableError("monitor");
      return process.exit(1);
    }
    const err = error as Error;
    console.error(`Error launching monitor: ${err.message}`);
    console.error("");
    console.error("Possible causes:");
    console.error("  - Server is not responding to monitor requests");
    console.error("  - Socket file is not accessible (permission issues)");
    console.error("  - Server was started without monitor support");
    console.error("");
    console.error("Try restarting the server:");
    console.error("  mcp-squared");
    process.exit(1);
  }
}

/**
 * Returns true if the error indicates a missing TUI runtime dependency
 * (@opentui/core or its platform-specific native packages).
 *
 * In compiled standalone binaries the TUI packages are marked --external and
 * resolved at runtime.  When they are absent (no bun install context), the
 * dynamic import of the TUI module itself throws a "Cannot find module" error
 * with the opentui package name in the message.
 */
function isTuiModuleNotFoundError(error: unknown): boolean {
  const cause =
    error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  if (
    cause !== undefined &&
    cause !== error &&
    isTuiModuleNotFoundError(cause)
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  const hasMissingModule =
    hasMissingModuleMessage(message) ||
    hasMissingModuleErrorCode(error as { code?: unknown });
  const hasOpentuiMarker = containsOpentuiMarker(message);

  return hasMissingModule && hasOpentuiMarker;
}

function hasMissingModuleErrorCode(error: { code?: unknown }): boolean {
  const code = error.code;
  return code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
}

function hasMissingModuleMessage(message: string): boolean {
  return (
    message.includes("Cannot find module") ||
    message.includes("Cannot find package")
  );
}

function containsOpentuiMarker(message: string): boolean {
  const lowercaseMessage = message.toLowerCase();
  return (
    lowercaseMessage.includes("@opentui") ||
    lowercaseMessage.includes("opentui")
  );
}

/**
 * Prints a user-friendly error when TUI commands are invoked in an environment
 * where @opentui/core is not available (e.g. standalone compiled binary).
 */
function printTuiUnavailableError(command: string): void {
  console.error(
    `Error: The '${command}' command requires the TUI runtime (@opentui/core),`,
  );
  console.error("which is not available in this environment.");
  console.error("");
  console.error("To use TUI commands, run mcp-squared via bun:");
  console.error(`  bunx mcp-squared ${command}`);
  console.error("  # or");
  console.error(`  bun run src/index.ts ${command}`);
}

function augmentProcessInfo(entries: InstanceRegistryEntry[]): void {
  if (entries.length === 0) {
    return;
  }
  if (process.platform === "win32") {
    return;
  }

  const pids = entries.map((entry) => entry.pid).filter((pid) => pid > 0);
  if (pids.length === 0) {
    return;
  }

  const result = spawnSync(
    "ps",
    ["-p", pids.join(","), "-o", "pid=,ppid=,user=,comm=,command="],
    { encoding: "utf8" },
  );

  if (result.status !== 0 || !result.stdout) {
    return;
  }

  const lines = result.stdout.trim().split("\n").filter(Boolean);
  for (const line of lines) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const pid = Number.parseInt(match[1] ?? "", 10);
    const ppid = Number.parseInt(match[2] ?? "", 10);
    const user = match[3];
    const comm = match[4];
    const command = match[5];
    const entry = entries.find((item) => item.pid === pid);
    if (!entry) {
      continue;
    }
    if (!Number.isNaN(ppid)) {
      entry.ppid = ppid;
    }
    if (user !== undefined) {
      entry.user = user;
    }
    if (comm !== undefined) {
      entry.processName = comm;
    }
    if (!entry.command && command !== undefined) {
      entry.command = command;
    }
  }

  const parentPids = Array.from(
    new Set(
      entries
        .map((entry) => entry.ppid)
        .filter((ppid): ppid is number => typeof ppid === "number" && ppid > 0),
    ),
  );
  if (parentPids.length === 0) {
    return;
  }

  const parentResult = spawnSync(
    "ps",
    ["-p", parentPids.join(","), "-o", "pid=,comm=,command="],
    { encoding: "utf8" },
  );

  if (parentResult.status !== 0 || !parentResult.stdout) {
    return;
  }

  const parentMap = new Map<number, { name: string; command: string }>();
  for (const line of parentResult.stdout.trim().split("\n").filter(Boolean)) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const pid = Number.parseInt(match[1] ?? "", 10);
    if (Number.isNaN(pid)) {
      continue;
    }
    parentMap.set(pid, { name: match[2] ?? "", command: match[3] ?? "" });
  }

  for (const entry of entries) {
    if (!entry.ppid) {
      continue;
    }
    const parent = parentMap.get(entry.ppid);
    if (!parent) {
      continue;
    }
    entry.parentProcessName = parent.name;
    entry.parentCommand = parent.command;
    if (!entry.launcher && parent.name) {
      entry.launcher = parent.name;
    }
  }
}

function resolveLauncherHint(): string | undefined {
  return (
    process.env["MCP_SQUARED_LAUNCHER"] ??
    process.env["MCP_CLIENT_NAME"] ??
    process.env["MCP_SQUARED_AGENT"] ??
    undefined
  );
}

/**
 * Runs the shared MCP² daemon.
 *
 * @param options - Daemon options from CLI
 * @internal
 */
async function runDaemon(options: DaemonArgs): Promise<void> {
  const { config, path: configPath } = await loadConfig();
  const configHash = computeConfigHash(config);
  const monitorSocketPath = getSocketFilePath(configHash);
  const runtime = new McpSquaredServer({
    config,
    monitorSocketPath,
  });
  const daemonOptions: {
    runtime: McpSquaredServer;
    configHash: string;
    socketPath?: string;
    onIdleShutdown?: () => void;
  } = {
    runtime,
    configHash,
    onIdleShutdown: () => {
      process.exit(0);
    },
  };
  if (options.socketPath) {
    daemonOptions.socketPath = options.socketPath;
  }
  const daemon = new DaemonServer(daemonOptions);

  ensureInstanceRegistryDir();
  ensureSocketDir();

  const daemonLauncher = resolveLauncherHint();
  const instanceEntry: InstanceRegistryEntry = {
    id: `daemon-${configHash}`,
    pid: process.pid,
    socketPath: monitorSocketPath,
    startedAt: Date.now(),
    cwd: process.cwd(),
    configPath,
    version: VERSION,
    command: process.argv.join(" "),
    role: "daemon",
    ...(daemonLauncher ? { launcher: daemonLauncher } : {}),
  };
  let instanceEntryPath: string | null = null;
  const registerInstance = (): void => {
    if (!instanceEntryPath) {
      instanceEntryPath = writeInstanceEntry(instanceEntry);
    }
  };
  const unregisterInstance = (): void => {
    if (instanceEntryPath) {
      deleteInstanceEntry(instanceEntryPath);
      instanceEntryPath = null;
    }
  };

  const shutdown = async (exitCode: number): Promise<void> => {
    try {
      await daemon.stop();
    } finally {
      unregisterInstance();
      process.exit(exitCode);
    }
  };

  process.on("SIGINT", () => {
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    void shutdown(0);
  });
  process.on("exit", () => {
    try {
      unregisterInstance();
    } catch {
      // best-effort cleanup
    }
  });

  await daemon.start();
  registerInstance();
}

/**
 * Runs the stdio proxy to the shared daemon.
 *
 * @param options - Proxy options from CLI
 * @internal
 */
async function runProxyCommand(options: ProxyArgs): Promise<void> {
  const { config, path: configPath } = await loadConfig();
  const configHash = computeConfigHash(config);
  const monitorSocketPath = getSocketFilePath(configHash);

  ensureInstanceRegistryDir();
  ensureSocketDir();

  const proxyLauncher = resolveLauncherHint();
  const instanceEntry: InstanceRegistryEntry = {
    id: `proxy-${process.pid}`,
    pid: process.pid,
    socketPath: monitorSocketPath,
    startedAt: Date.now(),
    cwd: process.cwd(),
    configPath,
    version: VERSION,
    command: process.argv.join(" "),
    role: "proxy",
    ...(proxyLauncher ? { launcher: proxyLauncher } : {}),
  };
  let instanceEntryPath: string | null = null;
  let proxyHandle: ProxyBridge | null = null;
  let isShuttingDown = false;
  const registerInstance = (): void => {
    if (!instanceEntryPath) {
      instanceEntryPath = writeInstanceEntry(instanceEntry);
    }
  };
  const unregisterInstance = (): void => {
    if (instanceEntryPath) {
      deleteInstanceEntry(instanceEntryPath);
      instanceEntryPath = null;
    }
  };

  const shutdown = async (exitCode: number): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    try {
      if (proxyHandle) {
        await proxyHandle.stop();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error shutting down proxy: ${message}`);
    } finally {
      unregisterInstance();
      process.exit(exitCode);
    }
  };

  process.on("exit", unregisterInstance);
  process.on("SIGINT", () => {
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    void shutdown(0);
  });
  process.stdin.on("close", () => {
    void shutdown(0);
  });
  process.stdin.on("end", () => {
    void shutdown(0);
  });

  const proxyOptions: {
    endpoint?: string;
    noSpawn: boolean;
    configHash: string;
  } = {
    noSpawn: options.noSpawn,
    configHash,
  };
  if (options.socketPath) {
    proxyOptions.endpoint = options.socketPath;
  }
  try {
    proxyHandle = await runProxy(proxyOptions);
  } catch (error) {
    unregisterInstance();
    throw error;
  }
  registerInstance();
}

/**
 * Main entry point for the MCP² CLI.
 * Parses arguments and dispatches to the appropriate mode.
 * @internal
 */
export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(`MCP² v${VERSION}`);
    process.exit(0);
  }

  switch (args.mode) {
    case "config": {
      try {
        const { runConfigTui } = await import("./tui/config-loader.js");
        await runConfigTui();
      } catch (error) {
        if (isTuiModuleNotFoundError(error)) {
          printTuiUnavailableError("config");
          return process.exit(1);
        }
        throw error;
      }
      break;
    }
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
    case "install":
      await runInstall(args.install);
      break;
    case "monitor":
      await runMonitor(args.monitor);
      break;
    case "daemon":
      await runDaemon(args.daemon);
      break;
    case "proxy":
      await runProxyCommand(args.proxy);
      break;
    default:
      if (args.stdio) {
        await startServer();
        break;
      }
      if (process.stdin.isTTY && process.stdout.isTTY) {
        await runDaemon(args.daemon);
      } else {
        await runProxyCommand(args.proxy);
      }
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
