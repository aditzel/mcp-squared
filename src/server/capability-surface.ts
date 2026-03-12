import {
  type CapabilityId,
  groupNamespacesByCapability,
} from "../capabilities/inference.js";
import {
  buildCapabilityRouters as buildRouters,
  type CapabilityRouter,
} from "../capabilities/routing.js";
import type { McpSquaredConfig } from "../config/schema.js";
import type { ToolInputSchema } from "../upstream/index.js";
import {
  capabilitySummary as sharedCapabilitySummary,
  capabilityTitle as sharedCapabilityTitle,
} from "../utils/capability-meta.js";

type CatalogStatus = {
  status: string;
  error: Error | string | undefined;
};

type InventoryTool = {
  name: string;
  description: string | undefined;
  serverKey: string;
  inputSchema: ToolInputSchema;
};

interface BuildCapabilityRoutersOptions {
  statusEntries: Iterable<readonly [string, CatalogStatus]>;
  getToolsForServer(namespace: string): InventoryTool[];
  upstreams: McpSquaredConfig["upstreams"];
  computedCapabilityOverrides: Partial<Record<string, CapabilityId>>;
  configuredCapabilityOverrides: Partial<Record<string, CapabilityId>>;
}

export function buildServerInstructions(): string {
  return [
    "Tool surface is generated at connect time from inferred upstream capabilities.",
    "Each capability tool accepts `action`, `arguments`, and optional `confirmation_token`.",
    'Call a capability tool with `action = "__describe_actions"` to inspect available actions and schemas.',
    "Use returned action IDs for execution calls; if disambiguation is required, choose one candidate action and retry.",
  ].join(" ");
}

export function capabilityTitle(capability: CapabilityId): string {
  return sharedCapabilityTitle(capability);
}

export function capabilitySummary(capability: CapabilityId): string {
  return sharedCapabilitySummary(capability);
}

export function actionSummary(
  description: string | null | undefined,
  capability: CapabilityId,
): string {
  if (typeof description === "string") {
    const singleLine = description.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (singleLine.length > 0) {
      return singleLine;
    }
  }

  return `Execute ${capabilityTitle(capability)} action`;
}

export function buildCapabilityRouters({
  statusEntries,
  getToolsForServer,
  upstreams,
  computedCapabilityOverrides,
  configuredCapabilityOverrides,
}: BuildCapabilityRoutersOptions): CapabilityRouter[] {
  const inventories = [...statusEntries]
    .filter(([, info]) => info.status === "connected")
    .map(([namespace]) => ({
      namespace,
      title: upstreams[namespace]?.label ?? namespace,
      tools: getToolsForServer(namespace),
    }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace));

  if (inventories.length === 0) {
    return [];
  }

  const overrides = {
    ...computedCapabilityOverrides,
    ...configuredCapabilityOverrides,
  };
  const grouping = groupNamespacesByCapability(inventories, overrides);

  return buildRouters(inventories, grouping, (description, capability) =>
    actionSummary(description, capability),
  );
}
