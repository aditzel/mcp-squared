/**
 * Capability routing utilities for building action routes from upstream tools.
 *
 * Extracts the routing logic from `McpSquaredServer.buildCapabilityRouters()`
 * into pure functions so both the server and CLI commands (e.g., `status`) can
 * share the same deterministic routing computation.
 *
 * @module capabilities/routing
 */

import type { ToolInputSchema } from "../upstream/cataloger.js";
import type {
  CapabilityGrouping,
  CapabilityId,
  NamespaceInventory,
} from "./inference.js";

/** A single action route mapping a capability action to an upstream tool. */
export interface CapabilityActionRoute {
  /** The capability this route belongs to */
  capability: CapabilityId;
  /** Final action name (may include disambiguating suffix) */
  action: string;
  /** Base action name before disambiguation */
  baseAction: string;
  /** Upstream server key */
  serverKey: string;
  /** Stable instance key used to distinguish duplicate upstreams */
  instanceKey?: string;
  /** Human-readable title for this upstream instance */
  instanceTitle?: string;
  /** Original upstream tool name */
  toolName: string;
  /** Qualified name: `serverKey:toolName` */
  qualifiedName: string;
  /** Canonical stable route identifier for internal tracking */
  canonicalRouteId?: string;
  /** Total number of routes sharing the same capability/base action */
  collisionGroupSize?: number;
  /** Backward-compatible action aliases retained for older callers */
  legacyActions?: string[];
  /** JSON Schema for the tool's input parameters */
  inputSchema: ToolInputSchema;
  /** Human-readable summary for the action */
  summary: string;
}

/** A capability router groups all action routes under a single capability. */
export interface CapabilityRouter {
  /** The capability identifier */
  capability: CapabilityId;
  /** Sorted list of action routes */
  actions: CapabilityActionRoute[];
}

const DESCRIBE_ACTION = "__describe_actions";

function buildCanonicalRouteId(
  capability: CapabilityId,
  instanceKey: string,
  toolName: string,
): string {
  return `${capability}:${instanceKey}:${toolName}`;
}

function buildInstanceActionBase(
  baseAction: string,
  instanceToken: string,
): string {
  return `${baseAction}__${instanceToken}`;
}

function allocateUniqueActionId(
  emittedActions: Set<string>,
  actionBase: string,
  index: number,
): string {
  let candidate = index === 0 ? actionBase : `${actionBase}__${index + 1}`;
  const suffixMatch = actionBase.match(/^(.*)__(\d+)$/);
  const dedupeBase = suffixMatch?.[1] ?? actionBase;
  let dedupe = suffixMatch?.[2]
    ? Number.parseInt(suffixMatch[2], 10) + 1
    : index + 2;

  while (emittedActions.has(candidate)) {
    candidate = `${dedupeBase}__${dedupe}`;
    dedupe += 1;
  }

  emittedActions.add(candidate);
  return candidate;
}

