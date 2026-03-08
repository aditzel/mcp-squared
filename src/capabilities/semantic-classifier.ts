/**
 * Semantic capability classifier using embedding similarity.
 *
 * Uses the project's existing EmbeddingGenerator (BGE-small-en-v1.5) to
 * classify upstream MCP namespaces by comparing tool signal embeddings
 * against pre-defined reference descriptions for each capability.
 *
 * @module capabilities/semantic-classifier
 */

import { EmbeddingGenerator } from "../embeddings/generator.js";
import {
  CAPABILITY_IDS,
  type CapabilityId,
  extractSchemaSignal,
  type NamespaceToolMetadata,
} from "./inference.js";

/**
 * Rich, disambiguating reference descriptions for each capability.
 * These are embedded once and compared against tool signals via cosine similarity.
 *
 * Each description is crafted to maximize semantic distance from confusable categories:
 * - browser_automation emphasizes DOM/click to distinguish from wiki "pages"
 * - docs mentions "component registries" to capture shadcn-style tools
 * - issue_tracking specifies "project management" to avoid confusion with error tracking
 */
const CAPABILITY_REFERENCE_TEXTS: Record<CapabilityId, string> = {
  code_search:
    "Search source code, symbols, function definitions, class references, and code context across repositories and codebases. Find implementations, usages, and navigate source files.",
  docs: "Query technical documentation, API references, library guides, SDK docs, component registries, and code example lookups. Read documentation pages and fetch reference material.",
  browser_automation:
    "Automate web browser interactions: click elements, fill forms, take screenshots, inspect DOM nodes, navigate URLs, execute JavaScript in page context, and run browser diagnostics.",
  issue_tracking:
    "Manage project management tickets, kanban boards, sprints, and work items. Create, update, and track issues in project trackers like Jira, Linear, Asana, and ClickUp.",
  observability:
    "Monitor systems, track incidents, inspect logs, errors, exceptions, traces, and metrics. Work with observability and error-tracking tools like Sentry, Datadog, Grafana, Rollbar, and New Relic.",
  messaging:
    "Send and manage chat messages, channels, threads, notifications, email, direct messages, and team communication workflows. Work with messaging tools like Slack, Discord, Microsoft Teams, Telegram, and Twilio.",
  payments:
    "Manage payments, subscriptions, invoices, checkout sessions, billing, charges, refunds, and customer payment workflows. Work with payment platforms like Stripe and related billing APIs.",
  database:
    "Manage databases, SQL queries, table schemas, migrations, rows, columns, and data operations. Work with database platforms and ORMs like Postgres, MySQL, SQLite, Prisma, and Supabase.",
  cms_content:
    "Manage wiki pages, knowledge base articles, content documents, blog posts, editorial workflows, and structured content. Create and organize content in systems like Notion, Confluence, and Sanity.",
  design:
    "Create and inspect visual design artifacts, UI mockups, wireframes, screenshots, diagrams, and visual layouts. Work with visual design tools for styling and mockup review.",
  design_workspace:
    "Edit structured design workspace files, canvases, layout state, selections, variables, components, and design-to-code assets. Work with Pencil .pen files and Figma or FigJam workspaces, design context, code connect mappings, workspace hierarchy, layout snapshots, variables, and code synchronization flows.",
  ai_media_generation:
    "Generate and edit images, videos, and visual media using AI models. Create images from text prompts, edit existing images with AI, upscale resolution, apply style transfer, inpaint or outpaint regions, and generate sequential or consistent media. Supports text-to-image, image-to-image, and AI-powered visual content creation.",
  hosting_deploy:
    "Manage server deployments, cloud infrastructure, hosting configurations, CI/CD pipelines, containers, databases, DNS records, and domain management.",
  time_util:
    "Convert between timezones, get current time, format dates, calculate time differences, and resolve scheduling utilities.",
  research:
    "Search the web, collect information from multiple sources, synthesize findings, and perform web research and data gathering operations.",
  general:
    "General-purpose utility operations, API integrations, data transformations, and miscellaneous tool actions.",
};

/** Result of classifying a single namespace. */
export interface SemanticClassificationResult {
  /** Best-matching capability */
  capability: CapabilityId;
  /** Cosine similarity score (0-1) */
  confidence: number;
  /** Inference time in milliseconds */
  inferenceMs: number;
  /** Second-best match for diagnostics */
  runnerUp?: { capability: CapabilityId; confidence: number } | undefined;
}

/** Single classification entry within a batch result. */
export interface ClassificationEntry extends SemanticClassificationResult {
  namespace: string;
}

