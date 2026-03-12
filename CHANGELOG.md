# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Documented the short-term accepted OpenTUI transitive `file-type` advisory in `docs/DEPENDENCY_EXCEPTIONS.md` and tightened the dependency-maintenance/release process so temporary audit exceptions are only allowed when reviewed reachability remains low and local-only.

## [0.8.1] - 2026-03-11

### Changed
- Refreshed the top-level README status text to match the current `0.8.x` alpha line and clarify that auth integrations and CLI/config details may still evolve.
- Refreshed contributor and agent-facing docs (`.github/CONTRIBUTING.md`, `WARP.md`, and `docs/PROJECT-INCEPTION-REQUIREMENTS.md`) so current-status messaging consistently reflects the active `0.8.x` alpha line while preserving the inception doc as a historical `v0.1.x` baseline.
- Extracted capability-surface assembly from `src/server/index.ts` into `src/server/capability-surface.ts`, isolating capability-router instructions, metadata summaries, and router construction behind focused tests to make further server architecture refactors safer.
- Extracted capability tool registration and request-dispatch composition from `src/server/index.ts` into `src/server/capability-tool-surface.ts`, with additional handler regression tests covering `__describe_actions`, missing/unknown actions, and ambiguous capability-route disambiguation.
- Extracted capability tool execution from `src/server/index.ts` into `src/server/capability-tool-executor.ts`, isolating policy gating, response-resource offload handling, and selection-tracking behavior behind focused executor tests.
- Extracted session-surface registration from `src/server/index.ts` into `src/server/session-surface.ts`, isolating capability tool exposure and optional response-resource registration behind focused helper tests.
- Extracted runtime lifecycle orchestration from `src/server/index.ts` into `src/server/runtime-lifecycle.ts`, isolating background refresh hooks plus core startup/shutdown sequencing for upstream connections, hybrid classification, embeddings, and monitor lifecycle.
- Extracted remaining stdio/session bootstrap composition from `src/server/index.ts` into `src/server/server-shell.ts`, isolating session creation plus primary start/stop connection wiring behind focused shell tests.
- Extracted shared CLI startup/shutdown helpers plus daemon/proxy orchestration from `src/index.ts` into dedicated runtime-bootstrap and runner modules, with focused dispatch and lifecycle regression tests for the interactive daemon and stdio proxy flows.
- Extracted the remaining auth and monitor orchestration from `src/index.ts` into dedicated CLI runner modules plus a shared TUI-runtime helper, with focused regression tests covering auth/monitor dispatch and lifecycle behavior.
- Extracted the remaining CLI test/install/import/migrate orchestration from `src/index.ts` into dedicated runner modules, with focused regression tests covering command delegation plus runtime dispatch for those flows.
- Refactored the remaining CLI entrypoint composition out of `src/index.ts` into dedicated `main-runtime`, `run-stdio-server`, and runtime-profile modules, with focused tests covering `main()` help/version dispatch and stdio startup/shutdown lifecycle wiring.
- Expanded shared-daemon lifecycle regression coverage to lock down three-client owner-reconnect sequencing on the server side and three-bridge replacement-daemon recovery on the proxy side during restart flapping.
- Expanded daemon lifecycle monitor coverage to verify monitor-visible owner promotion/restoration ordering and stale-session cleanup during three-client reconnect flapping.
- Expanded daemon lifecycle monitor recovery coverage to verify a monitor client can reconnect across full daemon replacement while three clients rejoin cleanly and stale session IDs do not survive the old/new daemon boundary.
- Expanded full shared-daemon replacement coverage to verify a reattached monitor client still sees exactly three recovered proxy sessions, the logical prior owner restored, and no stale session IDs after three proxy bridges reconnect to the replacement daemon.
- Expanded shared-daemon config-identity recovery coverage to verify three recovering proxy bridges ignore a live mismatched daemon identity, rebind only to the matching replacement daemon, and never surface mixed session state through monitor clients.
- Expanded shared-daemon stale-registry recovery coverage to verify recovering proxy bridges prune a dead matching-config registry entry, ignore a live mismatched daemon identity, and converge on exactly one fresh matching replacement daemon without leaking mixed monitor-visible session state.
- Expanded shared-daemon convergence coverage to verify overlapping stale matching-config recovery triggers still produce exactly one fresh matching replacement daemon, keep registry state stable after convergence, and avoid mixed monitor-visible session sets.

