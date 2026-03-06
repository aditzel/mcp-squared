import { describe, expect, test } from "bun:test";
import type { NamespaceInventory } from "@/capabilities/inference";
import { groupNamespacesByCapability } from "@/capabilities/inference";
import { buildCapabilityRouters, toActionToken } from "@/capabilities/routing";

describe("toActionToken", () => {
  test("normalizes simple names", () => {
    expect(toActionToken("myTool")).toBe("mytool");
  });

  test("replaces non-alphanumeric with underscores", () => {
    expect(toActionToken("my-tool-name")).toBe("my_tool_name");
  });

  test("strips leading/trailing underscores", () => {
    expect(toActionToken("__foo__")).toBe("foo");
  });

  test("collapses multiple underscores", () => {
    expect(toActionToken("foo___bar")).toBe("foo_bar");
  });

  test("returns 'tool' for empty result", () => {
    expect(toActionToken("---")).toBe("tool");
    expect(toActionToken("")).toBe("tool");
  });
});

describe("buildCapabilityRouters", () => {
  test("returns empty array for no inventories", () => {
    const grouping = { byNamespace: {}, grouped: {} as never };
    const result = buildCapabilityRouters([], grouping);
    expect(result).toEqual([]);
  });

  test("builds routers from single namespace", () => {
    const inventories: NamespaceInventory[] = [
      {
        namespace: "github",
        tools: [
          {
            name: "search",
            description: "Search code",
            inputSchema: { type: "object" },
          },
          {
            name: "list_repos",
            description: "List repos",
            inputSchema: { type: "object" },
          },
        ],
      },
    ];

    const grouping = groupNamespacesByCapability(inventories);
    const routers = buildCapabilityRouters(inventories, grouping);

    expect(routers.length).toBeGreaterThan(0);
    const allActions = routers.flatMap((r) => r.actions);
    expect(allActions.length).toBe(2);

    const searchAction = allActions.find((a) => a.toolName === "search");
    expect(searchAction).toBeDefined();
    expect(searchAction?.qualifiedName).toBe("github:search");
  });

  test("disambiguates colliding action names across namespaces", () => {
    const inventories: NamespaceInventory[] = [
      {
        namespace: "server-a",
        title: "Server A",
        tools: [
          {
            name: "do_search",
            description: "Search A",
            inputSchema: { type: "object" },
          },
        ],
      },
      {
        namespace: "server-b",
        title: "Server B",
        tools: [
          {
            name: "do_search",
            description: "Search B",
            inputSchema: { type: "object" },
          },
        ],
      },
    ];

    // Force both to the same capability
    const grouping = groupNamespacesByCapability(inventories, {
      "server-a": "general",
      "server-b": "general",
    });
    const routers = buildCapabilityRouters(inventories, grouping);

    const generalRouter = routers.find((r) => r.capability === "general");
    expect(generalRouter).toBeDefined();

    const actions = generalRouter?.actions ?? [];
    expect(actions.length).toBe(2);

    // Canonical IDs should be stable and derived from the instance key.
    const actionNames = actions.map((a) => a.action).sort();
    expect(actionNames).toEqual(["do_search__server_a", "do_search__server_b"]);

    expect(actions[0]?.baseAction).toBe("do_search");
    expect(actions[1]?.baseAction).toBe("do_search");
    expect(actions.every((a) => a.instanceKey != null)).toBe(true);
    expect(actions.every((a) => a.instanceTitle != null)).toBe(true);
  });

  test("uses numeric suffixes only for same-instance normalized collisions", () => {
    const inventories: NamespaceInventory[] = [
      {
        namespace: "misc",
        title: "Misc",
        tools: [
          {
            name: "foo-bar",
            description: "First variant",
            inputSchema: { type: "object" },
          },
          {
            name: "foo_bar",
            description: "Second variant",
            inputSchema: { type: "object" },
          },
        ],
      },
    ];

    const grouping = groupNamespacesByCapability(inventories, {
      misc: "general",
    });
    const routers = buildCapabilityRouters(inventories, grouping);
    const generalRouter = routers.find((r) => r.capability === "general");
    expect(generalRouter).toBeDefined();

    const actionNames = (generalRouter?.actions ?? [])
      .map((a) => a.action)
      .sort();
    expect(actionNames).toEqual(["foo_bar__misc", "foo_bar__misc__2"]);
  });

  test("deduplicates mixed inter-instance and intra-instance collisions globally", () => {
    const inventories: NamespaceInventory[] = [
      {
        namespace: "alpha",
        title: "Alpha",
        tools: [
          {
            name: "foo-bar",
            description: "Alpha primary",
            inputSchema: { type: "object" },
          },
          {
            name: "foo_bar",
            description: "Alpha secondary",
            inputSchema: { type: "object" },
          },
        ],
      },
      {
        namespace: "alpha-",
        title: "Alpha Dash",
        tools: [
          {
            name: "foo_bar",
            description: "Alpha dash primary",
            inputSchema: { type: "object" },
          },
        ],
      },
    ];

    const grouping = groupNamespacesByCapability(inventories, {
      alpha: "general",
      "alpha-": "general",
    });
    const routers = buildCapabilityRouters(inventories, grouping);
    const generalRouter = routers.find((r) => r.capability === "general");
    expect(generalRouter).toBeDefined();

    const actionNames = (generalRouter?.actions ?? [])
      .map((a) => a.action)
      .sort();
    expect(actionNames).toEqual([
      "foo_bar__alpha",
      "foo_bar__alpha__2",
      "foo_bar__alpha__3",
    ]);
    expect(new Set(actionNames).size).toBe(actionNames.length);
  });

  test("routes are sorted by capability then action", () => {
    const inventories: NamespaceInventory[] = [
      {
        namespace: "time-server",
        tools: [
          {
            name: "get_current_time",
            description: "Get current time",
            inputSchema: { type: "object" },
          },
        ],
      },
      {
        namespace: "code-search",
        tools: [
          {
            name: "search_codebase",
            description: "Search codebase for symbols",
            inputSchema: { type: "object" },
          },
        ],
      },
    ];

    const grouping = groupNamespacesByCapability(inventories);
    const routers = buildCapabilityRouters(inventories, grouping);

    // Routers should be sorted alphabetically by capability
    const capabilities = routers.map((r) => r.capability);
    const sortedCapabilities = [...capabilities].sort();
    expect(capabilities).toEqual(sortedCapabilities);
  });

  test("uses custom summarize function", () => {
    const inventories: NamespaceInventory[] = [
      {
        namespace: "test",
        tools: [
          {
            name: "foo",
            description: "Original desc",
            inputSchema: { type: "object" },
          },
        ],
      },
    ];

    const grouping = groupNamespacesByCapability(inventories, {
      test: "general",
    });
    const routers = buildCapabilityRouters(
      inventories,
      grouping,
      () => "Custom summary",
    );

    const action = routers[0]?.actions[0];
    expect(action?.summary).toBe("Custom summary");
  });

  test("default summarize truncates long descriptions", () => {
    const longDesc = "A".repeat(200);
    const inventories: NamespaceInventory[] = [
      {
        namespace: "test",
        tools: [
          {
            name: "foo",
            description: longDesc,
            inputSchema: { type: "object" },
          },
        ],
      },
    ];

    const grouping = groupNamespacesByCapability(inventories, {
      test: "general",
    });
    const routers = buildCapabilityRouters(inventories, grouping);

    const action = routers[0]?.actions[0];
    expect(action?.summary.length).toBeLessThanOrEqual(120);
    expect(action?.summary).toEndWith("...");
  });
});
