import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { NamespaceToolMetadata } from "@/capabilities/inference";
import { EmbeddingGenerator } from "@/embeddings/generator";

// We need deterministic embeddings that vary by input so cosine similarity
// can distinguish capabilities. Hash the input to seed the vector.
function hashToSeed(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function makeDeterministicVector(seed: number, dims = 384): Float32Array {
  const vec = new Float32Array(dims);
  let s = seed;
  let norm = 0;
  for (let i = 0; i < dims; i++) {
    // Simple LCG pseudorandom
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    vec[i] = (s >>> 0) / 4294967296 - 0.5;
    // biome-ignore lint/style/noNonNullAssertion: loop-bounded index
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dims; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop-bounded index
    vec[i] = vec[i]! / norm;
  }
  return vec;
}

// Mock that returns seed-deterministic embeddings per input text
mock.module("@huggingface/transformers", () => ({
  env: { allowLocalModels: false, cacheDir: "" },
  // biome-ignore lint/suspicious/noExplicitAny: mock
  pipeline: async (_task: string, _model: string, _options: any) => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    return async (input: string | string[], _opts: any) => {
      const texts = Array.isArray(input) ? input : [input];
      const dims = 384;
      const data = new Float32Array(texts.length * dims);
      for (let i = 0; i < texts.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: loop-bounded index
        const vec = makeDeterministicVector(hashToSeed(texts[i]!), dims);
        data.set(vec, i * dims);
      }
      return { data, dims: [texts.length, dims] };
    };
  },
}));

// Dynamic import after mock is registered
const { SemanticCapabilityClassifier } = await import(
  "@/capabilities/semantic-classifier"
);

describe("SemanticCapabilityClassifier", () => {
  let generator: EmbeddingGenerator;

  afterEach(() => {
    // No cleanup needed — each test creates its own classifier
  });

  async function createInitializedClassifier(
    threshold?: number,
  ): Promise<InstanceType<typeof SemanticCapabilityClassifier>> {
    generator = new EmbeddingGenerator();
    await generator.initialize();
    const classifier = new SemanticCapabilityClassifier(generator, {
      confidenceThreshold: threshold,
    });
    await classifier.initializeReferences();
    return classifier;
  }

  test("initializes reference embeddings", async () => {
    const classifier = await createInitializedClassifier();
    expect(classifier.isInitialized()).toBe(true);
  });

  test("isInitialized returns false before initializeReferences", async () => {
    generator = new EmbeddingGenerator();
    await generator.initialize();
    const classifier = new SemanticCapabilityClassifier(generator);
    expect(classifier.isInitialized()).toBe(false);
  });

  test("classifies a single namespace", async () => {
    const classifier = await createInitializedClassifier();
    const tools: NamespaceToolMetadata[] = [
      {
        name: "get_current_time",
        description: "Get current time in a specific timezone",
        inputSchema: {
          type: "object",
          properties: { timezone: { type: "string" } },
        },
      },
      {
        name: "convert_time",
        description: "Convert time between timezones",
        inputSchema: {
          type: "object",
          properties: {
            time: { type: "string" },
            source_timezone: { type: "string" },
            target_timezone: { type: "string" },
          },
        },
      },
    ];
    const result = await classifier.classify("time", tools);

    expect(result.capability).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.inferenceMs).toBeGreaterThanOrEqual(0);
  });

  test("classifyBatch returns overrides only for above-threshold results", async () => {
    const classifier = await createInitializedClassifier(0.0);
    const inventories = [
      {
        namespace: "time",
        tools: [
          {
            name: "get_current_time",
            description: "Get current time in a timezone",
          },
        ],
      },
      {
        namespace: "auggie",
        tools: [
          {
            name: "codebase_retrieval",
            description: "Search source code context",
          },
        ],
      },
    ];
    const result = await classifier.classifyBatch(inventories);

    // With threshold 0.0, all namespaces should produce overrides
    expect(Object.keys(result.overrides).length).toBe(2);
    expect(result.classifications.length).toBe(2);
    expect(result.inferenceMs).toBeGreaterThanOrEqual(0);
  });

  test("threshold 1.0 produces no overrides", async () => {
    const classifier = await createInitializedClassifier(1.0);
    const inventories = [
      {
        namespace: "time",
        tools: [
          {
            name: "get_current_time",
            description: "Get current time in a timezone",
          },
        ],
      },
    ];
    const result = await classifier.classifyBatch(inventories);

    // Cosine similarity cannot reach exactly 1.0 for distinct texts
    expect(Object.keys(result.overrides).length).toBe(0);
    // Classifications still returned for diagnostics
    expect(result.classifications.length).toBe(1);
  });

  test("constructs signal text from namespace, tool names, descriptions, and schema keys", async () => {
    const classifier = await createInitializedClassifier();
    const tools: NamespaceToolMetadata[] = [
      {
        name: "search_code",
        description: "Search source code in repositories",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            language: { type: "string" },
          },
          required: ["query"],
        },
      },
    ];

    // We spy on generator.embed to capture the signal text
    const embedSpy = spyOn(generator, "embed");
    await classifier.classify("github", tools);

    expect(embedSpy).toHaveBeenCalled();
    const signalText = embedSpy.mock.calls[0]?.[0] as string;

    // Signal text should contain namespace, tool name, description, and schema keys
    expect(signalText).toContain("github");
    expect(signalText).toContain("search_code");
    expect(signalText).toContain("Search source code in repositories");
    expect(signalText).toContain("query");
    expect(signalText).toContain("language");
  });

  test("classify returns all classification details", async () => {
    const classifier = await createInitializedClassifier();
    const tools: NamespaceToolMetadata[] = [
      {
        name: "create_issue",
        description: "Create a new issue in the project tracker",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
          },
        },
      },
    ];
    const result = await classifier.classify("linear", tools);

    expect(typeof result.capability).toBe("string");
    expect(typeof result.confidence).toBe("number");
    expect(typeof result.inferenceMs).toBe("number");
    // Runner-up should be present if more than one capability
    expect(result.runnerUp).toBeDefined();
    expect(typeof result.runnerUp?.capability).toBe("string");
    expect(typeof result.runnerUp?.confidence).toBe("number");
  });

  test("handles tools with missing descriptions and schemas", async () => {
    const classifier = await createInitializedClassifier();
    const tools: NamespaceToolMetadata[] = [
      { name: "do_thing" },
      { name: "another_thing", description: null },
      { name: "third_thing", description: undefined, inputSchema: undefined },
    ];
    const result = await classifier.classify("mystery", tools);

    expect(result.capability).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
  });

  test("handles empty tool list gracefully", async () => {
    const classifier = await createInitializedClassifier();
    const result = await classifier.classify("empty", []);
    expect(result.capability).toBeDefined();
  });
});
