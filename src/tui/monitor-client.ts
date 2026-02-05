/**
 * Unix Domain Socket (UDS) client for MCP² monitor.
 *
 * This module implements a client that connects to the MCP² monitor server
 * via Unix Domain Socket and retrieves statistics and monitoring data.
 *
 * @module tui/monitor-client
 */

import { type Socket, connect } from "node:net";
import type { ServerStats, ToolStats } from "../server/stats.js";

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
 * Supported commands for the monitor client.
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
export interface MonitorResponse<T = unknown> {
  /** Response status */
  status: ResponseStatus;
  /** Response data (varies by command) */
  data?: T;
  /** Error message if status is error */
  error?: string;
  /** Unix timestamp of the response */
  timestamp: number;
}

/**
 * Upstream status info.
 */
export interface UpstreamInfo {
  key: string;
  status: string;
  error?: string;
  serverName?: string;
  serverVersion?: string;
  toolCount?: number;
  toolNames?: string[];
  transport?: string;
  authPending?: boolean;
}

export interface ClientInfo {
  sessionId: string;
  clientId?: string;
  connectedAt: number;
  lastSeen: number;
  isOwner: boolean;
}

/**
 * Options for creating a MonitorClient.
 */
export interface MonitorClientOptions {
  /** Path to the Unix Domain Socket file */
  socketPath: string;
  /** Connection timeout in milliseconds (default: 5000) */
  timeout?: number;
}

/**
 * Unix Domain Socket client for MCP² monitor.
 *
 * This client connects to the MCP² monitor server and sends commands
 * to retrieve statistics and monitoring data.
 *
 * @example
 * ```ts
 * const client = new MonitorClient({ socketPath: "/tmp/mcp-squared.sock" });
 *
 * const stats = await client.getStats();
 * const tools = await client.getTools(10);
 * const pong = await client.ping();
 *
 * await client.disconnect();
 * ```
 */
export class MonitorClient {
  private readonly socketPath: string;
  private readonly timeout: number;
  private socket: Socket | null = null;
  private isConnected = false;

  /**
   * Creates a new MonitorClient instance.
   *
   * @param options - Client configuration options
   */
  constructor(options: MonitorClientOptions) {
    this.socketPath = options.socketPath;
    this.timeout = options.timeout ?? 5000;
  }

  /**
   * Connects to the monitor server.
   *
   * @returns Promise that resolves when connected
   * @throws Error if connection fails
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = isTcpEndpoint(this.socketPath)
        ? connect(parseTcpEndpoint(this.socketPath))
        : connect(this.socketPath);

      this.socket.on("error", (error) => {
        this.isConnected = false;
        reject(
          new Error(`Failed to connect to monitor server: ${error.message}`),
        );
      });

      this.socket.on("close", () => {
        this.isConnected = false;
      });

      // Set timeout
      const timeoutId = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error(`Connection timeout after ${this.timeout}ms`));
      }, this.timeout);

      this.socket.once("connect", () => {
        clearTimeout(timeoutId);
        this.isConnected = true;
        resolve();
      });
    });
  }

  /**
   * Disconnects from the monitor server.
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnected = false;
  }

  /**
   * Checks if the client is currently connected.
   *
   * @returns true if connected, false otherwise
   */
  isClientConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Sends a command to the monitor server and returns the response.
   *
   * @param command - The command to send
   * @returns Promise that resolves with the response
   * @throws Error if command fails
   * @internal
   */
  private async sendCommand<T = unknown>(
    command: string,
  ): Promise<MonitorResponse<T>> {
    if (!this.isConnected || !this.socket) {
      throw new Error("Not connected to monitor server");
    }

    return new Promise((resolve, reject) => {
      let buffer = "";
      let responseReceived = false;

      const cleanup = () => {
        this.socket?.off("data", handleData);
        this.socket?.off("error", handleError);
        this.socket?.off("close", handleClose);
      };

      const handleData = (data: Buffer) => {
        buffer += data.toString();

        // Process complete lines (responses are terminated by newlines)
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim() && !responseReceived) {
            responseReceived = true;
            cleanup();

            try {
              const response = JSON.parse(line) as MonitorResponse<T>;
              if (response.status === "error") {
                reject(new Error(response.error ?? "Unknown error"));
              } else {
                resolve(response);
              }
            } catch (error) {
              reject(new Error(`Failed to parse response: ${error}`));
            }
          }
        }
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(new Error(`Socket error: ${error.message}`));
      };

      const handleClose = () => {
        cleanup();
        if (!responseReceived) {
          reject(new Error("Connection closed before receiving response"));
        }
      };

      if (!this.socket) {
        reject(new Error("Socket is null"));
        return;
      }

      this.socket.on("data", handleData);
      this.socket.on("error", handleError);
      this.socket.on("close", handleClose);

      // Send the command
      this.socket.write(`${command}\n`);

      // Set timeout for response
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Response timeout after ${this.timeout}ms`));
      }, this.timeout);

      this.socket.once("data", () => {
        clearTimeout(timeoutId);
      });
    });
  }

  /**
   * Gets comprehensive server statistics.
   *
   * @returns Promise that resolves with server stats
   * @throws Error if command fails
   */
  async getStats(): Promise<ServerStats> {
    const response = await this.sendCommand<ServerStats>("stats");

    if (response.status === "error") {
      throw new Error(response.error ?? "Unknown error");
    }

    return response.data as ServerStats;
  }

  /**
   * Gets tool-level statistics.
   *
   * @param limit - Maximum number of tools to return (default: 100)
   * @returns Promise that resolves with tool stats
   * @throws Error if command fails
   */
  async getTools(limit = 100): Promise<ToolStats[]> {
    const response = await this.sendCommand<ToolStats[]>(`tools ${limit}`);

    if (response.status === "error") {
      throw new Error(response.error ?? "Unknown error");
    }

    return response.data as ToolStats[];
  }

  /**
   * Gets upstream connection status.
   *
   * @returns Promise that resolves with upstream info
   * @throws Error if command fails
   */
  async getUpstreams(): Promise<UpstreamInfo[]> {
    const response = await this.sendCommand<UpstreamInfo[]>("upstreams");

    if (response.status === "error") {
      throw new Error(response.error ?? "Unknown error");
    }

    return (response.data as UpstreamInfo[]) ?? [];
  }

  /**
   * Gets connected client sessions (daemon mode).
   */
  async getClients(): Promise<ClientInfo[]> {
    const response = await this.sendCommand<ClientInfo[]>("clients");

    if (response.status === "error") {
      throw new Error(response.error ?? "Unknown error");
    }

    return (response.data as ClientInfo[]) ?? [];
  }

  /**
   * Pings the monitor server.
   *
   * @returns Promise that resolves with pong response
   * @throws Error if command fails
   */
  async ping(): Promise<{ message: string }> {
    const response = await this.sendCommand<{ message: string }>("ping");

    if (response.status === "error") {
      throw new Error(response.error ?? "Unknown error");
    }

    return response.data as { message: string };
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