### Fixed
- Fixed `mcp-squared test` for interactive OAuth SSE upstreams to recreate the HTTP transport after browser auth completes, avoiding `StreamableHTTPClientTransport already started!` failures during reconnect.
- Fixed SSE config validation to give OAuth-specific guidance when an `auth = true` upstream also includes a literal bearer `Authorization` header, instead of suggesting env-placeholder bearer-token setup for OAuth-only services.
- Fixed a proxy shutdown race where overlapping daemon disconnect and manual bridge stop paths could call `stdioTransport.close()` twice before the first close completed, improving lifecycle idempotency for daemon/proxy teardown.
- Fixed daemon owner reassignment ordering so authenticated peers become the active owner immediately after a disconnect, even if the departing session's cleanup is still awaiting server/transport shutdown.
- Fixed fast same-client daemon reconnects to replace stale authenticated sessions immediately, so ownership recovers without waiting for heartbeat timeout when a proxy reconnects after transport loss.
- Fixed owner preservation during delayed same-client reconnect cleanup, so a reconnecting logical owner keeps ownership instead of incorrectly handing it to an older observer session.
- Fixed shared-daemon proxy recovery after daemon restarts by forcing reconnects to refresh endpoint discovery instead of reusing the dead daemon endpoint, so active stdio clients stay connected when a replacement daemon comes up.
- Fixed proxy reconnect handling after transient daemon restart failures by retrying recovery instead of closing stdio immediately, so active clients survive reconnect flapping while the replacement daemon comes online.
- Fixed concurrent shared-daemon recovery so multiple active proxy bridges reuse one replacement-daemon startup wait instead of racing duplicate rediscovery/spawn attempts after an outage.
- Fixed rapid shared-daemon owner reconnect flapping so a recently disconnected logical owner can promptly reclaim ownership from observers after reconnecting, instead of losing owner status based only on disconnect timing.
- Fixed reconnect-time daemon owner restoration to send `helloAck` before `ownerChanged`, so a reconnecting logical owner sees a stable handshake before the broadcast ownership update reaches all clients.
- Fixed reconnect-time daemon owner restoration to avoid sending a redundant `ownerChanged` self-notification to the authenticating session when its `helloAck` already reflects final ownership, while still broadcasting the restored owner to other active clients.

## [0.8.0] - 2026-03-08

### Added
- Added `docs/capability-taxonomy-design.md`, a draft design for evolving capability matching with stable canonical buckets, dynamic internal facets, and adapter-specific projection rules for downstream gateways.
- Added rich namespace classification diagnostics: canonical capability, internal facet tags, and evidence metadata are now available to internal callers, with `status --verbose` surfacing classification and optional adapter-projection details.
- Added additive config support for `operations.dynamicToolSurface.facetOverrides` and `operations.adapterProjection` so downstream integrations can remap canonical MCP² capabilities into adapter-specific buckets without changing the public router names.
- Added a canonical `database` capability for database tooling such as Prisma and Supabase, including heuristic signals, semantic reference text, and public capability metadata.
- Added a canonical `observability` capability for monitoring and error-tracking tooling such as Sentry, including heuristic signals, semantic reference text, and public capability metadata.
- Added a canonical `messaging` capability for chat and notification tooling such as Slack, including heuristic signals, semantic reference text, and public capability metadata.
- Added a canonical `payments` capability for billing and checkout tooling such as Stripe, including heuristic signals, semantic reference text, and public capability metadata.
- Added a canonical `design_workspace` capability for structured design-as-code tooling such as Pencil, including public capability metadata and docs/examples that distinguish it from generic visual `design` tools.
- Added a live-captured official Figma MCP fixture test and tuned `design_workspace` signals so Figma's published MCP tool surface classifies as `design_workspace` rather than generic visual `design`.

