/**
 * Cataloger module for managing connections to upstream MCP servers.
 *
 * This module provides the core functionality for connecting to and managing
 * multiple upstream MCP servers. It handles both stdio and SSE transport types,
 * maintains connection state, and provides tool discovery and execution capabilities.
 *
 * @module upstream/cataloger
 */

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  McpSquaredConfig,
  UpstreamServerConfig,
  UpstreamSseServerConfig,
  UpstreamStdioServerConfig,
} from "../config/schema.js";
import { McpOAuthProvider, TokenStorage } from "../oauth/index.js";
import { sanitizeDescription } from "../security/index.js";
import {
  formatQualifiedName,
  parseQualifiedName,
} from "../utils/tool-names.js";
import { safelyCloseTransport } from "../utils/transport.js";

/**
 * Connection status for an upstream server.
 *
 * - `disconnected`: No active connection
 * - `connecting`: Connection attempt in progress
 * - `connected`: Successfully connected and ready
 * - `error`: Connection failed or encountered an error
 */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * JSON Schema for tool input parameters.
 * Follows the JSON Schema specification with type "object".
 */
export interface ToolInputSchema {
  /** Must be "object" for MCP tool schemas */
  type: "object";
  /** Property definitions for the tool's parameters */
  properties?: Record<string, unknown>;
  /** List of required property names */
  required?: string[];
  /** Additional schema properties */
  [key: string]: unknown;
}

/**
 * A tool that has been cataloged from an upstream MCP server.
 * Contains sanitized metadata and the server it originated from.
 */
export interface CatalogedTool {
  /** Unique tool name (unique per server) */
  name: string;
  /** Sanitized tool description (may be undefined if not provided) */
  description: string | undefined;
  /** JSON Schema defining the tool's input parameters */
  inputSchema: ToolInputSchema;
  /** Key identifying the upstream server this tool belongs to */
  serverKey: string;
}

/**
 * Represents the state of a connection to an upstream MCP server.
 * Tracks connection status, available tools, and client/transport references.
 */
export interface ServerConnection {
  /** Unique key identifying this server connection */
  key: string;
  /** Configuration used to establish the connection */
  config: UpstreamServerConfig;
  /** Current connection status */
  status: ConnectionStatus;
  /** Error message if status is "error" */
  error: string | undefined;
  /** Name reported by the server (if connected) */
  serverName: string | undefined;
  /** Version reported by the server (if connected) */
  serverVersion: string | undefined;
  /** Tools available from this server */
  tools: CatalogedTool[];
  /** MCP client instance (null if not connected) */
  client: Client | null;
  /** Transport layer (stdio or HTTP streaming) */
  transport: Transport | null;
  /** OAuth provider for authenticated connections */
  authProvider: McpOAuthProvider | null;
  /** Whether auth is pending (browser authorization required) */
  authPending: boolean;
}

/**
 * Configuration options for the Cataloger.
 */
export interface CatalogerOptions {
  /** Connection timeout in milliseconds (default: 30000) */
  connectTimeoutMs?: number;
}

/**
 * Resolves environment variable references in a configuration object.
 * Values starting with "$" are replaced with the corresponding environment variable.
 *
 * @param env - Object with values that may contain environment variable references
 * @returns Object with resolved environment variable values
 *
 * @example
 * ```ts
 * const env = { API_KEY: "$MY_API_KEY" };
 * const resolved = resolveEnvVars(env);
 * // resolved.API_KEY === process.env.MY_API_KEY
 * ```
 */
