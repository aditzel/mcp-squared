/**
 * SQLite-based index store for tool search using FTS5.
 *
 * This module provides persistent storage and full-text search
 * capabilities for cataloged tools. It uses SQLite's FTS5 extension
 * for efficient natural language search across tool names and descriptions.
 *
 * @module index/store
 */

import { Database } from "bun:sqlite";
import type { CatalogedTool, ToolInputSchema } from "../upstream/cataloger.js";

/**
 * Tool data stored in the SQLite index.
 */
export interface IndexedTool {
  /** Auto-generated row ID */
  id: number;
  /** Tool name */
  name: string;
  /** Tool description (may be null) */
  description: string | null;
  /** JSON-serialized input schema */
  inputSchema: string;
  /** Key identifying the upstream server */
  serverKey: string;
  /** Hash of the input schema for change detection */
  schemaHash: string;
  /** Unix timestamp when first indexed */
  createdAt: number;
  /** Unix timestamp when last updated */
  updatedAt: number;
  /** Vector embedding for semantic search (may be null) */
  embedding: Float32Array | null;
}

/**
 * Semantic search result with similarity score.
 */
export interface SemanticSearchResult {
  /** Tool name */
  name: string;
  /** Tool description (may be null) */
  description: string | null;
  /** Key identifying the upstream server */
  serverKey: string;
  /** Cosine similarity score (0-1, higher is better) */
  similarity: number;
}

/**
 * Co-occurrence record for selection caching.
 */
export interface CooccurrenceRecord {
  /** First tool key (serverKey:toolName) */
  tool1Key: string;
  /** Second tool key (serverKey:toolName) */
  tool2Key: string;
  /** Number of times these tools were used together */
  count: number;
  /** Unix timestamp of last co-occurrence */
  lastUsedAt: number;
}

/**
 * Related tool with co-occurrence count.
 */
export interface RelatedTool {
  /** Tool key (serverKey:toolName) */
  toolKey: string;
  /** Number of times used together with the query tool */
  count: number;
}

/**
 * Tool search result with relevance score.
 */
export interface ToolSearchResult {
  /** Tool name */
  name: string;
  /** Tool description (may be null) */
  description: string | null;
  /** Key identifying the upstream server */
  serverKey: string;
  /** FTS5 relevance score (higher is better) */
  score: number;
}

/**
 * Configuration options for IndexStore.
 */
export interface IndexStoreOptions {
  /** Path to SQLite database file (default: ":memory:") */
  dbPath?: string | undefined;
}

/**
 * Generates a hash of a tool's input schema for change detection.
 * @internal
 */
function hashSchema(schema: ToolInputSchema): string {
  return Bun.hash(JSON.stringify(schema)).toString(16);
}

/**
 * Converts a Float32Array to a Buffer for SQLite BLOB storage.
 * @internal
 */
function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

/**
 * Converts a SQLite BLOB (Buffer) back to a Float32Array.
 * @internal
 */
function bufferToEmbedding(buffer: Buffer | null): Float32Array | null {
  if (!buffer) return null;
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}

/**
 * Computes cosine similarity between two embedding vectors.
 * Assumes vectors are already normalized (which BGE embeddings are).
 * @internal
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop condition
    const aVal = a[i]!;
    // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop condition
    const bVal = b[i]!;
    dotProduct += aVal * bVal;
  }
  return dotProduct;
}

/**
 * SQLite-based storage for indexed tools with full-text search.
 *
 * The IndexStore maintains a SQLite database with:
 * - A `tools` table for tool metadata and schemas
 * - An FTS5 virtual table for full-text search
 * - Triggers to keep the FTS index in sync
 *
 * @example
 * ```ts
 * const store = new IndexStore({ dbPath: "./tools.db" });
 * store.indexTools(cataloger.getAllTools());
 *
 * const results = store.search("file operations", 10);
 * ```
 */
export class IndexStore {
  private readonly db: Database;

  /**
   * Creates a new IndexStore instance.
   *
   * @param options - Configuration options
   * @param options.dbPath - Path to SQLite database (default: in-memory)
   */
  constructor(options: IndexStoreOptions = {}) {
    const dbPath = options.dbPath ?? ":memory:";
    this.db = new Database(dbPath);
    this.initSchema();
  }