### Changed
- Updated `docs/ARCHITECTURE.md` to document the planned direction for taxonomy evolution: preserve stable public capability IDs and layer richer internal classification beneath them.
- Capability inference now records richer internal signals while preserving the existing public capability router contract.

## [0.7.0] - 2026-03-06

### Added
- Added **response resource offloading**: when enabled, large upstream tool responses are stored as temporary MCP Resources instead of being returned inline. Clients receive a truncated preview with the resource URI and can fetch the full content via `resources/read`. Configurable via `operations.responseResource` with threshold, TTL, max inline lines, and eviction settings. Disabled by default.

### Fixed
- Fixed `cataloger.callTool()` silently dropping `structuredContent` from upstream MCP `CallToolResult` responses. The field is now forwarded through the response chain.
- Fixed response-resource offload thresholds to measure the exact stored payload bytes consistently, so boundary decisions and reported resource sizes now match.
- Fixed response-resource preview truncation to preserve valid UTF-8 when byte-capping long inline previews.
- Fixed capability-router disambiguation to consider only visible routes when resolving bare base actions, so blocked sibling routes no longer force unnecessary `requires_disambiguation` errors.
- Fixed TUI lazy loaders (`config-loader.ts`, `monitor-loader.ts`) failing in dev mode with `Cannot find module './tui/config.js'`. The hardcoded `./tui/config.js` specifier assumed bundled context (where the loader is inlined into `dist/index.js`); now dynamically resolves relative to `import.meta.url` to work in both source and bundled contexts.
- Fixed shadcn heuristic misclassification: added `shadcn` to docs namespace hints and added component registry patterns (`registry`, `component`, `example`) to docs capability patterns. Previously classified as `code_search` (with real tools) or `design` (with simplified tools).
- `status --verbose` now shows a **Context Savings** section estimating token savings from capability routing: tokens without MCP² (raw upstream tools), tokens with MCP² (capability tools), total saved tokens, and savings percentage.
- Added `ai_media_generation` capability (11th capability) for AI image/video generation tools (wavespeed, stability, replicate, runway, midjourney, etc.), preventing misclassification as `design`. Includes namespace hints, tool signal patterns, semantic reference text, and component tests with real wavespeed-cli-mcp tool metadata.
- Added `mcp-squared status` command that shows upstream server connection status and the full capability routing table (which upstream tools map to which capability actions). Supports `--verbose` for schema parameter details.
- Extracted action routing logic into shared `src/capabilities/routing.ts` module so both the server and CLI commands share the same deterministic routing computation.
- Added `hybrid` inference mode for capability classification: when `operations.dynamicToolSurface.inference = "hybrid"` and `operations.embeddings.enabled = true`, MCP² uses embedding-based semantic classification (BGE-small-en-v1.5) as a fallback for ambiguous namespaces. User config `capabilityOverrides` always take precedence. Controlled by `semanticConfidenceThreshold` (default: 0.45).
- Added `SemanticCapabilityClassifier` module that reuses the existing `EmbeddingGenerator` to classify namespaces by cosine similarity against capability reference embeddings.
- Added heuristic misclassification regression tests documenting 4 known failures (Notion, Sentry, Prisma, Supabase).
- Added component test for shadcn MCP server classification using real tool metadata from the official server (`npx shadcn@latest mcp`).
- Added a capability-first public tool API that registers one router per non-empty capability at connect time (`code_search`, `docs`, `browser_automation`, `issue_tracking`, `cms_content`, `design`, `hosting_deploy`, `time_util`, `research`, `general`).
- Added router introspection via reserved `action = "__describe_actions"` returning capability-local action catalogs and input schemas without upstream identifier leakage.
- Added deterministic action ID generation/collision handling from upstream tools, including reserved-name rewriting and suffixing (`__2`, `__3`, ...).
- Added capability inference/grouping tests (including `auggie` => `code_search`) and capability-router API contract tests.
- Added context-window budget tests for capability-router `tools/list` metadata footprint.

