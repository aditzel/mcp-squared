/**
 * Component test: official Figma MCP server classification.
 *
 * Uses a captured fixture from Figma's official MCP tools documentation:
 * https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/
 *
 * The Figma MCP server is workspace/editor oriented: design context, variables,
 * Code Connect mappings, metadata, and FigJam operations. It should land in the
 * canonical `design_workspace` bucket, not generic visual `design`.
 */
import { describe, expect, test } from "bun:test";
import {
  classifyNamespace,
  groupNamespacesByCapability,
  inferNamespaceCapability,
  type NamespaceToolMetadata,
} from "@/capabilities/inference";
import figmaFixture from "./fixtures/figma-mcp-tools.json";

const FIGMA_TOOLS = figmaFixture.tools as NamespaceToolMetadata[];

describe("figma classification", () => {
  test("official Figma MCP fixture is classified as design_workspace", () => {
    const capability = inferNamespaceCapability("figma", FIGMA_TOOLS);
    expect(capability).toBe("design_workspace");
  });

  test("rich classification keeps Figma in design_workspace with workspace facets", () => {
    const classification = classifyNamespace("figma", FIGMA_TOOLS);

    expect(classification.canonicalCapability).toBe("design_workspace");
    expect(classification.capabilitySource).toBe("heuristic");
    expect(classification.facets).toEqual(
      expect.arrayContaining([
        "design_workspace",
        "design_tokens",
        "design_to_code",
        "layout_analysis",
      ]),
    );
  });

  test("grouping places Figma under the design_workspace router", () => {
    const grouping = groupNamespacesByCapability(
      [{ namespace: "figma", tools: FIGMA_TOOLS }],
      {},
    );

    expect(grouping.byNamespace["figma"]).toBe("design_workspace");
    expect(grouping.grouped.design_workspace).toContain("figma");
    expect(grouping.grouped.design).not.toContain("figma");
  });
});
