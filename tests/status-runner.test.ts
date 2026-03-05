import { describe, expect, test } from "bun:test";
import type { CapabilityRouter } from "@/capabilities/routing";
import type { StatusResult, UpstreamStatus } from "@/status/runner";
import { formatStatus } from "@/status/runner";
import type { ContextStats } from "@/utils/context-stats";

/**
 * Strips ANSI escape codes from a string for assertion matching.
 */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI stripping
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeUpstream(
  overrides: Partial<UpstreamStatus> & { name: string },
): UpstreamStatus {
  return {
    enabled: true,
    status: "connected",
    toolCount: 0,
    ...overrides,
  };
}

describe("formatStatus", () => {
  test("shows header", () => {
    const result: StatusResult = { upstreams: [], routers: [] };
    const output = formatStatus(result, { verbose: false });
    expect(stripAnsi(output)).toContain("MCP² Status Report");
  });

  test("shows empty state when no upstreams configured", () => {
    const result: StatusResult = { upstreams: [], routers: [] };
    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).toContain("(no upstreams configured)");
  });

  test("shows connected upstream with tool count", () => {
    const result: StatusResult = {
      upstreams: [
        makeUpstream({
          name: "github",
          status: "connected",
          toolCount: 12,
          serverVersion: "1.0.0",
        }),
      ],
      routers: [],
    };
    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).toContain("✓");
    expect(output).toContain("github");
    expect(output).toContain("connected");
    expect(output).toContain("(12 tools)");
    expect(output).toContain("v1.0.0");
  });

  test("shows single tool without plural", () => {
    const result: StatusResult = {
      upstreams: [
        makeUpstream({
          name: "simple",
          status: "connected",
          toolCount: 1,
        }),
      ],
      routers: [],
    };
    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).toContain("(1 tool)");
    expect(output).not.toContain("(1 tools)");
  });

  test("shows disabled upstream with ⊘", () => {
    const result: StatusResult = {
      upstreams: [
        makeUpstream({
          name: "sentry",
          enabled: false,
          status: "disconnected",
        }),
      ],
      routers: [],
    };
    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).toContain("⊘");
    expect(output).toContain("sentry");
    expect(output).toContain("disabled");
  });

  test("shows error upstream with ✗ and error message", () => {
    const result: StatusResult = {
      upstreams: [
        makeUpstream({
          name: "notion",
          status: "error",
          error: "Connection refused",
        }),
      ],
      routers: [],
    };
    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).toContain("✗");
    expect(output).toContain("notion");
    expect(output).toContain("error");
    expect(output).toContain("Connection refused");
  });

  test("shows needs_auth upstream with ⚠ and auth message", () => {
    const result: StatusResult = {
      upstreams: [
        makeUpstream({
          name: "vercel",
          status: "needs_auth",
          error: 'Streamable HTTP error: {"error":"invalid_token"}',
        }),
      ],
      routers: [],
    };
    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).toContain("⚠");
    expect(output).toContain("vercel");
    expect(output).toContain("needs auth");
    expect(output).toContain("invalid_token");
    expect(output).not.toContain("✗");
  });

  test("summary counts needs_auth separately from errors", () => {
    const result: StatusResult = {
      upstreams: [
        makeUpstream({ name: "a", status: "connected", toolCount: 1 }),
        makeUpstream({
          name: "b",
          status: "needs_auth",
          error: "No token provided",
        }),
        makeUpstream({ name: "c", status: "error", error: "timeout" }),
        makeUpstream({
          name: "d",
          enabled: false,
          status: "disconnected",
        }),
      ],
      routers: [],
    };
    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).toContain("1 connected");
    expect(output).toContain("1 needs auth");
    expect(output).toContain("1 error");
    expect(output).toContain("1 disabled");
  });

  test("shows capability routing table", () => {
    const routers: CapabilityRouter[] = [
      {
        capability: "code_search",
        actions: [
          {
            capability: "code_search",
            action: "search_context",
            baseAction: "search_context",
            serverKey: "github",
            toolName: "search",
            qualifiedName: "github:search",
            inputSchema: { type: "object" },
            summary: "Search code",
          },
        ],
      },
      {
        capability: "research",
        actions: [
          {
            capability: "research",
            action: "firecrawl_scrape",
            baseAction: "firecrawl_scrape",
            serverKey: "firecrawl",
            toolName: "firecrawl_scrape",
            qualifiedName: "firecrawl:firecrawl_scrape",
            inputSchema: { type: "object" },
            summary: "Scrape a URL",
          },
          {
            capability: "research",
            action: "firecrawl_map",
            baseAction: "firecrawl_map",
            serverKey: "firecrawl",
            toolName: "firecrawl_map",
            qualifiedName: "firecrawl:firecrawl_map",
            inputSchema: { type: "object" },
            summary: "Map a website",
          },
        ],
      },
    ];

    const result: StatusResult = {
      upstreams: [
        makeUpstream({ name: "github", status: "connected", toolCount: 1 }),
        makeUpstream({ name: "firecrawl", status: "connected", toolCount: 2 }),
      ],
      routers,
    };

    const output = stripAnsi(formatStatus(result, { verbose: false }));

    // Capability headers
    expect(output).toContain("code_search (1 action)");
    expect(output).toContain("research (2 actions)");

    // Action mappings
    expect(output).toContain("search_context");
    expect(output).toContain("→ github:search");
    expect(output).toContain("firecrawl_scrape");
    expect(output).toContain("→ firecrawl:firecrawl_scrape");
    expect(output).toContain("firecrawl_map");
    expect(output).toContain("→ firecrawl:firecrawl_map");
  });

  test("shows no routing when no connected upstreams", () => {
    const result: StatusResult = {
      upstreams: [
        makeUpstream({ name: "broken", status: "error", error: "timeout" }),
      ],
      routers: [],
    };
    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).toContain(
      "(no capabilities routed — no connected upstreams)",
    );
  });

  test("shows summary counts", () => {
    const result: StatusResult = {
      upstreams: [
        makeUpstream({ name: "a", status: "connected", toolCount: 3 }),
        makeUpstream({ name: "b", status: "error", error: "fail" }),
        makeUpstream({
          name: "c",
          enabled: false,
          status: "disconnected",
        }),
      ],
      routers: [
        {
          capability: "general",
          actions: [
            {
              capability: "general",
              action: "do_something",
              baseAction: "do_something",
              serverKey: "a",
              toolName: "do_something",
              qualifiedName: "a:do_something",
              inputSchema: { type: "object" },
              summary: "Do something",
            },
          ],
        },
      ],
    };

    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).toContain("1 connected");
    expect(output).toContain("1 error");
    expect(output).toContain("1 disabled");
    expect(output).toContain("1 action across 1 capability");
  });

  test("verbose mode shows input schema parameter names", () => {
    const routers: CapabilityRouter[] = [
      {
        capability: "research",
        actions: [
          {
            capability: "research",
            action: "web_search",
            baseAction: "web_search",
            serverKey: "exa",
            toolName: "web_search_exa",
            qualifiedName: "exa:web_search_exa",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
                numResults: { type: "number" },
              },
            },
            summary: "Search the web",
          },
        ],
      },
    ];

    const result: StatusResult = {
      upstreams: [
        makeUpstream({ name: "exa", status: "connected", toolCount: 1 }),
      ],
      routers,
    };

    const output = stripAnsi(formatStatus(result, { verbose: true }));
    expect(output).toContain("(query, numResults)");
  });

  test("non-verbose mode omits schema parameters", () => {
    const routers: CapabilityRouter[] = [
      {
        capability: "research",
        actions: [
          {
            capability: "research",
            action: "web_search",
            baseAction: "web_search",
            serverKey: "exa",
            toolName: "web_search_exa",
            qualifiedName: "exa:web_search_exa",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
                numResults: { type: "number" },
              },
            },
            summary: "Search the web",
          },
        ],
      },
    ];

    const result: StatusResult = {
      upstreams: [
        makeUpstream({ name: "exa", status: "connected", toolCount: 1 }),
      ],
      routers,
    };

    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).not.toContain("(query, numResults)");
  });

  test("summary pluralizes correctly for multiple actions", () => {
    const routers: CapabilityRouter[] = [
      {
        capability: "code_search",
        actions: [
          {
            capability: "code_search",
            action: "a",
            baseAction: "a",
            serverKey: "s",
            toolName: "a",
            qualifiedName: "s:a",
            inputSchema: { type: "object" },
            summary: "A",
          },
          {
            capability: "code_search",
            action: "b",
            baseAction: "b",
            serverKey: "s",
            toolName: "b",
            qualifiedName: "s:b",
            inputSchema: { type: "object" },
            summary: "B",
          },
        ],
      },
      {
        capability: "research",
        actions: [
          {
            capability: "research",
            action: "c",
            baseAction: "c",
            serverKey: "r",
            toolName: "c",
            qualifiedName: "r:c",
            inputSchema: { type: "object" },
            summary: "C",
          },
        ],
      },
    ];

    const result: StatusResult = {
      upstreams: [
        makeUpstream({ name: "s", status: "connected", toolCount: 2 }),
        makeUpstream({ name: "r", status: "connected", toolCount: 1 }),
      ],
      routers,
    };

    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).toContain("3 actions across 2 capabilities");
  });

  test("verbose mode shows context savings stats", () => {
    const contextStats: ContextStats = {
      withoutMcp2Tokens: 8432,
      withMcp2Tokens: 391,
      savedTokens: 8041,
      savedPercent: 95.4,
      upstreamToolCount: 47,
      capabilityToolCount: 11,
    };

    const result: StatusResult = {
      upstreams: [
        makeUpstream({ name: "github", status: "connected", toolCount: 5 }),
      ],
      routers: [],
      contextStats,
    };

    const output = stripAnsi(formatStatus(result, { verbose: true }));

    expect(output).toContain("Context Savings");
    expect(output).toContain("Without MCP");
    expect(output).toContain("8,432 tokens");
    expect(output).toContain("(47 tools)");
    expect(output).toContain("With MCP");
    expect(output).toContain("391 tokens");
    expect(output).toContain("(11 tools)");
    expect(output).toContain("Saved:");
    expect(output).toContain("8,041 tokens");
    expect(output).toContain("95.4%");
  });

  test("non-verbose mode omits context savings", () => {
    const contextStats: ContextStats = {
      withoutMcp2Tokens: 1000,
      withMcp2Tokens: 200,
      savedTokens: 800,
      savedPercent: 80,
      upstreamToolCount: 10,
      capabilityToolCount: 2,
    };

    const result: StatusResult = {
      upstreams: [
        makeUpstream({ name: "a", status: "connected", toolCount: 5 }),
      ],
      routers: [],
      contextStats,
    };

    const output = stripAnsi(formatStatus(result, { verbose: false }));
    expect(output).not.toContain("Context Savings");
    expect(output).not.toContain("Without MCP");
  });

  test("verbose mode omits context savings when no upstream tools", () => {
    const contextStats: ContextStats = {
      withoutMcp2Tokens: 0,
      withMcp2Tokens: 0,
      savedTokens: 0,
      savedPercent: 0,
      upstreamToolCount: 0,
      capabilityToolCount: 0,
    };

    const result: StatusResult = {
      upstreams: [],
      routers: [],
      contextStats,
    };

    const output = stripAnsi(formatStatus(result, { verbose: true }));
    expect(output).not.toContain("Context Savings");
  });

  test("verbose mode omits saved line when no positive savings", () => {
    const contextStats: ContextStats = {
      withoutMcp2Tokens: 50,
      withMcp2Tokens: 200,
      savedTokens: -150,
      savedPercent: -300,
      upstreamToolCount: 1,
      capabilityToolCount: 1,
    };

    const result: StatusResult = {
      upstreams: [
        makeUpstream({ name: "a", status: "connected", toolCount: 1 }),
      ],
      routers: [],
      contextStats,
    };

    const output = stripAnsi(formatStatus(result, { verbose: true }));
    expect(output).toContain("Context Savings");
    expect(output).toContain("Without MCP");
    expect(output).not.toContain("Saved:");
  });
});
