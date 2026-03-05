/**
 * MCP² Server module - capability-first MCP router.
 *
 * Public tool surface is capability-oriented and generated at connect time.
 * Upstream server/tool routing remains internal.
 *
 * @module server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  build_sink,
  Guard,
  type LoadedPolicy,
  load_policy,
  type ObsSink,
  readSafetyEnv,
  task_span,
  tool_span,
} from "../../agent_safety_kit/index.js";
import { IndexRefreshManager } from "../background/index.js";
import { SelectionTracker } from "../caching/index.js";
import {
  type CapabilityId,
  groupNamespacesByCapability,
} from "../capabilities/inference.js";
import {
  buildCapabilityRouters as buildRouters,
  type CapabilityRouter,
} from "../capabilities/routing.js";
import { ensureSocketDir, getSocketFilePath } from "../config/index.js";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "../config/schema.js";
import { Retriever } from "../retriever/index.js";
import {
  type CompiledPolicy,
  compilePolicy,
  evaluatePolicy,
  getToolVisibilityCompiled,
} from "../security/index.js";
import { Cataloger, type ToolInputSchema } from "../upstream/index.js";
import {
  capabilitySummary as sharedCapabilitySummary,
  capabilityTitle as sharedCapabilityTitle,
} from "../utils/capability-meta.js";
import { VERSION } from "../version.js";
import { MonitorServer } from "./monitor-server.js";
import {
  DEFAULT_RESPONSE_RESOURCE_CONFIG,
  ResponseResourceManager,
} from "./response-resource.js";
import { type ServerStats, StatsCollector, type ToolStats } from "./stats.js";

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
  /** Default result limit for internal retrieval/index operations */
  defaultLimit?: number;
  /** Maximum result limit for internal retrieval/index operations */
  maxLimit?: number;
  /** Whether to enable detailed tool-level stats tracking (default: false) */
  enableToolStats?: boolean;
  /** Monitor socket path override */
  monitorSocketPath?: string;
}

const DESCRIBE_ACTION = "__describe_actions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The main MCP² server class that exposes capability routers.
 *
 * @example
 * ```ts
 * const server = new McpSquaredServer({ config: await loadConfig() });
 * await server.start();
 * ```
 */
export class McpSquaredServer {
  private readonly mcpServer: McpServer;
  private readonly cataloger: Cataloger;
  private readonly retriever: Retriever;
  private readonly config: McpSquaredConfig;
  private transport: StdioServerTransport | null = null;
  private readonly ownsCataloger: boolean;
  private readonly selectionTracker: SelectionTracker;
  private readonly compiledPolicy: CompiledPolicy;
  private readonly indexRefreshManager: IndexRefreshManager;
  private readonly statsCollector: StatsCollector;
  private readonly responseResourceManager: ResponseResourceManager;
  private readonly monitorServer: MonitorServer;
  private isCoreStarted = false;
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly safetyAgent: string;
  private readonly obsSink: ObsSink;
  private readonly guard: Guard;
  private baseToolsRegistered = false;
  private computedCapabilityOverrides: Partial<Record<string, CapabilityId>> =
    {};

