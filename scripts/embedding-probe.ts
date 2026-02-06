/**
 * Compile-time probe for embeddings support in Bun standalone binaries.
 *
 * This script intentionally initializes the embedding pipeline. It is used by
 * scripts/compile-matrix.sh to validate whether compiled binaries can load the
 * onnxruntime backend required by @huggingface/transformers.
 */

import { EmbeddingGenerator } from "../src/embeddings/index.js";

const generator = new EmbeddingGenerator({ showProgress: false });
await generator.initialize();

console.log(`Embedding pipeline initialized (${generator.getModelId()})`);
