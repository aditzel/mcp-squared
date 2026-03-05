import { describe, expect, test } from "bun:test";
import type { CapabilityRouter } from "@/capabilities/routing";
import type { CatalogedTool } from "@/upstream/cataloger";
import {
  CHARS_PER_TOKEN_ESTIMATE,
  computeContextStats,
  estimateTokens,
} from "@/utils/context-stats";

describe("estimateTokens", () => {
  test("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("uses 4 chars per token heuristic", () => {
    expect(CHARS_PER_TOKEN_ESTIMATE).toBe(4);
    // 12 chars → ceil(12/4) = 3 tokens
    expect(estimateTokens("hello world!")).toBe(3);
  });

  test("rounds up partial tokens", () => {
    // 5 chars → ceil(5/4) = 2 tokens
    expect(estimateTokens("hello")).toBe(2);
    // 1 char → ceil(1/4) = 1 token
    expect(estimateTokens("x")).toBe(1);
  });

  test("handles long strings", () => {
    const text = "a".repeat(1000);
    expect(estimateTokens(text)).toBe(250);
  });
});

describe("computeContextStats", () => {
  function makeTool(
    name: string,
    description: string,
    properties: Record<string, unknown> = {},
  ): CatalogedTool {
    return {
      name,
      description,
      inputSchema: { type: "object", properties },
      serverKey: "test",
    };
  }

  function makeRouter(
    capability: string,
    actionNames: string[],
  ): CapabilityRouter {
    return {
      capability,
      actions: actionNames.map((action) => ({
        capability,
        action,
        baseAction: action,
        serverKey: "test",
        toolName: action,
        qualifiedName: `test:${action}`,
        inputSchema: { type: "object" as const },
        summary: `Do ${action}`,
      })),
    };
  }

  test("returns zeros for empty inputs", () => {
    const stats = computeContextStats([], []);
    expect(stats.withoutMcp2Tokens).toBe(0);
    expect(stats.withMcp2Tokens).toBe(0);
    expect(stats.savedTokens).toBe(0);
    expect(stats.savedPercent).toBe(0);
    expect(stats.upstreamToolCount).toBe(0);
    expect(stats.capabilityToolCount).toBe(0);
  });

  test("counts upstream tools correctly", () => {
    const tools: CatalogedTool[] = [
      makeTool("search", "Search code", { query: { type: "string" } }),
      makeTool("index", "Index code", { path: { type: "string" } }),
    ];

    const stats = computeContextStats(tools, []);
    expect(stats.upstreamToolCount).toBe(2);
    expect(stats.withoutMcp2Tokens).toBeGreaterThan(0);
    // No routers → 0 capability tokens
    expect(stats.withMcp2Tokens).toBe(0);
    expect(stats.capabilityToolCount).toBe(0);
  });

  test("counts capability tools correctly", () => {
    const tools: CatalogedTool[] = [
      makeTool("search", "Search code", { query: { type: "string" } }),
    ];
    const routers = [makeRouter("code_search", ["search"])];

    const stats = computeContextStats(tools, routers);
    expect(stats.capabilityToolCount).toBe(1);
    expect(stats.withMcp2Tokens).toBeGreaterThan(0);
  });

  test("skips routers with no actions", () => {
    const tools: CatalogedTool[] = [
      makeTool("search", "Search code", { query: { type: "string" } }),
    ];
    const routers = [
      makeRouter("code_search", ["search"]),
      makeRouter("empty_cap", []),
    ];

    const stats = computeContextStats(tools, routers);
    expect(stats.capabilityToolCount).toBe(1);
  });

  test("computes savings correctly with realistic tool count", () => {
    // Simulate a realistic scenario: 10+ upstream tools → 2 capability tools
    const tools: CatalogedTool[] = [];
    for (let i = 0; i < 12; i++) {
      tools.push(
        makeTool(
          `tool_${i}`,
          `This is a detailed description for tool ${i} that explains what it does and how to use it with various parameters`,
          {
            query: { type: "string", description: "The search query to run" },
            limit: {
              type: "number",
              description: "Maximum number of results to return",
            },
            filter: {
              type: "string",
              description: "Optional filter expression",
            },
            verbose: {
              type: "boolean",
              description: "Whether to include verbose output",
            },
          },
        ),
      );
    }
    const routers = [
      makeRouter(
        "code_search",
        tools.slice(0, 6).map((t) => t.name),
      ),
      makeRouter(
        "research",
        tools.slice(6).map((t) => t.name),
      ),
    ];

    const stats = computeContextStats(tools, routers);

    // Savings must be positive: many tools with schemas → fewer tools with fixed schema
    expect(stats.savedTokens).toBeGreaterThan(0);
    expect(stats.savedPercent).toBeGreaterThan(0);
    expect(stats.savedPercent).toBeLessThanOrEqual(100);

    // Arithmetic consistency
    expect(stats.savedTokens).toBe(
      stats.withoutMcp2Tokens - stats.withMcp2Tokens,
    );

    // Tool counts
    expect(stats.upstreamToolCount).toBe(12);
    expect(stats.capabilityToolCount).toBe(2);
  });

  test("small tool count may show negative savings", () => {
    // With very few simple tools, capability overhead can exceed raw cost
    const tools: CatalogedTool[] = [
      makeTool("tiny", "X", { a: { type: "string" } }),
    ];
    const routers = [makeRouter("general", ["tiny"])];

    const stats = computeContextStats(tools, routers);

    // Arithmetic is still consistent regardless of direction
    expect(stats.savedTokens).toBe(
      stats.withoutMcp2Tokens - stats.withMcp2Tokens,
    );
  });

  test("is deterministic", () => {
    const tools: CatalogedTool[] = [
      makeTool("tool_a", "Does A", { x: { type: "string" } }),
    ];
    const routers = [makeRouter("general", ["tool_a"])];

    const stats1 = computeContextStats(tools, routers);
    const stats2 = computeContextStats(tools, routers);

    expect(stats1).toEqual(stats2);
  });

  test("savedPercent has one decimal place", () => {
    const tools: CatalogedTool[] = [
      makeTool("t1", "Tool 1", { a: { type: "string" } }),
      makeTool("t2", "Tool 2", { b: { type: "string" } }),
    ];
    const routers = [makeRouter("general", ["t1", "t2"])];

    const stats = computeContextStats(tools, routers);
    // Percentage should be rounded to 1 decimal
    const decimalStr = stats.savedPercent.toString();
    const parts = decimalStr.split(".");
    if (parts.length > 1) {
      expect(parts[1].length).toBeLessThanOrEqual(1);
    }
  });
});
