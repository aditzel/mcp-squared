# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
