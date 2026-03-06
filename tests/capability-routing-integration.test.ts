import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpSquaredConfig } from "@/config/schema";
import { DEFAULT_CONFIG } from "@/config/schema";
import { McpSquaredServer } from "@/server";

type ToolCallResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const fixturePath = fileURLToPath(
  new URL("./fixtures/dynamic-tool-server.ts", import.meta.url),
);

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mcp2-routing-"));
}

function parseToolPayload(result: ToolCallResult): Record<string, unknown> {
  const text = result.content?.[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

async function connectClient(runtime: McpSquaredServer): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const session = runtime.createSessionServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await session.connect(serverTransport);

  const client = new Client({
    name: "capability-routing-integration-test",
    version: "0.0.0",
  });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close().catch(() => {});
      await session.close().catch(() => {});
    },
  };
}

async function waitFor<T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 4000,
): Promise<T> {
  const start = Date.now();
  let lastValue = await producer();

  while (!predicate(lastValue)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for condition. Last value: ${JSON.stringify(lastValue)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    lastValue = await producer();
  }

  return lastValue;
}

describe.serial("capability routing integration", () => {
  const runtimes = new Set<McpSquaredServer>();
  const tempDirs = new Set<string>();

  afterEach(async () => {
    for (const runtime of runtimes) {
      await runtime.stopCore().catch(() => {});
    }
    runtimes.clear();

    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tempDirs.clear();
  });

  test("real duplicate upstream instances expose distinct instance-aware actions", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          allow: ["issue_tracking:*"],
          block: [],
          confirm: [],
        },
      },
      operations: {
        ...DEFAULT_CONFIG.operations,
        dynamicToolSurface: {
          ...DEFAULT_CONFIG.operations.dynamicToolSurface,
          capabilityOverrides: {
            "github-work": "issue_tracking",
            "github-personal": "issue_tracking",
          },
        },
      },
      upstreams: {
        "github-work": {
          transport: "stdio",
          enabled: true,
          label: "GitHub Work",
          env: {
            FIXTURE_ACCOUNT: "work",
          },
          stdio: {
            command: process.execPath,
            args: ["run", fixturePath],
          },
        },
        "github-personal": {
          transport: "stdio",
          enabled: true,
          label: "GitHub Personal",
          env: {
            FIXTURE_ACCOUNT: "personal",
          },
          stdio: {
            command: process.execPath,
            args: ["run", fixturePath],
          },
        },
      },
    };

    const runtime = new McpSquaredServer({
      config,
      monitorSocketPath: "tcp://127.0.0.1:0",
    });
    runtimes.add(runtime);
    await runtime.startCore();

    const { client, close } = await connectClient(runtime);
    try {
      const describeResult = (await client.callTool({
        name: "issue_tracking",
        arguments: {
          action: "__describe_actions",
          arguments: {},
        },
      })) as ToolCallResult;

      const describePayload = parseToolPayload(describeResult);
      const actions =
        (describePayload["actions"] as
          | Array<Record<string, unknown>>
          | undefined) ?? [];

      expect(actions.map((entry) => entry["action"]).sort()).toEqual([
        "create_issue__github_personal",
        "create_issue__github_work",
      ]);
      expect(actions.map((entry) => entry["instance"]).sort()).toEqual([
        "github-personal",
        "github-work",
      ]);
      expect(actions.map((entry) => entry["instanceTitle"]).sort()).toEqual([
        "GitHub Personal",
        "GitHub Work",
      ]);

      const callResult = (await client.callTool({
        name: "issue_tracking",
        arguments: {
          action: "create_issue__github_work",
          arguments: {
            title: "routing regression",
          },
        },
      })) as ToolCallResult;

      expect(callResult.isError).toBeFalsy();
      expect(parseToolPayload(callResult)).toMatchObject({
        account: "work",
        tool: "create_issue",
      });
    } finally {
      await close();
    }
  });

  test("long-lived client sessions observe refreshed upstream routing after tool changes", async () => {
    const dir = await createTempDir();
    tempDirs.add(dir);
    const statePath = join(dir, "tools.json");
    await writeFile(
      statePath,
      JSON.stringify({
        tools: [
          {
            name: "codebase-retrieval",
            description: "Search source code",
          },
        ],
      }),
    );

    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          allow: ["code_search:*"],
          block: [],
          confirm: [],
        },
      },
      operations: {
        ...DEFAULT_CONFIG.operations,
        dynamicToolSurface: {
          ...DEFAULT_CONFIG.operations.dynamicToolSurface,
          capabilityOverrides: {
            dynamic: "code_search",
          },
        },
      },
      upstreams: {
        dynamic: {
          transport: "stdio",
          enabled: true,
          label: "Dynamic Code Search",
          env: {
            FIXTURE_ACCOUNT: "dynamic",
            FIXTURE_TOOL_STATE: statePath,
            FIXTURE_POLL_MS: "25",
          },
          stdio: {
            command: process.execPath,
            args: ["run", fixturePath],
          },
        },
      },
    };

    const runtime = new McpSquaredServer({
      config,
      monitorSocketPath: "tcp://127.0.0.1:0",
    });
    runtimes.add(runtime);
    await runtime.startCore();

    const { client, close } = await connectClient(runtime);
    try {
      const initial = parseToolPayload(
        (await client.callTool({
          name: "code_search",
          arguments: {
            action: "__describe_actions",
            arguments: {},
          },
        })) as ToolCallResult,
      );

      expect(initial["actions"]).toMatchObject([
        {
          action: "codebase_retrieval",
          summary: "Search source code",
          requiresConfirmation: false,
          inputSchema: { type: "object" },
        },
      ]);

      await writeFile(
        statePath,
        JSON.stringify({
          tools: [
            {
              name: "symbol-search",
              description: "Search symbols",
            },
          ],
        }),
      );

      const refreshed = await waitFor(
        async () => {
          await runtime.getCataloger().refreshTools("dynamic");
          const result = (await client.callTool({
            name: "code_search",
            arguments: {
              action: "__describe_actions",
              arguments: {},
            },
          })) as ToolCallResult;
          return parseToolPayload(result);
        },
        (payload) => {
          const actions =
            (payload["actions"] as
              | Array<Record<string, unknown>>
              | undefined) ?? [];
          return (
            actions.length === 1 &&
            actions[0]?.["action"] === "symbol_search" &&
            actions[0]?.["summary"] === "Search symbols" &&
            actions[0]?.["requiresConfirmation"] === false
          );
        },
      );

      expect(refreshed["actions"]).toMatchObject([
        {
          action: "symbol_search",
          summary: "Search symbols",
          requiresConfirmation: false,
          inputSchema: { type: "object" },
        },
      ]);

      const callResult = (await client.callTool({
        name: "code_search",
        arguments: {
          action: "symbol_search",
          arguments: {
            query: "routing",
          },
        },
      })) as ToolCallResult;

      expect(callResult.isError).toBeFalsy();
      expect(parseToolPayload(callResult)).toMatchObject({
        account: "dynamic",
        tool: "symbol-search",
      });
    } finally {
      await close();
    }
  });

  test("fixture startup tolerates invalid initial tool state and later recovers", async () => {
    const dir = await createTempDir();
    tempDirs.add(dir);
    const statePath = join(dir, "broken-tools.json");
    await writeFile(statePath, "{not valid json");

    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          allow: ["code_search:*"],
          block: [],
          confirm: [],
        },
      },
      operations: {
        ...DEFAULT_CONFIG.operations,
        dynamicToolSurface: {
          ...DEFAULT_CONFIG.operations.dynamicToolSurface,
          capabilityOverrides: {
            dynamic: "code_search",
          },
        },
      },
      upstreams: {
        dynamic: {
          transport: "stdio",
          enabled: true,
          label: "Dynamic Code Search",
          env: {
            FIXTURE_ACCOUNT: "dynamic",
            FIXTURE_TOOL_STATE: statePath,
            FIXTURE_POLL_MS: "25",
          },
          stdio: {
            command: process.execPath,
            args: ["run", fixturePath],
          },
        },
      },
    };

    const runtime = new McpSquaredServer({
      config,
      monitorSocketPath: "tcp://127.0.0.1:0",
    });
    runtimes.add(runtime);
    await runtime.startCore();

    const initialStatus = runtime.getCataloger().getStatus().get("dynamic");
    expect(initialStatus?.status).toBe("connected");

    await writeFile(
      statePath,
      JSON.stringify({
        tools: [
          {
            name: "symbol-search",
            description: "Search symbols",
          },
        ],
      }),
    );

    await waitFor(
      async () => {
        await runtime.getCataloger().refreshTools("dynamic");
        return runtime.getCataloger().getToolsForServer("dynamic");
      },
      (tools) => tools.some((tool) => tool.name === "symbol-search"),
    );

    const { client, close } = await connectClient(runtime);
    try {
      const recovered = parseToolPayload(
        (await client.callTool({
          name: "code_search",
          arguments: {
            action: "__describe_actions",
            arguments: {},
          },
        })) as ToolCallResult,
      );

      expect(recovered["actions"]).toMatchObject([
        {
          action: "symbol_search",
          summary: "Search symbols",
          requiresConfirmation: false,
          inputSchema: { type: "object" },
        },
      ]);
    } finally {
      await close();
    }
  });
});
