/**
 * MCP² Server module - capability-first MCP router.
 *
 * Public tool surface is capability-oriented and generated at connect time.
 * Upstream server/tool routing remains internal.
 *
 * @module server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import type { CapabilityId } from "../capabilities/inference.js";
import type { CapabilityRouter } from "../capabilities/routing.js";
import { ensureSocketDir, getSocketFilePath } from "../config/index.js";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "../config/schema.js";
import { Retriever } from "../retriever/index.js";
import { type CompiledPolicy, compilePolicy } from "../security/index.js";
import { Cataloger } from "../upstream/index.js";
import { VERSION } from "../version.js";
import {
  buildCapabilityRouters as buildServerCapabilityRouters,
  buildServerInstructions,
  capabilitySummary,
  capabilityTitle,
} from "./capability-surface.js";
import { executeCapabilityTool } from "./capability-tool-executor.js";
import { registerCapabilityTools } from "./capability-tool-surface.js";
import { MonitorServer } from "./monitor-server.js";
import {
  DEFAULT_RESPONSE_RESOURCE_CONFIG,
  ResponseResourceManager,
} from "./response-resource.js";
import {
  classifyNamespacesSemantic,
  registerRuntimeRefreshHooks,
  startServerRuntimeCore,
  stopServerRuntimeCore,
} from "./runtime-lifecycle.js";
import {
  createSessionServer as createConfiguredSessionServer,
  startPrimaryServerSession,
  stopPrimaryServerSession,
} from "./server-shell.js";
import { registerConfiguredSessionSurface } from "./session-surface.js";
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

    this.mcpServer = this.buildMcpServer(name, version);

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

    registerRuntimeRefreshHooks({
      indexRefreshManager: this.indexRefreshManager,
      statsCollector: this.statsCollector,
      retriever: this.retriever,
      embeddingsEnabled: this.config.operations.embeddings.enabled,
    });
  }

  /**
   * Creates a new MCP server instance with the configured capabilities.
   * @internal
   */
  private buildMcpServer(name: string, version: string): McpServer {
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
    return buildServerInstructions();
  }

  /**
   * Creates a new MCP server session bound to this runtime.
   * Use this for multi-client transports (daemon mode).
   */
  createSessionServer(): McpServer {
    return createConfiguredSessionServer({
      name: this.serverName,
      version: this.serverVersion,
      createMcpServer: (name, version) => this.buildMcpServer(name, version),
      registerConfiguredSessionSurface: (server) =>
        this.registerConfiguredSessionSurface(server),
    });
  }

  private registerConfiguredSessionSurface(server: McpServer): void {
    registerConfiguredSessionSurface({
      server,
      registerCapabilityTools: () => this.registerCapabilityRouters(server),
      responseResourceManager: this.responseResourceManager,
    });
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
    return capabilityTitle(capability);
  }

  private capabilitySummary(capability: CapabilityId): string {
    return capabilitySummary(capability);
  }

  private buildCapabilityRouters(): CapabilityRouter[] {
    return buildServerCapabilityRouters({
      statusEntries: this.cataloger.getStatus().entries(),
      getToolsForServer: (namespace) =>
        this.cataloger.getToolsForServer(namespace),
      upstreams: this.config.upstreams,
      computedCapabilityOverrides: this.computedCapabilityOverrides,
      configuredCapabilityOverrides:
        this.config.operations.dynamicToolSurface.capabilityOverrides,
    });
  }

  private getCapabilityRouter(capability: CapabilityId): CapabilityRouter {
    return (
      this.buildCapabilityRouters().find(
        (router) => router.capability === capability,
      ) ?? {
        capability,
        actions: [],
      }
    );
  }

  private registerCapabilityRouters(server: McpServer): void {
    registerCapabilityTools({
      server,
      routers: this.buildCapabilityRouters(),
      getCapabilityTitle: (capability) => this.capabilityTitle(capability),
      getCapabilitySummary: (capability) => this.capabilitySummary(capability),
      getLiveRouter: (capability) => this.getCapabilityRouter(capability),
      compiledPolicy: this.compiledPolicy,
      runCapabilityTask: (capability, run) => this.runTaskSpan(capability, run),
      onCapabilityRequestStarted: () => ({
        requestId: this.statsCollector.startRequest(),
        startTime: Date.now(),
      }),
      onCapabilityRequestFinished: ({
        requestId,
        capability,
        success,
        startTime,
      }) => {
        this.statsCollector.endRequest(
          requestId,
          success,
          Date.now() - startTime,
          capability,
          "capability",
        );
      },
      executeRoute: (args) => this.executeRoutedTool(args),
    });
  }

  private async executeRoutedTool(args: {
    capability: CapabilityId;
    action: string;
    policyAction?: string;
    routeId?: string;
    qualifiedToolName: string;
    toolNameForCall: string;
    args: Record<string, unknown>;
    confirmationToken?: string;
  }): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError: boolean;
    structuredContent?: Record<string, unknown>;
  }> {
    return executeCapabilityTool({
      capability: args.capability,
      action: args.action,
      policyAction: args.policyAction,
      routeId: args.routeId,
      toolNameForCall: args.toolNameForCall,
      args: args.args,
      confirmationToken: args.confirmationToken,
      config: this.config,
      responseResourceManager: this.responseResourceManager,
      enforceGuard: ({ tool, action, params }) => {
        this.guard.enforce({
          agent: this.safetyAgent,
          tool,
          action,
          params,
        });
      },
      callTool: (toolNameForCall, callArgs) =>
        tool_span(
          this.obsSink,
          {
            agent: this.safetyAgent,
            tool: args.routeId ?? `${args.capability}:${args.action}`,
            action: "call",
            playbook: this.guard.playbook,
            env: this.guard.agentEnv,
          },
          () => this.cataloger.callTool(toolNameForCall, callArgs),
        ),
      onSuccessfulSelection: this.config.operations.selectionCache.enabled
        ? (toolKey) => {
            this.selectionTracker.trackToolUsage(toolKey);
            if (this.selectionTracker.getSessionToolCount() >= 2) {
              this.selectionTracker.flushToStore(
                this.retriever.getIndexStore(),
              );
            }
          }
        : undefined,
    });
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
   * Returns the active monitor socket endpoint.
   */
  getMonitorSocketPath(): string {
    return this.monitorServer.getSocketPath();
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
    await classifyNamespacesSemantic({
      config: this.config,
      retriever: this.retriever,
      cataloger: this.cataloger,
      setComputedCapabilityOverrides: (overrides) => {
        this.computedCapabilityOverrides = overrides;
      },
    });
  }

  /**
   * Starts the MCP server and begins listening for client connections via stdio.
   * Automatically connects to all enabled upstream servers and syncs the tool index.
   *
   * @returns Promise that resolves when the server is ready
   */
  async start(): Promise<void> {
    const state = await startPrimaryServerSession({
      startCore: () => this.startCore(),
      baseToolsRegistered: this.baseToolsRegistered,
      server: this.mcpServer,
      registerConfiguredSessionSurface: (server) =>
        this.registerConfiguredSessionSurface(server),
      statsCollector: this.statsCollector,
    });

    this.baseToolsRegistered = state.baseToolsRegistered;
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

    await startServerRuntimeCore({
      config: this.config,
      cataloger: this.cataloger,
      retriever: this.retriever,
      statsCollector: this.statsCollector,
      indexRefreshManager: this.indexRefreshManager,
      monitorServer: this.monitorServer,
      ensureSocketDir,
      syncIndex: () => this.syncIndex(),
      classifyNamespacesSemantic: () => this.classifyNamespacesSemantic(),
    });
  }

  /**
   * Stops the server and cleans up all resources.
   * Closes the MCP connection, retriever index, and disconnects all upstreams.
   *
   * @returns Promise that resolves when shutdown is complete
   */
  async stop(): Promise<void> {
    await stopPrimaryServerSession({
      server: this.mcpServer,
      statsCollector: this.statsCollector,
      stopCore: () => this.stopCore(),
    });
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

    await stopServerRuntimeCore({
      indexRefreshManager: this.indexRefreshManager,
      monitorServer: this.monitorServer,
      retriever: this.retriever,
      ownsCataloger: this.ownsCataloger,
      cataloger: this.cataloger,
    });
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
