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
  "observability",
  "messaging",
  "payments",
  "database",
  "cms_content",
  "design",
  "design_workspace",
  "ai_media_generation",
  "hosting_deploy",
  "time_util",
  "research",
  "general",
] as const;

/** Capability identifier union. */
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** Secondary internal classification tags. */
export type CapabilityFacetId = string;

/** Source of the canonical capability decision. */
export type CapabilityClassificationSource =
  | "heuristic"
  | "semantic"
  | "user_override"
  | "computed_override";

/** Override-only sources that can be injected from config/runtime callers. */
export type CapabilityOverrideSource = Extract<
  CapabilityClassificationSource,
  "user_override" | "computed_override"
>;

/** Evidence source used for diagnostics. */
export type ClassificationEvidenceSource =
  | "namespace_hint"
  | "tool_signal"
  | "semantic_similarity"
  | "user_override"
  | "computed_override"
  | "facet_override";

/** A single diagnostic clue used during classification. */
export interface ClassificationEvidence {
  source: ClassificationEvidenceSource;
  target: string;
  score?: number;
  note?: string;
}

/** Secondary ranked canonical capability for diagnostics. */
export interface NamespaceClassificationRunnerUp {
  canonicalCapability: CapabilityId;
  confidence: number;
}

/** Rich namespace classification used for diagnostics and adapter projection. */
export interface NamespaceClassification {
  namespace: string;
  canonicalCapability: CapabilityId;
  capabilitySource: CapabilityClassificationSource;
  confidence: number;
  runnerUp?: NamespaceClassificationRunnerUp | undefined;
  facets: CapabilityFacetId[];
  evidence: ClassificationEvidence[];
}

/** Options for rich namespace classification. */
export interface NamespaceClassificationOptions {
  capabilityOverrides?: Partial<Record<string, CapabilityId>> | undefined;
  capabilityOverrideSources?:
    | Partial<Record<string, CapabilityOverrideSource>>
    | undefined;
  facetOverrides?: Partial<Record<string, CapabilityFacetId[]>> | undefined;
}

/** Minimal tool metadata used by inference heuristics. */
export interface NamespaceToolMetadata {
  name: string;
  description?: string | null | undefined;
  inputSchema?: ToolInputSchema | undefined;
}

