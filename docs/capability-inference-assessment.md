# Capability Inference Assessment

## Executive Summary

The current regex+score heuristic achieves **62% accuracy** against a 13-server real-world benchmark. Five of the failures are **structural** — they cannot be fixed by tuning weights or adding patterns. An LLM is unnecessary; the project already ships the infrastructure needed for a better approach.

---

## 1. Failure Analysis

### Scoring Trace Results (13 real-world MCP server profiles)

| Server | Expected | Actual | Verdict |
|---|---|---|---|
| shadcn | docs | **design** | WRONG |
| augment-code-actions | code_search | code_search | OK |
| context7 | docs | docs | OK |
| supabase | hosting_deploy | **issue_tracking** | WRONG |
| stripe | general | general | OK |
| notion | cms_content | **browser_automation** | WRONG |
| sentry | general | **issue_tracking** | WRONG |
| slack | general | general | OK |
| Ref | docs | docs | OK |
| Exa | research | research | OK |
| prisma | general | **cms_content** | WRONG |
| github | code_search | code_search | OK |
| kubernetes | hosting_deploy | hosting_deploy | OK |

### Failure Mode Classification

**Type 1: Semantic collision (3 failures)**
Shared vocabulary triggers wrong category because patterns are too broad.

- **Notion → browser_automation**: Tool descriptions say "page" (as in wiki page). The `browser_automation` pattern `/\bpage\b/` matches, scoring 8 vs `cms_content`'s 4. The word "page" genuinely means both browser pages and content pages.
- **Sentry → issue_tracking**: Sentry tools say "issue" and "project" (error tracking concepts). The `issue_tracking` patterns match because error tracking **shares vocabulary** with project management, even though the intent is completely different.
- **Prisma → cms_content**: Prisma uses "schema" and "migration" (database concepts). The `cms_content` patterns treat these as CMS signals because Sanity also uses these words.

**Type 2: Taxonomy gap (1 failure)**
The target category doesn't exist.

- **Supabase**: Database-as-a-service doesn't map cleanly to any of the 10 categories. It gets classified as `issue_tracking` (because "projects") when no correct answer exists.

**Type 3: Nuance failure (1 failure)**
The correct answer requires understanding *what the tools do*, not just word matching.

- **shadcn → design**: shadcn tools say "ui" and "component". The heuristic correctly detects UI-related signal but classifies as `design` (Figma/Pencil territory) when shadcn is a **code component registry** — closer to `docs`. A regex cannot distinguish "visual design tools" from "code libraries about UI".

### Root Causes

1. **Regex patterns are symmetric**: `/\bpage\b/` matches Notion wiki pages and browser pages identically. No disambiguation is possible without understanding context.
2. **Vocabulary overlap is inherent**: Many domains share terms (issue, project, schema, migration, content, page). More patterns make this worse, not better.
3. **The taxonomy is underspecified**: 10 categories cannot cover the MCP ecosystem. Missing: database, monitoring/observability, messaging/chat, payments, ORM/schema.
4. **No negative signal**: The heuristic only adds scores, never subtracts. A tool about "Prisma database schema" should **suppress** cms_content, but can't.

---

## 2. Can the Heuristic Be Tuned to Fix This?

**Partially.** You could:
- Add negative patterns (e.g., "Prisma" in namespace → suppress cms_content)
- Add more namespace hints (e.g., `notion` → cms_content at score 20)
- Widen the taxonomy to 15+ categories

But this creates a **whack-a-mole dynamic**: every new MCP server added to the ecosystem may need its own override. The maintenance burden scales linearly with the number of upstream servers in the wild. The fundamental issue is that **classification from keyword frequency is the wrong level of abstraction** for this problem.

---

## 3. Would an LLM Fix This?

### What would an LLM actually do here?

The classification task is: given a namespace name + a list of (tool_name, description, schema_keys), assign one of ~10 category labels. This is **short-text multi-class classification** — one of the simplest NLP tasks.

### Why an LLM is overkill

1. **The input is tiny**: Namespace name + 3-10 tool signatures ≈ 100-500 tokens. This is a classification problem, not a generation problem.
2. **The label space is fixed**: 10 categories. No open-ended reasoning needed.
3. **Latency budget is tight**: Classification happens at connect time for every upstream. Even 200ms per namespace × 10 upstreams = 2s added to startup.
4. **Cold-start cost**: Even small LLMs (TinyLlama, SmolLM2) take 1-5s to load into memory on CPU. This dominates the latency budget.
5. **Dependency weight**: Adding llama.cpp bindings or a GGUF model adds 100MB-1GB to the install, vs the current approach at ~0 bytes.

### Where an LLM *would* help

An LLM would correctly handle all 5 failure cases because it understands that:
- "shadcn/ui component" is a code library, not a design tool
- "Sentry issue" means error tracking, not project management
- "Prisma schema" is database ORM, not CMS content
- "Notion page" is wiki/knowledge base content

But this understanding can be captured **much more cheaply**.

---

## 4. Better Approaches (No LLM Required)

### Option A: Zero-Shot NLI Classification

Use a Natural Language Inference model via the `zero-shot-classification` pipeline from `@huggingface/transformers` (already in `package.json`). The model scores each capability label as entailment/contradiction against the input text.

