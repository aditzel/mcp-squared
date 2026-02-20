/**
 * Embeddings module - Local embedding generation using Transformers.js
 *
 * This module provides semantic embedding capabilities for tool search
 * using the BGE-small-en-v1.5 model with WASM backend for Bun compatibility.
 *
 * @module embeddings
 */

export {
  EmbeddingGenerator,
  EmbeddingRuntimeDependencyError,
  type EmbeddingOptions,
} from "./generator.js";
