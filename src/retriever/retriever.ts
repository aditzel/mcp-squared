/**
 * Tool retriever module for searching and retrieving tools from the index.
 *
 * This module provides natural language search capabilities over the indexed
 * tools using SQLite FTS5. It bridges the Cataloger (live tool data) with
 * the IndexStore (search index).
 *
 * @module retriever
 */

import { IndexStore } from "../index/index.js";
import type { CatalogedTool, Cataloger } from "../upstream/index.js";

/**
 * Summary information about a tool returned from search results.
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
 * Configuration options for the Retriever.
 */
export interface RetrieverOptions {
  /** Path to SQLite database file (default: in-memory) */
  indexDbPath?: string | undefined;
  /** Default result limit for searches (default: 5) */
  defaultLimit?: number;
  /** Maximum allowed result limit (default: 50) */
  maxLimit?: number;
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
   * Uses FTS5 full-text search with prefix matching.
   *
   * @param query - Natural language search query
   * @param limit - Maximum results to return (capped at maxLimit)
   * @returns Search results with matching tools
   */
  search(query: string, limit?: number): RetrieveResult {
    const effectiveLimit = Math.min(limit ?? this.defaultLimit, this.maxLimit);

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

    const searchResults = this.indexStore.search(query, effectiveLimit);

    // Get accurate total count if results are limited
    const totalMatches =
      searchResults.length < effectiveLimit
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
   * Gets full tool details by name from the cataloger.
   *
   * @param name - Tool name to look up
   * @param serverKey - Optional server key to narrow search
   * @returns Full tool details if found, undefined otherwise
   */
  getTool(name: string, serverKey?: string): CatalogedTool | undefined {
    // First check the cataloger for live data
    if (serverKey) {
      const tools = this.cataloger.getToolsForServer(serverKey);
      return tools.find((t) => t.name === name);
    }

    return this.cataloger.findTool(name);
  }

  /**
   * Gets full details for multiple tools by name.
   *
   * @param names - Array of tool names to look up
   * @returns Array of found tools (missing tools are omitted)
   */
  getTools(names: string[]): CatalogedTool[] {
    const result: CatalogedTool[] = [];

    for (const name of names) {
      const tool = this.cataloger.findTool(name);
      if (tool) {
        result.push(tool);
      }
    }

    return result;
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
   * Closes the retriever and releases database resources.
   * Call this when shutting down the server.
   */
  close(): void {
    this.indexStore.close();
  }
}
