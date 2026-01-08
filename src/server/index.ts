import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "../index.js";
import { Retriever } from "../retriever/index.js";
import { Cataloger } from "../upstream/index.js";

export interface McpSquaredServerOptions {
  name?: string;
  version?: string;
  cataloger?: Cataloger;
  indexDbPath?: string;
  defaultLimit?: number;
  maxLimit?: number;
}

export class McpSquaredServer {
  private readonly mcpServer: McpServer;
  private readonly cataloger: Cataloger;
  private readonly retriever: Retriever;
  private transport: StdioServerTransport | null = null;
  private readonly ownsCataloger: boolean;

  constructor(options: McpSquaredServerOptions = {}) {
    const name = options.name ?? "mcp-squared";
    const version = options.version ?? VERSION;

    // Use provided cataloger or create a new one
    if (options.cataloger) {
      this.cataloger = options.cataloger;
      this.ownsCataloger = false;
    } else {
      this.cataloger = new Cataloger();
      this.ownsCataloger = true;
    }

    this.retriever = new Retriever(this.cataloger, {
      indexDbPath: options.indexDbPath,
      defaultLimit: options.defaultLimit ?? 5,
      maxLimit: options.maxLimit ?? 50,
    });

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
        const result = this.retriever.search(args.query, args.limit);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                query: result.query,
                totalMatches: result.totalMatches,
                tools: result.tools,
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
        const tools = this.retriever.getTools(args.tool_names);

        const schemas = tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          serverKey: tool.serverKey,
          inputSchema: tool.inputSchema,
        }));

        const notFound = args.tool_names.filter(
          (name) => !tools.some((t) => t.name === name),
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                schemas,
                notFound: notFound.length > 0 ? notFound : undefined,
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
        try {
          const result = await this.cataloger.callTool(
            args.tool_name,
            args.arguments,
          );

          return {
            content: result.content.map((c) => {
              if (typeof c === "object" && c !== null && "type" in c) {
                return c as { type: "text"; text: string };
              }
              return {
                type: "text" as const,
                text: JSON.stringify(c),
              };
            }),
            isError: result.isError,
          };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: errorMessage,
                }),
              },
            ],
            isError: true,
          };
        }
      },
    );
  }

  /**
   * Sync tools from the cataloger to the index
   */
  syncIndex(): void {
    this.retriever.syncFromCataloger();
  }

  /**
   * Get the cataloger instance
   */
  getCataloger(): Cataloger {
    return this.cataloger;
  }

  /**
   * Get the retriever instance
   */
  getRetriever(): Retriever {
    return this.retriever;
  }

  async start(): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.mcpServer.connect(this.transport);
  }

  async stop(): Promise<void> {
    await this.mcpServer.close();
    this.retriever.close();
    if (this.ownsCataloger) {
      await this.cataloger.disconnectAll();
    }
    this.transport = null;
  }

  isConnected(): boolean {
    return this.mcpServer.isConnected();
  }
}
