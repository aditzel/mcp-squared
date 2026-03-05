/**
 * Context window savings estimation.
 *
 * Computes the token cost of all raw upstream tool definitions ("Without MCP²")
 * versus the consolidated capability router tools ("With MCP²"), then reports
 * the savings.
 *
 * Uses the same 4-chars-per-token heuristic established in
 * tests/tool-surface-context-window.test.ts.
 *
 * @module utils/context-stats
 */

import type { CapabilityRouter } from "../capabilities/routing.js";
import type { CatalogedTool } from "../upstream/cataloger.js";
import { capabilitySummary, capabilityTitle } from "./capability-meta.js";

/** Approximate characters per token for estimation. */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Aggregate context-window savings data. */
export interface ContextStats {
  /** Estimated tokens if all upstream tools were listed directly. */
  withoutMcp2Tokens: number;
  /** Estimated tokens for the MCP² capability tools. */
  withMcp2Tokens: number;
  /** Tokens saved (withoutMcp2Tokens - withMcp2Tokens). */
  savedTokens: number;
  /** Savings as a percentage (0–100). */
  savedPercent: number;
  /** Total number of raw upstream tools. */
  upstreamToolCount: number;
  /** Number of capability tools exposed to the client. */
  capabilityToolCount: number;
}

/**
 * Estimates the number of tokens in a text string.
 *
 * Uses a simple heuristic of `ceil(length / 4)`.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Reconstructs the JSON-serialized tool metadata that a single capability
 * router would contribute to a `tools/list` response.
 *
 * This mirrors the structure created by `McpSquaredServer.registerCapabilityRouters()`.
 */
function reconstructCapabilityToolMetadata(
  router: CapabilityRouter,
): Record<string, unknown> {
  return {
    name: router.capability,
    title: capabilityTitle(router.capability),
    description: capabilitySummary(router.capability),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: `Action ID for ${router.capability}. Use "__describe_actions" to inspect available actions and schemas.`,
        },
        arguments: {
          type: "object",
          additionalProperties: {},
          default: {},
          description: "Arguments for the selected capability action",
        },
        confirmation_token: {
          type: "string",
          description:
            "Optional confirmation token for actions that require explicit confirmation",
        },
      },
      required: ["action"],
    },
  };
}

/**
 * Computes context-window savings by comparing token costs of raw upstream
 * tools against the consolidated capability tools.
 *
 * @param upstreamTools - All tools from connected upstream servers
 * @param routers - Capability routers that would replace the raw tools
 * @returns Savings statistics
 */
export function computeContextStats(
  upstreamTools: CatalogedTool[],
  routers: CapabilityRouter[],
): ContextStats {
  // "Without MCP²": each upstream tool as it would appear in tools/list
  const withoutTokens = upstreamTools.reduce((sum, tool) => {
    const serialized = JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
    return sum + estimateTokens(serialized);
  }, 0);

  // "With MCP²": each capability router as a single tool
  const activeRouters = routers.filter((r) => r.actions.length > 0);
  const withTokens = activeRouters.reduce((sum, router) => {
    const meta = reconstructCapabilityToolMetadata(router);
    return sum + estimateTokens(JSON.stringify(meta));
  }, 0);

  const saved = withoutTokens - withTokens;
  const percent = withoutTokens > 0 ? (saved / withoutTokens) * 100 : 0;

  return {
    withoutMcp2Tokens: withoutTokens,
    withMcp2Tokens: withTokens,
    savedTokens: saved,
    savedPercent: Math.round(percent * 10) / 10, // one decimal place
    upstreamToolCount: upstreamTools.length,
    capabilityToolCount: activeRouters.length,
  };
}
