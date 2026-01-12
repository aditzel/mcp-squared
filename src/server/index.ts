/**
 * MCP² Server module - The core MCP meta-server implementation.
 *
 * This module implements the MCP server that exposes three meta-tools:
 * - find_tools: Search for tools across all upstream servers
 * - describe_tools: Get detailed schemas for specific tools
 * - execute: Execute tools on upstream servers with security policy enforcement
 *
 * The server acts as a proxy/gateway to multiple upstream MCP servers,
 * providing unified tool discovery and execution with security controls.
 *
 * @module server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DEFAULT_CONFIG,
  type McpSquaredConfig,
  SearchModeSchema,
} from "../config/schema.js";
import { VERSION } from "../index.js";
import { Retriever } from "../retriever/index.js";
import { evaluatePolicy } from "../security/index.js";
import { Cataloger } from "../upstream/index.js";

/**
 * Configuration options for creating an MCP² server instance.
 */
export interface McpSquaredServerOptions {
  /** Server name reported to clients (default: "mcp-squared") */
  name?: string;
  /** Server version reported to clients (default: package version) */
  version?: string;
  /** Pre-configured cataloger instance (creates new if not provided) */
  cataloger?: Cataloger;
  /** MCP² configuration for security policies and operations */
  config?: McpSquaredConfig;
  /** Path to the SQLite index database (default: in-memory) */
  indexDbPath?: string;
  /** Default number of results for find_tools (default: 5) */
  defaultLimit?: number;
  /** Maximum allowed results for find_tools (default: 50) */
  maxLimit?: number;
}

/**
 * The main MCP² server class that implements the meta-server functionality.
 *
 * This server exposes three tools to MCP clients:
 * - `find_tools`: Natural language search for tools across upstream servers
 * - `describe_tools`: Get full JSON schemas for specific tools
 * - `execute`: Execute tools with security policy enforcement
 *
 * @example
 * ```ts
 * const server = new McpSquaredServer({
 *   config: await loadConfig(),
 *   defaultLimit: 10,
 * });
 *
 * await server.start();
 * ```
 */
export class McpSquaredServer {
  private readonly mcpServer: McpServer;
  private readonly cataloger: Cataloger;
  private readonly retriever: Retriever;
  private readonly config: McpSquaredConfig;
  private readonly maxLimit: number;
  private transport: StdioServerTransport | null = null;
  private readonly ownsCataloger: boolean;

  /**
   * Creates a new MCP² server instance.
   *
   * @param options - Server configuration options
   */
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

    this.config = options.config ?? DEFAULT_CONFIG;

