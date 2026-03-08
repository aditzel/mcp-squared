/**
 * Status command runner — shows upstream server status and capability routing.
 *
 * Connects to all enabled upstreams, runs capability inference, computes the
 * action routing table, and prints a structured report.
 *
 * @module status/runner
 */

import {
  classifyNamespaces,
  groupClassificationsByCapability,
  type NamespaceClassification,
} from "../capabilities/inference.js";
import {
  type AdapterProjectionResult,
  projectNamespaceClassifications,
} from "../capabilities/projection.js";
import {
  buildCapabilityRouters,
  type CapabilityRouter,
} from "../capabilities/routing.js";
import {
  formatValidationIssues,
  loadConfig,
  type McpSquaredConfig,
  validateConfig,
} from "../config/index.js";
import type { ConnectionStatus } from "../upstream/cataloger.js";
import { Cataloger } from "../upstream/cataloger.js";
import {
  type ContextStats,
  computeContextStats,
} from "../utils/context-stats.js";

/** Options for the status command. */
export interface StatusOptions {
  /** Show detailed output including schema parameters and override sources */
  verbose: boolean;
}

/** Status info for a single upstream server. */
export interface UpstreamStatus {
  name: string;
  enabled: boolean;
  status: ConnectionStatus;
  error?: string | undefined;
  toolCount: number;
  serverName?: string | undefined;
  serverVersion?: string | undefined;
}

/** Result of the status command (for testing). */
export interface StatusResult {
  upstreams: UpstreamStatus[];
  routers: CapabilityRouter[];
  classifications?: NamespaceClassification[];
  adapterProjection?: {
    adapterId: string;
    projections: AdapterProjectionResult[];
  };
  configPath?: string;
  contextStats?: ContextStats;
}

// ANSI helpers
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * Collects status data by connecting to upstreams and computing routing.
 * Separated from formatting for testability.
 */
export async function collectStatus(
  config: McpSquaredConfig,
): Promise<StatusResult> {
  const cataloger = new Cataloger({ connectTimeoutMs: 15_000 });
  const upstreams: UpstreamStatus[] = [];

  try {
    // Connect to all enabled upstreams
    await cataloger.connectAll(config);

    // Gather upstream status
    const status = cataloger.getStatus();
    for (const [name, serverConfig] of Object.entries(config.upstreams)) {
      if (!serverConfig.enabled) {
        upstreams.push({
          name,
          enabled: false,
          status: "disconnected",
          toolCount: 0,
        });
        continue;
      }

      const connStatus = status.get(name);
      const connection = cataloger.getConnection(name);

      upstreams.push({
        name,
        enabled: true,
        status: connStatus?.status ?? "disconnected",
        error: connStatus?.error,
        toolCount: connection?.tools.length ?? 0,
        serverName: connection?.serverName,
        serverVersion: connection?.serverVersion,
      });
    }

    // Compute capability routing for connected upstreams
    const inventories = [...status.entries()]
      .filter(([, info]) => info.status === "connected")
      .map(([namespace]) => ({
        namespace,
        title: config.upstreams[namespace]?.label ?? namespace,
        tools: cataloger.getToolsForServer(namespace),
      }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));

    let routers: CapabilityRouter[] = [];
    let classifications: NamespaceClassification[] = [];
    let adapterProjection:
      | {
          adapterId: string;
          projections: AdapterProjectionResult[];
        }
      | undefined;
    if (inventories.length > 0) {
      const overrides =
        config.operations.dynamicToolSurface.capabilityOverrides ?? {};
      const overrideSources = Object.fromEntries(
        Object.keys(overrides).map((namespace) => [namespace, "user_override"]),
      ) as Record<string, "user_override">;
      const facetOverrides =
        config.operations.dynamicToolSurface.facetOverrides ?? {};
      classifications = classifyNamespaces(inventories, {
        capabilityOverrides: overrides,
        capabilityOverrideSources: overrideSources,
        facetOverrides,
      });
      const grouping = groupClassificationsByCapability(classifications);
      routers = buildCapabilityRouters(inventories, grouping);

      if (config.operations.adapterProjection.enabled) {
        const adapterId = config.operations.adapterProjection.defaultAdapter;
        adapterProjection = {
          adapterId,
          projections: projectNamespaceClassifications(
            adapterId,
            classifications,
            config.operations.adapterProjection,
          ),
        };
      }
    }

    // Compute context savings stats
    const allUpstreamTools = inventories.flatMap((inv) => inv.tools);
    const contextStats = computeContextStats(allUpstreamTools, routers);

    return {
      upstreams,
      routers,
      classifications,
      ...(adapterProjection ? { adapterProjection } : {}),
      contextStats,
    };
  } finally {
    await cataloger.disconnectAll();
  }
}