/** Result of batch classification across multiple namespaces. */
export interface SemanticClassificationBatchResult {
  /** Capability overrides for namespaces above confidence threshold */
  overrides: Partial<Record<string, CapabilityId>>;
  /** Full classification details for every namespace */
  classifications: ClassificationEntry[];
  /** Total inference time in milliseconds */
  inferenceMs: number;
}

/** Inventory of tools for a single namespace, used as batch input. */
export interface NamespaceInventory {
  namespace: string;
  tools: NamespaceToolMetadata[];
}

/**
 * Embedding-based capability classifier that reuses the project's existing
 * EmbeddingGenerator to classify namespaces via cosine similarity against
 * pre-computed reference embeddings.
 */
export class SemanticCapabilityClassifier {
  private readonly generator: EmbeddingGenerator;
  private readonly confidenceThreshold: number;
  private referenceEmbeddings: Map<CapabilityId, Float32Array> | null = null;

  constructor(
    generator: EmbeddingGenerator,
    options?: { confidenceThreshold?: number | undefined },
  ) {
    this.generator = generator;
    this.confidenceThreshold = options?.confidenceThreshold ?? 0.45;
  }

  /**
   * Pre-computes reference embeddings for all capability categories.
   * Must be called once before classify/classifyBatch.
   */
  async initializeReferences(): Promise<void> {
    const texts = CAPABILITY_IDS.map((id) => CAPABILITY_REFERENCE_TEXTS[id]);
    const result = await this.generator.embedBatch(texts, false);
    this.referenceEmbeddings = new Map();
    for (let i = 0; i < CAPABILITY_IDS.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: loop-bounded index
      this.referenceEmbeddings.set(CAPABILITY_IDS[i]!, result.embeddings[i]!);
    }
  }

  /** Whether reference embeddings have been initialized. */
  isInitialized(): boolean {
    return this.referenceEmbeddings !== null;
  }

  /**
   * Classifies a single namespace's tools against all capability references.
   *
   * @param namespace - The upstream namespace name
   * @param tools - Tool metadata for this namespace
   * @returns Classification result with capability, confidence, and timing
   */
  async classify(
    namespace: string,
    tools: NamespaceToolMetadata[],
  ): Promise<SemanticClassificationResult> {
    if (!this.referenceEmbeddings) {
      throw new Error(
        "SemanticCapabilityClassifier not initialized. Call initializeReferences() first.",
      );
    }

    const startTime = performance.now();
    const signalText = this.buildSignalText(namespace, tools);
    const signalResult = await this.generator.embed(signalText, true);

    // Compute cosine similarity against each capability reference
    const scores: Array<{ capability: CapabilityId; similarity: number }> = [];
    for (const [capId, refEmb] of this.referenceEmbeddings) {
      const similarity = EmbeddingGenerator.cosineSimilarity(
        signalResult.embedding,
        refEmb,
      );
      scores.push({ capability: capId, similarity });
    }

    // Sort descending by similarity
    scores.sort((a, b) => b.similarity - a.similarity);

    const best = scores[0];
    if (!best) {
      throw new Error("No capability references available for classification");
    }
    const runnerUp = scores[1];
    const inferenceMs = performance.now() - startTime;

    return {
      capability: best.capability,
      confidence: best.similarity,
      inferenceMs,
      runnerUp: runnerUp
        ? { capability: runnerUp.capability, confidence: runnerUp.similarity }
        : undefined,
    };
  }

  /**
   * Classifies multiple namespaces in batch.
   *
   * @param inventories - Array of namespace/tools pairs
   * @returns Batch result with overrides map and full classification details
   */
  async classifyBatch(
    inventories: NamespaceInventory[],
  ): Promise<SemanticClassificationBatchResult> {
    const startTime = performance.now();
    const overrides: Partial<Record<string, CapabilityId>> = {};
    const classifications: ClassificationEntry[] = [];

    for (const { namespace, tools } of inventories) {
      const result = await this.classify(namespace, tools);
      classifications.push({ namespace, ...result });
      if (result.confidence >= this.confidenceThreshold) {
        overrides[namespace] = result.capability;
      }
    }

    return {
      overrides,
      classifications,
      inferenceMs: performance.now() - startTime,
    };
  }

  /**
   * Constructs the signal text for embedding from namespace metadata.
   * Combines namespace name, tool names, descriptions, and schema keys.
   */
  private buildSignalText(
    namespace: string,
    tools: NamespaceToolMetadata[],
  ): string {
    const parts: string[] = [namespace];
    for (const tool of tools) {
      parts.push(tool.name);
      if (tool.description) {
        parts.push(tool.description);
      }
      const schemaSignal = extractSchemaSignal(tool.inputSchema);
      if (schemaSignal) {
        parts.push(schemaSignal);
      }
    }
    return parts.join(" ");
  }
}
