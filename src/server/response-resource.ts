/**
 * Response resource manager for offloading large tool responses to MCP Resources.
 *
 * When an upstream tool response exceeds a configurable byte threshold,
 * the full content is stored as a temporary MCP Resource. The tool response
 * is replaced with a truncated preview plus the resource URI, allowing
 * clients to fetch the full data via `resources/read` on demand.
 *
 * @module server/response-resource
 */

import { randomBytes } from "node:crypto";

/** Configuration for response resource offloading. */
export interface ResponseResourceConfig {
  /** Enable response resource offloading (default: false) */
  enabled: boolean;
  /** Byte threshold for offloading (default: 51200 = 50 KB) */
  thresholdBytes: number;
  /** Maximum lines to include inline as preview (default: 20) */
  maxInlineLines: number;
  /** Maximum number of stored resources before eviction (default: 100) */
  maxResources: number;
  /** Time-to-live for stored resources in milliseconds (default: 600000 = 10 minutes) */
  ttlMs: number;
}

/** Default configuration (disabled). */
export const DEFAULT_RESPONSE_RESOURCE_CONFIG: ResponseResourceConfig = {
  enabled: false,
  thresholdBytes: 51_200,
  maxInlineLines: 20,
  maxResources: 100,
  ttlMs: 600_000,
};

/** Context about the tool call that produced the response. */
export interface OffloadContext {
  capability: string;
  action: string;
}

/** Result of an offload operation. */
export interface OffloadResult {
  resourceUri: string;
  inlineContent: Array<{ type: "text"; text: string }>;
}

/** MCP Resource metadata for listing. */
export interface StoredResource {
  uri: string;
  name: string;
  description?: string;
  mimeType: string;
  size?: number;
}

/** Internal stored resource entry. */
interface ResourceEntry {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  fullText: string;
  byteCount: number;
  createdAt: number;
}

/**
 * Manages temporary MCP Resources for large tool responses.
 *
 * Resources are stored in-memory with LRU eviction and TTL expiration.
 * The manager exposes list/read operations compatible with MCP's resource
 * protocol, allowing integration with the McpServer's resource handlers.
 */
export class ResponseResourceManager {
  private readonly config: ResponseResourceConfig;
  private readonly resources = new Map<string, ResourceEntry>();
  private readonly insertionOrder: string[] = [];

  constructor(config: ResponseResourceConfig) {
    this.config = config;
  }

  /** Whether response resource offloading is enabled. */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Determines whether the given content should be offloaded.
   * Returns false if disabled or content is below the threshold.
   */
  shouldOffload(content: Array<{ type: "text"; text: string }>): boolean {
    if (!this.config.enabled) return false;
    const byteCount = this.measureBytes(content);
    return byteCount > this.config.thresholdBytes;
  }

  /**
   * Offloads content to a temporary resource.
   * Returns the resource URI and a truncated inline preview.
   */
  offload(
    content: Array<{ type: "text"; text: string }>,
    context: OffloadContext,
  ): OffloadResult {
    const fullText = content.map((c) => c.text).join("\n\n---\n\n");
    const byteCount = Buffer.byteLength(fullText, "utf8");
    const id = this.generateId(context);
    const uri = `mcp2://response/${context.capability}/${id}`;

    const entry: ResourceEntry = {
      uri,
      name: `${context.capability}:${context.action} response`,
      description: `Full response from ${context.capability}:${context.action} (${byteCount} bytes)`,
      mimeType: "text/plain",
      fullText,
      byteCount,
      createdAt: Date.now(),
    };

    this.store(uri, entry);

    const preview = this.buildPreview(fullText);
    const pointer = {
      truncated: true,
      resource_uri: uri,
      total_bytes: byteCount,
      preview,
      instructions:
        "Full response available via resources/read with the resource_uri above.",
    };

    return {
      resourceUri: uri,
      inlineContent: [{ type: "text" as const, text: JSON.stringify(pointer) }],
    };
  }

  /**
   * Reads a stored resource by URI.
   * Returns null if the resource doesn't exist or has expired.
   */
  readResource(uri: string): {
    contents: Array<{ uri: string; mimeType: string; text: string }>;
  } | null {
    const entry = this.resources.get(uri);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.createdAt >= this.config.ttlMs) {
      this.resources.delete(uri);
      const idx = this.insertionOrder.indexOf(uri);
      if (idx !== -1) this.insertionOrder.splice(idx, 1);
      return null;
    }

    return {
      contents: [
        {
          uri: entry.uri,
          mimeType: entry.mimeType,
          text: entry.fullText,
        },
      ],
    };
  }

  /** Lists all non-expired stored resources. */
  listResources(): StoredResource[] {
    this.evictExpired();
    const result: StoredResource[] = [];
    for (const entry of this.resources.values()) {
      result.push({
        uri: entry.uri,
        name: entry.name,
        description: entry.description,
        mimeType: entry.mimeType,
        size: entry.byteCount,
      });
    }
    return result;
  }

  /** Returns the number of currently stored resources. */
  getResourceCount(): number {
    return this.resources.size;
  }

  private measureBytes(content: Array<{ type: "text"; text: string }>): number {
    return Buffer.byteLength(JSON.stringify(content), "utf8");
  }

  private generateId(context: OffloadContext): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(4).toString("hex");
    const actionSlug = context.action
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 24);
    return `${actionSlug}_${timestamp}_${random}`;
  }

  private buildPreview(fullText: string): string {
    const lines = fullText.split("\n");
    if (lines.length <= this.config.maxInlineLines) {
      return fullText;
    }
    return `${lines.slice(0, this.config.maxInlineLines).join("\n")}\n...`;
  }

  private store(uri: string, entry: ResourceEntry): void {
    // Evict expired first
    this.evictExpired();

    // Evict oldest if at capacity
    while (
      this.resources.size >= this.config.maxResources &&
      this.insertionOrder.length > 0
    ) {
      const oldest = this.insertionOrder.shift();
      if (!oldest) break;
      this.resources.delete(oldest);
    }

    this.resources.set(uri, entry);
    this.insertionOrder.push(uri);
  }

  private evictExpired(): void {
    const now = Date.now();
    const toRemove: string[] = [];
    for (const [uri, entry] of this.resources) {
      if (now - entry.createdAt >= this.config.ttlMs) {
        toRemove.push(uri);
      }
    }
    for (const uri of toRemove) {
      this.resources.delete(uri);
      const idx = this.insertionOrder.indexOf(uri);
      if (idx !== -1) this.insertionOrder.splice(idx, 1);
    }
  }
}
