/**
 * Socket transports for daemon IPC (length-prefixed JSON).
 *
 * @module daemon/transport
 */

import { connect, type Socket } from "node:net";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  JSONRPCMessage,
  MessageExtraInfo,
} from "@modelcontextprotocol/sdk/types.js";

const HEADER_LENGTH = 4;

export type DaemonEnvelope =
  | { type: "mcp"; payload: JSONRPCMessage }
  | { type: "hello"; clientId?: string; sharedSecret?: string }
  | { type: "helloAck"; sessionId: string; isOwner: boolean }
  | { type: "heartbeat"; sessionId?: string }
  | { type: "ownerChanged"; ownerSessionId: string }
  | { type: "goodbye"; sessionId?: string }
  | { type: "error"; message: string };

function encodeFrame(message: DaemonEnvelope): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

class FrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): DaemonEnvelope[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: DaemonEnvelope[] = [];

    while (this.buffer.length >= HEADER_LENGTH) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < HEADER_LENGTH + length) {
        break;
      }

      const payload = this.buffer.subarray(
        HEADER_LENGTH,
        HEADER_LENGTH + length,
      );
      this.buffer = this.buffer.subarray(HEADER_LENGTH + length);

      try {
        const parsed = JSON.parse(payload.toString("utf8")) as DaemonEnvelope;
        messages.push(parsed);
      } catch {
        // Ignore malformed payloads; caller can decide to error on stream issues.
      }
    }

    return messages;
  }
}

abstract class BaseSocketTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(
    message: T,
    extra?: MessageExtraInfo,
  ) => void;
  oncontrol?: (message: DaemonEnvelope) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;

  protected socket: Socket | null = null;
  protected readonly decoder = new FrameDecoder();
  protected started = false;

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.attachHandlers();
  }

  async send(
    message: JSONRPCMessage,
    _options?: TransportSendOptions,
  ): Promise<void> {
    if (!this.socket) {
      throw new Error("Transport socket not connected");
    }
    this.socket.write(encodeFrame({ type: "mcp", payload: message }));
  }

  async sendControl(message: DaemonEnvelope): Promise<void> {
    if (!this.socket) {
      throw new Error("Transport socket not connected");
    }
    if (message.type === "mcp") {
      throw new Error("Use send() for MCP messages");
    }
    this.socket.write(encodeFrame(message));
  }

  async close(): Promise<void> {
    if (!this.socket) {
      return;
    }
    this.socket.end();
  }

  protected attachHandlers(): void {
    if (!this.socket) {
      return;
    }

    this.socket.on("data", (chunk) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const messages = this.decoder.push(buffer);
      for (const message of messages) {
        if (message.type === "mcp") {
          this.onmessage?.(message.payload as JSONRPCMessage);
        } else {
          this.oncontrol?.(message);
        }
      }
    });

    this.socket.on("error", (error) => {
      this.onerror?.(error);
    });

    this.socket.on("close", () => {
      this.onclose?.();
    });
  }
}

export class SocketServerTransport extends BaseSocketTransport {
  constructor(socket: Socket) {
    super();
    this.socket = socket;
  }
}

export interface SocketClientTransportOptions {
  endpoint: string;
  timeoutMs?: number;
}

function isTcpEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("tcp://");
}

function parseTcpEndpoint(endpoint: string): { host: string; port: number } {
  const url = new URL(endpoint);
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

export class SocketClientTransport extends BaseSocketTransport {
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(options: SocketClientTransportOptions) {
    super();
    this.endpoint = options.endpoint;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  override async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = isTcpEndpoint(this.endpoint)
        ? connect(parseTcpEndpoint(this.endpoint))
        : connect(this.endpoint);
      this.socket = socket;

      const timeoutId = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      socket.once("connect", () => {
        clearTimeout(timeoutId);
        this.started = true;
        this.attachHandlers();
        resolve();
      });

      socket.once("error", (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }
}
