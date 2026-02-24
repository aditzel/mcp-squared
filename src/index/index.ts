/**
 * Index module exports.
 *
 * Provides SQLite-based storage with FTS5 full-text search
 * for cataloged tools from upstream MCP servers.
 *
 * @module index
 */

export {
  type CooccurrenceRecord,
  type IndexedTool,
  IndexStore,
  type IndexStoreOptions,
  type RelatedTool,
  type SemanticSearchResult,
  type ToolSearchResult,
} from "./store.js";
