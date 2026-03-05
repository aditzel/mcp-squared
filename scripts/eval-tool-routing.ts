#!/usr/bin/env bun

/**
 * Capability routing evaluation harness.
 *
 * Verifies that upstream tool inventories are grouped into the correct
 * capability buckets and that the capability router API exposes them
 * with expected action names.
 *
 * Usage: bun run eval:routing [--strict]
 */

import { spyOn } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ConnectionStatus } from "@/config/schema.js";
import { McpSquaredServer } from "@/server/index.js";
import { formatRatioPercent } from "@/utils/percent.js";

type Scenario = {
  id: string;
  /** Upstream namespace + tool metadata to seed */
  namespace: string;
  tools: Array<{ name: string; description: string }>;
  /** Expected capability bucket */
  expectedCapability: string;
  /** Expected action name(s) in that capability */
  expectedActions: string[];
};

type EvalRow = {
  id: string;
  namespace: string;
  expectedCapability: string;
  actualCapability: string | null;
  expectedActions: string[];
  actualActions: string[];
  pass: boolean;
};

const SCENARIOS: Scenario[] = [
  {
    id: "cs-01",
    namespace: "auggie",
    tools: [
      {
        name: "search_context",
        description: "Semantic code search over repositories and symbols",
      },
    ],
    expectedCapability: "code_search",
    expectedActions: ["search_context"],
  },
  {
    id: "cs-02",
    namespace: "ctxdb",
    tools: [
      {
        name: "lookup_index",
        description: "Lookup source symbols in a precomputed context index",
      },
    ],
    expectedCapability: "code_search",
    expectedActions: ["lookup_index"],
  },
  {
    id: "it-01",
    namespace: "github",
    tools: [
      {
        name: "create_issue",
        description: "Create an issue in GitHub",
      },
      {
        name: "list_issues",
        description: "List issues in a GitHub repository",
      },
    ],
    expectedCapability: "issue_tracking",
    expectedActions: ["create_issue", "list_issues"],
  },
  {
    id: "tu-01",
    namespace: "time-server",
    tools: [
      {
        name: "convert_time",
        description: "Convert time values between formats",
      },
    ],
    expectedCapability: "time_util",
    expectedActions: ["convert_time"],
  },
  {
    id: "doc-01",
    namespace: "docs-server",
    tools: [
      {
        name: "search_docs",
        description: "Search documentation pages",
      },
    ],
    expectedCapability: "docs",
    expectedActions: ["search_docs"],
  },
  {
    id: "ba-01",
    namespace: "puppeteer",
    tools: [
      {
        name: "navigate",
        description: "Navigate to a URL in the browser",
      },
      {
        name: "screenshot",
        description: "Take a screenshot of the browser",
      },
    ],
    expectedCapability: "browser_automation",
    expectedActions: ["navigate", "screenshot"],
  },
];

function extractTextContent(
  content: unknown[] | undefined,
): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      "text" in item &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      return (item as { text: string }).text;
    }
  }
  return undefined;
}

function printReport(rows: EvalRow[]): void {
  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;

  console.log("\nCapability Routing Eval\n");
  console.log(
    "| id | namespace | expected capability | actual capability | actions match | pass |",
  );
  console.log("|---|---|---|---|---|---|");
  for (const row of rows) {
    const actionsMatch =
      JSON.stringify(row.expectedActions) === JSON.stringify(row.actualActions);
    console.log(
      `| ${row.id} | ${row.namespace} | ${row.expectedCapability} | ${row.actualCapability ?? "(none)"} | ${actionsMatch ? "yes" : "no"} | ${row.pass ? "yes" : "no"} |`,
    );
  }

  console.log("\nSummary");
  console.log(
    `- overall: ${passed}/${total} (${formatRatioPercent(passed, total)}%)`,
  );
}

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict");

  const server = new McpSquaredServer();
  const cataloger = server.getCataloger();

  // Build the full status + tools maps from scenarios
  const statusMap = new Map<
    string,
    { status: ConnectionStatus; error: string | undefined }
  >();
  const toolsByServer = new Map<
    string,
    Array<{
      name: string;
      description: string;
      serverKey: string;
      inputSchema: { type: "object" };
    }>
  >();

  for (const scenario of SCENARIOS) {
    statusMap.set(scenario.namespace, {
      status: "connected",
      error: undefined,
    });
    toolsByServer.set(
      scenario.namespace,
      scenario.tools.map((t) => ({
        ...t,
        serverKey: scenario.namespace,
        inputSchema: { type: "object" as const },
      })),
    );
  }

  spyOn(cataloger, "getStatus").mockReturnValue(statusMap);
  spyOn(cataloger, "getToolsForServer").mockImplementation(
    (key: string) => toolsByServer.get(key) ?? [],
  );

  const sessionServer = server.createSessionServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "routing-eval",
    version: "0.0.0",
  });

  try {
    await sessionServer.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    const toolNames = new Set(listed.tools.map((t) => t.name));

    const rows: EvalRow[] = [];

    for (const scenario of SCENARIOS) {
      const capabilityToolExists = toolNames.has(scenario.expectedCapability);

      let actualActions: string[] = [];
      let actualCapability: string | null = null;

      if (capabilityToolExists) {
        // Call __describe_actions to get the action catalog
        const result = await client.callTool({
          name: scenario.expectedCapability,
          arguments: { action: "__describe_actions" },
        });
        const text = extractTextContent(result.content as unknown[]);
        if (text) {
          const payload = JSON.parse(text) as {
            capability?: string;
            actions?: Array<{ action: string }>;
          };
          actualCapability = payload.capability ?? null;
          actualActions = (payload.actions ?? [])
            .map((a) => a.action)
            .filter((a) => scenario.expectedActions.includes(a))
            .sort();
        }
      }

      const expectedSorted = [...scenario.expectedActions].sort();
      const pass =
        actualCapability === scenario.expectedCapability &&
        JSON.stringify(expectedSorted) === JSON.stringify(actualActions);

      rows.push({
        id: scenario.id,
        namespace: scenario.namespace,
        expectedCapability: scenario.expectedCapability,
        actualCapability,
        expectedActions: expectedSorted,
        actualActions,
        pass,
      });
    }

    printReport(rows);

    if (strict) {
      const failed = rows.filter((r) => !r.pass);
      if (failed.length > 0) {
        console.error(`\nStrict mode: ${failed.length} scenario(s) failed`);
        process.exitCode = 1;
      }
    }
  } finally {
    await client.close().catch(() => {});
    await sessionServer.close().catch(() => {});
    await server.stop();
  }
}

await main();
