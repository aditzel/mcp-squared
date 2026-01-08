import { IndexStore } from "../index/index.js";
import type { CatalogedTool, Cataloger } from "../upstream/index.js";

export interface ToolSummary {
  name: string;
  description: string | null;
  serverKey: string;
}

export interface RetrieveResult {
  tools: ToolSummary[];
  query: string;
  totalMatches: number;
}

export interface RetrieverOptions {
  indexDbPath?: string | undefined;
  defaultLimit?: number;
  maxLimit?: number;
}

export class Retriever {
  private readonly indexStore: IndexStore;
  private readonly cataloger: Cataloger;
  private readonly defaultLimit: number;
  private readonly maxLimit: number;

  constructor(cataloger: Cataloger, options: RetrieverOptions = {}) {
    this.cataloger = cataloger;
    this.indexStore = new IndexStore({ dbPath: options.indexDbPath });
    this.defaultLimit = options.defaultLimit ?? 5;
    this.maxLimit = options.maxLimit ?? 50;
  }

  /**
   * Sync tools from the cataloger to the index
   */
  syncFromCataloger(): void {
    const tools = this.cataloger.getAllTools();
    this.indexStore.indexTools(tools);
  }

  /**
   * Sync tools for a specific server from the cataloger
   */
  syncServerFromCataloger(serverKey: string): void {
    const tools = this.cataloger.getToolsForServer(serverKey);

    // Remove old tools for this server and add new ones
    this.indexStore.removeToolsForServer(serverKey);
    this.indexStore.indexTools(tools);
  }

  /**
   * Search for tools matching the query
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

    return {
      tools: searchResults.map((r) => ({
        name: r.name,
        description: r.description,
        serverKey: r.serverKey,
      })),
      query,
      totalMatches: searchResults.length,
    };
  }

  /**
   * Get full tool details by name
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
   * Get multiple tools by name
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
   * Get all indexed tool names
   */
  getIndexedToolCount(): number {
    return this.indexStore.getToolCount();
  }

  /**
   * Clear the index
   */
  clearIndex(): void {
    this.indexStore.clear();
  }

  /**
   * Close the retriever and clean up resources
   */
  close(): void {
    this.indexStore.close();
  }
}
