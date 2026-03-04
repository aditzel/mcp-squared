/**
 * Capability inference and grouping for upstream MCP namespaces.
 *
 * This module provides stable capability IDs plus a deterministic heuristic
 * classifier that maps each namespace to one capability.
 *
 * @module capabilities/inference
 */

import type { ToolInputSchema } from "../upstream/cataloger.js";

/** Stable capability taxonomy IDs used by dynamic tool surfacing. */
export const CAPABILITY_IDS = [
  "code_search",
  "docs",
  "browser_automation",
  "issue_tracking",
  "cms_content",
  "design",
  "hosting_deploy",
  "time_util",
  "research",
  "general",
] as const;

/** Capability identifier union. */
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** Minimal tool metadata used by inference heuristics. */
export interface NamespaceToolMetadata {
  name: string;
  description?: string | null | undefined;
  inputSchema?: ToolInputSchema | undefined;
}

/** Namespace and tool inventory entry used for grouping. */
export interface NamespaceInventory {
  namespace: string;
  tools: NamespaceToolMetadata[];
}

/** Output of namespace grouping by inferred capability. */
export interface CapabilityGrouping {
  byNamespace: Record<string, CapabilityId>;
  grouped: Record<CapabilityId, string[]>;
}

const CAPABILITY_PRIORITY: CapabilityId[] = [
  "code_search",
  "docs",
  "browser_automation",
  "issue_tracking",
  "cms_content",
  "design",
  "hosting_deploy",
  "time_util",
  "research",
  "general",
];

const NAMESPACE_HINTS: Array<{
  capability: CapabilityId;
  pattern: RegExp;
  score: number;
}> = [
  {
    capability: "code_search",
    pattern: /(auggie|augment|ctxdb|code|source|repo|symbol|search)/i,
    score: 24,
  },
  {
    capability: "docs",
    pattern: /(context7|ref|docs?|documentation|shadcn)/i,
    score: 18,
  },
  {
    capability: "browser_automation",
    pattern: /(chrome|devtools|browser|playwright|puppeteer|webdriver)/i,
    score: 24,
  },
  {
    capability: "issue_tracking",
    pattern: /(linear|jira|issue|ticket|project|milestone)/i,
    score: 20,
  },
  {
    capability: "cms_content",
    pattern: /(sanity|content|cms|dataset|schema|studio)/i,
    score: 20,
  },
  {
    capability: "design",
    pattern: /(pencil|figma|ui|design|artifact|visual)/i,
    score: 20,
  },
  {
    capability: "hosting_deploy",
    pattern: /(vercel|host|hosting|domain|dns|vps|deploy|infra)/i,
    score: 22,
  },
  {
    capability: "time_util",
    pattern: /(time|timezone|clock|date|utc)/i,
    score: 22,
  },
  {
    capability: "research",
    pattern: /(exa|perplexity|firecrawl|crawl|scrape|research|search)/i,
    score: 16,
  },
];

const CAPABILITY_PATTERNS: Record<CapabilityId, RegExp[]> = {
  code_search: [
    /\bcodebase\b/i,
    /\bsource\b/i,
    /\brepo(?:sitory)?\b/i,
    /\bsymbol(?:s)?\b/i,
    /\bdefinition(?:s)?\b/i,
    /\breference(?:s)?\b/i,
    /\busage(?:s)?\b/i,
    /\bsearch_context\b/i,
    /\bcodebase-retrieval\b/i,
    /\bdirectory_path\b/i,
  ],
  docs: [
    /\bdoc(?:s|umentation)?\b/i,
    /\bread_docs\b/i,
    /\bquery-docs\b/i,
    /\breference\b/i,
    /\bmanual\b/i,
    /\bknowledge\b/i,
    /\bregist(?:ry|ries)\b/i,
    /\bcomponent(?:s)?\b/i,
    /\bexample(?:s)?\b/i,
  ],
  browser_automation: [
    /\bbrowser\b/i,
    /\bdevtools\b/i,
    /\bnavigate\b/i,
    /\bclick\b/i,
    /\bhover\b/i,
    /\bnetwork\b/i,
    /\bconsole\b/i,
    /\bscreenshot\b/i,
    /\bpage\b/i,
  ],
  issue_tracking: [
    /\bissue(?:s)?\b/i,
    /\bticket(?:s)?\b/i,
    /\bmilestone(?:s)?\b/i,
    /\bcycle(?:s)?\b/i,
    /\bproject(?:s)?\b/i,
    /\bcomment(?:s)?\b/i,
    /\blinear\b/i,
  ],
  cms_content: [
    /\bcms\b/i,
    /\bcontent\b/i,
    /\bdocument(?:s)?\b/i,
    /\bdataset(?:s)?\b/i,
    /\bschema\b/i,
    /\bpublish\b/i,
    /\bdraft(?:s)?\b/i,
    /\bsanity\b/i,
    /\bmigration\b/i,
  ],
  design: [
    /\bdesign\b/i,
    /\bui\b/i,
    /\bartifact\b/i,
    /\bstyle_guide\b/i,
    /\bscreenshot\b/i,
    /\bdiagram\b/i,
    /\bimage\b/i,
    /\blayout\b/i,
    /\bframe\b/i,
  ],
  hosting_deploy: [
    /\bdeploy(?:ment)?\b/i,
    /\bhosting\b/i,
    /\bdomain(?:s)?\b/i,
    /\bdns\b/i,
    /\bvps\b/i,
    /\bvirtual_machine(?:s)?\b/i,
    /\bfirewall\b/i,
    /\bwebsite\b/i,
    /\bbilling\b/i,
    /\bnameserver(?:s)?\b/i,
  ],
  time_util: [
    /\btime\b/i,
    /\btimezone\b/i,
    /\butc\b/i,
    /\bclock\b/i,
    /\bdate\b/i,
    /\bconvert_time\b/i,
    /\bget_current_time\b/i,
  ],
  research: [
    /\bresearch\b/i,
    /\bcrawl\b/i,
    /\bscrape\b/i,
    /\bextract\b/i,
    /\bsemantic_search\b/i,
    /\bweb_search\b/i,
    /\bask\b/i,
    /\bperplexity\b/i,
    /\bfirecrawl\b/i,
    /\bexa\b/i,
  ],
  general: [],
};

