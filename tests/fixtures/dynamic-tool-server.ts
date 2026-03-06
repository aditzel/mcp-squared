#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

interface ToolSpec {
  name: string;
  description?: string;
}

interface ToolStateFile {
  tools?: ToolSpec[];
}

const account = process.env["FIXTURE_ACCOUNT"] ?? "default";
const statePath = process.env["FIXTURE_TOOL_STATE"];
const pollMs = Number(process.env["FIXTURE_POLL_MS"] ?? "25");

const server = new McpServer({
  name: `fixture-${account}`,
  version: "1.0.0",
});

// Ensure the SDK exposes tools/list even while the dynamic tool set is empty.
const bootstrapTool = server.registerTool(
  "__bootstrap_fixture",
  {
    description: "Hidden bootstrap tool for empty fixture surfaces",
    inputSchema: z.object({}).passthrough(),
  },
  async () => ({
    content: [],
  }),
);
bootstrapTool.disable();

const registrations = new Map<string, ReturnType<typeof server.registerTool>>();

function readDesiredTools(): ToolSpec[] {
  if (!statePath || !existsSync(statePath)) {
    return [
      {
        name: "create_issue",
        description: `Create issue for ${account}`,
      },
    ];
  }

  const parsed = JSON.parse(readFileSync(statePath, "utf8")) as ToolStateFile;
  if (!Array.isArray(parsed.tools)) {
    return [];
  }

  return parsed.tools
    .filter((tool): tool is ToolSpec => typeof tool?.name === "string")
    .map((tool) =>
      tool.description === undefined
        ? { name: tool.name }
        : { name: tool.name, description: tool.description },
    );
}

function syncTools(): void {
  const desired = readDesiredTools();
  const desiredNames = new Set(desired.map((tool) => tool.name));

  for (const spec of desired) {
    const existing = registrations.get(spec.name);
    if (existing) {
      existing.update({
        ...(spec.description !== undefined
          ? { description: spec.description }
          : {}),
        enabled: true,
        callback: async (args) => ({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                account,
                tool: spec.name,
                args,
              }),
            },
          ],
          structuredContent: {
            account,
            tool: spec.name,
            args: (args ?? {}) as Record<string, unknown>,
          },
        }),
      });
      continue;
    }

    const registration = server.registerTool(
      spec.name,
      {
        ...(spec.description !== undefined
          ? { description: spec.description }
          : {}),
        inputSchema: z.object({}).passthrough(),
      },
      async (args) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              account,
              tool: spec.name,
              args,
            }),
          },
        ],
        structuredContent: {
          account,
          tool: spec.name,
          args: (args ?? {}) as Record<string, unknown>,
        },
      }),
    );
    registrations.set(spec.name, registration);
  }

  for (const [name, registration] of registrations) {
    if (desiredNames.has(name)) {
      continue;
    }
    registration.remove();
    registrations.delete(name);
  }
}

try {
  syncTools();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dynamic-tool-server] initial sync failed: ${message}`);
}
const timer = setInterval(
  () => {
    try {
      syncTools();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[dynamic-tool-server] sync failed: ${message}`);
    }
  },
  Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 25,
);

const transport = new StdioServerTransport();

async function shutdown(): Promise<void> {
  clearInterval(timer);
  await server.close().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});

await server.connect(transport);
