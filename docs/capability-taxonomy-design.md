# Capability Taxonomy and Adapter Projection Design

Status: Draft
Last updated: 2026-03-07
Owners: MCP² maintainers

## Problem Statement

MCP² currently assigns each upstream namespace to exactly one public capability bucket such as `code_search`, `docs`, or `design`.

That model is stable and easy to route, but it breaks down in two cases:

- Some upstreams span multiple concerns.
- Different downstream consumers mean different things by the same label.

Example: Pencil is a reasonable fit for MCP²'s current `design` bucket, but it is a poor fit for a downstream gateway whose `design` bucket mostly means screenshot analysis, OCR, diagram understanding, and visual diffing.

The current system needs:

- Stable public capability IDs for policy, routing, and client contracts.
- Richer internal metadata than one label.
- A way to project MCP²'s canonical model into adapter-specific buckets without rewriting the core taxonomy for every integration.

## Goals

- Keep the public MCP² capability contract stable and versionable.
- Add richer internal classification signals without exposing unstable tool names.
- Support adapter-specific projections for external gateways and tool ecosystems.
- Preserve existing `capability:action` security semantics.
- Make misclassifications diagnosable with explicit evidence.

## Non-Goals

- Dynamically generating new public capability tools at runtime.
- Replacing capability routing with per-upstream tool exposure.
- Solving all taxonomy gaps in one release.
- Introducing a mandatory breaking change for existing configs.

## Decision

MCP² should keep a curated, pre-set canonical capability taxonomy for its public API.

It should add two new internal layers underneath that API:

1. Capability facets: dynamic secondary tags that describe what a namespace actually does.
2. Adapter projections: mapping rules that translate canonical capability + facets into another consumer's bucket model.

In short:

- Public buckets are fixed.
- Internal facets are dynamic.
- External bucket mappings are adapter-specific.

## Why Not Dynamic Public Categories?

Dynamic public categories would destabilize several existing contracts:

- Security rules match `capability:action`.
- Config overrides pin `namespace -> capability`.
- MCP clients call one public tool per capability.
- Router naming, docs, and confirmation tokens all depend on stable capability IDs.

Those surfaces should remain versioned and predictable.

## Proposed Data Model

### 1. Canonical Capability

This stays close to the current `CapabilityId` model.

```ts
export type CanonicalCapabilityId =
  | "code_search"
  | "docs"
  | "browser_automation"
  | "issue_tracking"
  | "observability"
  | "messaging"
  | "payments"
  | "database"
  | "cms_content"
  | "design"
  | "design_workspace"
  | "ai_media_generation"
  | "hosting_deploy"
  | "time_util"
  | "research"
  | "general";
```

This remains the only public MCP² router namespace unless a future release explicitly adds a new canonical capability.

### 2. Capability Facets

Facets are internal, many-valued tags. They are not public tool names.

```ts
export type CapabilityFacetId = string;
```

Examples:

- `vision_analysis`
- `ocr`
- `diagram_understanding`
- `ui_diff`
- `design_workspace`
- `layout_analysis`
- `design_tokens`
- `design_to_code`
- `database_admin`
- `observability`
- `payments`

Facets can be model-generated, heuristic, or explicitly overridden.

### 3. Classification Result

The current single-label output becomes a richer internal record.

```ts
export interface NamespaceClassification {
  namespace: string;
  canonicalCapability: CanonicalCapabilityId;
  confidence: number;
  runnerUp?: {
    canonicalCapability: CanonicalCapabilityId;
    confidence: number;
  };
  facets: CapabilityFacetId[];
  evidence: ClassificationEvidence[];
}

export interface ClassificationEvidence {
  source:
    | "namespace_hint"
    | "tool_signal"
    | "semantic_similarity"
    | "user_override"
    | "adapter_override";
  target: string;
  score?: number;
  note?: string;
}
```

### 4. Adapter Projection

Adapters consume canonical classification and decide how to expose it to a specific external surface.

```ts
export interface AdapterProjectionResult {
  adapterId: string;
  bucket: string;
  confidence: number;
  reason: string;
}

export interface AdapterCapabilityProfile {
  id: string;
  title: string;
  summary: string;
  acceptsCanonical: CanonicalCapabilityId[];
  prefersFacets?: CapabilityFacetId[];
  rejectsFacets?: CapabilityFacetId[];
}
```

## Proposed Config Shape

This is intentionally additive and non-breaking.

