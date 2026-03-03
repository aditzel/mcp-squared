#!/usr/bin/env bun

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "@/config/schema.js";
import { McpSquaredServer } from "@/server/index.js";
import { formatRatioPercent } from "@/utils/percent.js";

type Scenario = {
  id: string;
  query: string;
  intent: "codeSearch" | "generic";
  expectedFirst?: string;
};

type EvalRow = {
  id: string;
  intent: Scenario["intent"];
  query: string;
  firstNamespace: string;
  expected: string;
  pass: boolean;
};

const CODE_SEARCH_PREFS = ["auggie", "ctxdb"];

const SCENARIOS: Scenario[] = [
  {
    id: "cs-01",
    query: "search the codebase for auth middleware",
    intent: "codeSearch",
  },
  {
    id: "cs-02",
    query: "find symbol references for McpSquaredServer",
    intent: "codeSearch",
  },
  {
    id: "cs-03",
    query: "where is configuration loaded in this repository",
    intent: "codeSearch",
  },
  {
    id: "cs-04",
    query: "look up call sites for runImport",
    intent: "codeSearch",
  },
  {
    id: "gen-01",
    query: "create a GitHub issue",
    intent: "generic",
    expectedFirst: "github",
  },
  {
    id: "gen-02",
    query: "read a local file",
    intent: "generic",
    expectedFirst: "filesystem",
  },
];

function parseFirstNamespace(responseText: string | undefined): string {
  if (!responseText) return "(none)";
  try {
    const payload = JSON.parse(responseText) as {
      tools?: Array<{ serverKey?: string }>;
    };
    return payload.tools?.[0]?.serverKey ?? "(none)";
  } catch {
    return "(none)";
  }
}

function extractTextContent(
  content: unknown[] | undefined,
): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

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

function buildEvalServerConfig(): McpSquaredConfig {
  return {
    ...DEFAULT_CONFIG,
    upstreams: {
      auggie: {
        transport: "stdio",
        enabled: true,
        env: {},
        stdio: { command: "auggie", args: [] },
      },
      ctxdb: {
        transport: "stdio",
        enabled: true,
        env: {},
        stdio: { command: "ctxdb", args: [] },
      },
      filesystem: {
        transport: "stdio",
        enabled: true,
        env: {},
        stdio: { command: "filesystem", args: [] },
      },
      github: {
        transport: "stdio",
        enabled: true,
        env: {},
        stdio: { command: "github", args: [] },
      },
    },
    operations: {
      ...DEFAULT_CONFIG.operations,
      findTools: {
        ...DEFAULT_CONFIG.operations.findTools,
        preferredNamespacesByIntent: {
          codeSearch: CODE_SEARCH_PREFS,
        },
      },
    },
  };
}

function seedTools(server: McpSquaredServer): void {
  const indexStore = server.getRetriever().getIndexStore();

  indexStore.indexTool({
    name: "search_context",
    description: "Semantic code search over repositories and symbols",
    serverKey: "auggie",
    inputSchema: { type: "object" },
  });
  indexStore.indexTool({
    name: "lookup_index",
    description: "Lookup source symbols in a precomputed context index",
    serverKey: "ctxdb",
    inputSchema: { type: "object" },
  });
  indexStore.indexTool({
    name: "read_file",
    description: "Read a file from local disk",
    serverKey: "filesystem",
    inputSchema: { type: "object" },
  });
  indexStore.indexTool({
    name: "create_issue",
    description: "Create an issue in GitHub",
    serverKey: "github",
    inputSchema: { type: "object" },
  });
}

function expectedNamespaceForScenario(scenario: Scenario): string {
  if (scenario.intent === "codeSearch") {
    return CODE_SEARCH_PREFS.join("|");
  }
  return scenario.expectedFirst ?? "(unspecified)";
}

function isPass(scenario: Scenario, firstNamespace: string): boolean {
  if (scenario.intent === "codeSearch") {
    return CODE_SEARCH_PREFS.includes(firstNamespace);
  }
  if (!scenario.expectedFirst) {
    return true;
  }
  return scenario.expectedFirst === firstNamespace;
}

function printReport(rows: EvalRow[]): void {
  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  const codeRows = rows.filter((r) => r.intent === "codeSearch");
  const codePassed = codeRows.filter((r) => r.pass).length;

  console.log("\nTool Routing Eval\n");
  console.log("| id | intent | first namespace | expected | pass |");
  console.log("|---|---|---|---|---|");
  for (const row of rows) {
    console.log(
      `| ${row.id} | ${row.intent} | ${row.firstNamespace} | ${row.expected} | ${row.pass ? "yes" : "no"} |`,
    );
  }

  console.log("\nSummary");
  console.log(
    `- overall: ${passed}/${total} (${formatRatioPercent(passed, total)}%)`,
  );
  console.log(
    `- codeSearch intent: ${codePassed}/${codeRows.length} (${formatRatioPercent(codePassed, codeRows.length)}%)`,
  );
}

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict");

  const server = new McpSquaredServer({ config: buildEvalServerConfig() });
  const sessionServer = server.createSessionServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "routing-eval",
    version: "0.0.0",
  });
  try {
    seedTools(server);
    await sessionServer.connect(serverTransport);
    await client.connect(clientTransport);

    const rows: EvalRow[] = [];

    for (const scenario of SCENARIOS) {
      const result = await client.callTool({
        name: "find_tools",
        arguments: {
          query: scenario.query,
          limit: 5,
        },
      });
      const firstNamespace = parseFirstNamespace(
        extractTextContent(result.content as unknown[] | undefined),
      );
      rows.push({
        id: scenario.id,
        intent: scenario.intent,
        query: scenario.query,
        firstNamespace,
        expected: expectedNamespaceForScenario(scenario),
        pass: isPass(scenario, firstNamespace),
      });
    }

    printReport(rows);

    if (strict) {
      const codeRows = rows.filter((r) => r.intent === "codeSearch");
      const codePassed = codeRows.filter((r) => r.pass).length;
      if (codePassed < codeRows.length) {
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
