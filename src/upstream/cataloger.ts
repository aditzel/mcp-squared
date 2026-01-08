import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  McpSquaredConfig,
  UpstreamServerConfig,
  UpstreamSseServerConfig,
  UpstreamStdioServerConfig,
} from "../config/schema.js";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface CatalogedTool {
  name: string;
  description: string | undefined;
  inputSchema: ToolInputSchema;
  serverKey: string;
}

export interface ServerConnection {
  key: string;
  config: UpstreamServerConfig;
  status: ConnectionStatus;
  error: string | undefined;
  serverName: string | undefined;
  serverVersion: string | undefined;
  tools: CatalogedTool[];
  client: Client | null;
  transport: StdioClientTransport | SSEClientTransport | null;
}

export interface CatalogerOptions {
  connectTimeoutMs?: number;
}

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

export class Cataloger {
  private readonly connections = new Map<string, ServerConnection>();
  private readonly connectTimeoutMs: number;

  constructor(options: CatalogerOptions = {}) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 30_000;
  }

  /**
   * Connect to all enabled upstream servers from config
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
   * Connect to a single upstream server
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
    };
    this.connections.set(key, connection);

    try {
      const client = new Client({
        name: "mcp-squared",
        version: "1.0.0",
      });

      let transport: StdioClientTransport | SSEClientTransport;

      if (config.transport === "stdio") {
        transport = this.createStdioTransport(config);
      } else {
        transport = this.createSseTransport(config);
      }

      connection.client = client;
      connection.transport = transport;

      // Connect with timeout
      const connectPromise = client.connect(transport);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Connection timeout")),
          this.connectTimeoutMs,
        );
      });

      await Promise.race([connectPromise, timeoutPromise]);

      // Get server info
      const serverInfo = client.getServerVersion();
      connection.serverName = serverInfo?.name;
      connection.serverVersion = serverInfo?.version;

      // Fetch tools
      const { tools } = await client.listTools();
      connection.tools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as ToolInputSchema,
        serverKey: key,
      }));

      connection.status = "connected";
    } catch (err) {
      connection.status = "error";
      connection.error = err instanceof Error ? err.message : String(err);

      // Clean up on error
      await this.cleanupConnection(connection);
    }
  }

  /**
   * Disconnect from a specific upstream server
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
   * Disconnect from all upstream servers
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.keys()).map((key) =>
      this.disconnect(key),
    );
    await Promise.allSettled(disconnectPromises);
  }

  /**
   * Get all tools from all connected servers
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
   * Get tools from a specific server
   */
  getToolsForServer(key: string): CatalogedTool[] {
    const connection = this.connections.get(key);
    if (!connection || connection.status !== "connected") {
      return [];
    }
    return connection.tools;
  }

  /**
   * Find a tool by name across all servers
   */
  findTool(toolName: string): CatalogedTool | undefined {
    for (const connection of this.connections.values()) {
      if (connection.status === "connected") {
        const tool = connection.tools.find((t) => t.name === toolName);
        if (tool) return tool;
      }
    }
    return undefined;
  }

  /**
   * Get the status of all connections
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
   * Get a specific connection
   */
  getConnection(key: string): ServerConnection | undefined {
    return this.connections.get(key);
  }

  /**
   * Check if any servers are connected
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
   * Call a tool on its upstream server
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: unknown[]; isError: boolean | undefined }> {
    const tool = this.findTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const connection = this.connections.get(tool.serverKey);
    if (!connection?.client || connection.status !== "connected") {
      throw new Error(`Server not connected: ${tool.serverKey}`);
    }

    const result = await connection.client.callTool({
      name: toolName,
      arguments: args,
    });

    return {
      content: result.content as unknown[],
      isError: result.isError as boolean | undefined,
    };
  }

  /**
   * Refresh tools from a specific server
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
        description: tool.description,
        inputSchema: tool.inputSchema as ToolInputSchema,
        serverKey: key,
      }));
    } catch (err) {
      connection.status = "error";
      connection.error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Refresh tools from all connected servers
   */
  async refreshAllTools(): Promise<void> {
    const refreshPromises: Promise<void>[] = [];
    for (const key of this.connections.keys()) {
      refreshPromises.push(this.refreshTools(key));
    }
    await Promise.allSettled(refreshPromises);
  }

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

  private createSseTransport(
    config: UpstreamSseServerConfig,
  ): SSEClientTransport {
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

    return new SSEClientTransport(new URL(config.sse.url), {
      requestInit: {
        headers,
      },
    });
  }

  private async cleanupConnection(connection: ServerConnection): Promise<void> {
    if (connection.client) {
      try {
        await connection.client.close();
      } catch {
        // Ignore cleanup errors
      }
      connection.client = null;
    }

    if (connection.transport) {
      try {
        await connection.transport.close();
      } catch {
        // Ignore cleanup errors
      }
      connection.transport = null;
    }
  }
}
