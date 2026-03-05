/**
 * Component test: wavespeed-cli-mcp server classification.
 *
 * Tests that the wavespeed MCP server (AI image generation) is classified
 * as `ai_media_generation`, NOT `design`. Wavespeed generates images from
 * text prompts using AI models — it has nothing to do with UI mockups,
 * wireframes, or design system components.
 *
 * Uses the REAL tool metadata from the wavespeed-cli-mcp server as of 2026-03.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import type { NamespaceToolMetadata } from "@/capabilities/inference";
import {
  groupNamespacesByCapability,
  inferNamespaceCapability,
} from "@/capabilities/inference";
import { EmbeddingGenerator } from "@/embeddings/generator";

// ---------------------------------------------------------------------------
// Real wavespeed-cli-mcp server tool metadata
// ---------------------------------------------------------------------------
const WAVESPEED_TOOLS: NamespaceToolMetadata[] = [
  {
    name: "list_models",
    description:
      "List available Wavespeed AI models with their capabilities. Call this to discover valid model IDs before using generate/edit tools.",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Search models by name or ID (e.g., 'flux', 'seedream')",
        },
        type: {
          type: "string",
          description:
            "Filter by model type (e.g., 'text-to-image', 'text-to-video')",
        },
        limit: {
          type: "number",
          description: "Maximum models to return (default: 20)",
        },
        refresh: {
          type: "boolean",
          description: "Force refresh from API",
        },
      },
    },
  },
  {
    name: "generate",
    description: "Generate images from text prompts using Wavespeed AI",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of image to generate",
        },
        model: {
          type: "string",
          description: "Model ID (optional, uses config default)",
        },
        size: {
          type: "string",
          description: "Image size WxH (1024-4096, default: 2048*2048)",
        },
        output: {
          type: "string",
          description: "Output format: urls, paths (save files), or base64",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "edit",
    description: "Edit images using text prompts with Wavespeed AI",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of desired edits",
        },
        images: {
          type: "array",
          description: "Image URLs or base64 data (max 10)",
        },
        model: {
          type: "string",
          description: "Model ID (optional)",
        },
        size: {
          type: "string",
          description: "Output image size WxH (default: 2048*2048)",
        },
      },
      required: ["prompt", "images"],
    },
  },
  {
    name: "generate_sequential",
    description: "Generate multiple consistent images from text prompts",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of images to generate",
        },
        count: {
          type: "number",
          description: "Number of images (1-15)",
        },
        model: {
          type: "string",
          description: "Model ID (optional)",
        },
        size: {
          type: "string",
          description: "Image size WxH (default: 2048*2048)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "edit_sequential",
    description: "Edit multiple images sequentially with consistency",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of desired edits",
        },
        images: {
          type: "array",
          description: "Optional input images (max 10)",
        },
        count: {
          type: "number",
          description: "Number of output images (1-15)",
        },
        model: {
          type: "string",
          description: "Model ID (optional)",
        },
      },
      required: ["prompt"],
    },
  },
];

// ---------------------------------------------------------------------------
// Heuristic path tests
// ---------------------------------------------------------------------------
describe("wavespeed classification — heuristic path", () => {
  test("wavespeed-cli-mcp is classified as ai_media_generation", () => {
    const capability = inferNamespaceCapability(
      "wavespeed-cli-mcp",
      WAVESPEED_TOOLS,
    );
    expect(capability).toBe("ai_media_generation");
  });

  test("wavespeed-cli-mcp is NOT classified as design", () => {
    const capability = inferNamespaceCapability(
      "wavespeed-cli-mcp",
      WAVESPEED_TOOLS,
    );
    expect(capability).not.toBe("design");
  });

  test("wavespeed grouped via heuristic lands in ai_media_generation bucket", () => {
    const groups = groupNamespacesByCapability(
      [{ namespace: "wavespeed-cli-mcp", tools: WAVESPEED_TOOLS }],
      {},
    );

    expect(groups.byNamespace["wavespeed-cli-mcp"]).toBe("ai_media_generation");
    expect(groups.grouped.design ?? []).not.toContain("wavespeed-cli-mcp");
    expect(groups.grouped.ai_media_generation ?? []).toContain(
      "wavespeed-cli-mcp",
    );
  });

  test("user override to general is respected over heuristic", () => {
    const capability = inferNamespaceCapability(
      "wavespeed-cli-mcp",
      WAVESPEED_TOOLS,
      { "wavespeed-cli-mcp": "general" },
    );
    expect(capability).toBe("general");
  });
});

// ---------------------------------------------------------------------------
// Namespace hint tests — other AI media server names
// ---------------------------------------------------------------------------
describe("wavespeed classification — namespace hints for AI media servers", () => {
  const minimalTools: NamespaceToolMetadata[] = [
    { name: "create", description: "Create output" },
  ];

  test.each([
    "stability-ai",
    "replicate",
    "midjourney",
    "dalle",
    "dall-e",
    "runway",
    "flux-mcp",
    "dreamstudio",
  ])("%s namespace hint triggers ai_media_generation", (namespace) => {
    const capability = inferNamespaceCapability(namespace, minimalTools);
    expect(capability).toBe("ai_media_generation");
  });
});

// ---------------------------------------------------------------------------
// Semantic classifier path tests (mock embeddings)
// ---------------------------------------------------------------------------

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

const { SemanticCapabilityClassifier } = await import(
  "@/capabilities/semantic-classifier"
);

describe("wavespeed classification — semantic classifier path", () => {
  test("wavespeed is NOT classified as design by semantic classifier", async () => {
    const generator = new EmbeddingGenerator();
    await generator.initialize();
    const classifier = new SemanticCapabilityClassifier(generator, {
      confidenceThreshold: 0,
    });
    await classifier.initializeReferences();

    const result = await classifier.classify(
      "wavespeed-cli-mcp",
      WAVESPEED_TOOLS,
    );

    expect(result.capability).not.toBe("design");
    expect(result.confidence).toBeGreaterThan(0);
  });

  test("wavespeed signal text contains AI generation vocabulary, not design terms", async () => {
    const generator = new EmbeddingGenerator();
    await generator.initialize();
    const classifier = new SemanticCapabilityClassifier(generator, {
      confidenceThreshold: 0,
    });
    await classifier.initializeReferences();

    const embedSpy = spyOn(generator, "embed");
    await classifier.classify("wavespeed-cli-mcp", WAVESPEED_TOOLS);

    const signalText = embedSpy.mock.calls[0]?.[0] as string;

    // Signal text should reflect wavespeed's domain: AI image generation
    expect(signalText).toContain("wavespeed");
    expect(signalText).toContain("generate");
    expect(signalText).toContain("image");
    expect(signalText).toContain("prompt");

    // Signal text should NOT contain design-specific vocabulary
    expect(signalText).not.toContain("wireframe");
    expect(signalText).not.toContain("mockup");
    expect(signalText).not.toContain("layout");
    expect(signalText).not.toContain("figma");
  });
});
