/**
 * Tool retriever module for searching and retrieving tools from the index.
 *
 * This module provides natural language search capabilities over the indexed
 * tools using SQLite FTS5 and optional semantic search with embeddings.
 * It bridges the Cataloger (live tool data) with the IndexStore (search index).
 *
 * @module retriever
 */

import type { SearchMode } from "../config/schema.js";
import type { EmbeddingGenerator } from "../embeddings/index.js";
import { IndexStore } from "../index/index.js";
import type { CatalogedTool, Cataloger } from "../upstream/index.js";

/**
 * Minimal tool identity (L0 detail level).
 * Contains only the information needed to identify a tool.
 */
export interface ToolIdentity {
  /** Tool name */
  name: string;
  /** Key identifying the upstream server */
  serverKey: string;
}

/**
 * Summary information about a tool (L1 detail level).
 * Default level returned from search results.
 */
export interface ToolSummary {
  /** Tool name */
  name: string;
  /** Tool description (may be null) */
  description: string | null;
  /** Key identifying the upstream server */
  serverKey: string;
}

/**
 * Full tool schema (L2 detail level).
 * Includes inputSchema for immediate execution.
 */
export interface ToolFullSchema {
  /** Tool name */
  name: string;
  /** Tool description (may be null) */
  description: string | null;
  /** Key identifying the upstream server */
  serverKey: string;
  /** Full JSON Schema for tool input parameters */
  inputSchema: Record<string, unknown>;
}

/**
 * Union type for tool results at different detail levels.
 */
export type ToolResult = ToolIdentity | ToolSummary | ToolFullSchema;

/**
 * Result of a tool search operation.
 */
export interface RetrieveResult {
  /** Matching tools (up to limit) */
  tools: ToolSummary[];
  /** The original search query */
  query: string;
  /** Total number of matches found */
  totalMatches: number;
}

/**
 * Search options for a single search call.
 */
export interface SearchOptions {
  /** Maximum results to return */
  limit?: number | undefined;
  /** Search mode override (default: uses retriever's defaultMode) */
  mode?: SearchMode | undefined;
}

/**
 * Configuration options for the Retriever.
 */
export interface RetrieverOptions {
  /** Path to SQLite database file (default: in-memory) */
  indexDbPath?: string | undefined;
  /** Default result limit for searches (default: 5) */
  defaultLimit?: number;
  /** Maximum allowed result limit (default: 50) */
  maxLimit?: number;
  /** Default search mode (default: "fast") */
  defaultMode?: SearchMode;
}