### Security
- Updated transitive `express-rate-limit` from 8.2.1 to 8.2.2 to fix GHSA-46wh-pxpv-q5gq (IPv4-mapped IPv6 addresses bypass per-client rate limiting on dual-stack servers).
- Updated `tar` from 7.5.9 to 7.5.10 (fixes GHSA-qffp-2rhf-9h96: hardlink path traversal).
- Updated `@hono/node-server` from 1.19.9 to 1.19.11 (fixes GHSA-wc8c-qw6v-h7f6: auth bypass via encoded slashes).
- Updated `hono` from 4.11.x to 4.12.5 (fixes GHSA-5pq2-9x2x-5p6w, GHSA-p6xx-57qc-3wxr, GHSA-q5qw-h33p-qvwr: cookie injection, SSE injection, arbitrary file access).

### Changed
- Capability router collision IDs are now stable and instance-aware for duplicate upstreams. Colliding actions use the upstream instance key in the public action ID (for example `create_issue__github_work`), `__describe_actions` includes instance metadata for those collisions, and capability handlers resolve against live routing state so refreshed upstream tool surfaces are reflected without recreating the handler.
- Coverage enforcement now reads Bun's text summary for line coverage and LCOV branch totals when available, closing the line-only gate gap without depending on Bun's incomplete LCOV line aggregation.
- Authentication errors (invalid tokens, missing API keys, unauthorized access) are now shown as `⚠ needs auth` (yellow) in `mcp-squared status` instead of the generic `✗ error` (red), making it easier to distinguish credential issues from connection failures.
- Replaced the mixed/legacy public API surface with capability routers only; public `find_tools` / `describe_tools` / `execute` / `list_namespaces` / `clear_selection_cache` are no longer registered.
- Reinterpreted `security.tools` policy patterns as `capability:action` and bound confirmation tokens to capability/action context.
- Simplified `operations.dynamicToolSurface` to inference/refresh/overrides fields; legacy `mode`/`naming` keys are now ignored with warnings.
- Updated `mcp-squared migrate` to remove deprecated dynamic tool-surface keys and best-effort translate legacy `server:tool` security rules to capability/action patterns with unresolved reporting.
- Updated `mcp-squared init` template and architecture/README docs to reflect capability-first routing as the only public mode.

## [0.4.0] - 2026-03-03

### Changed
- Added MCP `initialize` usage instructions that emphasize discovery-first tool routing (`find_tools` before local shell fallback) and surface configured code-search namespace hints when present.
- Enhanced meta-tool registration metadata with explicit titles and tool annotations (`readOnlyHint`, `openWorldHint`, etc.) to better align with MCP tool-interface best practices.
- `find_tools` responses now include a `guidance` block and apply intent-aware ranking boosts for codebase-search queries, preferring configured code-search namespaces (for example `auggie`) when available.
- Added explicit config support for intent-based namespace preference at `operations.findTools.preferredNamespacesByIntent.codeSearch`, with heuristic fallback when not configured.
- `mcp-squared init` now pre-populates `operations.findTools.preferredNamespacesByIntent.codeSearch` with `["auggie", "ctxdb"]` so code-search routing works out of the box.
- Added `mcp-squared migrate` (with `--dry-run`) to apply one-time config migrations for existing files, including seeding code-search namespace defaults when unset.
- Added a repeatable routing evaluation harness (`bun run eval:routing`) to measure first-choice namespace selection quality for code-search prompts.
- CI now enforces a minimum line coverage threshold (`>=80%`) after generating LCOV coverage reports.
- CI now runs strict routing evaluation (`bun run eval:routing --strict`) on PRs/pushes and publish builds.

### Fixed
- `mcp-squared migrate` now preserves explicitly configured `codeSearch = []` and seeds defaults only when the key is unset.
- Coverage workflows now create `coverage/` before teeing summary output, preventing CI failures on clean runners.
- Routing eval summary now guards empty `codeSearch` scenario sets to avoid `NaN`/`Infinity` percentages in report output.
- Routing eval strict-failure handling now sets `process.exitCode` instead of exiting synchronously, ensuring cleanup in `finally` always runs.
- Restored runtime-safe relative import for `runMigrate` in the CLI entrypoint so publish-time runtime import verification passes.

