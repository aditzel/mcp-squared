/**
 * Index module exports.
 *
 * Provides SQLite-based storage with FTS5 full-text search
 * for cataloged tools from upstream MCP servers.
 *
 * @module index
 */

export {
  IndexStore,
  type IndexedTool,
  type IndexStoreOptions,
  type ToolSearchResult,
} from "./store.js";
