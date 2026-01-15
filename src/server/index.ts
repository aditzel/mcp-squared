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
import { IndexRefreshManager } from "../background/index.js";
import { SelectionTracker } from "../caching/index.js";
import {
  DEFAULT_CONFIG,
  type DetailLevel,
  DetailLevelSchema,
  type McpSquaredConfig,
  SearchModeSchema,
} from "../config/schema.js";
import { VERSION } from "../index.js";
import {
  Retriever,
  type ToolFullSchema,
  type ToolIdentity,
  type ToolResult,
  type ToolSummary,
} from "../retriever/index.js";
import {
  type CompiledPolicy,
  compilePolicy,
  evaluatePolicy,
  getToolVisibilityCompiled,
} from "../security/index.js";
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
  private readonly selectionTracker: SelectionTracker;
  private readonly compiledPolicy: CompiledPolicy;
  private readonly indexRefreshManager: IndexRefreshManager;

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

    this.selectionTracker = new SelectionTracker();
    this.compiledPolicy = compilePolicy(this.config);
    this.indexRefreshManager = new IndexRefreshManager({
      cataloger: this.cataloger,
      retriever: this.retriever,
      refreshIntervalMs: this.config.operations.index.refreshIntervalMs,
    });

    this.registerMetaTools();
  }

  /**
   * Filters tools based on security policy visibility.
   * Removes blocked tools and marks confirm-required tools.
   *
   * @param tools - Array of tools to filter
   * @returns Filtered array with requiresConfirmation flag added where applicable
   * @internal
   */
  private filterToolsByPolicy<T extends { name: string; serverKey: string }>(
    tools: T[],
  ): Array<T & { requiresConfirmation?: boolean }> {
    return tools
      .map((tool) => {
        const visibility = getToolVisibilityCompiled(
          tool.serverKey,
          tool.name,
          this.compiledPolicy,
        );
        if (!visibility.visible) {
          return null;
        }
        return visibility.requiresConfirmation
          ? { ...tool, requiresConfirmation: true as const }
          : tool;
      })
      .filter((t): t is T & { requiresConfirmation?: boolean } => t !== null);
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
          detail_level: DetailLevelSchema.optional().describe(
            'Level of detail: "L0" (name only), "L1" (summary with description, default), "L2" (full schema)',
          ),
        },
      },
      async (args) => {
        const result = await this.retriever.search(args.query, {
          limit: args.limit,
          mode: args.mode,
        });

        // Apply security policy filtering
        const filteredTools = this.filterToolsByPolicy(result.tools);

        const detailLevel: DetailLevel =
          args.detail_level ??
          this.config.operations.findTools.defaultDetailLevel;
        const tools = this.formatToolsForDetailLevel(
          filteredTools,
          detailLevel,
        );

        // Get bundle suggestions if selection caching is enabled
        const selectionCacheConfig = this.config.operations.selectionCache;
        let suggestedTools:
          | Array<{ tools: string[]; frequency: number }>
          | undefined;

        if (
          selectionCacheConfig.enabled &&
          selectionCacheConfig.maxBundleSuggestions > 0
        ) {
          const toolKeys = filteredTools.map((t) => `${t.serverKey}:${t.name}`);
          const suggestions = this.retriever
            .getIndexStore()
            .getSuggestedBundles(
              toolKeys,
              selectionCacheConfig.minCooccurrenceThreshold,
              selectionCacheConfig.maxBundleSuggestions,
            );

          if (suggestions.length > 0) {
            suggestedTools = suggestions.map((s) => ({
              tools: [s.toolKey],
              frequency: s.count,
            }));
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                query: result.query,
                totalMatches: filteredTools.length,
                detailLevel,
                tools,
                ...(suggestedTools && { suggestedTools }),
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

        // Apply security policy filtering
        const filteredTools = this.filterToolsByPolicy(result.tools);

        const schemas = filteredTools.map((tool) => ({
          name: tool.name,
          qualifiedName: `${tool.serverKey}:${tool.name}`,
          description: tool.description,
          serverKey: tool.serverKey,
          inputSchema: tool.inputSchema,
          ...(tool.requiresConfirmation && { requiresConfirmation: true }),
        }));

        // Find blocked tools (requested but filtered out by policy)
        const filteredNames = new Set(filteredTools.map((t) => t.name));
        const blocked = result.tools
          .filter((t) => !filteredNames.has(t.name))
          .map((t) => `${t.serverKey}:${t.name}`);

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
                blocked: blocked.length > 0 ? blocked : undefined,
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

          // Track tool usage for selection caching (only on success)
          if (
            !result.isError &&
            this.config.operations.selectionCache.enabled
          ) {
            const toolKey = `${tool.serverKey}:${tool.name}`;
            this.selectionTracker.trackToolUsage(toolKey);

            // Flush co-occurrences if we have multiple tools in session
            if (this.selectionTracker.getSessionToolCount() >= 2) {
              this.selectionTracker.flushToStore(
                this.retriever.getIndexStore(),
              );
            }
          }

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

    this.mcpServer.registerTool(
      "clear_selection_cache",
      {
        description:
          "Clears all learned tool co-occurrence patterns. Use this to reset the selection cache if suggestions become stale or irrelevant.",
        inputSchema: {},
      },
      async () => {
        const countBefore = this.retriever
          .getIndexStore()
          .getCooccurrenceCount();
        this.retriever.getIndexStore().clearCooccurrences();
        this.selectionTracker.reset();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                message: "Selection cache cleared",
                patternsRemoved: countBefore,
              }),
            },
          ],
        };
      },
    );

    this.mcpServer.registerTool(
      "list_namespaces",
      {
        description:
          "Lists all available namespaces (upstream MCP servers). Use this to discover available servers and understand which namespaces are available when disambiguating tool names with qualified format (namespace:tool_name).",
        inputSchema: {
          include_tools: z
            .boolean()
            .default(false)
            .describe(
              "If true, includes the list of tool names available in each namespace",
            ),
        },
      },
      async (args) => {
        const status = this.cataloger.getStatus();
        const namespaces: Array<{
          name: string;
          status: string;
          toolCount: number;
          error?: string;
          tools?: string[];
        }> = [];

        for (const [key, info] of status) {
          const tools = this.cataloger.getToolsForServer(key);
          const namespace: {
            name: string;
            status: string;
            toolCount: number;
            error?: string;
            tools?: string[];
          } = {
            name: key,
            status: info.status,
            toolCount: tools.length,
          };

          if (info.error) {
            namespace.error = info.error;
          }

          if (args.include_tools && tools.length > 0) {
            namespace.tools = tools.map((t) => t.name);
          }

          namespaces.push(namespace);
        }

        // Also detect tool conflicts to help with disambiguation
        const conflicts = this.cataloger.getConflictingTools();
        const conflictingTools: Record<string, string[]> = {};
        for (const [toolName, qualifiedNames] of conflicts) {
          conflictingTools[toolName] = qualifiedNames;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                namespaces,
                totalNamespaces: namespaces.length,
                connectedCount: namespaces.filter(
                  (n) => n.status === "connected",
                ).length,
                ...(Object.keys(conflictingTools).length > 0 && {
                  conflictingTools,
                  conflictNote:
                    "These tools exist on multiple servers. Use qualified names (namespace:tool_name) to disambiguate.",
                }),
              }),
            },
          ],
        };
      },
    );
  }

  /**
   * Formats tool results based on the requested detail level.
   * Preserves the requiresConfirmation flag through formatting.
   *
   * @param tools - Array of tool summaries from search results (may include requiresConfirmation)
   * @param level - Detail level (L0, L1, or L2)
   * @returns Formatted tools at the requested detail level
   * @internal
   */
  private formatToolsForDetailLevel(
    tools: Array<ToolSummary & { requiresConfirmation?: boolean }>,
    level: DetailLevel,
  ): ToolResult[] {
    switch (level) {
      case "L0":
        // Name only - minimal context footprint
        return tools.map(
          (t): ToolIdentity & { requiresConfirmation?: boolean } => ({
            name: t.name,
            serverKey: t.serverKey,
            ...(t.requiresConfirmation && { requiresConfirmation: true }),
          }),
        );

      case "L2": {
        // Full schema - include inputSchema for immediate execution
        return tools.map(
          (t): ToolFullSchema & { requiresConfirmation?: boolean } => {
            const { tool } = this.cataloger.findTool(
              `${t.serverKey}:${t.name}`,
            );
            return {
              name: t.name,
              description: t.description,
              serverKey: t.serverKey,
              inputSchema: tool?.inputSchema ?? { type: "object" },
              ...(t.requiresConfirmation && { requiresConfirmation: true }),
            };
          },
        );
      }

      default:
        // L1: Summary (default) - name + description
        return tools.map((t) => ({
          name: t.name,
          description: t.description,
          serverKey: t.serverKey,
          ...(t.requiresConfirmation && { requiresConfirmation: true }),
        }));
    }
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
    // Connect to all enabled upstream servers in parallel
    const upstreamEntries = Object.entries(this.config.upstreams);
    const enabledUpstreams = upstreamEntries.filter(
      ([_, upstream]) => upstream.enabled,
    );

    // Parallel connections - all upstreams connect concurrently
    const connectionPromises = enabledUpstreams.map(async ([key, upstream]) => {
      try {
        await this.cataloger.connect(key, upstream);
        return { key, success: true as const };
      } catch {
        // Log error but continue with other upstreams
        // Individual upstream failures shouldn't prevent server startup
        return { key, success: false as const };
      }
    });

    await Promise.all(connectionPromises);

    // Sync the tool index after connecting to upstreams
    this.syncIndex();

    // Start background index refresh
    this.indexRefreshManager.start();

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
    // Stop background refresh first
    this.indexRefreshManager.stop();

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
