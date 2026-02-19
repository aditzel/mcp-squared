# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
