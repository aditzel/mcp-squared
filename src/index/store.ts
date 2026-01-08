import { Database } from "bun:sqlite";
import type { CatalogedTool, ToolInputSchema } from "../upstream/cataloger.js";

export interface IndexedTool {
  id: number;
  name: string;
  description: string | null;
  inputSchema: string;
  serverKey: string;
  schemaHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface ToolSearchResult {
  name: string;
  description: string | null;
  serverKey: string;
  score: number;
}

export interface IndexStoreOptions {
  dbPath?: string | undefined;
}

function hashSchema(schema: ToolInputSchema): string {
  return Bun.hash(JSON.stringify(schema)).toString(16);
}

export class IndexStore {
  private readonly db: Database;

  constructor(options: IndexStoreOptions = {}) {
    const dbPath = options.dbPath ?? ":memory:";
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        input_schema TEXT NOT NULL,
        server_key TEXT NOT NULL,
        schema_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(name, server_key)
      )
    `);

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
  }

  /**
   * Index a tool from the cataloger
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
   * Index multiple tools at once
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
   * Search tools using full-text search
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
   * Get a tool by name
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get all tools for a server
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get all indexed tools
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Remove all tools for a server
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
   * Remove a specific tool
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
   * Get the count of indexed tools
   */
  getToolCount(): number {
    const result = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM tools")
      .get();
    return result?.count ?? 0;
  }

  /**
   * Clear all indexed tools
   */
  clear(): void {
    this.db.run("DELETE FROM tools");
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

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
}
