/**
 * Embedding generator using Transformers.js with WASM backend.
 *
 * Uses BGE-small-en-v1.5 (quantized) for high-quality embeddings
 * optimized for retrieval tasks like tool discovery.
 *
 * @module embeddings/generator
 */

import {
  type FeatureExtractionPipeline,
  env,
  pipeline,
} from "@huggingface/transformers";

/**
 * Configuration options for the embedding generator.
 */
export interface EmbeddingOptions {
  /**
   * Model ID to use for embeddings.
   * @default "Xenova/bge-small-en-v1.5"
   */
  modelId?: string;

  /**
   * Quantization level for the model.
   * Lower precision = faster inference + smaller size.
   * @default "q8" (8-bit quantization)
   */
  dtype?: "fp32" | "fp16" | "q8" | "q4";

  /**
   * Directory to cache downloaded models.
   * @default Uses Hugging Face default cache
   */
  cacheDir?: string;

  /**
   * Whether to show download progress.
   * @default false
   */
  showProgress?: boolean;
}

/**
 * Result of an embedding operation with timing info.
 */
export interface EmbeddingResult {
  /** The embedding vector (normalized) */
  embedding: Float32Array;
  /** Embedding dimensions */
  dimensions: number;
  /** Time taken for inference in milliseconds */
  inferenceMs: number;
}

/**
 * Batch embedding result.
 */
export interface BatchEmbeddingResult {
  /** Array of embedding vectors */
  embeddings: Float32Array[];
  /** Embedding dimensions */
  dimensions: number;
  /** Total time for batch inference in milliseconds */
  inferenceMs: number;
  /** Average time per embedding */
  avgPerEmbeddingMs: number;
}

// Default model optimized for retrieval tasks
const DEFAULT_MODEL = "Xenova/bge-small-en-v1.5";
const DEFAULT_DTYPE = "q8";

export class EmbeddingRuntimeDependencyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmbeddingRuntimeDependencyError";
  }
}

function isMissingOnnxSharedLibraryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Explicit sentinel set by EmbeddingRuntimeDependencyError itself
  if (message.includes("onnxruntime requires external shared libs")) {
    return true;
  }
  // Raw loader errors: require the onnxruntime lib filename to be present so
  // we don't misclassify ABI/symbol-incompatibility dlopen failures as a
  // simple missing-library case (they share the same substrings but need
  // different remediation).
  const hasOnnxLibName =
    message.includes("libonnxruntime.so") ||
    message.includes("libonnxruntime.dylib") ||
    message.includes("onnxruntime.dll");
  const hasDlopenSignature =
    message.includes("cannot open shared object file") ||
    message.includes("No such file or directory") ||
    message.includes("image not found") || // macOS dlopen / dyld
    message.includes("dlopen");
  return hasOnnxLibName && hasDlopenSignature;
}

/**
 * EmbeddingGenerator provides local embedding generation using Transformers.js.
 *
 * The generator lazily loads the model on first use and caches it for
 * subsequent calls. Uses WASM backend for cross-runtime compatibility.
 *
 * @example
 * ```ts
 * const generator = new EmbeddingGenerator();
 * await generator.initialize();
 *
 * const result = await generator.embed("Find file reading tools");
 * console.log(result.embedding.length); // 384
 * console.log(result.inferenceMs); // ~20-50ms
 * ```
 */
export class EmbeddingGenerator {
  private pipeline: FeatureExtractionPipeline | null = null;
  private readonly modelId: string;
  private readonly dtype: "fp32" | "fp16" | "q8" | "q4";
  private readonly showProgress: boolean;
  private initPromise: Promise<void> | null = null;
  private modelLoadTimeMs = 0;

  /**
   * Creates a new EmbeddingGenerator instance.
   *
   * @param options - Configuration options
   */
  constructor(options: EmbeddingOptions = {}) {
    this.modelId = options.modelId ?? DEFAULT_MODEL;
    this.dtype = options.dtype ?? DEFAULT_DTYPE;
    this.showProgress = options.showProgress ?? false;

    // Configure Transformers.js for WASM backend (Bun compatible)
    // Disable local model check to always use remote/cached models
    env.allowLocalModels = false;

    // Set cache directory if provided
    if (options.cacheDir) {
      env.cacheDir = options.cacheDir;
    }
  }

