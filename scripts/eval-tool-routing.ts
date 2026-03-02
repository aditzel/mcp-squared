#!/usr/bin/env bun

import { DEFAULT_CONFIG, type McpSquaredConfig } from "../src/config/schema.js";
import { McpSquaredServer } from "../src/server/index.js";

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

type SessionWithTools = {
  _registeredTools?: Record<
    string,
    {
      handler?: (args?: Record<string, unknown>) => Promise<{
        content?: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>;
    }
  >;
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

function getFindToolsHandler(
  server: McpSquaredServer,
): (
  args?: Record<string, unknown>,
) => Promise<{ content?: Array<{ type: string; text: string }> }> {
  const session = server.createSessionServer() as unknown as SessionWithTools;
  const handler = session._registeredTools?.["find_tools"]?.handler;
  if (!handler) {
    throw new Error("find_tools handler is not registered");
  }
  return handler;
}

function parseFirstNamespace(responseText: string | undefined): string {
  if (!responseText) return "(none)";
  const payload = JSON.parse(responseText) as {
    tools?: Array<{ serverKey?: string }>;
  };
  return payload.tools?.[0]?.serverKey ?? "(none)";
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
    `- overall: ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `- codeSearch intent: ${codePassed}/${codeRows.length} (${((codePassed / codeRows.length) * 100).toFixed(1)}%)`,
  );
}

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict");

  const server = new McpSquaredServer({ config: buildEvalServerConfig() });
  try {
    seedTools(server);
    const findTools = getFindToolsHandler(server);

    const rows: EvalRow[] = [];

    for (const scenario of SCENARIOS) {
      const result = await findTools({
        query: scenario.query,
        limit: 5,
      });
      const firstNamespace = parseFirstNamespace(result.content?.[0]?.text);
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
        process.exit(1);
      }
    }
  } finally {
    await server.stop();
  }
}

await main();
