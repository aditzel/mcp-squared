import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "../index.js";

export interface McpSquaredServerOptions {
  name?: string;
  version?: string;
}

export class McpSquaredServer {
  private readonly mcpServer: McpServer;
  private transport: StdioServerTransport | null = null;

  constructor(options: McpSquaredServerOptions = {}) {
    const name = options.name ?? "mcp-squared";
    const version = options.version ?? VERSION;

    this.mcpServer = new McpServer(
      { name, version },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.registerMetaTools();
  }

  private registerMetaTools(): void {
    this.mcpServer.registerTool(
      "find_tools",
      {
        description:
          "Search for available tools across all connected upstream MCP servers. Returns a list of tool summaries matching the query.",
        inputSchema: {
          query: z
            .string()
            .describe("Natural language search query to find relevant tools"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(5)
            .describe("Maximum number of results to return"),
        },
      },
      async (args) => {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                message: "find_tools not yet implemented",
                query: args.query,
                limit: args.limit,
                results: [],
              }),
            },
          ],
        };
      },
    );

    this.mcpServer.registerTool(
      "describe_tools",
      {
        description:
          "Get full JSON schemas for the specified tools. Use this after find_tools to get detailed parameter information before calling a tool.",
        inputSchema: {
          tool_names: z
            .array(z.string())
            .min(1)
            .max(20)
            .describe("List of tool names to get schemas for"),
        },
      },
      async (args) => {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                message: "describe_tools not yet implemented",
                tool_names: args.tool_names,
                schemas: [],
              }),
            },
          ],
        };
      },
    );

    this.mcpServer.registerTool(
      "execute",
      {
        description:
          "Execute a tool on an upstream MCP server. The tool must exist and the arguments must match its schema.",
        inputSchema: {
          tool_name: z.string().describe("Name of the tool to execute"),
          arguments: z
            .record(z.string(), z.unknown())
            .default({})
            .describe("Arguments to pass to the tool"),
        },
      },
      async (args) => {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                message: "execute not yet implemented",
                tool_name: args.tool_name,
                arguments: args.arguments,
              }),
            },
          ],
        };
      },
    );
  }

  async start(): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.mcpServer.connect(this.transport);
  }

  async stop(): Promise<void> {
    await this.mcpServer.close();
    this.transport = null;
  }

  isConnected(): boolean {
    return this.mcpServer.isConnected();
  }
}