  /**
   * Initializes the embedding pipeline by loading the model.
   * This is called automatically on first embed() call, but can be
   * called explicitly for eager loading.
   *
   * @returns Promise that resolves when model is loaded
   */
  async initialize(): Promise<void> {
    if (this.pipeline) {
      return;
    }

    // Ensure only one initialization happens
    if (!this.initPromise) {
      this.initPromise = this.loadPipeline();
    }

    await this.initPromise;
  }

  private async loadPipeline(): Promise<void> {
    const startTime = performance.now();

    // Build pipeline options
    const pipelineOptions: {
      dtype: "fp32" | "fp16" | "q8" | "q4";
      progress_callback?: (progress: {
        status: string;
        progress?: number;
      }) => void;
    } = {
      dtype: this.dtype,
    };

    // Add progress callback if enabled
    if (this.showProgress) {
      pipelineOptions.progress_callback = (progress) => {
        if (progress.status === "progress" && progress.progress) {
          process.stderr.write(
            `\rLoading model: ${Math.round(progress.progress)}%`,
          );
        } else if (progress.status === "done") {
          process.stderr.write("\n");
        }
      };
    }

    // Create feature extraction pipeline with specified model and dtype
    try {
      this.pipeline = await pipeline(
        "feature-extraction",
        this.modelId,
        pipelineOptions,
      );
    } catch (error) {
      if (isMissingOnnxSharedLibraryError(error)) {
        throw new EmbeddingRuntimeDependencyError(
          "onnxruntime shared library is unavailable. Embeddings require an external shared lib (libonnxruntime) that could not be loaded.",
          { cause: error },
        );
      }
      throw error;
    }

    this.modelLoadTimeMs = performance.now() - startTime;
  }

  /**
   * Generates an embedding for a single text input.
   *
   * For retrieval queries, the text is automatically prefixed with "query: "
   * as required by BGE models for optimal performance.
   *
   * @param text - Text to embed
   * @param isQuery - Whether this is a search query (adds "query: " prefix)
   * @returns Embedding result with vector and timing info
   */
  async embed(text: string, isQuery = true): Promise<EmbeddingResult> {
    await this.initialize();

    // BGE models expect "query: " prefix for search queries
    const input = isQuery ? `query: ${text}` : text;

    const startTime = performance.now();

    const output = await this.pipeline?.(input, {
      pooling: "mean",
      normalize: true,
    });

    if (!output) {
      throw new Error("Pipeline not initialized");
    }

    const inferenceMs = performance.now() - startTime;

    // Extract the embedding data
    const embedding = new Float32Array(output.data as ArrayLike<number>);

    return {
      embedding,
      dimensions: embedding.length,
      inferenceMs,
    };
  }

  /**
   * Generates embeddings for multiple texts in a batch.
   *
   * @param texts - Array of texts to embed
   * @param isQuery - Whether these are search queries
   * @returns Batch result with all embeddings and timing
   */
  async embedBatch(
    texts: string[],
    isQuery = true,
  ): Promise<BatchEmbeddingResult> {
    await this.initialize();

    const inputs = isQuery ? texts.map((t) => `query: ${t}`) : texts;

    const startTime = performance.now();

    const outputs = await this.pipeline?.(inputs, {
      pooling: "mean",
      normalize: true,
    });

    if (!outputs) {
      throw new Error("Pipeline not initialized");
    }

    const inferenceMs = performance.now() - startTime;

    // Extract embeddings from batch output
    const data = outputs.data as ArrayLike<number>;
    const dimensions = outputs.dims[1] as number;
    const embeddings: Float32Array[] = [];

    for (let i = 0; i < texts.length; i++) {
      const start = i * dimensions;
      const end = start + dimensions;
      embeddings.push(new Float32Array(Array.from(data).slice(start, end)));
    }

    return {
      embeddings,
      dimensions,
      inferenceMs,
      avgPerEmbeddingMs: inferenceMs / texts.length,
    };
  }

  /**
   * Computes cosine similarity between two embedding vectors.
   *
   * @param a - First embedding
   * @param b - Second embedding
   * @returns Similarity score between -1 and 1
   */
  static cosineSimilarity(a: Float32Array, b: Float32Array): number {
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

    // Since we normalize embeddings, norms should be ~1, but compute anyway
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Returns model loading time in milliseconds.
   * Returns 0 if model hasn't been loaded yet.
   */
  getModelLoadTimeMs(): number {
    return this.modelLoadTimeMs;
  }

  /**
   * Returns whether the model has been loaded.
   */
  isInitialized(): boolean {
    return this.pipeline !== null;
  }

  /**
   * Returns the model ID being used.
   */
  getModelId(): string {
    return this.modelId;
  }
}