function resolveEnvVars(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value.startsWith("$")) {
      const envKey = value.slice(1);
      resolved[key] = process.env[envKey] ?? "";
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Manages connections to upstream MCP servers and catalogs their available tools.
 *
 * The Cataloger is the central component for:
 * - Establishing connections to multiple upstream MCP servers
 * - Discovering and cataloging tools from connected servers
 * - Executing tool calls on the appropriate upstream server
 * - Managing connection lifecycle (connect, disconnect, refresh)
 *
 * @example
 * ```ts
 * const cataloger = new Cataloger({ connectTimeoutMs: 10000 });
 * await cataloger.connectAll(config);
 *
 * const tools = cataloger.getAllTools();
 * const result = await cataloger.callTool("some_tool", { arg: "value" });
 * ```
 */
export class Cataloger {
  private readonly connections = new Map<string, ServerConnection>();
  private readonly connectTimeoutMs: number;

  /**
   * Creates a new Cataloger instance.
   *
   * @param options - Configuration options
   * @param options.connectTimeoutMs - Connection timeout in milliseconds (default: 30000)
   */
  constructor(options: CatalogerOptions = {}) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 30_000;
  }

  /**
   * Connects to all enabled upstream servers defined in the configuration.
   * Connections are made in parallel for efficiency.
   *
   * @param config - The MCP² configuration containing upstream server definitions
   * @returns Promise that resolves when all connection attempts have completed
   */
  async connectAll(config: McpSquaredConfig): Promise<void> {
    const connectPromises: Promise<void>[] = [];

    for (const [key, serverConfig] of Object.entries(config.upstreams)) {
      if (serverConfig.enabled) {
        connectPromises.push(this.connect(key, serverConfig));
      }
    }

    await Promise.allSettled(connectPromises);
  }

  /**
   * Connects to a single upstream MCP server.
   * If a connection with the same key exists, it will be disconnected first.
   * Tool descriptions are sanitized to prevent prompt injection attacks.
   *
   * @param key - Unique identifier for this connection
   * @param config - Server configuration (stdio or SSE transport)
   * @returns Promise that resolves when connection is established or fails
   */
  async connect(key: string, config: UpstreamServerConfig): Promise<void> {
    // Disconnect existing connection if any
    if (this.connections.has(key)) {
      await this.disconnect(key);
    }

    const connection: ServerConnection = {
      key,
      config,
      status: "connecting",
      error: undefined,
      serverName: undefined,
      serverVersion: undefined,
      tools: [],
      client: null,
      transport: null,
      authProvider: null,
      authPending: false,
    };
    this.connections.set(key, connection);

    try {
      const client = new Client({
        name: "mcp-squared",
        version: "1.0.0",
      });

      let transport: Transport;

      if (config.transport === "stdio") {
        transport = this.createStdioTransport(config);
      } else {
        const { transport: httpTransport, authProvider } =
          this.createHttpTransport(key, config);
        transport = httpTransport as Transport;
        connection.authProvider = authProvider;
      }

      connection.client = client;
      connection.transport = transport;

      // Connect with timeout
      const connectPromise = client.connect(transport);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Connection timeout")),
          this.connectTimeoutMs,
        );
      });

      try {
        await Promise.race([connectPromise, timeoutPromise]);
      } catch (err) {
        // Handle OAuth authorization required
        if (err instanceof UnauthorizedError && connection.authProvider) {
          if (connection.authProvider.isNonInteractive()) {
            // In server mode, we can't do interactive browser auth
            // Mark as pending and let the user run `mcp-squared auth <upstream>`
            connection.authPending = true;
            connection.status = "error";
            connection.error = `OAuth authorization required. Run: mcp-squared auth ${key}`;
            return;
          }
          // If interactive, let the error propagate (client might handle it)
          throw err;
        }
        throw err;
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }

      // Get server info
      const serverInfo = client.getServerVersion();
      connection.serverName = serverInfo?.name;
      connection.serverVersion = serverInfo?.version;

      // Fetch tools
      const { tools } = await client.listTools();
      connection.tools = tools.map((tool) => ({
        name: tool.name,
        description: sanitizeDescription(tool.description),
        inputSchema: tool.inputSchema as ToolInputSchema,
        serverKey: key,
      }));

      connection.status = "connected";
    } catch (err) {
      connection.status = "error";
      connection.error = err instanceof Error ? err.message : String(err);

      // Clean up on error - handle any cleanup errors to ensure the connection stays in error state
      try {
        await this.cleanupConnection(connection);
      } catch (cleanupErr) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Disconnects from a specific upstream server and cleans up resources.
   *
   * @param key - The server key to disconnect
   * @returns Promise that resolves when disconnection is complete
   */
  async disconnect(key: string): Promise<void> {
    const connection = this.connections.get(key);
    if (!connection) return;

    await this.cleanupConnection(connection);
    connection.status = "disconnected";
    connection.tools = [];
    this.connections.delete(key);
  }

  /**
   * Disconnects from all upstream servers and cleans up all resources.
   *
   * @returns Promise that resolves when all disconnections are complete
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.keys()).map((key) =>
      this.disconnect(key),
    );
    await Promise.allSettled(disconnectPromises);
  }

  /**
   * Returns all tools from all connected upstream servers.
   *
   * @returns Array of cataloged tools from all connected servers
   */
  getAllTools(): CatalogedTool[] {
    const allTools: CatalogedTool[] = [];
    for (const connection of this.connections.values()) {
      if (connection.status === "connected") {
        allTools.push(...connection.tools);
      }
    }
    return allTools;
  }

  /**
   * Returns tools from a specific upstream server.
   *
   * @param key - The server key to get tools from
   * @returns Array of tools from the specified server (empty if not connected)
   */
  getToolsForServer(key: string): CatalogedTool[] {
    const connection = this.connections.get(key);
    if (!connection || connection.status !== "connected") {
      return [];
    }
    return connection.tools;
  }

  /**
   * Finds all tools matching a bare tool name across all connected servers.
   * Use this to detect ambiguity when a tool name exists on multiple servers.
   *
   * @param toolName - The bare tool name to search for
   * @returns Array of matching tools (may contain 0, 1, or multiple matches)
   */
  findToolsByName(toolName: string): CatalogedTool[] {
    const matches: CatalogedTool[] = [];
    for (const connection of this.connections.values()) {
      if (connection.status === "connected") {
        const tool = connection.tools.find((t) => t.name === toolName);
        if (tool) {
          matches.push(tool);
        }
      }
    }
    return matches;
  }

  /**
   * Finds a tool by name, supporting both qualified and bare names.
   *
   * Qualified format: `serverKey:toolName` - returns exact match
   * Bare format: `toolName` - returns match if unambiguous
   *
   * @param name - Tool name (qualified or bare)
   * @returns Object with tool (if found) and ambiguous flag with alternatives
   *
   * @example
   * ```ts
   * // Qualified lookup - exact match
   * const result = cataloger.findTool("filesystem:read_file");
   * // { tool: {...}, ambiguous: false, alternatives: [] }
   *
   * // Bare lookup - ambiguous
   * const result = cataloger.findTool("read_file");
   * // { tool: undefined, ambiguous: true, alternatives: ["filesystem:read_file", "github:read_file"] }
   * ```
   */
  findTool(name: string): {
    tool: CatalogedTool | undefined;
    ambiguous: boolean;
    alternatives: string[];
  } {
    const parsed = parseQualifiedName(name);

    if (parsed.serverKey !== null) {
      // Qualified name - exact lookup
      const connection = this.connections.get(parsed.serverKey);
      if (!connection || connection.status !== "connected") {
        return { tool: undefined, ambiguous: false, alternatives: [] };
      }
      const tool = connection.tools.find((t) => t.name === parsed.toolName);
      return { tool, ambiguous: false, alternatives: [] };
    }

    // Bare name - check for ambiguity
    const matches = this.findToolsByName(parsed.toolName);

    if (matches.length === 0) {
      return { tool: undefined, ambiguous: false, alternatives: [] };
    }

    if (matches.length === 1) {
      return { tool: matches[0], ambiguous: false, alternatives: [] };
    }

    // Multiple matches - ambiguous
    const alternatives = matches.map((t) =>
      formatQualifiedName(t.serverKey, t.name),
    );
    return { tool: undefined, ambiguous: true, alternatives };
  }

  /**
   * Returns the connection status of all upstream servers.
   *
   * @returns Map of server keys to their connection status and error (if any)
   */
  getStatus(): Map<
    string,
    { status: ConnectionStatus; error: string | undefined }
  > {
    const status = new Map<
      string,
      { status: ConnectionStatus; error: string | undefined }
    >();
    for (const [key, connection] of this.connections) {
      status.set(key, {
        status: connection.status,
        error: connection.error,
      });
    }
    return status;
  }

  /**
   * Returns the connection object for a specific upstream server.
   *
   * @param key - The server key to look up
   * @returns The server connection if it exists, undefined otherwise
   */
  getConnection(key: string): ServerConnection | undefined {
    return this.connections.get(key);
  }

  /**
   * Checks if any upstream servers are currently connected.
   *
   * @returns true if at least one server is connected, false otherwise
   */
  hasConnections(): boolean {
    for (const connection of this.connections.values()) {
      if (connection.status === "connected") {
        return true;
      }
    }
    return false;
  }

  /**
   * Detects tool name conflicts across connected servers.
   * Returns a map of tool names that exist on multiple servers.
   *
   * @returns Map where keys are conflicting tool names and values are arrays of qualified names
   *
   * @example
   * ```ts
   * const conflicts = cataloger.getConflictingTools();
   * // Map { "read_file" => ["filesystem:read_file", "github:read_file"] }
   * ```
   */
  getConflictingTools(): Map<string, string[]> {
    const toolServers = new Map<string, string[]>();
    const conflicts = new Map<string, string[]>();

    // Build map of tool name -> list of servers that have it
    for (const connection of this.connections.values()) {
      if (connection.status === "connected") {
        for (const tool of connection.tools) {
          const servers = toolServers.get(tool.name) ?? [];
          servers.push(connection.key);
          toolServers.set(tool.name, servers);
        }
      }
    }

    // Extract conflicts (tools with >1 server)
    for (const [toolName, servers] of toolServers) {
      if (servers.length > 1) {
        conflicts.set(
          toolName,
          servers.map((serverKey) => formatQualifiedName(serverKey, toolName)),
        );
      }
    }

    return conflicts;
  }

  /**
   * Logs warnings for any tool name conflicts.
   * Call this after connecting to new servers to alert about potential ambiguities.
   */
  logConflicts(): void {
    const conflicts = this.getConflictingTools();
    if (conflicts.size > 0) {
      console.warn(
        "[mcp²] Tool name conflicts detected. Use qualified names to avoid ambiguity:",
      );
      for (const [toolName, qualified] of conflicts) {
        console.warn(`  - "${toolName}" available as: ${qualified.join(", ")}`);
      }
    }
  }

  /**
   * Executes a tool call on the appropriate upstream server.
   * The tool is located by name and the call is forwarded to its server.
   * Supports both qualified (`serverKey:toolName`) and bare tool names.
   *
   * @param toolName - Name of the tool to execute (qualified or bare)
   * @param args - Arguments to pass to the tool
   * @returns Promise resolving to the tool result with content and error flag
   * @throws Error if tool is not found, ambiguous, or server is not connected
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: unknown[]; isError: boolean | undefined }> {
    const result = this.findTool(toolName);

    if (result.ambiguous) {
      throw new Error(
        `Ambiguous tool name "${toolName}". Use a qualified name: ${result.alternatives.join(", ")}`,
      );
    }

    if (!result.tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const connection = this.connections.get(result.tool.serverKey);
    if (!connection?.client || connection.status !== "connected") {
      throw new Error(`Server not connected: ${result.tool.serverKey}`);
    }

    // Use the bare tool name when calling upstream (they don't know about our namespacing)
    const parsed = parseQualifiedName(toolName);
    const bareToolName = parsed.toolName;

    const callResult = await connection.client.callTool({
      name: bareToolName,
      arguments: args,
    });

    return {
      content: callResult.content as unknown[],
      isError: callResult.isError as boolean | undefined,
    };
  }

  /**
   * Refreshes the tool list from a specific upstream server.
   * Updates the cached tools with the latest from the server.
   * Tool descriptions are sanitized during refresh.
   *
   * @param key - The server key to refresh tools from
   * @returns Promise that resolves when refresh is complete
   */
  async refreshTools(key: string): Promise<void> {
    const connection = this.connections.get(key);
    if (!connection?.client || connection.status !== "connected") {
      return;
    }

    try {
      const { tools } = await connection.client.listTools();
      connection.tools = tools.map((tool) => ({
        name: tool.name,
        description: sanitizeDescription(tool.description),
        inputSchema: tool.inputSchema as ToolInputSchema,
        serverKey: key,
      }));
    } catch (err) {
      connection.status = "error";
      connection.error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Refreshes the tool lists from all connected upstream servers.
   * Updates are performed in parallel for efficiency.
   *
   * @returns Promise that resolves when all refresh operations complete
   */
  async refreshAllTools(): Promise<void> {
    const refreshPromises: Promise<void>[] = [];
    for (const key of this.connections.keys()) {
      refreshPromises.push(this.refreshTools(key));
    }
    await Promise.allSettled(refreshPromises);
  }

  /**
   * Creates a stdio transport for connecting to a local MCP server process.
   *
   * @param config - Stdio server configuration
   * @returns Configured stdio client transport
   * @internal
   */
  private createStdioTransport(
    config: UpstreamStdioServerConfig,
  ): StdioClientTransport {
    const resolvedEnv = resolveEnvVars(config.env);
    const envWithDefaults = { ...process.env, ...resolvedEnv } as Record<
      string,
      string
    >;

    return new StdioClientTransport({
      command: config.stdio.command,
      args: config.stdio.args,
      env: envWithDefaults,
      ...(config.stdio.cwd ? { cwd: config.stdio.cwd } : {}),
      stderr: "pipe",
    });
  }

  /**
   * Creates an HTTP streaming transport for connecting to a remote MCP server.
   * Supports OAuth authentication when configured.
   *
   * @param key - Server key for token storage
   * @param config - SSE server configuration with URL, headers, and optional OAuth
   * @returns Object with transport and optional auth provider
   * @internal
   */
  private createHttpTransport(
    key: string,
    config: UpstreamSseServerConfig,
  ): {
    transport: StreamableHTTPClientTransport;
    authProvider: McpOAuthProvider | null;
  } {
    const resolvedEnv = resolveEnvVars(config.env);

    // Resolve env vars in headers
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.sse.headers)) {
      if (value.startsWith("$")) {
        const envKey = value.slice(1);
        headers[key] = resolvedEnv[envKey] ?? process.env[envKey] ?? "";
      } else {
        headers[key] = value;
      }
    }

    // Create OAuth provider if auth is enabled OR if stored tokens exist
    // Use non-interactive mode since we're in server mode (can't do browser auth)
    let authProvider: McpOAuthProvider | null = null;
    const tokenStorage = new TokenStorage();
    const hasStoredTokens = tokenStorage.load(key)?.tokens !== undefined;
    if (config.sse.auth || hasStoredTokens) {
      const authOptions =
        typeof config.sse.auth === "object" ? config.sse.auth : {};
      authProvider = new McpOAuthProvider(key, tokenStorage, {
        ...authOptions,
        nonInteractive: true, // Server mode - throw instead of opening browser
      });
    }

    // Build transport options
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

    return { transport, authProvider };
  }

  /**
   * Cleans up resources for a connection (closes client and transport).
   *
   * @param connection - The server connection to clean up
   * @returns Promise that resolves when cleanup is complete
   * @internal
   */
  private async cleanupConnection(connection: ServerConnection): Promise<void> {
    if (connection.transport) {
      await safelyCloseTransport(connection.transport);
      connection.transport = null;
    }

    if (connection.client) {
      try {
        await connection.client.close();
      } catch {
        // Ignore cleanup errors
      }
      connection.client = null;
    }
  }
}
