import { describe, expect, test } from "bun:test";
import {
  classifyNamespace,
  type NamespaceToolMetadata,
} from "@/capabilities/inference";
import { projectNamespaceClassification } from "@/capabilities/projection";
import { SemanticCapabilityClassifier } from "@/capabilities/semantic-classifier";
import type { EmbeddingGenerator } from "@/embeddings/generator";

const PENCIL_TOOLS: NamespaceToolMetadata[] = [
  {
    name: "batch_design",
    description:
      "Create, modify, and manipulate design elements in a .pen canvas",
  },
  {
    name: "snapshot_layout",
    description: "Analyze layout structure and detect overlapping elements",
  },
  {
    name: "get_variables",
    description: "Read design tokens and sync theme values with CSS variables",
  },
  {
    name: "export_react",
    description: "Generate React code for this design system component",
  },
];

describe("namespace classification", () => {
  test("returns canonical capability, facets, and evidence for Pencil-like tools", () => {
    const classification = classifyNamespace("pencil", PENCIL_TOOLS);

    expect(classification.namespace).toBe("pencil");
    expect(classification.canonicalCapability).toBe("design_workspace");
    expect(classification.capabilitySource).toBe("heuristic");
    expect(classification.confidence).toBeGreaterThan(0);
    expect(classification.runnerUp).toBeDefined();
    expect(classification.facets).toEqual(
      expect.arrayContaining([
        "design_workspace",
        "layout_analysis",
        "design_tokens",
        "design_to_code",
      ]),
    );
    expect(classification.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "namespace_hint",
          target: "design_workspace",
        }),
        expect.objectContaining({
          source: "tool_signal",
          target: "design_workspace",
        }),
      ]),
    );
  });

  test("respects capability and facet overrides with explicit source metadata", () => {
    const classification = classifyNamespace("pencil", PENCIL_TOOLS, {
      capabilityOverrides: { pencil: "general" },
      capabilityOverrideSources: { pencil: "user_override" },
      facetOverrides: { pencil: ["custom_workspace"] },
    });

    expect(classification.canonicalCapability).toBe("general");
    expect(classification.capabilitySource).toBe("user_override");
    expect(classification.facets).toEqual(
      expect.arrayContaining(["design_workspace", "custom_workspace"]),
    );
    expect(classification.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "user_override",
          target: "general",
        }),
      ]),
    );
  });
});

describe("adapter projection", () => {
  test("can project a canonical design_workspace classification away from screenshot-analysis design buckets", () => {
    const classification = classifyNamespace("pencil", PENCIL_TOOLS);

    const projection = projectNamespaceClassification(
      "gateway",
      classification,
      {
        mode: "projected",
        fallbackBucket: "general",
        capabilities: [
          {
            id: "design",
            title: "Design Analysis",
            summary: "Analyze screenshots, diagrams, and visual diffs.",
            acceptsCanonical: ["design", "browser_automation", "research"],
            prefersFacets: [
              "vision_analysis",
              "ocr",
              "diagram_understanding",
              "ui_diff",
            ],
            rejectsFacets: [
              "design_workspace",
              "design_tokens",
              "design_to_code",
            ],
          },
          {
            id: "general",
            title: "General",
            summary: "Fallback bucket for tools that do not map cleanly.",
            acceptsCanonical: [
              "general",
              "design",
              "design_workspace",
              "docs",
              "research",
            ],
          },
        ],
      },
    );

    expect(projection.bucket).toBe("general");
    expect(projection.adapterId).toBe("gateway");
    expect(projection.reason).toContain("matched adapter profile");
  });
});

describe("semantic classifier", () => {
  function normalizedVector(values: number[]): Float32Array {
    const vec = new Float32Array(values);
    let norm = 0;
    for (const value of vec) {
      norm += value * value;
    }
    const mag = Math.sqrt(norm);
    for (let i = 0; i < vec.length; i++) {
      const value = vec[i] ?? 0;
      vec[i] = value / mag;
    }
    return vec;
  }

  test("classifies Pencil-like tools as design_workspace in semantic mode", async () => {
    const designWorkspaceVector = normalizedVector([1, 0, 0, 0]);
    const designVector = normalizedVector([0, 1, 0, 0]);
    const otherVector = normalizedVector([0, 0, 1, 0]);

    const fakeGenerator = {
      async embedBatch(texts: string[]) {
        return {
          embeddings: texts.map((text) => {
            if (text.includes("structured design workspace files")) {
              return designWorkspaceVector;
            }
            if (text.includes("visual design artifacts")) {
              return designVector;
            }
            return otherVector;
          }),
          dimensions: 4,
          inferenceMs: 0,
          avgPerEmbeddingMs: 0,
        };
      },
      async embed(text: string) {
        return {
          embedding:
            text.includes(".pen") || text.includes("batch_design")
              ? designWorkspaceVector
              : otherVector,
          dimensions: 4,
          inferenceMs: 0,
        };
      },
    } as unknown as EmbeddingGenerator;

    const classifier = new SemanticCapabilityClassifier(fakeGenerator, {
      confidenceThreshold: 0,
    });
    await classifier.initializeReferences();

    const result = await classifier.classify("pencil", PENCIL_TOOLS);

    expect(result.capability).toBe("design_workspace");
  });
});