  /**
   * Initializes the database schema including tables, indexes, and FTS.
   * @internal
   */
  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        input_schema TEXT NOT NULL,
        server_key TEXT NOT NULL,
        schema_hash TEXT NOT NULL,
        embedding BLOB,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(name, server_key)
      )
    `);

    // Migration: Add embedding column if it doesn't exist (for existing databases)
    try {
      this.db.run("ALTER TABLE tools ADD COLUMN embedding BLOB");
    } catch {
      // Column already exists, ignore error
    }

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_tools_server_key ON tools(server_key)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_tools_name ON tools(name)
    `);

    // Create FTS5 virtual table for full-text search
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS tools_fts USING fts5(
        name,
        description,
        content='tools',
        content_rowid='id'
      )
    `);

    // Create triggers to keep FTS in sync
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS tools_ai AFTER INSERT ON tools BEGIN
        INSERT INTO tools_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS tools_ad AFTER DELETE ON tools BEGIN
        INSERT INTO tools_fts(tools_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS tools_au AFTER UPDATE ON tools BEGIN
        INSERT INTO tools_fts(tools_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
        INSERT INTO tools_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
      END
    `);

    // Co-occurrence table for selection caching
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tool_cooccurrences (
        tool1_key TEXT NOT NULL,
        tool2_key TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        last_used_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (tool1_key, tool2_key)
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_cooccurrences_tool1 ON tool_cooccurrences(tool1_key)
    `);
  }

  /**
   * Indexes a single tool, updating if it already exists.
   * Uses upsert to handle both insert and update cases.
   *
   * @param tool - The tool to index
   */
  indexTool(tool: CatalogedTool): void {
    const schemaHash = hashSchema(tool.inputSchema);
    const inputSchemaJson = JSON.stringify(tool.inputSchema);

    this.db.run(
      `
      INSERT INTO tools (name, description, input_schema, server_key, schema_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(name, server_key) DO UPDATE SET
        description = excluded.description,
        input_schema = excluded.input_schema,
        schema_hash = excluded.schema_hash,
        updated_at = unixepoch()
    `,
      [
        tool.name,
        tool.description ?? null,
        inputSchemaJson,
        tool.serverKey,
        schemaHash,
      ],
    );
  }

  /**
   * Indexes multiple tools in a single transaction for efficiency.
   * Uses prepared statements and transactions for bulk operations.
   *
   * @param tools - Array of tools to index
   */
  indexTools(tools: CatalogedTool[]): void {
    const insertStmt = this.db.prepare(`
      INSERT INTO tools (name, description, input_schema, server_key, schema_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(name, server_key) DO UPDATE SET
        description = excluded.description,
        input_schema = excluded.input_schema,
        schema_hash = excluded.schema_hash,
        updated_at = unixepoch()
    `);

    const transaction = this.db.transaction((tools: CatalogedTool[]) => {
      for (const tool of tools) {
        const schemaHash = hashSchema(tool.inputSchema);
        const inputSchemaJson = JSON.stringify(tool.inputSchema);
        insertStmt.run(
          tool.name,
          tool.description ?? null,
          inputSchemaJson,
          tool.serverKey,
          schemaHash,
        );
      }
    });

    transaction(tools);
  }

  /**
   * Searches for tools using FTS5 full-text search.
   * Supports prefix matching for partial word matches.
   *
   * @param query - Search query string
   * @param limit - Maximum results to return (default: 10)
   * @returns Array of matching tools with relevance scores
   */
  search(query: string, limit = 10): ToolSearchResult[] {
    if (!query.trim()) {
      return [];
    }

    // Escape special FTS5 characters and prepare query
    const ftsQuery = this.prepareFtsQuery(query);

    const results = this.db
      .query<
        {
          name: string;
          description: string | null;
          server_key: string;
          rank: number;
        },
        [string, number]
      >(
        `
      SELECT t.name, t.description, t.server_key, fts.rank
      FROM tools_fts fts
      JOIN tools t ON t.id = fts.rowid
      WHERE tools_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `,
      )
      .all(ftsQuery, limit);

    return results.map((row) => ({
      name: row.name,
      description: row.description,
      serverKey: row.server_key,
      score: -row.rank, // FTS5 rank is negative, lower is better
    }));
  }

  /**
   * Counts the total number of tools matching a search query.
   * Use this to get accurate totalMatches when limiting search results.
   *
   * @param query - Search query string
   * @returns Total count of matching tools
   */
  searchCount(query: string): number {
    if (!query.trim()) {
      return 0;
    }

    const ftsQuery = this.prepareFtsQuery(query);

    const result = this.db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM tools_fts WHERE tools_fts MATCH ?",
      )
      .get(ftsQuery);

    return result?.count ?? 0;
  }

  /**
   * Gets a tool by name, optionally filtering by server.
   *
   * @param name - Tool name to look up
   * @param serverKey - Optional server key to narrow search
   * @returns The indexed tool if found, null otherwise
   */
  getTool(name: string, serverKey?: string): IndexedTool | null {
    let query: string;
    let params: (string | undefined)[];

    if (serverKey) {
      query = "SELECT * FROM tools WHERE name = ? AND server_key = ?";
      params = [name, serverKey];
    } else {
      query = "SELECT * FROM tools WHERE name = ? LIMIT 1";
      params = [name];
    }

    const row = this.db
      .query<
        {
          id: number;
          name: string;
          description: string | null;
          input_schema: string;
          server_key: string;
          schema_hash: string;
          embedding: Buffer | null;
          created_at: number;
          updated_at: number;
        },
        string[]
      >(query)
      .get(...(params.filter((p) => p !== undefined) as string[]));

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      inputSchema: row.input_schema,
      serverKey: row.server_key,
      schemaHash: row.schema_hash,
      embedding: bufferToEmbedding(row.embedding),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Gets all tools indexed for a specific server.
   *
   * @param serverKey - Server key to get tools for
   * @returns Array of all indexed tools for that server
   */
  getToolsForServer(serverKey: string): IndexedTool[] {
    const rows = this.db
      .query<
        {
          id: number;
          name: string;
          description: string | null;
          input_schema: string;
          server_key: string;
          schema_hash: string;
          embedding: Buffer | null;
          created_at: number;
          updated_at: number;
        },
        [string]
      >("SELECT * FROM tools WHERE server_key = ?")
      .all(serverKey);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      inputSchema: row.input_schema,
      serverKey: row.server_key,
      schemaHash: row.schema_hash,
      embedding: bufferToEmbedding(row.embedding),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Gets all indexed tools from all servers.
   *
   * @returns Array of all indexed tools
   */
  getAllTools(): IndexedTool[] {
    const rows = this.db
      .query<
        {
          id: number;
          name: string;
          description: string | null;
          input_schema: string;
          server_key: string;
          schema_hash: string;
          embedding: Buffer | null;
          created_at: number;
          updated_at: number;
        },
        []
      >("SELECT * FROM tools")
      .all();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      inputSchema: row.input_schema,
      serverKey: row.server_key,
      schemaHash: row.schema_hash,
      embedding: bufferToEmbedding(row.embedding),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Removes all tools for a specific server.
   *
   * @param serverKey - Server key to remove tools for
   * @returns Number of tools removed
   */
  removeToolsForServer(serverKey: string): number {
    // Count first since triggers affect the changes count
    const countResult = this.db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM tools WHERE server_key = ?",
      )
      .get(serverKey);
    const count = countResult?.count ?? 0;

    this.db.run("DELETE FROM tools WHERE server_key = ?", [serverKey]);
    return count;
  }

  /**
   * Removes a specific tool from the index.
   *
   * @param name - Tool name to remove
   * @param serverKey - Server key the tool belongs to
   * @returns true if tool was removed, false if not found
   */
  removeTool(name: string, serverKey: string): boolean {
    // Check existence first since triggers affect the changes count
    const exists = this.db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) as count FROM tools WHERE name = ? AND server_key = ?",
      )
      .get(name, serverKey);

    if (!exists || exists.count === 0) {
      return false;
    }

    this.db.run("DELETE FROM tools WHERE name = ? AND server_key = ?", [
      name,
      serverKey,
    ]);
    return true;
  }

  /**
   * Returns the total count of indexed tools.
   *
   * @returns Number of tools in the index
   */
  getToolCount(): number {
    const result = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM tools")
      .get();
    return result?.count ?? 0;
  }

  /**
   * Clears all tools from the index.
   * The FTS index is automatically updated via triggers.
   */
  clear(): void {
    this.db.run("DELETE FROM tools");
  }

  /**
   * Closes the database connection and releases resources.
   * Call this when shutting down the application.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Prepares a user query string for FTS5 matching.
   * Escapes special characters and adds prefix matching.
   *
   * @param query - User's search query
   * @returns FTS5-safe query string
   * @internal
   */
  private prepareFtsQuery(query: string): string {
    // Remove special FTS5 operators and escape quotes
    const cleaned = query
      .replace(/[*"(){}[\]^~\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return '""';

    // Split into terms and join with OR for broader matching
    const terms = cleaned.split(" ").filter((t) => t.length > 0);

    // Use prefix matching for partial word matches
    return terms.map((t) => `"${t}"*`).join(" OR ");
  }

  // ============================================================
  // Vector Embedding Methods
  // ============================================================

  /**
   * Updates the embedding for a specific tool.
   *
   * @param name - Tool name
   * @param serverKey - Server key the tool belongs to
   * @param embedding - The embedding vector to store
   * @returns true if updated, false if tool not found
   */
  updateEmbedding(
    name: string,
    serverKey: string,
    embedding: Float32Array,
  ): boolean {
    const buffer = embeddingToBuffer(embedding);
    const result = this.db.run(
      "UPDATE tools SET embedding = ?, updated_at = unixepoch() WHERE name = ? AND server_key = ?",
      [buffer, name, serverKey],
    );
    return result.changes > 0;
  }

  /**
   * Updates embeddings for multiple tools in a single transaction.
   *
   * @param embeddings - Array of {name, serverKey, embedding} objects
   * @returns Number of tools updated
   */
  updateEmbeddings(
    embeddings: Array<{
      name: string;
      serverKey: string;
      embedding: Float32Array;
    }>,
  ): number {
    const updateStmt = this.db.prepare(
      "UPDATE tools SET embedding = ?, updated_at = unixepoch() WHERE name = ? AND server_key = ?",
    );

    let updated = 0;
    const transaction = this.db.transaction(
      (
        items: Array<{
          name: string;
          serverKey: string;
          embedding: Float32Array;
        }>,
      ) => {
        for (const item of items) {
          const buffer = embeddingToBuffer(item.embedding);
          const result = updateStmt.run(buffer, item.name, item.serverKey);
          if (result.changes > 0) updated++;
        }
      },
    );

    transaction(embeddings);
    return updated;
  }

  /**
   * Performs semantic search using cosine similarity.
   * Returns tools ranked by similarity to the query embedding.
   *
   * @param queryEmbedding - The query's embedding vector
   * @param limit - Maximum results to return (default: 10)
   * @returns Array of tools with similarity scores, sorted by similarity
   */
  searchSemantic(
    queryEmbedding: Float32Array,
    limit = 10,
  ): SemanticSearchResult[] {
    // Fetch all tools with embeddings
    const rows = this.db
      .query<
        {
          name: string;
          description: string | null;
          server_key: string;
          embedding: Buffer;
        },
        []
      >(
        "SELECT name, description, server_key, embedding FROM tools WHERE embedding IS NOT NULL",
      )
      .all();

    // Compute similarities and rank
    const results: SemanticSearchResult[] = [];
    for (const row of rows) {
      const embedding = bufferToEmbedding(row.embedding);
      if (!embedding) continue;

      const similarity = cosineSimilarity(queryEmbedding, embedding);
      results.push({
        name: row.name,
        description: row.description,
        serverKey: row.server_key,
        similarity,
      });
    }

    // Sort by similarity (descending) and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /**
   * Returns count of tools that have embeddings stored.
   *
   * @returns Number of tools with embeddings
   */
  getEmbeddingCount(): number {
    const result = this.db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM tools WHERE embedding IS NOT NULL",
      )
      .get();
    return result?.count ?? 0;
  }

  /**
   * Returns tools that don't have embeddings yet.
   * Useful for batch embedding generation.
   *
   * @returns Array of tools missing embeddings
   */
  getToolsWithoutEmbeddings(): Array<{
    name: string;
    description: string | null;
    serverKey: string;
  }> {
    return this.db
      .query<
        { name: string; description: string | null; server_key: string },
        []
      >(
        "SELECT name, description, server_key FROM tools WHERE embedding IS NULL",
      )
      .all()
      .map((row) => ({
        name: row.name,
        description: row.description,
        serverKey: row.server_key,
      }));
  }

  /**
   * Clears all embeddings from tools.
   * Useful for re-generating embeddings with a different model.
   */
  clearEmbeddings(): void {
    this.db.run("UPDATE tools SET embedding = NULL");
  }

  // ============================================================
  // Co-occurrence / Selection Caching Methods
  // ============================================================

  /**
   * Records a co-occurrence between two tools.
   * Used for selection caching to track which tools are used together.
   *
   * @param tool1Key - First tool key (serverKey:toolName)
   * @param tool2Key - Second tool key (serverKey:toolName)
   */
  recordCooccurrence(tool1Key: string, tool2Key: string): void {
    // Normalize order to avoid duplicate pairs (a,b) and (b,a)
    const [first, second] =
      tool1Key < tool2Key ? [tool1Key, tool2Key] : [tool2Key, tool1Key];

    this.db.run(
      `
      INSERT INTO tool_cooccurrences (tool1_key, tool2_key, count, last_used_at)
      VALUES (?, ?, 1, unixepoch())
      ON CONFLICT(tool1_key, tool2_key) DO UPDATE SET
        count = count + 1,
        last_used_at = unixepoch()
    `,
      [first, second],
    );
  }

  /**
   * Records co-occurrences between multiple tools used in the same session.
   * Generates all unique pairs from the tool list.
   *
   * @param toolKeys - Array of tool keys used together
   */
  recordCooccurrences(toolKeys: string[]): void {
    if (toolKeys.length < 2) return;

    const transaction = this.db.transaction((keys: string[]) => {
      // Generate all unique pairs
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop condition
          const tool1 = keys[i]!;
          // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop condition
          const tool2 = keys[j]!;
          // Normalize order
          const [first, second] =
            tool1 < tool2 ? [tool1, tool2] : [tool2, tool1];

          this.db.run(
            `
            INSERT INTO tool_cooccurrences (tool1_key, tool2_key, count, last_used_at)
            VALUES (?, ?, 1, unixepoch())
            ON CONFLICT(tool1_key, tool2_key) DO UPDATE SET
              count = count + 1,
              last_used_at = unixepoch()
          `,
            [first, second],
          );
        }
      }
    });

    transaction(toolKeys);
  }

  /**
   * Gets tools that frequently co-occur with the given tool.
   *
   * @param toolKey - Tool key to find related tools for
   * @param minCount - Minimum co-occurrence count (default: 1)
   * @param limit - Maximum results to return (default: 10)
   * @returns Array of related tools sorted by co-occurrence count
   */
  getRelatedTools(toolKey: string, minCount = 1, limit = 10): RelatedTool[] {
    const results = this.db
      .query<
        { related_key: string; count: number },
        [string, string, string, number, number]
      >(
        `
        SELECT
          CASE WHEN tool1_key = ? THEN tool2_key ELSE tool1_key END as related_key,
          count
        FROM tool_cooccurrences
        WHERE (tool1_key = ? OR tool2_key = ?)
          AND count >= ?
        ORDER BY count DESC
        LIMIT ?
      `,
      )
      .all(toolKey, toolKey, toolKey, minCount, limit);

    return results.map((row) => ({
      toolKey: row.related_key,
      count: row.count,
    }));
  }

  /**
   * Gets suggested tool bundles based on co-occurrence patterns.
   * Returns tools that frequently appear with any of the given tools.
   *
   * @param toolKeys - Array of tool keys to find related bundles for
   * @param minCount - Minimum co-occurrence count (default: 2)
   * @param limit - Maximum suggestions to return (default: 5)
   * @returns Array of related tools not in the input set
   */
  getSuggestedBundles(
    toolKeys: string[],
    minCount = 2,
    limit = 5,
  ): RelatedTool[] {
    if (toolKeys.length === 0) return [];

    const toolKeySet = new Set(toolKeys);
    const relatedCounts = new Map<string, number>();

    // Aggregate co-occurrence counts for all input tools
    for (const toolKey of toolKeys) {
      const related = this.getRelatedTools(toolKey, minCount, 50);
      for (const r of related) {
        if (!toolKeySet.has(r.toolKey)) {
          relatedCounts.set(
            r.toolKey,
            (relatedCounts.get(r.toolKey) ?? 0) + r.count,
          );
        }
      }
    }

    // Sort by aggregated count and return top results
    const sorted = Array.from(relatedCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return sorted.map(([toolKey, count]) => ({ toolKey, count }));
  }

  /**
   * Clears all co-occurrence data.
   * Used by the clear_selection_cache tool.
   */
  clearCooccurrences(): void {
    this.db.run("DELETE FROM tool_cooccurrences");
  }

  /**
   * Gets the total count of co-occurrence records.
   *
   * @returns Number of co-occurrence pairs stored
   */
  getCooccurrenceCount(): number {
    const result = this.db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM tool_cooccurrences",
      )
      .get();
    return result?.count ?? 0;
  }
}
