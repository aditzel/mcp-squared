/**
 * Component test: shadcn MCP server classification.
 *
 * Tests that the shadcn/ui MCP server is never classified as `code_search`.
 * shadcn is a component registry for browsing, searching, and installing
 * UI components — it belongs under `docs` (or `design`), never `code_search`.
 *
 * Uses the REAL tool metadata from the official shadcn MCP server
 * (npx shadcn@latest mcp) as of 2026-03.
 *
 * @see https://ui.shadcn.com/docs/mcp
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import type { NamespaceToolMetadata } from "@/capabilities/inference";
import {
  groupNamespacesByCapability,
  inferNamespaceCapability,
} from "@/capabilities/inference";
import { EmbeddingGenerator } from "@/embeddings/generator";

// ---------------------------------------------------------------------------
// Real shadcn MCP server tool metadata (official server: npx shadcn@latest mcp)
// ---------------------------------------------------------------------------
const SHADCN_TOOLS: NamespaceToolMetadata[] = [
  {
    name: "get_project_registries",
    description:
      "Get configured registry names from components.json. Returns error if no components.json exists (use init_project to create one).",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "The working directory of the project.",
        },
      },
    },
  },
  {
    name: "list_items_in_registries",
    description:
      "List items from registries. Requires components.json — use init_project if missing.",
    inputSchema: {
      type: "object",
      properties: {
        registryNames: {
          type: "array",
          description: "Registry names to list items from.",
        },
      },
    },
  },
  {
    name: "search_items_in_registries",
    description:
      "Search for components in registries using fuzzy matching. Requires components.json. After finding an item, use get_item_examples_from_registries to see usage examples.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query for fuzzy matching against component names.",
        },
        registryNames: {
          type: "array",
          description: "Registry names to search.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "view_items_in_registries",
    description:
      "Shows full documentation for a specific component including source code, dependencies, and usage notes.",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          description: "Component names to view.",
        },
        registryName: {
          type: "string",
          description: "Registry to look up items in.",
        },
      },
      required: ["names"],
    },
  },
  {
    name: "get_item_examples_from_registries",
    description:
      "Retrieves usage examples for a component. Use after search_items_in_registries to see how a component is used.",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          description: "Component names to get examples for.",
        },
        registryName: {
          type: "string",
          description: "Registry to look up examples in.",
        },
      },
      required: ["names"],
    },
  },
  {
    name: "get_add_command_for_items",
    description:
      "Generates the correct npx shadcn add command for installing one or more components into the project.",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          description: "Component names to generate install commands for.",
        },
        registryName: {
          type: "string",
          description: "Registry to install from.",
        },
      },
      required: ["names"],
    },
  },
  {
    name: "get_audit_checklist",
    description:
      "Returns a best practices checklist for shadcn/ui usage including accessibility, theming, and composition patterns.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Heuristic path tests
// ---------------------------------------------------------------------------
describe("shadcn classification — heuristic path", () => {
  test("shadcn is NOT classified as code_search by the heuristic", () => {
    const capability = inferNamespaceCapability("shadcn", SHADCN_TOOLS);
    expect(capability).not.toBe("code_search");
  });

  test("shadcn grouped via heuristic never lands in code_search bucket", () => {
    const groups = groupNamespacesByCapability(
      [{ namespace: "shadcn", tools: SHADCN_TOOLS }],
      {},
    );

    expect(groups.byNamespace["shadcn"]).not.toBe("code_search");
    expect(groups.grouped.code_search ?? []).not.toContain("shadcn");
  });

  test("shadcn with user override to docs is respected over heuristic", () => {
    const capability = inferNamespaceCapability("shadcn", SHADCN_TOOLS, {
      shadcn: "docs",
    });
    expect(capability).toBe("docs");
  });
});

// ---------------------------------------------------------------------------
// Semantic classifier path tests (mock embeddings)
// ---------------------------------------------------------------------------

// Hash-to-seed for deterministic input-dependent embeddings
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

describe("shadcn classification — semantic classifier path", () => {
  test("shadcn is NOT classified as code_search by semantic classifier", async () => {
    const generator = new EmbeddingGenerator();
    await generator.initialize();
    const classifier = new SemanticCapabilityClassifier(generator, {
      confidenceThreshold: 0,
    });
    await classifier.initializeReferences();

    const result = await classifier.classify("shadcn", SHADCN_TOOLS);

    expect(result.capability).not.toBe("code_search");
    expect(result.confidence).toBeGreaterThan(0);
  });

  test("shadcn classifyBatch override never produces code_search", async () => {
    const generator = new EmbeddingGenerator();
    await generator.initialize();
    const classifier = new SemanticCapabilityClassifier(generator, {
      confidenceThreshold: 0,
    });
    await classifier.initializeReferences();

    const result = await classifier.classifyBatch([
      { namespace: "shadcn", tools: SHADCN_TOOLS },
    ]);

    expect(result.overrides["shadcn"]).not.toBe("code_search");
    // Full classification details should also not pick code_search
    const shadcnEntry = result.classifications.find(
      (c) => c.namespace === "shadcn",
    );
    expect(shadcnEntry).toBeDefined();
    expect(shadcnEntry?.capability).not.toBe("code_search");
  });

  test("shadcn signal text contains registry/component vocabulary, not code search terms", async () => {
    const generator = new EmbeddingGenerator();
    await generator.initialize();
    const classifier = new SemanticCapabilityClassifier(generator, {
      confidenceThreshold: 0,
    });
    await classifier.initializeReferences();

    const embedSpy = spyOn(generator, "embed");
    await classifier.classify("shadcn", SHADCN_TOOLS);

    const signalText = embedSpy.mock.calls[0]?.[0] as string;

    // Signal text should reflect shadcn's actual domain: component registries and docs
    expect(signalText).toContain("shadcn");
    expect(signalText).toContain("registries");
    expect(signalText).toContain("components");
    expect(signalText).toContain("documentation");
    expect(signalText).toContain("usage examples");

    // Signal text should NOT contain code-search-specific vocabulary
    // Note: "source code" appears in shadcn's view_items description (component source),
    // which is legitimate — it's not code-search vocabulary in this context.
    expect(signalText).not.toContain("symbols");
    expect(signalText).not.toContain("codebase");
    expect(signalText).not.toContain("function definitions");
    expect(signalText).not.toContain("class references");
  });
});