## [0.3.4] - 2026-03-02

### Added
- TUI upstream edit flow now supports updating existing stdio and SSE upstream server configuration directly from the edit screen.
- Added regression tests for TUI upstream edit/delete behavior and form parsing in `tests/tui-upstream-edit.test.ts`.

### Changed
- Refactored TUI upstream form save/delete/menu logic into shared helpers at `src/tui/upstream-edit.ts` to improve determinism and testability.

### Fixed
- Version resolution now checks multiple package manifest locations to avoid falling back to `0.0.0` in bundled TUI/runtime contexts.

## [0.3.3] - 2026-03-02

### Fixed
- Fixed packaged `config` and `monitor` CLI modes by shipping TUI runtime modules (`dist/tui/config.js`, `dist/tui/monitor.js`) and resolving loader imports to those paths.
- Added a build artifact regression test to catch missing local dynamic-import targets in `dist/index.js`.

## [0.3.2] - 2026-03-02

### Fixed
- Added a publish-time `dist/index.js` runtime import guard to fail builds if unresolved `@/...` aliases are emitted, preventing broken CLI installs.
- Documented stale global-install troubleshooting for `Cannot find module '@/version.js'` failures (`mcp-squared@0.3.0` artifacts).

## [0.3.1] - 2026-03-02

### Fixed
- Replaced `@/...` path-alias imports in CLI runtime code paths with relative imports so published installs resolve `VERSION` and daemon modules correctly at runtime.

## [0.3.0] - 2026-03-02

### Added
- Explicit semantic/hybrid search behavior with more reliable fallback handling.
- Hardened default security posture for work/enterprise usage.
- Unified runtime version source of truth.
- Dependency maintenance runbook at `docs/DEPENDENCY_MAINTENANCE.md` and exception register at `docs/DEPENDENCY_EXCEPTIONS.md`.

### Changed
- CI and publish workflows now run `bun run audit` after dependency install.
- `release:check` now includes dependency auditing (`bun run audit`).
- Expanded cross-platform standalone compile validation, including a macOS native smoke leg.

### Fixed
- SSE auth import mapping now preserves/normalizes auth objects, including null and partial auth cases.
- Hardened daemon IPC/auth handling (shared-secret handshake, mapped loopback/IPv4 handling, and registry file permissions).
- Fixed monitor listener leak and execute policy normalization for qualified tool names.

### Security
- Upgraded key dependencies (`@modelcontextprotocol/sdk`, `@opentui/core`, `@biomejs/biome`) and pinned patched transitive ranges for `ajv` and `hono` via overrides.

## [0.2.0] - 2026-02-24

### Added
- `bun run release:check` script to run test/build/lint/typecheck and verify package contents with `bun pm pack --dry-run`.
- Maintainer release runbook at `docs/RELEASING.md`.

### Changed
- Tightened npm package contents to include only runtime artifacts (`bin/mcp-squared`, `dist/index.js`, `dist/*.scm`, `dist/*.wasm`), excluding standalone compile outputs and logs.

### Fixed
- Improved standalone binary compile reliability across platforms (lazy TUI loading and compile/runtime hardening).

### Security
- Hardened OAuth/config handling and dependency posture via follow-up remediation work.

## [0.1.0] - 2026-02-19

### Added
- Multi-upstream support (stdio + SSE/HTTP with OAuth 2.0 dynamic client registration)
- Hybrid search (FTS5 + optional local embeddings via Transformers.js BGE-small)
- Progressive tool disclosure with L0/L1/L2 detail levels
- Selection caching with co-occurrence bundle suggestions
- Security policy engine (allow/block/confirm gates with confirmation tokens)
- Tool description sanitization to mitigate prompt injection
- Background index refresh with change detection
- Shared daemon mode (one backend, multiple stdio proxy clients)
- TUI interfaces for configuration and monitoring
- Import/install support for 17+ MCP clients (Claude, Cursor, VS Code, Zed, Windsurf, Codex, and more)
- Agent Safety Kit with cost model simulator

### Fixed
- Stdio process leak - safelyCloseTransport now called before client.close() to prevent zombie processes