function createEmptyScores(): Record<CapabilityId, number> {
  return CAPABILITY_IDS.reduce(
    (acc, capability) => {
      acc[capability] = 0;
      return acc;
    },
    {} as Record<CapabilityId, number>,
  );
}

export function extractSchemaSignal(
  schema: ToolInputSchema | undefined,
): string {
  if (!schema || schema.type !== "object") {
    return "";
  }
  const keys = Object.keys(schema.properties ?? {});
  const required = schema.required ?? [];
  return `${keys.join(" ")} ${required.join(" ")}`;
}

function scoreTextSignals(
  scores: Record<CapabilityId, number>,
  text: string,
): void {
  for (const capability of CAPABILITY_IDS) {
    for (const pattern of CAPABILITY_PATTERNS[capability]) {
      if (pattern.test(text)) {
        scores[capability] += 4;
      }
    }
  }
}

function getHighestScoringCapability(
  scores: Record<CapabilityId, number>,
): CapabilityId {
  const bestScore = Math.max(...Object.values(scores));
  if (bestScore <= 0) {
    return "general";
  }

  for (const capability of CAPABILITY_PRIORITY) {
    if (scores[capability] === bestScore) {
      return capability;
    }
  }

  return "general";
}

/**
 * Infers a namespace capability using deterministic heuristics, with optional
 * explicit overrides.
 */
export function inferNamespaceCapability(
  namespace: string,
  tools: NamespaceToolMetadata[],
  capabilityOverrides: Partial<Record<string, CapabilityId>> = {},
): CapabilityId {
  const override = capabilityOverrides[namespace];
  if (override) {
    return override;
  }

  const scores = createEmptyScores();
  const namespaceText = namespace.toLowerCase();

  for (const hint of NAMESPACE_HINTS) {
    if (hint.pattern.test(namespaceText)) {
      scores[hint.capability] += hint.score;
    }
  }

  for (const tool of tools) {
    const signal = [
      tool.name,
      tool.description ?? "",
      extractSchemaSignal(tool.inputSchema),
    ]
      .join(" ")
      .toLowerCase();
    scoreTextSignals(scores, signal);
  }

  return getHighestScoringCapability(scores);
}

/**
 * Groups namespace inventories by inferred capability.
 */
export function groupNamespacesByCapability(
  inventories: NamespaceInventory[],
  capabilityOverrides: Partial<Record<string, CapabilityId>> = {},
): CapabilityGrouping {
  const grouped = CAPABILITY_IDS.reduce(
    (acc, capability) => {
      acc[capability] = [];
      return acc;
    },
    {} as Record<CapabilityId, string[]>,
  );

  const byNamespace: Record<string, CapabilityId> = {};
  const sorted = [...inventories].sort((a, b) =>
    a.namespace.localeCompare(b.namespace),
  );

  for (const inventory of sorted) {
    const capability = inferNamespaceCapability(
      inventory.namespace,
      inventory.tools,
      capabilityOverrides,
    );
    byNamespace[inventory.namespace] = capability;
    grouped[capability].push(inventory.namespace);
  }

  return { byNamespace, grouped };
}