| Model | Params | Quantized Size | Latency (CPU) |
|---|---|---|---|
| `Xenova/nli-deberta-v3-xsmall` | 22M | ~90MB | ~20-50ms |
| `Xenova/mobilebert-uncased-mnli` | 25M | ~100MB | ~15-40ms |
| `Xenova/distilbert-base-uncased-mnli` | 66M | ~260MB | ~40-100ms |

**Advantages:**
- Zero new npm dependencies — `@huggingface/transformers` is already installed
- Zero training data needed — the 10 capability labels work directly as NLI hypotheses
- Handles semantic nuance natively (understands "Sentry issue" ≠ "Jira issue")
- Pipeline handles tokenization, inference, and scoring

**Disadvantages:**
- ~90MB model download on first use
- Cold-start: model load adds 1-3s to first classification (cached after)
- NLI models are slightly slower than pure embedding similarity

### Option B: Embedding-Based Classification (Fastest)

The project **already ships** `EmbeddingGenerator` with BGE-small-en-v1.5. This can be repurposed:

1. **Pre-compute reference embeddings** for each capability category using representative descriptions:
   ```
   code_search: "Search source code, symbols, definitions, and references across repositories"
   docs: "Query technical documentation, API references, library guides, and component registries"
   cms_content: "Manage wiki pages, knowledge base articles, content documents, and editorial workflows"
   ...
   ```

2. **At classify time**, embed the namespace's concatenated tool signals (name + descriptions), compute cosine similarity against all 10 reference embeddings, pick the highest.

3. **Threshold**: If max similarity < 0.3, fall back to `general`.

| Model | Params | Quantized Size | Latency (CPU) |
|---|---|---|---|
| `Xenova/bge-small-en-v1.5` (current) | 33M | ~130MB | ~20-50ms |
| `Xenova/all-MiniLM-L6-v2` | 22M | ~80MB | ~5-15ms |

**Advantages:**
- Uses existing infrastructure (BGE-small, ONNX runtime, embeddings module)
- ~5-50ms per classification depending on model
- Reference embeddings can be pre-computed and shipped as a static Float32Array
- No new dependencies at all

**Disadvantages:**
- Requires embeddings to be enabled (currently optional, off by default)
- Quality depends on how well reference descriptions are authored
- Still a single-label classifier — multi-capability servers (GitHub) still get one label

### Option C: Hybrid Heuristic + ML Fallback (Recommended)

Keep the existing heuristic as a synchronous fast path. When confidence is low (winning score < threshold, or top-2 scores within margin), fall back to ML-based classification (Option A or B).

**Advantages:**
- Zero latency cost for clear-cut cases (auggie, context7, time)
- ML fallback only fires for ambiguous cases (~40% of namespaces)
- Graceful degradation if embeddings/models aren't available
- The heuristic remains deterministic and testable

### Option D: Improved Heuristic Only (Minimal Change)

If ML is off the table, the heuristic can be improved:

1. **Add negative patterns**: "database", "ORM", "sql" → suppress cms_content
2. **Add namespace-specific hardcoded hints** for the top-20 known MCP servers
3. **Use TF-IDF-like weighting** instead of flat +4 per match
4. **Expand taxonomy** to cover database, monitoring, messaging

This is the most pragmatic short-term fix but has the worst long-term maintenance properties — every new MCP server in the wild potentially needs a new pattern.

### What NOT to Do

- **Do not use generative LLMs** (Qwen2.5-0.5B, SmolLM2, TinyLlama, Phi-3-mini) — too slow (200ms+ autoregressive), too large (300MB+), wrong tool for classification, requires fragile output parsing
- **Do not add `node-llama-cpp`** — introduces native C++ compilation dependency for a task that doesn't need it
- **Do not fine-tune a model** — with only 10 categories and no large labeled dataset, zero-shot or embeddings will match fine-tuned accuracy with zero training effort

---

## 5. Recommendation

**Option C (Hybrid heuristic + ML fallback)** is the best path forward:

1. The heuristic already works for ~60% of cases with zero latency cost.
2. For the remaining ~40%, the project's existing Transformers.js infrastructure can classify with semantic understanding — either via embedding similarity (Option B, fastest) or NLI zero-shot (Option A, most accurate).
3. No new npm dependencies. No generative LLM. No model downloads beyond what's already optional.
4. The `capabilityOverrides` config remains as a user escape hatch for edge cases.
5. Model results can be cached per namespace — classification only runs once per upstream connection.

The person who told you an LLM isn't needed is **correct in conclusion but potentially for the wrong reason**. The issue isn't that heuristics are "good enough" — they demonstrably aren't at 62% accuracy. The issue is that **encoder-based ML models (embeddings or NLI) solve this problem at the right level of abstraction**: semantic similarity without generative overhead. The project already has the infrastructure; it just isn't wired into the classification path.

---

## Appendix: Scoring Trace Details

Reproduced via an instrumented scoring trace against 13 real-world MCP server profiles (shadcn, augment-code-actions, context7, supabase, stripe, notion, sentry, slack, Ref, Exa, prisma, github, kubernetes).