  /**
   * Creates a new MCP² server instance.
   *
   * @param options - Server configuration options
   */
  constructor(options: McpSquaredServerOptions = {}) {
    const name = options.name ?? "mcp-squared";
    const version = options.version ?? VERSION;
    this.serverName = name;
    this.serverVersion = version;

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
    const retrieverMaxLimit = options.maxLimit ?? findToolsConfig.maxLimit;
    this.retriever = new Retriever(this.cataloger, {
      indexDbPath: options.indexDbPath,
      defaultLimit: options.defaultLimit ?? findToolsConfig.defaultLimit,
      maxLimit: retrieverMaxLimit,
      defaultMode: findToolsConfig.defaultMode,
    });

    const safetyEnv = readSafetyEnv();
    this.safetyAgent = process.env["MCP_SQUARED_AGENT"] ?? name;
    this.obsSink = build_sink({
      enabled: safetyEnv.enabled,
      sinkName: safetyEnv.obsSink,
      serviceName: process.env["OTEL_SERVICE_NAME"] ?? name,
    });

    let loadedPolicy: LoadedPolicy | null = null;
    if (safetyEnv.enabled) {
      loadedPolicy = load_policy({
        path: safetyEnv.policyPath,
        playbook: safetyEnv.playbook,
        agentEnv: safetyEnv.agentEnv,
        reportOnly: safetyEnv.reportOnly,
      });
    }
    this.guard = new Guard({
      enabled: safetyEnv.enabled,
      policy: loadedPolicy,
      sink: this.obsSink,
    });

    // Initialize response resource manager (before createMcpServer which checks isEnabled)
    const rrConfig =
      this.config.operations.responseResource ??
      DEFAULT_RESPONSE_RESOURCE_CONFIG;
    this.responseResourceManager = new ResponseResourceManager(rrConfig);

    this.mcpServer = this.createMcpServer(name, version);

    this.selectionTracker = new SelectionTracker();
    this.compiledPolicy = compilePolicy(this.config);
    this.indexRefreshManager = new IndexRefreshManager({
      cataloger: this.cataloger,
      retriever: this.retriever,
      refreshIntervalMs: this.config.operations.index.refreshIntervalMs,
    });

    // Initialize stats collector
    this.statsCollector = new StatsCollector({
      indexStore: this.retriever.getIndexStore(),
      enableToolTracking: options.enableToolStats ?? false,
    });

    // Initialize monitor server
    const monitorSocketPath = options.monitorSocketPath ?? getSocketFilePath();
    this.monitorServer = new MonitorServer({
      socketPath: monitorSocketPath,
      statsCollector: this.statsCollector,
      cataloger: this.cataloger,
    });

    // Hook into index refresh events to update stats and generate embeddings
    this.indexRefreshManager.on("refresh:complete", () => {
      this.statsCollector.updateIndexRefreshTime(Date.now());
      // Generate embeddings for any new tools added during refresh
      if (this.config.operations.embeddings.enabled) {
        this.retriever.generateToolEmbeddings().catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[mcp²] Background embedding generation failed — ${message}`,
          );
        });
      }
    });
  }

  /**
   * Creates a new MCP server instance with the configured capabilities.
   * @internal
   */
  private createMcpServer(name: string, version: string): McpServer {
    return new McpServer(
      {
        name,
        version,
        title: "MCP² Capability Router",
        description:
          "Execute capability-first tools routed to connected upstream MCP servers.",
      },
      {
        capabilities: {
          tools: {},
          ...(this.responseResourceManager.isEnabled()
            ? { resources: {} }
            : {}),
        },
        instructions: this.buildServerInstructions(),
      },
    );
  }

  /**
   * Builds server-level usage instructions returned during MCP initialize.
   *
   * Per MCP spec, clients may surface these instructions directly to the model
   * (for example by appending them to the system prompt), so keep them concise
   * and action-oriented.
   */
  private buildServerInstructions(): string {
    return [
      "Tool surface is generated at connect time from inferred upstream capabilities.",
      "Each capability tool accepts `action`, `arguments`, and optional `confirmation_token`.",
      'Call a capability tool with `action = "__describe_actions"` to inspect available actions and schemas.',
      "Use returned action IDs for execution calls; if disambiguation is required, choose one candidate action and retry.",
    ].join(" ");
  }

  /**
   * Creates a new MCP server session bound to this runtime.
   * Use this for multi-client transports (daemon mode).
   */
  createSessionServer(): McpServer {
    const server = this.createMcpServer(this.serverName, this.serverVersion);
    this.registerConfiguredToolSurface(server);
    return server;
  }

  private registerConfiguredToolSurface(server: McpServer): void {
    this.registerCapabilityRouters(server);
    if (this.responseResourceManager.isEnabled()) {
      this.registerResponseResources(server);
    }
  }

  private registerResponseResources(server: McpServer): void {
    const mgr = this.responseResourceManager;

    server.registerResource(
      "response-resources",
      "mcp2://response/{capability}/{id}",
      {
        description:
          "Temporary resources containing full tool responses that exceeded the inline size threshold.",
        mimeType: "text/plain",
      },
      async (uri) => {
        const result = mgr.readResource(uri.href);
        if (!result) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "text/plain",
                text: JSON.stringify({
                  error: "Resource not found or expired",
                }),
              },
            ],
          };
        }
        return result;
      },
    );
  }

  private runTaskSpan<T>(
    taskName: string,
    run: () => Promise<T> | T,
  ): Promise<T> {
    return task_span(
      this.obsSink,
      {
        agent: this.safetyAgent,
        taskName,
        playbook: this.guard.playbook,
        env: this.guard.agentEnv,
      },
      run,
    );
  }

  private capabilityTitle(capability: CapabilityId): string {
    return sharedCapabilityTitle(capability);
  }

  private capabilitySummary(capability: CapabilityId): string {
    return sharedCapabilitySummary(capability);
  }

  private actionSummary(
    description: string | null | undefined,
    capability: CapabilityId,
  ): string {
    if (typeof description === "string") {
      const singleLine = description.split(/\r?\n/, 1)[0]?.trim() ?? "";
      if (singleLine.length > 0) {
        return singleLine;
      }
    }
    return `Execute ${this.capabilityTitle(capability)} action`;
  }

  private buildCapabilityRouters(): CapabilityRouter[] {
    const status = this.cataloger.getStatus();
    const inventories = [...status.entries()]
      .filter(([, info]) => info.status === "connected")
      .map(([namespace]) => ({
        namespace,
        tools: this.cataloger.getToolsForServer(namespace),
      }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));

    if (inventories.length === 0) {
      return [];
    }

    const overrides = {
      ...this.computedCapabilityOverrides,
      ...this.config.operations.dynamicToolSurface.capabilityOverrides,
    };
    const grouping = groupNamespacesByCapability(inventories, overrides);

    return buildRouters(inventories, grouping, (desc, cap) =>
      this.actionSummary(desc, cap),
    );
  }

  private registerCapabilityRouters(server: McpServer): void {
    const routers = this.buildCapabilityRouters();
    for (const router of routers) {
      if (router.actions.length === 0) {
        continue;
      }

      server.registerTool(
        router.capability,
        {
          title: this.capabilityTitle(router.capability),
          description: this.capabilitySummary(router.capability),
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: true,
          },
          inputSchema: {
            action: z
              .string()
              .describe(
                `Action ID for ${router.capability}. Use "${DESCRIBE_ACTION}" to inspect available actions and schemas.`,
              ),
            arguments: z
              .record(z.string(), z.unknown())
              .default({})
              .describe("Arguments for the selected capability action"),
            confirmation_token: z
              .string()
              .optional()
              .describe(
                "Optional confirmation token for actions that require explicit confirmation",
              ),
          },
        },
        async (rawArgs) =>
          this.runTaskSpan(router.capability, async () => {
            const requestId = this.statsCollector.startRequest();
            const startTime = Date.now();
            let success = false;

            try {
              const parsedArgs: Record<string, unknown> = isRecord(rawArgs)
                ? { ...rawArgs }
                : {};
              const action =
                typeof parsedArgs["action"] === "string"
                  ? parsedArgs["action"]
                  : "";
              const confirmationToken =
                typeof parsedArgs["confirmation_token"] === "string"
                  ? parsedArgs["confirmation_token"]
                  : undefined;
              const actionArgs = isRecord(parsedArgs["arguments"])
                ? (parsedArgs["arguments"] as Record<string, unknown>)
                : {};

              if (action.length === 0) {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: JSON.stringify({
                        error: "Missing required action",
                        capability: router.capability,
                      }),
                    },
                  ],
                  isError: true,
                };
              }

              const visibleActions = router.actions
                .map((route) => {
                  const visibility = getToolVisibilityCompiled(
                    router.capability,
                    route.action,
                    this.compiledPolicy,
                  );
                  if (!visibility.visible) {
                    return null;
                  }
                  return {
                    action: route.action,
                    summary: route.summary,
                    inputSchema: route.inputSchema,
                    requiresConfirmation: visibility.requiresConfirmation,
                  };
                })
                .filter(
                  (
                    entry,
                  ): entry is {
                    action: string;
                    summary: string;
                    inputSchema: ToolInputSchema;
                    requiresConfirmation: boolean;
                  } => entry !== null,
                )
                .sort((a, b) => a.action.localeCompare(b.action));

              if (action === DESCRIBE_ACTION) {
                success = true;
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: JSON.stringify({
                        capability: router.capability,
                        actions: visibleActions,
                        totalActions: visibleActions.length,
                      }),
                    },
                  ],
                };
              }

              const ambiguousCandidates = router.actions
                .filter((route) => route.baseAction === action)
                .map((route) => route.action)
                .sort((a, b) => a.localeCompare(b));

              if (ambiguousCandidates.length > 1) {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: JSON.stringify({
                        requires_disambiguation: true,
                        capability: router.capability,
                        action,
                        candidates: ambiguousCandidates,
                      }),
                    },
                  ],
                  isError: true,
                };
              }

              const route = router.actions.find(
                (entry) => entry.action === action,
              );
              if (!route) {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: JSON.stringify({
                        error: "Unknown action",
                        capability: router.capability,
                        action,
                        availableActions: visibleActions.map((a) => a.action),
                      }),
                    },
                  ],
                  isError: true,
                };
              }

              const callResult = await this.executeRoutedTool({
                capability: router.capability,
                action: route.action,
                qualifiedToolName: route.qualifiedName,
                toolNameForCall: route.qualifiedName,
                args: actionArgs,
                ...(confirmationToken != null ? { confirmationToken } : {}),
              });
              success = !callResult.isError;
              return callResult;
            } catch {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      error: "Action execution failed",
                    }),
                  },
                ],
                isError: true,
              };
            } finally {
              const responseTime = Date.now() - startTime;
              this.statsCollector.endRequest(
                requestId,
                success,
                responseTime,
                router.capability,
                "capability",
              );
            }
          }),
      );
    }
  }

  private normalizeToolResultContent(content: unknown[]): Array<{
    type: "text";
    text: string;
  }> {
    return content.map((entry) => {
      if (typeof entry === "object" && entry !== null && "type" in entry) {
        return entry as { type: "text"; text: string };
      }
      return {
        type: "text" as const,
        text: JSON.stringify(entry),
      };
    });
  }

  private async executeRoutedTool(args: {
    capability: CapabilityId;
    action: string;
    qualifiedToolName: string;
    toolNameForCall: string;
    args: Record<string, unknown>;
    confirmationToken?: string;
  }): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError: boolean;
  }> {
    const policyResult = evaluatePolicy(
      {
        capability: args.capability,
        action: args.action,
        confirmationToken: args.confirmationToken,
      },
      this.config,
    );

    if (policyResult.decision === "block") {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Action blocked by security policy",
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
              message: "Action requires confirmation by security policy",
            }),
          },
        ],
        isError: false,
      };
    }

    this.guard.enforce({
      agent: this.safetyAgent,
      tool: `${args.capability}:${args.action}`,
      action: "call",
      params: args.args,
    });

    const result = await tool_span(
      this.obsSink,
      {
        agent: this.safetyAgent,
        tool: `${args.capability}:${args.action}`,
        action: "call",
        playbook: this.guard.playbook,
        env: this.guard.agentEnv,
      },
      () => this.cataloger.callTool(args.toolNameForCall, args.args),
    );

    if (!result.isError && this.config.operations.selectionCache.enabled) {
      const toolKey = `${args.capability}:${args.action}`;
      this.selectionTracker.trackToolUsage(toolKey);
      if (this.selectionTracker.getSessionToolCount() >= 2) {
        this.selectionTracker.flushToStore(this.retriever.getIndexStore());
      }
    }

    const normalizedContent = this.normalizeToolResultContent(result.content);

    // Offload large responses to MCP Resources when enabled
    if (
      !result.isError &&
      this.responseResourceManager.isEnabled() &&
      this.responseResourceManager.shouldOffload(normalizedContent)
    ) {
      const offloaded = this.responseResourceManager.offload(
        normalizedContent,
        { capability: args.capability, action: args.action },
      );
      return {
        content: offloaded.inlineContent,
        isError: false,
      };
    }

    return {
      content: normalizedContent,
      isError: result.isError ?? false,
    };
  }

  /**
   * Synchronizes tools from the cataloger to the full-text search index.
   * Call this after connecting to upstream servers to enable tool search.
   */
  syncIndex(): void {
    this.retriever.syncFromCataloger();
    this.statsCollector.updateIndexRefreshTime(Date.now());
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
   * Returns the stats collector instance used for metrics tracking.
   *
   * @returns The StatsCollector instance
   */
  getStatsCollector(): StatsCollector {
    return this.statsCollector;
  }

  /**
   * Injects a client info provider for the monitor server (daemon mode).
   */
  setMonitorClientProvider(
    provider?: () => import("./monitor-server.js").MonitorClientInfo[],
  ): void {
    this.monitorServer.setClientInfoProvider(provider);
  }

  /**
   * Gets current server statistics.
   *
   * @returns Current server statistics
   */
  getStats(): ServerStats {
    return this.statsCollector.getStats();
  }

  /**
   * Gets tool-level statistics.
   *
   * @param limit - Maximum number of tools to return (default: 100)
   * @returns Array of tool statistics sorted by call count
   */
  getToolStats(limit = 100): ToolStats[] {
    return this.statsCollector.getToolStats(limit);
  }

  /**
   * Runs semantic capability classification using embeddings when hybrid mode
   * is configured. Results are stored as computed overrides that feed into
   * the existing capability routing system.
   */
  private async classifyNamespacesSemantic(): Promise<void> {
    const generator = this.retriever.getEmbeddingGenerator();
    if (!generator) {
      console.error(
        "[mcp²] Hybrid inference: embeddings not available, falling back to heuristic.",
      );
      return;
    }

    try {
      const { SemanticCapabilityClassifier } = await import(
        "../capabilities/semantic-classifier.js"
      );
      const threshold =
        this.config.operations.dynamicToolSurface.semanticConfidenceThreshold;
      const classifier = new SemanticCapabilityClassifier(generator, {
        confidenceThreshold: threshold,
      });
      await classifier.initializeReferences();

      const status = this.cataloger.getStatus();
      const inventories = [...status.entries()]
        .filter(([, info]) => info.status === "connected")
        .map(([namespace]) => ({
          namespace,
          tools: this.cataloger.getToolsForServer(namespace),
        }));

      const result = await classifier.classifyBatch(inventories);
      this.computedCapabilityOverrides = result.overrides;

      const count = Object.keys(result.overrides).length;
      console.error(
        `[mcp²] Hybrid inference: classified ${count}/${inventories.length} namespaces semantically (${Math.round(result.inferenceMs)}ms).`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[mcp²] Hybrid inference: classification failed — ${message}. Falling back to heuristic.`,
      );
    }
  }

  /**
   * Starts the MCP server and begins listening for client connections via stdio.
   * Automatically connects to all enabled upstream servers and syncs the tool index.
   *
   * @returns Promise that resolves when the server is ready
   */
  async start(): Promise<void> {
    await this.startCore();

    if (!this.baseToolsRegistered) {
      this.registerConfiguredToolSurface(this.mcpServer);
      this.baseToolsRegistered = true;
    }

    // Start the MCP transport (stdio)
    this.transport = new StdioServerTransport();
    await this.mcpServer.connect(this.transport);

    // Track active connection
    this.statsCollector.incrementActiveConnections();
  }

  /**
   * Starts the shared runtime components (upstreams, index, monitor).
   * This should only be called once in daemon mode.
   */
  async startCore(): Promise<void> {
    if (this.isCoreStarted) {
      return;
    }
    this.isCoreStarted = true;

    ensureSocketDir();

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

    // Initialize embeddings if enabled in config
    if (this.config.operations.embeddings.enabled) {
      try {
        await this.retriever.initializeEmbeddings();
        const embeddingCount = await this.retriever.generateToolEmbeddings();
        const toolCount = this.retriever.getIndexedToolCount();
        if (this.retriever.hasEmbeddings()) {
          console.error(
            `[mcp²] Embeddings: initialized (${embeddingCount}/${toolCount} tools embedded). Search modes: semantic, hybrid available.`,
          );
        } else {
          console.error(
            `[mcp²] Embeddings: enabled but runtime unavailable (onnxruntime not found). Falling back to fast (FTS5) search.`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[mcp²] Embeddings: initialization failed — ${message}. Falling back to fast (FTS5) search.`,
        );
      }
    }

    // Run semantic classification if hybrid inference is configured
    if (this.config.operations.dynamicToolSurface.inference === "hybrid") {
      await this.classifyNamespacesSemantic();
    }

    // Update index refresh time
    this.statsCollector.updateIndexRefreshTime(Date.now());

    // Start background index refresh
    this.indexRefreshManager.start();

    // Start the monitor server
    await this.monitorServer.start();
  }

  /**
   * Stops the server and cleans up all resources.
   * Closes the MCP connection, retriever index, and disconnects all upstreams.
   *
   * @returns Promise that resolves when shutdown is complete
   */
  async stop(): Promise<void> {
    await this.mcpServer.close();
    this.transport = null;

    // Decrement active connection
    this.statsCollector.decrementActiveConnections();

    await this.stopCore();
  }

  /**
   * Stops the shared runtime components (upstreams, index, monitor).
   *
   * @returns Promise that resolves when shutdown is complete
   */
  async stopCore(): Promise<void> {
    if (!this.isCoreStarted) {
      return;
    }
    this.isCoreStarted = false;

    // Stop background refresh first
    this.indexRefreshManager.stop();

    // Stop the monitor server
    await this.monitorServer.stop();

    this.retriever.close();
    if (this.ownsCataloger) {
      await this.cataloger.disconnectAll();
    }
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