/**
 * Formats and prints the status report to stdout.
 */
export function formatStatus(
  result: StatusResult,
  options: StatusOptions,
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`${BOLD}MCP² Status Report${RESET}`);

  // Section 1: Upstream Servers
  lines.push("");
  lines.push(
    `${DIM}── Upstream Servers ──────────────────────────────────${RESET}`,
  );

  if (result.upstreams.length === 0) {
    lines.push(`  ${DIM}(no upstreams configured)${RESET}`);
  }

  for (const upstream of result.upstreams) {
    if (!upstream.enabled) {
      lines.push(`  ${DIM}⊘ ${upstream.name.padEnd(24)} disabled${RESET}`);
      continue;
    }

    if (upstream.status === "connected") {
      const toolInfo = `(${upstream.toolCount} tool${upstream.toolCount !== 1 ? "s" : ""})`;
      const version = upstream.serverVersion
        ? `  ${DIM}v${upstream.serverVersion}${RESET}`
        : "";
      lines.push(
        `  ${GREEN}✓${RESET} ${upstream.name.padEnd(24)} connected  ${toolInfo}${version}`,
      );
    } else if (upstream.status === "needs_auth") {
      const errorMsg = upstream.error ?? "Authentication required";
      lines.push(
        `  ${YELLOW}⚠${RESET} ${upstream.name.padEnd(24)} needs auth ${DIM}${errorMsg}${RESET}`,
      );
    } else if (upstream.status === "error") {
      const errorMsg = upstream.error ?? "Unknown error";
      lines.push(
        `  ${RED}✗${RESET} ${upstream.name.padEnd(24)} error      ${DIM}${errorMsg}${RESET}`,
      );
    } else {
      lines.push(
        `  ${DIM}? ${upstream.name.padEnd(24)} ${upstream.status}${RESET}`,
      );
    }
  }

  // Section 2: Namespace Classification (verbose only)
  if (
    options.verbose &&
    result.classifications &&
    result.classifications.length
  ) {
    lines.push("");
    lines.push(
      `${DIM}── Namespace Classification ─────────────────────────${RESET}`,
    );

    const projectionsByNamespace = new Map<string, AdapterProjectionResult>();
    for (const projection of result.adapterProjection?.projections ?? []) {
      projectionsByNamespace.set(projection.namespace, projection);
    }

    for (const classification of result.classifications) {
      lines.push(
        `  ${classification.namespace.padEnd(24)} ${BOLD}${classification.canonicalCapability}${RESET}`,
      );
      lines.push(`    ${DIM}source=${classification.capabilitySource}${RESET}`);
      lines.push(
        `    ${DIM}confidence=${classification.confidence.toFixed(2)}${RESET}`,
      );
      if (classification.runnerUp) {
        lines.push(
          `    ${DIM}runner-up=${classification.runnerUp.canonicalCapability} (${classification.runnerUp.confidence.toFixed(2)})${RESET}`,
        );
      }
      if (classification.facets.length > 0) {
        lines.push(
          `    ${DIM}facets:${RESET} ${classification.facets.join(", ")}`,
        );
      }

      const projection = projectionsByNamespace.get(classification.namespace);
      if (projection && result.adapterProjection) {
        lines.push(
          `    ${DIM}projection[${result.adapterProjection.adapterId}]:${RESET} ${projection.bucket} ${DIM}(${projection.source})${RESET}`,
        );
      }
    }
  }

  // Section 3: Capability Routing
  lines.push("");
  lines.push(
    `${DIM}── Capability Routing ────────────────────────────────${RESET}`,
  );

  if (result.routers.length === 0) {
    lines.push(
      `  ${DIM}(no capabilities routed — no connected upstreams)${RESET}`,
    );
  }

  let totalActions = 0;
  for (const router of result.routers) {
    const count = router.actions.length;
    totalActions += count;
    const plural = count !== 1 ? "s" : "";
    lines.push(
      `  ${BOLD}${router.capability}${RESET} ${DIM}(${count} action${plural})${RESET}`,
    );

    if (count === 0) {
      lines.push(`    ${DIM}(no actions)${RESET}`);
    }

    for (const action of router.actions) {
      const actionName = action.action.padEnd(28);
      const mapping = `${DIM}→${RESET} ${action.qualifiedName}`;

      if (options.verbose) {
        const schemaKeys = Object.keys(
          (action.inputSchema?.properties as Record<string, unknown>) ?? {},
        );
        const params =
          schemaKeys.length > 0
            ? ` ${DIM}(${schemaKeys.join(", ")})${RESET}`
            : "";
        lines.push(`    ${actionName} ${mapping}${params}`);
      } else {
        lines.push(`    ${actionName} ${mapping}`);
      }
    }

    lines.push(""); // blank line between capabilities
  }

  // Section 4: Context Savings (verbose only)
  if (options.verbose && result.contextStats) {
    const cs = result.contextStats;
    if (cs.upstreamToolCount > 0) {
      lines.push(
        `${DIM}── Context Savings ──────────────────────────────────${RESET}`,
      );

      const fmt = (n: number) => n.toLocaleString("en-US");

      const withoutLabel = `Without MCP\u00B2:`;
      const withLabel = `With MCP\u00B2:`;
      const savedLabel = `Saved:`;

      lines.push(
        `  ${withoutLabel.padEnd(16)} ${fmt(cs.withoutMcp2Tokens).padStart(8)} tokens  ${DIM}(${cs.upstreamToolCount} tool${cs.upstreamToolCount !== 1 ? "s" : ""})${RESET}`,
      );
      lines.push(
        `  ${withLabel.padEnd(16)} ${fmt(cs.withMcp2Tokens).padStart(8)} tokens  ${DIM}(${cs.capabilityToolCount} tool${cs.capabilityToolCount !== 1 ? "s" : ""})${RESET}`,
      );

      if (cs.savedTokens > 0) {
        lines.push(`  ${DIM}${"─".repeat(40)}${RESET}`);
        lines.push(
          `  ${GREEN}${savedLabel.padEnd(16)} ${fmt(cs.savedTokens).padStart(8)} tokens  (${cs.savedPercent}%)${RESET}`,
        );
      }

      lines.push("");
    }
  }

  // Summary
  const connected = result.upstreams.filter(
    (u) => u.status === "connected",
  ).length;
  const needsAuth = result.upstreams.filter(
    (u) => u.status === "needs_auth",
  ).length;
  const errors = result.upstreams.filter((u) => u.status === "error").length;
  const disabled = result.upstreams.filter((u) => !u.enabled).length;
  const capCount = result.routers.filter((r) => r.actions.length > 0).length;

  const parts: string[] = [];
  if (connected > 0) parts.push(`${GREEN}${connected} connected${RESET}`);
  if (needsAuth > 0) parts.push(`${YELLOW}${needsAuth} needs auth${RESET}`);
  if (errors > 0) parts.push(`${RED}${errors} error${RESET}`);
  if (disabled > 0) parts.push(`${DIM}${disabled} disabled${RESET}`);

  const actionSummary =
    totalActions > 0
      ? `${totalActions} action${totalActions !== 1 ? "s" : ""} across ${capCount} capabilit${capCount !== 1 ? "ies" : "y"}`
      : "no actions";

  lines.push(`${DIM}Summary:${RESET} ${parts.join(", ")} | ${actionSummary}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Runs the status command: loads config, connects to upstreams, and prints report.
 */
export async function runStatus(options: StatusOptions): Promise<void> {
  let config: McpSquaredConfig;
  let configPath: string | undefined;

  try {
    const loaded = await loadConfig();
    config = loaded.config;
    configPath = loaded.path;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error loading configuration: ${message}`);
    console.error(
      "Run 'mcp-squared config' to create or fix your configuration.",
    );
    process.exit(1);
  }

  const upstreamEntries = Object.entries(config.upstreams);
  if (upstreamEntries.length === 0) {
    console.error(
      "Error: No upstreams configured. Run 'mcp-squared config' to add one.",
    );
    process.exit(1);
  }

  // Validate configuration
  const validationIssues = validateConfig(config);
  if (validationIssues.length > 0) {
    console.error(formatValidationIssues(validationIssues));
    console.error("");
  }

  if (options.verbose && configPath) {
    console.log(`${DIM}Config: ${configPath}${RESET}`);
  }

  console.log("Connecting to upstream servers...");
  const result = await collectStatus(config);
  result.configPath = configPath;

  const output = formatStatus(result, options);
  console.log(output);
}