    // Use config values for retriever limits, with options as overrides
    const findToolsConfig = this.config.operations.findTools;
    this.maxLimit = options.maxLimit ?? findToolsConfig.maxLimit;
    this.retriever = new Retriever(this.cataloger, {
      indexDbPath: options.indexDbPath,
      defaultLimit: options.defaultLimit ?? findToolsConfig.defaultLimit,
      maxLimit: this.maxLimit,
      defaultMode: findToolsConfig.defaultMode,
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

  /**
   * Registers the three meta-tools: find_tools, describe_tools, and execute.
   * These tools provide the core functionality for tool discovery and execution.
   *
   * @internal
   */
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
            .max(this.maxLimit)
            .default(this.config.operations.findTools.defaultLimit)
            .describe("Maximum number of results to return"),
          mode: SearchModeSchema.optional().describe(
            'Search mode: "fast" (FTS5), "semantic" (embeddings), or "hybrid" (FTS5 + rerank)',
          ),
        },
      },
      async (args) => {
        const result = await this.retriever.search(args.query, {
          limit: args.limit,
          mode: args.mode,
        });

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
        const result = this.retriever.getTools(args.tool_names);

        const schemas = result.tools.map((tool) => ({
          name: tool.name,
          qualifiedName: `${tool.serverKey}:${tool.name}`,
          description: tool.description,
          serverKey: tool.serverKey,
          inputSchema: tool.inputSchema,
        }));

        // Find names that weren't found (not in tools and not ambiguous)
        const foundNames = new Set(result.tools.map((t) => t.name));
        const ambiguousNames = new Set(result.ambiguous.map((a) => a.name));
        const notFound = args.tool_names.filter(
          (name) => !foundNames.has(name) && !ambiguousNames.has(name),
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                schemas,
                ambiguous:
                  result.ambiguous.length > 0 ? result.ambiguous : undefined,
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
          confirmation_token: z
            .string()
            .optional()
            .describe(
              "Optional confirmation token for tools that require explicit confirmation",
            ),
        },
      },
      async (args) => {
        try {
          // Look up the tool to get its server key (supports qualified names)
          const lookupResult = this.cataloger.findTool(args.tool_name);

          if (lookupResult.ambiguous) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: `Ambiguous tool name "${args.tool_name}". Use a qualified name.`,
                    alternatives: lookupResult.alternatives,
                  }),
                },
              ],
              isError: true,
            };
          }

          if (!lookupResult.tool) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: `Tool not found: ${args.tool_name}`,
                  }),
                },
              ],
              isError: true,
            };
          }

          const tool = lookupResult.tool;

          // Evaluate security policy
          const policyResult = evaluatePolicy(
            {
              serverKey: tool.serverKey,
              toolName: args.tool_name,
              confirmationToken: args.confirmation_token,
            },
            this.config,
          );

          // Handle policy decision
          if (policyResult.decision === "block") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: policyResult.reason,
                    blocked: true,
                  }),
                },
              ],
              isError: true,
            };
          }

          if (policyResult.decision === "confirm") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    requires_confirmation: true,
                    confirmation_token: policyResult.confirmationToken,
                    message: policyResult.reason,
                  }),
                },
              ],
              isError: false,
            };
          }

          // Policy allows execution - proceed
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
   * Synchronizes tools from the cataloger to the full-text search index.
   * Call this after connecting to upstream servers to enable tool search.
   */
  syncIndex(): void {
    this.retriever.syncFromCataloger();
  }

  /**
   * Returns the cataloger instance used by this server.
   * Use this to manage upstream connections directly.
   *
   * @returns The Cataloger instance
   */
  getCataloger(): Cataloger {
    return this.cataloger;
  }

  /**
   * Returns the retriever instance used for tool search.
   *
   * @returns The Retriever instance
   */
  getRetriever(): Retriever {
    return this.retriever;
  }

  /**
   * Starts the MCP server and begins listening for client connections via stdio.
   * Automatically connects to all enabled upstream servers and syncs the tool index.
   *
   * @returns Promise that resolves when the server is ready
   */
  async start(): Promise<void> {
    // Connect to all enabled upstream servers from config
    const upstreamEntries = Object.entries(this.config.upstreams);
    for (const [key, upstream] of upstreamEntries) {
      if (upstream.enabled) {
        try {
          await this.cataloger.connect(key, upstream);
        } catch {
          // Log error but continue with other upstreams
          // Individual upstream failures shouldn't prevent server startup
        }
      }
    }

    // Sync the tool index after connecting to upstreams
    this.syncIndex();

    // Start the MCP transport
    this.transport = new StdioServerTransport();
    await this.mcpServer.connect(this.transport);
  }

  /**
   * Stops the server and cleans up all resources.
   * Closes the MCP connection, retriever index, and disconnects all upstreams.
   *
   * @returns Promise that resolves when shutdown is complete
   */
  async stop(): Promise<void> {
    await this.mcpServer.close();
    this.retriever.close();
    if (this.ownsCataloger) {
      await this.cataloger.disconnectAll();
    }
    this.transport = null;
  }

  /**
   * Checks if the server is currently connected to a client.
   *
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    return this.mcpServer.isConnected();
  }
}
