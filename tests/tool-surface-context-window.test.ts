import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEFAULT_CONFIG } from "@/config/schema";
import { McpSquaredServer } from "@/server";

const CHARS_PER_TOKEN_ESTIMATE = 4;
const CAPABILITY_TOOL_BUDGET_BASELINE = {
  minifiedChars: 1564,
  estimatedTokens: 391,
  perTool: {
    code_search: { minifiedChars: 777, estimatedTokens: 195 },
    time_util: { minifiedChars: 774, estimatedTokens: 194 },
  } as Record<
    string,
    {
      minifiedChars: number;
      estimatedTokens: number;
    }
  >,
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

async function getCapabilityToolPayload(): Promise<{
  tools: Array<{
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    annotations?: unknown;
    execution?: unknown;
  }>;
}> {
  const runtime = new McpSquaredServer({ config: DEFAULT_CONFIG });
  const cataloger = runtime.getCataloger();
  cataloger.getStatus = () =>
    new Map([
      ["auggie", { status: "connected", error: undefined }],
      ["time", { status: "connected", error: undefined }],
    ]);
  cataloger.getToolsForServer = (key: string) => {
    if (key === "auggie") {
      return [
        {
          name: "codebase-retrieval",
          description: "Search source code",
          serverKey: "auggie",
          inputSchema: {
            type: "object",
            properties: {
              information_request: { type: "string" },
              directory_path: { type: "string" },
            },
          },
        },
      ];
    }
    if (key === "time") {
      return [
        {
          name: "convert_time",
          description: "Convert timezone values",
          serverKey: "time",
          inputSchema: {
            type: "object",
            properties: {
              source_timezone: { type: "string" },
              target_timezone: { type: "string" },
            },
          },
        },
      ];
    }
    return [];
  };

  const session = runtime.createSessionServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await session.connect(serverTransport);

  const client = new Client({
    name: "tool-surface-context-budget-test",
    version: "0.0.0",
  });
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    return {
      tools: listed.tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        execution: tool.execution,
      })),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

describe("tool-surface context budget", () => {
  test("capability tool listing stays within context-window budget baseline", async () => {
    const payload = await getCapabilityToolPayload();
    const minified = JSON.stringify(payload);
    const estimatedTokens = estimateTokens(minified);

    const sortedToolNames = payload.tools.map((tool) => tool.name).sort();
    expect(sortedToolNames).toEqual(["code_search", "time_util"]);

    if (minified.length > CAPABILITY_TOOL_BUDGET_BASELINE.minifiedChars) {
      const delta =
        minified.length - CAPABILITY_TOOL_BUDGET_BASELINE.minifiedChars;
      throw new Error(
        `Capability tool listing grew by ${delta} chars (baseline=${CAPABILITY_TOOL_BUDGET_BASELINE.minifiedChars}, current=${minified.length}).`,
      );
    }

    if (estimatedTokens > CAPABILITY_TOOL_BUDGET_BASELINE.estimatedTokens) {
      const delta =
        estimatedTokens - CAPABILITY_TOOL_BUDGET_BASELINE.estimatedTokens;
      throw new Error(
        `Capability tool listing grew by ${delta} estimated tokens (baseline=${CAPABILITY_TOOL_BUDGET_BASELINE.estimatedTokens}, current=${estimatedTokens}).`,
      );
    }

    for (const tool of payload.tools) {
      const serialized = JSON.stringify(tool);
      const toolChars = serialized.length;
      const toolTokens = estimateTokens(serialized);
      const baseline = CAPABILITY_TOOL_BUDGET_BASELINE.perTool[tool.name];
      expect(baseline).toBeDefined();
      if (!baseline) {
        continue;
      }

      if (toolChars > baseline.minifiedChars) {
        const delta = toolChars - baseline.minifiedChars;
        throw new Error(
          `Tool ${tool.name} grew by ${delta} chars (baseline=${baseline.minifiedChars}, current=${toolChars}).`,
        );
      }
      if (toolTokens > baseline.estimatedTokens) {
        const delta = toolTokens - baseline.estimatedTokens;
        throw new Error(
          `Tool ${tool.name} grew by ${delta} estimated tokens (baseline=${baseline.estimatedTokens}, current=${toolTokens}).`,
        );
      }
    }
  });
});
