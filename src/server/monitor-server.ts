/**
 * Unix Domain Socket (UDS) monitor server for MCP².
 *
 * This module implements a UDS server that provides real-time statistics
 * and monitoring capabilities for the MCP² server. It accepts connections
 * from TUI monitors and responds to stats requests with JSON data.
 *
 * @module server/monitor-server
 */

import { existsSync, unlinkSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import type { Cataloger } from "../upstream/cataloger.js";
import type { StatsCollector } from "./stats.js";

function isTcpEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("tcp://");
}

function parseTcpEndpoint(endpoint: string): { host: string; port: number } {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid TCP endpoint: ${endpoint}`);
  }

  if (url.protocol !== "tcp:") {
    throw new Error(`Invalid TCP endpoint protocol: ${url.protocol}`);
  }

  const host = url.hostname;
  const port = Number.parseInt(url.port, 10);

  if (!host || Number.isNaN(port)) {
    throw new Error(`Invalid TCP endpoint: ${endpoint}`);
  }

  return { host, port };
}

/**
 * Supported commands for the monitor server.
 */
export type MonitorCommand =
  | "stats"
  | "tools"
  | "upstreams"
  | "clients"
  | "ping";

/**
 * Response status for monitor commands.
 */
export type ResponseStatus = "success" | "error";

/**
 * Response format for monitor commands.
 */
export interface MonitorResponse {
  /** Response status */
  status: ResponseStatus;
  /** Response data (varies by command) */
  data?: unknown;
  /** Error message if status is error */
  error?: string;
  /** Unix timestamp of the response */
  timestamp: number;
}

/**
 * Options for creating a MonitorServer.
 */
export interface MonitorServerOptions {
  /** Path to the Unix Domain Socket file */
  socketPath: string;
  /** Stats collector instance for retrieving statistics */
  statsCollector: StatsCollector;
  /** Cataloger for upstream status (optional) */
  cataloger?: Cataloger;
  /** Provider for connected client sessions (optional) */
  clientInfoProvider?: () => MonitorClientInfo[];
}

export interface MonitorClientInfo {
  sessionId: string;
  clientId?: string;
  connectedAt: number;
  lastSeen: number;
  isOwner: boolean;
}

/**
 * Unix Domain Socket monitor server for MCP².
 *
 * This server listens on a Unix Domain Socket and responds to commands
 * from TUI monitors. It supports concurrent connections and provides
 * real-time statistics about the MCP² server.
 *
 * @example
 * ```ts
 * const monitor = new MonitorServer({
 *   socketPath: "/tmp/mcp-squared.sock",
 *   statsCollector,
 * });
 *
 * await monitor.start();
 * // ... server runs ...
 * await monitor.stop();
 * ```
 */
export class MonitorServer {
  private socketPath: string;
  private readonly statsCollector: StatsCollector;
  private readonly cataloger: Cataloger | undefined;
  private clientInfoProvider: (() => MonitorClientInfo[]) | undefined;
  private server: Server | null = null;
  private isRunning = false;
  private activeSockets: Set<Socket> = new Set();

  /**
   * Creates a new MonitorServer instance.
   *
   * @param options - Server configuration options
   */
  constructor(options: MonitorServerOptions) {
    this.socketPath = options.socketPath;
    this.statsCollector = options.statsCollector;
    this.cataloger = options.cataloger;
    this.clientInfoProvider = options.clientInfoProvider;
  }

  setClientInfoProvider(provider?: () => MonitorClientInfo[]): void {
    this.clientInfoProvider = provider;
  }

  /**
   * Starts the monitor server.
   * Creates the Unix Domain Socket and begins accepting connections.
   *
   * @returns Promise that resolves when the server is ready
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const tcp = isTcpEndpoint(this.socketPath);

    // Clean up existing socket file if it exists
    if (!tcp && existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch (error) {
        // Ignore errors during cleanup
        const err = error as Error;
        console.warn(
          `Warning: Could not remove existing socket file: ${err.message}`,
        );
      }
    }

    const server = createServer((socket) => {
      this.handleConnection(socket);
    });
    this.server = server;

    // Handle server errors
    server.on("error", (error) => {
      console.error(`Monitor server error: ${error.message}`);
    });

    // Listen on the socket path/endpoint and wait for it to be ready
    await new Promise<void>((resolve, reject) => {
      // Set up error handler for the listen call
      server.once("error", (error) => {
        reject(error);
      });

      if (tcp) {
        const { host, port } = parseTcpEndpoint(this.socketPath);
        server.listen({ host, port }, () => {
          const address = server.address();
          if (address && typeof address !== "string") {
            this.socketPath = `tcp://${host}:${address.port}`;
          }
          this.isRunning = true;
          resolve();
        });
        return;
      }

      server.listen(this.socketPath, () => {
        this.isRunning = true;
        resolve();
      });
    });
  }

  /**
   * Stops the monitor server.
   * Closes all connections and removes the socket file.
   *
   * @returns Promise that resolves when shutdown is complete
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    // Destroy all active connections
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();

    // Close the server
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    // Clean up socket file (UDS only)
    if (!isTcpEndpoint(this.socketPath)) {
      try {
        if (existsSync(this.socketPath)) {
          unlinkSync(this.socketPath);
        }
      } catch (error) {
        // Ignore errors during cleanup
        const err = error as Error;
        console.warn(`Warning: Could not remove socket file: ${err.message}`);
      }
    }

    this.server = null;
    this.isRunning = false;
  }

  /**
   * Checks if the monitor server is currently running.
   *
   * @returns true if running, false otherwise
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Handles a new client connection.
   *
   * @param socket - The client socket
   * @internal
   */
  private handleConnection(socket: Socket): void {
    // Track active socket
    this.activeSockets.add(socket);

    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();

      // Process complete lines (commands are terminated by newlines)
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          this.handleCommand(socket, line.trim());
        }
      }
    });

    socket.on("error", (error) => {
      console.error(`Socket error: ${error.message}`);
    });

    socket.on("close", () => {
      // Remove from active sockets
      this.activeSockets.delete(socket);
    });
  }

  /**
   * Handles a command from a client.
   *
   * @param socket - The client socket
   * @param command - The command string
   * @internal
   */
  private handleCommand(socket: Socket, command: string): void {
    try {
      const response = this.processCommand(command);
      socket.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      const err = error as Error;
      const errorResponse: MonitorResponse = {
        status: "error",
        error: err.message,
        timestamp: Date.now(),
      };
      socket.write(`${JSON.stringify(errorResponse)}\n`);
    }
  }

  /**
   * Processes a command and returns a response.
   *
   * @param command - The command to process
   * @returns Response object
   * @internal
   */
  private processCommand(command: string): MonitorResponse {
    const parts = command.split(/\s+/);
    const cmd = parts[0] as MonitorCommand;

    switch (cmd) {
      case "stats":
        return this.handleStatsCommand();

      case "tools":
        return this.handleToolsCommand(parts[1]);

      case "upstreams":
        return this.handleUpstreamsCommand();

      case "clients":
        return this.handleClientsCommand();

      case "ping":
        return this.handlePingCommand();

      default:
        return {
          status: "error",
          error: `Unknown command: ${cmd}. Supported commands: stats, tools, upstreams, clients, ping`,
          timestamp: Date.now(),
        };
    }
  }

  /**
   * Handles the 'stats' command.
   * Returns comprehensive server statistics.
   *
   * @returns Response with server stats
   * @internal
   */
  private handleStatsCommand(): MonitorResponse {
    const stats = this.statsCollector.getStats();
    return {
      status: "success",
      data: stats,
      timestamp: Date.now(),
    };
  }

  /**
   * Handles the 'tools' command.
   * Returns tool-level statistics.
   *
   * @param limitStr - Optional limit string (e.g., "10")
   * @returns Response with tool stats
   * @internal
   */
  private handleToolsCommand(limitStr?: string): MonitorResponse {
    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;
    const toolStats = this.statsCollector.getToolStats(
      Number.isNaN(limit) ? 100 : Math.max(1, limit),
    );
    return {
      status: "success",
      data: toolStats,
      timestamp: Date.now(),
    };
  }

  /**
   * Handles the 'upstreams' command.
   * Returns upstream connection details.
   *
   * @returns Response with upstream info
   * @internal
   */
  private handleUpstreamsCommand(): MonitorResponse {
    if (!this.cataloger) {
      return {
        status: "error",
        error: "Upstream information not available.",
        timestamp: Date.now(),
      };
    }

    const statusMap = this.cataloger.getStatus();
    const upstreams = Array.from(statusMap.entries()).map(
      ([key, statusInfo]) => {
        const connection = this.cataloger?.getConnection(key);
        return {
          key,
          status: statusInfo.status,
          error: statusInfo.error,
          serverName: connection?.serverName,
          serverVersion: connection?.serverVersion,
          toolCount: connection?.tools.length ?? 0,
          transport: connection?.config.transport,
          authPending: connection?.authPending ?? false,
        };
      },
    );

    return {
      status: "success",
      data: upstreams,
      timestamp: Date.now(),
    };
  }

  /**
   * Handles the 'clients' command.
   * Returns connected client sessions (daemon mode).
   */
  private handleClientsCommand(): MonitorResponse {
    if (!this.clientInfoProvider) {
      return {
        status: "error",
        error: "Client information not available.",
        timestamp: Date.now(),
      };
    }

    return {
      status: "success",
      data: this.clientInfoProvider(),
      timestamp: Date.now(),
    };
  }

  /**
   * Handles the 'ping' command.
   * Returns a simple pong response for health checks.
   *
   * @returns Response with pong
   * @internal
   */
  private handlePingCommand(): MonitorResponse {
    return {
      status: "success",
      data: { message: "pong" },
      timestamp: Date.now(),
    };
  }

  /**
   * Gets the socket path.
   *
   * @returns The socket path
   */
  getSocketPath(): string {
    return this.socketPath;
  }
}