```toml
[operations.dynamicToolSurface]
inference = "hybrid"
refresh = "on_connect"
semanticConfidenceThreshold = 0.45

[operations.dynamicToolSurface.capabilityOverrides]
# Existing stable override surface stays canonical.
# pencil = "design_workspace"

[operations.dynamicToolSurface.facetOverrides]
pencil = ["design_workspace", "layout_analysis", "design_tokens", "design_to_code"]

[operations.adapterProjection]
enabled = true
defaultAdapter = "mcp2"

[operations.adapterProjection.adapters.mcp2]
mode = "canonical"

[operations.adapterProjection.adapters.gateway]
mode = "projected"
fallbackBucket = "general"

[[operations.adapterProjection.adapters.gateway.capabilities]]
id = "design"
title = "Design Analysis"
summary = "Analyze screenshots, diagrams, UI diffs, and other visual artifacts."
acceptsCanonical = ["design", "design_workspace", "browser_automation", "research"]
prefersFacets = ["vision_analysis", "ocr", "diagram_understanding", "ui_diff"]
rejectsFacets = ["design_workspace", "design_tokens", "design_to_code"]

[[operations.adapterProjection.adapters.gateway.capabilities]]
id = "general"
title = "General"
summary = "Fallback bucket for tools that do not map cleanly."
acceptsCanonical = ["general", "design", "docs", "research"]

[operations.adapterProjection.adapters.gateway.namespaceBucketOverrides]
pencil = "general"
```

## Runtime Behavior

### Canonical MCP² Surface

MCP² continues to expose one public tool per canonical capability.

- Policies still match `capability:action`.
- Confirmation tokens remain scoped to canonical capability + action.
- Existing configs continue to work.

### Internal Classification

Classification becomes a 2-step process:

1. Infer canonical capability.
2. Infer zero or more facets.

Canonical capability is still required even when facets are present.

### Adapter Projection

Adapter projection is optional and happens after canonical classification.

Examples:

- Native MCP² client:
  - Uses canonical capability directly.
- Gateway with screenshot-analysis `design` semantics:
  - Uses adapter projection rules.
- Status/diagnostics output:
  - Can show canonical capability plus inferred facets.

## Pencil Example

### Canonical Classification

Pencil should remain canonically classified as:

```ts
canonicalCapability = "design_workspace"
```

### Suggested Facets

```ts
facets = [
  "design_workspace",
  "layout_analysis",
  "design_tokens",
  "design_to_code",
];
```

### Gateway Projection

If the gateway's `design` bucket means screenshot/vision analysis, Pencil should not project there by default.

A reasonable projection would be:

```ts
adapter = "gateway"
bucket = "general"
```

Reason:

- Pencil edits structured design workspaces.
- It is not primarily an OCR/vision-analysis/screenshot-diff tool.
- Mapping it to gateway `design` would over-promise the wrong affordances.

## API Surface Changes

### No Immediate Breaking Change

Existing APIs continue to return canonical capability routers.

### Optional New Diagnostics

Future diagnostics may expose richer classification details:

```json
{
  "namespace": "pencil",
  "canonicalCapability": "design_workspace",
  "facets": [
    "design_workspace",
    "layout_analysis",
    "design_tokens",
    "design_to_code"
  ],
  "projection": {
    "adapter": "gateway",
    "bucket": "general"
  }
}
```

This should be exposed only in internal status, verbose diagnostics, or explicit adapter tooling, not in the base MCP² public contract.

## Migration Plan

### Phase 1: Internal Types and Diagnostics

- Add `NamespaceClassification`.
- Keep existing `CapabilityId` public contract unchanged.
- Add facet inference and evidence recording.
- Update `status --verbose` to show canonical capability, facets, and override source.

### Phase 2: Adapter Projection Layer

- Add adapter projection config and runtime mapping helpers.
- Keep MCP² default adapter in canonical mode.
- Add integration tests for adapter-specific projections.

### Phase 3: Taxonomy Expansion

Further canonical taxonomy changes should still be deliberate versioned changes, not emergent runtime behavior.

## Test Strategy

- Keep existing canonical capability tests.
- Add facet inference tests for multi-concern namespaces.
- Add adapter projection tests that validate external mappings without changing canonical routing.
- Add regression tests for known mismatches such as:
  - Pencil vs gateway `design`
  - shadcn vs visual-design tools
  - Supabase vs hosting/DB projections

## Consequences

### Benefits

- Preserves stable public tool names.
- Improves classification expressiveness.
- Makes integration mismatches explainable.
- Avoids forcing one taxonomy onto every adapter.

### Costs

- More internal state to maintain.
- Additional configuration surface.
- Need to define facet vocabularies with reasonable discipline.

## Recommendation

Adopt canonical capabilities + dynamic facets + adapter projection.

Do not generate public categories dynamically.

That keeps MCP² stable where it must be stable, and flexible where integrations actually need flexibility.
