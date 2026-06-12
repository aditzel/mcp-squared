import { afterEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "../src/config/schema.js";
import { clearPendingConfirmations } from "../src/security/index.js";
import {
  executeCapabilityTool,
  normalizeToolResultContent,
} from "../src/server/capability-tool-executor.js";
import {
  DEFAULT_RESPONSE_RESOURCE_CONFIG,
  ResponseResourceManager,
} from "../src/server/response-resource.js";

function makeConfig(
  overrides: Partial<McpSquaredConfig> = {},
): McpSquaredConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    operations: {
      ...DEFAULT_CONFIG.operations,
      ...(overrides.operations ?? {}),
    },
    security: {
      ...DEFAULT_CONFIG.security,
      ...(overrides.security ?? {}),
      tools: {
        ...DEFAULT_CONFIG.security.tools,
        ...(overrides.security?.tools ?? {}),
      },
    },
  };
}

function makeResponseResourceManager(enabled = false): ResponseResourceManager {
  return new ResponseResourceManager({
    ...DEFAULT_RESPONSE_RESOURCE_CONFIG,
    enabled,
    thresholdBytes: 64,
  });
}

afterEach(() => {
  clearPendingConfirmations();
});

describe("normalizeToolResultContent", () => {
  test("stringifies non-text entries", () => {
    expect(normalizeToolResultContent([{ ok: true }, 42])).toEqual([
      { type: "text", text: JSON.stringify({ ok: true }) },
      { type: "text", text: JSON.stringify(42) },
    ]);
  });
});

describe("executeCapabilityTool", () => {
  test("returns blocked payload without calling the upstream tool", async () => {
    const callTool = mock(async () => ({
      content: [{ type: "text", text: "should not run" }],
      isError: false,
    }));
    const enforceGuard = mock(() => {});

    const result = await executeCapabilityTool({
      capability: "general",
      action: "delete_file",
      toolNameForCall: "github:delete_file",
      args: {},
      config: makeConfig({
        security: {
          ...DEFAULT_CONFIG.security,
          tools: {
            allow: [],
            block: ["general:delete_file"],
            confirm: [],
          },
        },
      }),
      responseResourceManager: makeResponseResourceManager(),
      enforceGuard,
      callTool,
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "Action blocked by security policy",
      blocked: true,
    });
    expect(enforceGuard).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  test("returns confirmation payload until a valid confirmation token is provided", async () => {
    const callTool = mock(async () => ({
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      isError: false,
    }));
    const enforceGuard = mock(() => {});
    const config = makeConfig({
      security: {
        ...DEFAULT_CONFIG.security,
        tools: {
          allow: [],
          block: [],
          confirm: ["code_search:codebase_retrieval"],
        },
      },
    });

    const first = await executeCapabilityTool({
      capability: "code_search",
      action: "codebase_retrieval",
      toolNameForCall: "auggie:codebase-retrieval",
      args: { query: "auth" },
      config,
      responseResourceManager: makeResponseResourceManager(),
      enforceGuard,
      callTool,
    });
    const token = JSON.parse(first.content[0]?.text ?? "{}")[
      "confirmation_token"
    ];

    expect(first.isError).toBe(false);
    expect(typeof token).toBe("string");
    expect(callTool).not.toHaveBeenCalled();

    const second = await executeCapabilityTool({
      capability: "code_search",
      action: "codebase_retrieval",
      toolNameForCall: "auggie:codebase-retrieval",
      args: { query: "auth" },
      confirmationToken: token,
      config,
      responseResourceManager: makeResponseResourceManager(),
      enforceGuard,
      callTool,
    });

    expect(second.isError).toBe(false);
    expect(callTool).toHaveBeenCalledWith("auggie:codebase-retrieval", {
      query: "auth",
    });
  });

  test("tracks successful selections and preserves structured content on inline responses", async () => {
    const onSuccessfulSelection = mock(() => {});
    const enforceGuard = mock(() => {});

    const result = await executeCapabilityTool({
      capability: "docs",
      action: "fetch_url",
      routeId: "docs:fetch_url",
      toolNameForCall: "docs:fetch_url",
      args: { url: "https://example.com" },
      config: makeConfig({
        security: {
          ...DEFAULT_CONFIG.security,
          tools: { allow: ["docs:fetch_url"], block: [], confirm: [] },
        },
      }),
      responseResourceManager: makeResponseResourceManager(),
      enforceGuard,
      callTool: async () => ({
        content: [{ type: "text", text: "summary" }],
        structuredContent: { url: "https://example.com" },
        isError: false,
      }),
      onSuccessfulSelection,
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "summary" }],
      isError: false,
      structuredContent: { url: "https://example.com" },
    });
    expect(enforceGuard).toHaveBeenCalledWith({
      tool: "docs:fetch_url",
      action: "call",
      params: { url: "https://example.com" },
    });
    expect(onSuccessfulSelection).toHaveBeenCalledWith("docs:fetch_url");
  });

  test("offloads large successful responses and falls back to inline when offload fails", async () => {
    const config = makeConfig({
      security: {
        ...DEFAULT_CONFIG.security,
        tools: { allow: ["research:collect"], block: [], confirm: [] },
      },
    });
    const largeText = "x".repeat(200);

    const offloaded = await executeCapabilityTool({
      capability: "research",
      action: "collect",
      toolNameForCall: "research:collect",
      args: {},
      config,
      responseResourceManager: makeResponseResourceManager(true),
      enforceGuard: () => {},
      callTool: async () => ({
        content: [{ type: "text", text: largeText }],
        isError: false,
      }),
    });

    expect(offloaded.content[0]?.text).toContain("mcp2://response/research/");
    expect(offloaded.isError).toBe(false);

    const brokenManager = makeResponseResourceManager(true);
    const originalOffload = brokenManager.offload.bind(brokenManager);
    brokenManager.offload = (() => {
      throw new Error("boom");
    }) as typeof brokenManager.offload;

    const inlineFallback = await executeCapabilityTool({
      capability: "research",
      action: "collect",
      toolNameForCall: "research:collect",
      args: {},
      config,
      responseResourceManager: brokenManager,
      enforceGuard: () => {},
      callTool: async () => ({
        content: [{ type: "text", text: largeText }],
        isError: false,
      }),
    });

    expect(inlineFallback.content).toEqual([{ type: "text", text: largeText }]);
    brokenManager.offload = originalOffload;
  });
});