function resolveInstanceTokens(
  records: CapabilityActionRoute[],
): Map<string, string> {
  const byToken = new Map<string, string[]>();

  for (const record of records) {
    const instanceKey = record.instanceKey ?? record.serverKey;
    const token = toActionToken(instanceKey);
    const existing = byToken.get(token) ?? [];
    if (!existing.includes(instanceKey)) {
      existing.push(instanceKey);
      existing.sort((a, b) => a.localeCompare(b));
      byToken.set(token, existing);
    }
  }

  const resolved = new Map<string, string>();
  for (const [token, instanceKeys] of [...byToken.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    instanceKeys.forEach((instanceKey, index) => {
      resolved.set(instanceKey, index === 0 ? token : `${token}__${index + 1}`);
    });
  }

  return resolved;
}

/**
 * Normalizes a tool name into a snake_case action token.
 *
 * @param value - Raw tool name
 * @returns Normalized token suitable for use as an action ID
 */
export function toActionToken(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return normalized.length > 0 ? normalized : "tool";
}

/**
 * Builds capability routers from namespace inventories and their grouping.
 *
 * This is the pure, deterministic routing computation. It takes the pre-computed
 * capability grouping and generates the full action routing table with
 * disambiguation for name collisions.
 *
 * @param inventories - Upstream server tool inventories (must be sorted by namespace)
 * @param grouping - Pre-computed capability grouping from `groupNamespacesByCapability()`
 * @param summarize - Optional function to generate action summaries from tool descriptions
 * @returns Sorted array of capability routers
 */
export function buildCapabilityRouters(
  inventories: NamespaceInventory[],
  grouping: CapabilityGrouping,
  summarize?: (
    description: string | undefined,
    capability: CapabilityId,
  ) => string,
): CapabilityRouter[] {
  if (inventories.length === 0) {
    return [];
  }

  const defaultSummarize = (
    desc: string | undefined,
    cap: CapabilityId,
  ): string => {
    if (desc) {
      const firstLine = desc.split("\n")[0]?.trim();
      if (firstLine && firstLine.length > 0) {
        return firstLine.length > 120
          ? `${firstLine.slice(0, 117)}...`
          : firstLine;
      }
    }
    const title = cap
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    return `Execute ${title} action`;
  };

  const resolveSummary = summarize ?? defaultSummarize;
  const candidates: CapabilityActionRoute[] = [];
  const reservedNormalized = toActionToken(DESCRIBE_ACTION);

  for (const inventory of inventories) {
    const capability = grouping.byNamespace[inventory.namespace] ?? "general";
    const instanceKey = inventory.namespace;
    const instanceTitle = inventory.title ?? inventory.namespace;
    const sortedTools = [...inventory.tools].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const tool of sortedTools) {
      let baseAction = toActionToken(tool.name);
      if (baseAction === DESCRIBE_ACTION || baseAction === reservedNormalized) {
        baseAction = `${DESCRIBE_ACTION}__tool`;
      }

      candidates.push({
        capability,
        action: baseAction,
        baseAction,
        serverKey: inventory.namespace,
        instanceKey,
        instanceTitle,
        toolName: tool.name,
        qualifiedName: `${inventory.namespace}:${tool.name}`,
        canonicalRouteId: buildCanonicalRouteId(
          capability,
          instanceKey,
          tool.name,
        ),
        collisionGroupSize: 1,
        inputSchema: tool.inputSchema ?? { type: "object" },
        summary: resolveSummary(tool.description ?? undefined, capability),
      });
    }
  }

  // Group by capability:action to detect collisions
  const byCapabilityAction = new Map<string, CapabilityActionRoute[]>();
  for (const candidate of candidates) {
    const key = `${candidate.capability}:${candidate.baseAction}`;
    const existing = byCapabilityAction.get(key) ?? [];
    existing.push(candidate);
    byCapabilityAction.set(key, existing);
  }

  // Resolve collisions with numeric suffixes
  const resolved: CapabilityActionRoute[] = [];
  const sortedKeys = [...byCapabilityAction.keys()].sort((a, b) =>
    a.localeCompare(b),
  );

  for (const key of sortedKeys) {
    const records = (byCapabilityAction.get(key) ?? []).sort((a, b) =>
      a.qualifiedName.localeCompare(b.qualifiedName),
    );
    if (records.length === 1) {
      const [record] = records;
      if (record) {
        resolved.push({
          ...record,
          action: record.baseAction,
          collisionGroupSize: 1,
          legacyActions: [],
        });
      }
      continue;
    }

    const legacyActionsByQualifiedName = new Map<string, string[]>();
    records.forEach((record, index) => {
      legacyActionsByQualifiedName.set(
        record.qualifiedName,
        index === 0 ? [] : [`${record.baseAction}__${index + 1}`],
      );
    });

    const instanceTokens = resolveInstanceTokens(records);
    const byInstance = new Map<string, CapabilityActionRoute[]>();
    for (const record of records) {
      const instanceKey = record.instanceKey ?? record.serverKey;
      const existing = byInstance.get(instanceKey) ?? [];
      existing.push(record);
      byInstance.set(instanceKey, existing);
    }

    const emittedActions = new Set<string>();
    for (const instanceKey of [...byInstance.keys()].sort((a, b) =>
      a.localeCompare(b),
    )) {
      const instanceRecords = (byInstance.get(instanceKey) ?? []).sort((a, b) =>
        a.qualifiedName.localeCompare(b.qualifiedName),
      );
      const instanceToken =
        instanceTokens.get(instanceKey) ?? toActionToken(instanceKey);
      const actionBase = buildInstanceActionBase(
        records[0]?.baseAction ?? "tool",
        instanceToken,
      );

      instanceRecords.forEach((record, index) => {
        resolved.push({
          ...record,
          action: allocateUniqueActionId(emittedActions, actionBase, index),
          collisionGroupSize: records.length,
          legacyActions:
            legacyActionsByQualifiedName.get(record.qualifiedName) ?? [],
        });
      });
    }
  }

  // Group by capability
  const byCapability = new Map<CapabilityId, CapabilityActionRoute[]>();
  for (const route of resolved) {
    const existing = byCapability.get(route.capability) ?? [];
    existing.push(route);
    byCapability.set(route.capability, existing);
  }

  return [...byCapability.entries()]
    .map(([capability, actions]) => ({
      capability,
      actions: actions.sort((a, b) => a.action.localeCompare(b.action)),
    }))
    .sort((a, b) => a.capability.localeCompare(b.capability));
}