type EmbeddingModule = typeof import("../embeddings/index.js");
type EmbeddingGeneratorClass = EmbeddingModule["EmbeddingGenerator"];

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Embedding dimensions must match: ${a.length} vs ${b.length}`,
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop condition
    const aVal = a[i]!;
    // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop condition
    const bVal = b[i]!;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Retriever provides full-text search over tools from upstream MCP servers.
 *
 * The retriever maintains a SQLite FTS5 index that enables fast, typo-tolerant
 * search across tool names and descriptions. It works in conjunction with
 * the Cataloger to provide both search results and full tool details.
 *
 * @example
 * ```ts
 * const retriever = new Retriever(cataloger, { defaultLimit: 10 });
 * retriever.syncFromCataloger();
 *
 * const results = retriever.search("file operations");
 * const tool = retriever.getTool("fs__read_file");
 * ```
 */
export class Retriever {
  private readonly indexStore: IndexStore;
  private readonly cataloger: Cataloger;
  private readonly defaultLimit: number;
  private readonly maxLimit: number;
  private readonly defaultMode: SearchMode;
  private embeddingGenerator: EmbeddingGenerator | null = null;
  private embeddingGeneratorClassPromise: Promise<EmbeddingGeneratorClass> | null =
    null;

  /**
   * Creates a new Retriever instance.
   *
   * @param cataloger - The Cataloger to sync tools from
   * @param options - Configuration options
   */
  constructor(cataloger: Cataloger, options: RetrieverOptions = {}) {
    this.cataloger = cataloger;
    this.indexStore = new IndexStore({ dbPath: options.indexDbPath });
    this.defaultLimit = options.defaultLimit ?? 5;
    this.maxLimit = options.maxLimit ?? 50;
    this.defaultMode = options.defaultMode ?? "fast";
  }

  /**
   * Synchronizes all tools from the cataloger to the search index.
   * Call this after connecting to upstream servers.
   */
  syncFromCataloger(): void {
    const tools = this.cataloger.getAllTools();
    this.indexStore.indexTools(tools);
  }

  /**
   * Synchronizes tools for a specific server from the cataloger.
   * Removes old tools for the server and adds the current ones.
   *
   * @param serverKey - The server key to sync tools for
   */
  syncServerFromCataloger(serverKey: string): void {
    const tools = this.cataloger.getToolsForServer(serverKey);

    // Remove old tools for this server and add new ones
    this.indexStore.removeToolsForServer(serverKey);
    this.indexStore.indexTools(tools);
  }

  /**
   * Searches for tools matching a natural language query.
   *
   * Supports three search modes:
   * - "fast": FTS5 full-text search (default, fastest)
   * - "semantic": Vector similarity search using embeddings
   * - "hybrid": FTS5 search with embedding-based reranking (best quality)
   *
   * @param query - Natural language search query
   * @param options - Search options (limit, mode) or just a limit number for backwards compatibility
   * @returns Search results with matching tools
   */
  async search(
    query: string,
    options?: SearchOptions | number,
  ): Promise<RetrieveResult> {
    // Support both new SearchOptions and legacy number parameter
    const opts: SearchOptions =
      typeof options === "number" ? { limit: options } : (options ?? {});
    const effectiveLimit = Math.min(
      opts.limit ?? this.defaultLimit,
      this.maxLimit,
    );
    const mode = opts.mode ?? this.defaultMode;

    if (!query.trim()) {
      // Return top tools when no query provided
      const allTools = this.indexStore.getAllTools();
      const tools = allTools.slice(0, effectiveLimit).map((t) => ({
        name: t.name,
        description: t.description,
        serverKey: t.serverKey,
      }));

      return {
        tools,
        query,
        totalMatches: allTools.length,
      };
    }

    // Dispatch to appropriate search implementation
    switch (mode) {
      case "semantic":
        return this.searchSemantic(query, effectiveLimit);
      case "hybrid":
        return this.searchHybrid(query, effectiveLimit);
      default:
        return this.searchFast(query, effectiveLimit);
    }
  }

  /**
   * Fast search using FTS5 full-text search.
   * @internal
   */
  private searchFast(query: string, limit: number): RetrieveResult {
    const searchResults = this.indexStore.search(query, limit);

    // Get accurate total count if results are limited
    const totalMatches =
      searchResults.length < limit
        ? searchResults.length
        : this.indexStore.searchCount(query);

    return {
      tools: searchResults.map((r) => ({
        name: r.name,
        description: r.description,
        serverKey: r.serverKey,
      })),
      query,
      totalMatches,
    };
  }

  /**
   * Semantic search using embedding similarity.
   * Falls back to fast search if embeddings are not available.
   * @internal
   */
  private async searchSemantic(
    query: string,
    limit: number,
  ): Promise<RetrieveResult> {
    // Check if we have embeddings available
    if (!this.embeddingGenerator || this.indexStore.getEmbeddingCount() === 0) {
      // Fall back to fast search if embeddings not available
      return this.searchFast(query, limit);
    }

    // Generate query embedding
    const result = await this.embeddingGenerator.embed(query, true);
    const queryEmbedding = result.embedding;

    const results = this.indexStore.searchSemantic(queryEmbedding, limit);

    return {
      tools: results.map((r) => ({
        name: r.name,
        description: r.description,
        serverKey: r.serverKey,
      })),
      query,
      totalMatches: results.length,
    };
  }

  /**
   * Hybrid search: FTS5 first, then rerank with embeddings.
   * Falls back to fast search if embeddings are not available.
   * @internal
   */
  private async searchHybrid(
    query: string,
    limit: number,
  ): Promise<RetrieveResult> {
    // Check if we have embeddings available
    if (!this.embeddingGenerator || this.indexStore.getEmbeddingCount() === 0) {
      // Fall back to fast search if embeddings not available
      return this.searchFast(query, limit);
    }

    // Get more candidates from FTS5 than needed
    const candidateLimit = Math.min(limit * 3, 100);
    const ftsResults = this.indexStore.search(query, candidateLimit);

    if (ftsResults.length === 0) {
      return { tools: [], query, totalMatches: 0 };
    }

    // Generate query embedding
    const result = await this.embeddingGenerator.embed(query, true);
    const queryEmbedding = result.embedding;

    // Score and rerank FTS results using embeddings
    const reranked: Array<{
      name: string;
      description: string | null;
      serverKey: string;
      score: number;
    }> = [];

    for (const ftsResult of ftsResults) {
      const tool = this.indexStore.getTool(ftsResult.name, ftsResult.serverKey);
      if (tool?.embedding) {
        const similarity = cosineSimilarity(queryEmbedding, tool.embedding);
        // Combine FTS score (normalized) with similarity
        // FTS scores vary widely, so we normalize roughly
        const normalizedFtsScore = Math.min(ftsResult.score / 10, 1);
        const combinedScore = 0.3 * normalizedFtsScore + 0.7 * similarity;
        reranked.push({
          name: ftsResult.name,
          description: ftsResult.description,
          serverKey: ftsResult.serverKey,
          score: combinedScore,
        });
      } else {
        // No embedding, use only FTS score
        reranked.push({
          name: ftsResult.name,
          description: ftsResult.description,
          serverKey: ftsResult.serverKey,
          score: ftsResult.score / 10,
        });
      }
    }

    // Sort by combined score (descending) and take top results
    reranked.sort((a, b) => b.score - a.score);
    const topResults = reranked.slice(0, limit);

    return {
      tools: topResults.map((r) => ({
        name: r.name,
        description: r.description,
        serverKey: r.serverKey,
      })),
      query,
      totalMatches: ftsResults.length,
    };
  }

  /**
   * Gets full tool details by name from the cataloger.
   * Supports both qualified (`serverKey:toolName`) and bare names.
   *
   * @param name - Tool name to look up (qualified or bare)
   * @param serverKey - Optional server key to narrow search (overrides qualified name)
   * @returns Object with tool (if found), ambiguous flag, and alternatives
   */
  getTool(
    name: string,
    serverKey?: string,
  ): {
    tool: CatalogedTool | undefined;
    ambiguous: boolean;
    alternatives: string[];
  } {
    // If explicit serverKey provided, use it directly
    if (serverKey) {
      const tools = this.cataloger.getToolsForServer(serverKey);
      const tool = tools.find((t) => t.name === name);
      return { tool, ambiguous: false, alternatives: [] };
    }

    // Use cataloger's qualified name handling
    return this.cataloger.findTool(name);
  }

  /**
   * Gets full details for multiple tools by name.
   * Supports both qualified (`serverKey:toolName`) and bare names.
   * Ambiguous bare names are reported separately.
   *
   * @param names - Array of tool names to look up
   * @returns Object with found tools and any ambiguous names
   */
  getTools(names: string[]): {
    tools: CatalogedTool[];
    ambiguous: { name: string; alternatives: string[] }[];
  } {
    const tools: CatalogedTool[] = [];
    const ambiguous: { name: string; alternatives: string[] }[] = [];

    for (const name of names) {
      const result = this.cataloger.findTool(name);
      if (result.ambiguous) {
        ambiguous.push({ name, alternatives: result.alternatives });
      } else if (result.tool) {
        tools.push(result.tool);
      }
    }

    return { tools, ambiguous };
  }

  /**
   * Returns the count of tools currently in the search index.
   *
   * @returns Number of indexed tools
   */
  getIndexedToolCount(): number {
    return this.indexStore.getToolCount();
  }

  /**
   * Clears all tools from the search index.
   */
  clearIndex(): void {
    this.indexStore.clear();
  }

  /**
   * Initializes the embedding generator for semantic search.
   * Must be called before using semantic or hybrid search modes.
   *
   * @returns Promise that resolves when model is loaded
   */
  async initializeEmbeddings(): Promise<void> {
    if (this.embeddingGenerator) {
      return;
    }

    const EmbeddingGeneratorClass = await this.getEmbeddingGeneratorClass();
    this.embeddingGenerator = new EmbeddingGeneratorClass();
    await this.embeddingGenerator.initialize();
  }

  private async getEmbeddingGeneratorClass(): Promise<EmbeddingGeneratorClass> {
    if (!this.embeddingGeneratorClassPromise) {
      this.embeddingGeneratorClassPromise = import(
        "../embeddings/index.js"
      ).then((module) => module.EmbeddingGenerator);
    }

    return this.embeddingGeneratorClassPromise;
  }

  /**
   * Generates embeddings for all indexed tools that don't have them.
   * Call this after syncing tools and initializing embeddings.
   *
   * @returns Number of tools that had embeddings generated
   */
  async generateToolEmbeddings(): Promise<number> {
    if (!this.embeddingGenerator) {
      await this.initializeEmbeddings();
    }

    const toolsWithoutEmbeddings = this.indexStore.getToolsWithoutEmbeddings();
    if (toolsWithoutEmbeddings.length === 0) {
      return 0;
    }

    // Generate text for each tool (name + description)
    const texts = toolsWithoutEmbeddings.map((t) => {
      const desc = t.description ?? "";
      return `${t.name}: ${desc}`.trim();
    });

    // Generate embeddings in batch (not as queries, so no "query: " prefix)
    const result = await this.embeddingGenerator?.embedBatch(texts, false);

    if (!result) {
      throw new Error("Embedding generator not initialized");
    }

    // Update embeddings in the store
    const embeddings = toolsWithoutEmbeddings.map((tool, i) => ({
      name: tool.name,
      serverKey: tool.serverKey,
      // biome-ignore lint/style/noNonNullAssertion: embedBatch returns same length array
      embedding: result.embeddings[i]!,
    }));

    return this.indexStore.updateEmbeddings(embeddings);
  }

  /**
   * Returns the count of tools with embeddings.
   */
  getEmbeddingCount(): number {
    return this.indexStore.getEmbeddingCount();
  }

  /**
   * Returns whether embeddings are available for search.
   */
  hasEmbeddings(): boolean {
    return (
      this.embeddingGenerator !== null &&
      this.indexStore.getEmbeddingCount() > 0
    );
  }

  /**
   * Returns the current default search mode.
   */
  getDefaultMode(): SearchMode {
    return this.defaultMode;
  }

  /**
   * Returns the underlying IndexStore for direct access.
   * Use this for selection caching and co-occurrence tracking.
   *
   * @returns The IndexStore instance
   */
  getIndexStore(): IndexStore {
    return this.indexStore;
  }

  /**
   * Closes the retriever and releases database resources.
   * Call this when shutting down the server.
   */
  close(): void {
    this.indexStore.close();
  }
}
