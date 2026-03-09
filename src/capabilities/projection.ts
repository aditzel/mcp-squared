/**
 * Adapter-specific bucket projection for rich namespace classifications.
 *
 * Keeps MCP²'s canonical capability taxonomy stable while allowing downstream
 * integrations to map canonical capabilities + facets into their own bucket
 * models.
 *
 * @module capabilities/projection
 */

import type {
  AdapterProjectionAdapterConfig,
  AdapterProjectionConfig,
} from "../config/schema.js";
import type { NamespaceClassification } from "./inference.js";

export type AdapterProjectionSource =
  | "canonical"
  | "matched_profile"
  | "fallback"
  | "adapter_override";

export interface AdapterProjectionResult {
  namespace: string;
  adapterId: string;
  bucket: string;
  confidence: number;
  reason: string;
  source: AdapterProjectionSource;
}

function normalizeScore(score: number): number {
  if (score <= 0) {
    return 0;
  }
  if (score >= 100) {
    return 1;
  }
  return Number((score / 100).toFixed(4));
}

function scoreProfile(
  classification: NamespaceClassification,
  profile: AdapterProjectionAdapterConfig["capabilities"][number],
): number | null {
  if (!profile.acceptsCanonical.includes(classification.canonicalCapability)) {
    return null;
  }

  let score = 100;
  for (const facet of classification.facets) {
    if ((profile.prefersFacets ?? []).includes(facet)) {
      score += 15;
    }
    if ((profile.rejectsFacets ?? []).includes(facet)) {
      score -= 35;
    }
  }
  return score;
}

export function projectNamespaceClassification(
  adapterId: string,
  classification: NamespaceClassification,
  adapterConfig?: AdapterProjectionAdapterConfig,
): AdapterProjectionResult {
  if (!adapterConfig || adapterConfig.mode === "canonical") {
    return {
      namespace: classification.namespace,
      adapterId,
      bucket: classification.canonicalCapability,
      confidence: 1,
      reason: "canonical capability",
      source: "canonical",
    };
  }

  const overrideBucket =
    adapterConfig.namespaceBucketOverrides?.[classification.namespace];
  if (overrideBucket) {
    return {
      namespace: classification.namespace,
      adapterId,
      bucket: overrideBucket,
      confidence: 1,
      reason: "namespace override",
      source: "adapter_override",
    };
  }

  const ranked = (adapterConfig.capabilities ?? [])
    .map((profile) => ({
      profile,
      score: scoreProfile(classification, profile),
    }))
    .filter(
      (
        entry,
      ): entry is typeof entry & {
        score: number;
      } => entry.score !== null && entry.score > 0,
    )
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (best) {
    return {
      namespace: classification.namespace,
      adapterId,
      bucket: best.profile.id,
      confidence: normalizeScore(best.score),
      reason: `matched adapter profile ${best.profile.id}`,
      source: "matched_profile",
    };
  }

  if (adapterConfig.fallbackBucket) {
    return {
      namespace: classification.namespace,
      adapterId,
      bucket: adapterConfig.fallbackBucket,
      confidence: 0.5,
      reason: "adapter fallback bucket",
      source: "fallback",
    };
  }

  return {
    namespace: classification.namespace,
    adapterId,
    bucket: classification.canonicalCapability,
    confidence: 1,
    reason: "canonical capability",
    source: "canonical",
  };
}

export function projectNamespaceClassifications(
  adapterId: string,
  classifications: NamespaceClassification[],
  projectionConfig?: AdapterProjectionConfig,
): AdapterProjectionResult[] {
  const adapterConfig =
    projectionConfig?.adapters[adapterId] ??
    (adapterId === "mcp2"
      ? {
          mode: "canonical",
          fallbackBucket: undefined,
          capabilities: [],
          namespaceBucketOverrides: {},
        }
      : undefined);

  return classifications.map((classification) =>
    projectNamespaceClassification(adapterId, classification, adapterConfig),
  );
}