/** Namespace and tool inventory entry used for grouping. */
export interface NamespaceInventory {
  namespace: string;
  title?: string;
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
  "observability",
  "messaging",
  "payments",
  "database",
  "cms_content",
  "design_workspace",
  "design",
  "ai_media_generation",
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
    capability: "observability",
    pattern:
      /(sentry|datadog|newrelic|grafana|honeycomb|bugsnag|rollbar|incident|alert|trace|metric|observability|monitor|(?:^|[._/\-\s])log(?:$|[._/\-\s]))/i,
    score: 22,
  },
  {
    capability: "messaging",
    pattern:
      /(slack|discord|teams|telegram|twilio|message|chat|channel|notification|email|inbox|thread|(?:^|[._/\-\s])dm(?:$|[._/\-\s]))/i,
    score: 22,
  },
  {
    capability: "payments",
    pattern:
      /(stripe|payment|invoice|subscription|checkout|billing|refund|charge|customer portal)/i,
    score: 22,
  },
  {
    capability: "database",
    pattern:
      /(prisma|supabase|postgres(?:ql)?|mysql|sqlite|mongodb|redis|neon|planetscale|hasura|database|sql)/i,
    score: 22,
  },
  {
    capability: "cms_content",
    pattern: /(sanity|content|cms|dataset|schema|studio)/i,
    score: 20,
  },
  {
    capability: "design_workspace",
    pattern: /(pencil|figma|figjam|penfile|design[-_ ]workspace)/i,
    score: 24,
  },
  {
    capability: "design",
    pattern:
      /(sketch|design|artifact|visual|(?:^|[._/\-\s])ui(?:$|[._/\-\s]))/i,
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
    capability: "ai_media_generation",
    pattern:
      /(wavespeed|stability|replicate|midjourney|dall.?e|runway|imagen|flux|fal\.ai|dreamstudio)/i,
    score: 24,
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
  observability: [
    /\berror(?:s)?\b/i,
    /\bincident(?:s)?\b/i,
    /\balert(?:s)?\b/i,
    /\btrace(?:s)?\b/i,
    /\bmetric(?:s)?\b/i,
    /\blogs?\b/i,
    /\bmonitor(?:ing)?\b/i,
    /\bperformance\b/i,
    /\bexception(?:s)?\b/i,
    /\bcrash(?:es)?\b/i,
    /\bsentry\b/i,
    /\brollbar\b/i,
    /\bdatadog\b/i,
    /\bgrafana\b/i,
  ],
  messaging: [
    /\bmessage(?:s)?\b/i,
    /\bchannel(?:s)?\b/i,
    /\bchat\b/i,
    /\bthread(?:s)?\b/i,
    /\bdm\b/i,
    /\bnotification(?:s)?\b/i,
    /\bemail\b/i,
    /\binbox\b/i,
    /\bslack\b/i,
    /\bdiscord\b/i,
    /\btelegram\b/i,
    /\bteams\b/i,
    /\btwilio\b/i,
  ],
  payments: [
    /\bpayment(?:s)?\b/i,
    /\binvoice(?:s)?\b/i,
    /\bsubscription(?:s)?\b/i,
    /\bcheckout\b/i,
    /\bbilling\b/i,
    /\brefund(?:s)?\b/i,
    /\bcharge(?:s)?\b/i,
    /\bcustomer portal\b/i,
    /\bstripe\b/i,
  ],
  database: [
    /\bdatabase\b/i,
    /\bsql\b/i,
    /\bquery\b/i,
    /\bqueries\b/i,
    /\btable(?:s)?\b/i,
    /\bcolumn(?:s)?\b/i,
    /\brow(?:s)?\b/i,
    /\bschema\b/i,
    /\bmigration\b/i,
    /\borm\b/i,
    /\bpostgres(?:ql)?\b/i,
    /\bmysql\b/i,
    /\bsqlite\b/i,
    /\bprisma\b/i,
    /\bsupabase\b/i,
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
  design_workspace: [
    /\b\.pen\b/i,
    /\bbatch_design\b/i,
    /\bbatch_get\b/i,
    /\bget_design_context\b/i,
    /\bdesign context\b/i,
    /\bget_variable_defs\b/i,
    /\bvariable defs\b/i,
    /\bcode connect\b/i,
    /\bget_code_connect_map\b/i,
    /\badd_code_connect_map\b/i,
    /\bget_code_connect_suggestions\b/i,
    /\bsend_code_connect_mappings\b/i,
    /\bget_figjam\b/i,
    /\bgenerate_diagram\b/i,
    /\bget_metadata\b/i,
    /\bnode ids?\b/i,
    /\blayer ids?\b/i,
    /\bselection\b/i,
    /\beditor[_ ]state\b/i,
    /\bcanvas\b/i,
    /\bdesign system\b/i,
    /\bdesign tokens\b/i,
    /\bsync\b.*\bcss\b/i,
    /\bexport\b.*\breact\b/i,
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
  ai_media_generation: [
    /\btext.to.image\b/i,
    /\bimage.to.image\b/i,
    /\btext.to.video\b/i,
    /\binpaint(?:ing)?\b/i,
    /\bupscal(?:e|ing)\b/i,
    /\bgenerat(?:e|ion)\b.*\bimage/i,
    /\bimage\b.*\bgenerat(?:e|ion)\b/i,
    /\bai\b.*\b(?:image|photo|video)\b/i,
    /\bstable.diffusion\b/i,
    /\bdiffusion\b/i,
    /\bprompt\b.*\b(?:image|visual)\b/i,
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

const FACET_PATTERNS: Record<CapabilityFacetId, RegExp[]> = {
  vision_analysis: [
    /\banaly[sz]e[_ ]image\b/i,
    /\banaly[sz]e[_ ]video\b/i,
    /\bdiagnos(?:e|ing)?[_ ]error[_ ]screenshot\b/i,
    /\bextract[_ ]text[_ ]from[_ ]screenshot\b/i,
    /\bvisual diff/i,
  ],
  ocr: [/\bocr\b/i, /\bextract[_ ]text\b/i, /\btext extraction\b/i],
  diagram_understanding: [
    /\bdiagram\b/i,
    /\bflowchart\b/i,
    /\buml\b/i,
    /\ber diagram\b/i,
    /\barchitecture diagram\b/i,
  ],
  ui_diff: [
    /\bui[_ ]diff\b/i,
    /\bvisual differences?\b/i,
    /\bcompare before\/after\b/i,
  ],
  design_workspace: [
    /\bpencil\b/i,
    /\bfigma\b/i,
    /\bfigjam\b/i,
    /\b\.pen\b/i,
    /\bbatch_design\b/i,
    /\bbatch_get\b/i,
    /\bdesign context\b/i,
    /\bselection\b/i,
    /\bnode ids?\b/i,
    /\blayer ids?\b/i,
    /\bmetadata\b/i,
    /\beditor[_ ]state\b/i,
    /\bdesign elements?\b/i,
    /\bcanvas\b/i,
  ],
  layout_analysis: [
    /\blayout\b/i,
    /\boverlap(?:ping)?\b/i,
    /\bposition(?:ing)?\b/i,
    /\bhierarchy\b/i,
    /\bspacing\b/i,
  ],
  design_tokens: [
    /\bvariables?\b/i,
    /\btokens?\b/i,
    /\btheme\b/i,
    /\bcolor palette\b/i,
    /\btypography scale\b/i,
    /\bcss variables?\b/i,
  ],
  design_to_code: [
    /\bexport\b.*\bcomponent\b/i,
    /\bgenerate\b.*\b(?:react|vue|svelte|next\.js|typescript)\b/i,
    /\bsync\b.*\bcode\b/i,
    /\bimport\b.*\bcodebase\b/i,
    /\bcode connect\b/i,
    /\bdesign system rules?\b/i,
    /\btailwind\b/i,
    /\bshadcn\b/i,
  ],
  database_admin: [
    /\bdatabase\b/i,
    /\bsql\b/i,
    /\btable\b/i,
    /\bmigration\b/i,
    /\bschema\b/i,
    /\bprisma\b/i,
    /\bsupabase\b/i,
  ],
  observability: [
    /\bsentry\b/i,
    /\berror tracking\b/i,
    /\btrace(?:s)?\b/i,
    /\bmetric(?:s)?\b/i,
    /\blogs?\b/i,
    /\balert(?:s)?\b/i,
    /\bincident(?:s)?\b/i,
    /\bmonitor(?:ing)?\b/i,
  ],
  messaging: [
    /\bslack\b/i,
    /\bmessage(?:s)?\b/i,
    /\bchannel(?:s)?\b/i,
    /\bchat\b/i,
    /\bnotification(?:s)?\b/i,
    /\bemail\b/i,
  ],
  payments: [
    /\bstripe\b/i,
    /\bpayment(?:s)?\b/i,
    /\binvoice(?:s)?\b/i,
    /\bsubscription(?:s)?\b/i,
    /\bcheckout\b/i,
    /\bbilling\b/i,
  ],
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

function pushEvidence(
  evidence: ClassificationEvidence[],
  seen: Set<string>,
  entry: ClassificationEvidence,
): void {
  const key = JSON.stringify([
    entry.source,
    entry.target,
    entry.score ?? null,
    entry.note ?? null,
  ]);
  if (!seen.has(key)) {
    seen.add(key);
    evidence.push(entry);
  }
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
  evidence?: ClassificationEvidence[],
  seen?: Set<string>,
  note?: string,
): void {
  for (const capability of CAPABILITY_IDS) {
    for (const pattern of CAPABILITY_PATTERNS[capability]) {
      if (pattern.test(text)) {
        scores[capability] += 4;
        if (evidence && seen) {
          pushEvidence(evidence, seen, {
            source: "tool_signal",
            target: capability,
            score: 4,
            note: note
              ? `${note} matched ${pattern}`
              : `Matched ${pattern} in tool signal`,
          });
        }
      }
    }
  }
}

function getSortedScoreEntries(
  scores: Record<CapabilityId, number>,
): Array<{ capability: CapabilityId; score: number }> {
  return CAPABILITY_PRIORITY.map((capability) => ({
    capability,
    score: scores[capability],
  })).sort((a, b) =>
    b.score === a.score
      ? CAPABILITY_PRIORITY.indexOf(a.capability) -
        CAPABILITY_PRIORITY.indexOf(b.capability)
      : b.score - a.score,
  );
}

function computeHeuristicConfidence(
  bestScore: number,
  runnerUpScore: number,
): number {
  if (bestScore <= 0) {
    return 0;
  }
  if (runnerUpScore <= 0) {
    return 1;
  }
  return Number((bestScore / (bestScore + runnerUpScore)).toFixed(4));
}

function inferNamespaceFacetsInternal(
  namespace: string,
  tools: NamespaceToolMetadata[],
  facetOverrides: Partial<Record<string, CapabilityFacetId[]>> = {},
): {
  facets: CapabilityFacetId[];
  evidence: ClassificationEvidence[];
} {
  const facets = new Set<CapabilityFacetId>();
  const evidence: ClassificationEvidence[] = [];
  const seen = new Set<string>();
  const namespaceText = namespace.toLowerCase();

  for (const [facet, patterns] of Object.entries(FACET_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(namespaceText)) {
        facets.add(facet);
        pushEvidence(evidence, seen, {
          source: "namespace_hint",
          target: facet,
          note: `Namespace matched ${pattern}`,
        });
        break;
      }
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

    for (const [facet, patterns] of Object.entries(FACET_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(signal)) {
          facets.add(facet);
          pushEvidence(evidence, seen, {
            source: "tool_signal",
            target: facet,
            note: `${tool.name} matched ${pattern}`,
          });
          break;
        }
      }
    }
  }

  for (const facet of facetOverrides[namespace] ?? []) {
    facets.add(facet);
    pushEvidence(evidence, seen, {
      source: "facet_override",
      target: facet,
      note: "Pinned by config facet override",
    });
  }

  return {
    facets: [...facets].sort(),
    evidence,
  };
}

/** Returns inferred facets for a namespace. */
export function inferNamespaceFacets(
  namespace: string,
  tools: NamespaceToolMetadata[],
  facetOverrides: Partial<Record<string, CapabilityFacetId[]>> = {},
): CapabilityFacetId[] {
  return inferNamespaceFacetsInternal(namespace, tools, facetOverrides).facets;
}

/** Rich heuristic namespace classification with facets and evidence. */
export function classifyNamespace(
  namespace: string,
  tools: NamespaceToolMetadata[],
  options: NamespaceClassificationOptions = {},
): NamespaceClassification {
  const capabilityOverrides = options.capabilityOverrides ?? {};
  const capabilityOverrideSources = options.capabilityOverrideSources ?? {};
  const facetOverrides = options.facetOverrides ?? {};
  const { facets, evidence: facetEvidence } = inferNamespaceFacetsInternal(
    namespace,
    tools,
    facetOverrides,
  );

  const override = capabilityOverrides[namespace];
  if (override) {
    const source = capabilityOverrideSources[namespace] ?? "user_override";
    return {
      namespace,
      canonicalCapability: override,
      capabilitySource: source,
      confidence: 1,
      facets,
      evidence: [
        {
          source,
          target: override,
          note: "Pinned by capability override",
        },
        ...facetEvidence,
      ],
    };
  }

  const scores = createEmptyScores();
  const evidence: ClassificationEvidence[] = [];
  const seen = new Set<string>();
  const namespaceText = namespace.toLowerCase();

  for (const hint of NAMESPACE_HINTS) {
    if (hint.pattern.test(namespaceText)) {
      scores[hint.capability] += hint.score;
      pushEvidence(evidence, seen, {
        source: "namespace_hint",
        target: hint.capability,
        score: hint.score,
        note: `Namespace matched ${hint.pattern}`,
      });
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
    scoreTextSignals(scores, signal, evidence, seen, tool.name);
  }

  const ranked = getSortedScoreEntries(scores);
  const best = ranked[0] ?? { capability: "general" as CapabilityId, score: 0 };
  const runnerUp = ranked[1];
  const bestCapability =
    best.score <= 0 ? ("general" as CapabilityId) : best.capability;
  const bestConfidence = computeHeuristicConfidence(
    best.score,
    runnerUp?.score ?? 0,
  );

  return {
    namespace,
    canonicalCapability: bestCapability,
    capabilitySource: "heuristic",
    confidence: bestConfidence,
    runnerUp:
      runnerUp && runnerUp.score > 0
        ? {
            canonicalCapability: runnerUp.capability,
            confidence: computeHeuristicConfidence(runnerUp.score, best.score),
          }
        : undefined,
    facets,
    evidence: [...evidence, ...facetEvidence],
  };
}

/** Rich classification for a batch of inventories. */
export function classifyNamespaces(
  inventories: NamespaceInventory[],
  options: NamespaceClassificationOptions = {},
): NamespaceClassification[] {
  return [...inventories]
    .sort((a, b) => a.namespace.localeCompare(b.namespace))
    .map((inventory) =>
      classifyNamespace(inventory.namespace, inventory.tools, options),
    );
}

/** Builds a capability grouping from rich namespace classifications. */
export function groupClassificationsByCapability(
  classifications: NamespaceClassification[],
): CapabilityGrouping {
  const grouped = CAPABILITY_IDS.reduce(
    (acc, capability) => {
      acc[capability] = [];
      return acc;
    },
    {} as Record<CapabilityId, string[]>,
  );

  const byNamespace: Record<string, CapabilityId> = {};
  const sorted = [...classifications].sort((a, b) =>
    a.namespace.localeCompare(b.namespace),
  );

  for (const classification of sorted) {
    byNamespace[classification.namespace] = classification.canonicalCapability;
    grouped[classification.canonicalCapability].push(classification.namespace);
  }

  return { byNamespace, grouped };
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
  return classifyNamespace(namespace, tools, {
    capabilityOverrides,
  }).canonicalCapability;
}

/**
 * Groups namespace inventories by inferred capability.
 */
export function groupNamespacesByCapability(
  inventories: NamespaceInventory[],
  capabilityOverrides: Partial<Record<string, CapabilityId>> = {},
): CapabilityGrouping {
  return groupClassificationsByCapability(
    classifyNamespaces(inventories, { capabilityOverrides }),
  );
}
