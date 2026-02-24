# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP² (Mercury Control Plane) is a local-first meta-server and proxy for the Model Context Protocol (MCP). It reduces tool context bloat by exposing a minimal surface area (`find_tools`, `describe_tools`, `execute`, plus supporting meta-tools) instead of loading all tool schemas into LLM context.

**Status**: Alpha (v0.1.x)

## Development Commands

```bash
# Development
bun run dev              # Watch mode with hot reload
bun run start            # Run server

# Quality
bun test                 # Run tests
bun test --watch         # Watch mode
bun run typecheck        # TypeScript type checking
bun run lint             # Biome linting
bun run lint:fix         # Auto-fix lint issues
bun run format           # Format with Biome

# Build
bun run build            # Build to dist/
bun run clean            # Remove dist/
```

## Commit Rules

You MUST NOT commit changes until all of these are clean:

- `bun test`
- `bun run build`
- `bun run lint`

This applies even when failures are pre-existing in the branch.

### Running a Single Test

```bash
bun test tests/config.test.ts        # Run specific test file
bun test -t "test name pattern"      # Filter by test name
```

## CLI Usage

```bash
mcp-squared                 # Start MCP server (stdio mode)
mcp-squared config          # Launch config TUI
mcp-squared test [name]     # Test upstream connection(s)
mcp-squared auth <name>     # OAuth auth for SSE/HTTP upstream
mcp-squared import          # Import MCP configs from other tools
mcp-squared install         # Install MCP² into other MCP clients
mcp-squared monitor         # Launch server monitor TUI
```

## Architecture

MCP² sits between MCP clients (IDEs, agents) and upstream MCP servers:

```
MCP Client → MCP² Meta-Server → Upstream MCP Servers
                   │
            ┌──────┴──────┐
            │ Local Index │
            └─────────────┘
```

### Core Components

- **`src/index.ts`** - Entry point; CLI argument handling and mode dispatch
- **`src/server/`** - MCP server implementation using `@modelcontextprotocol/sdk`. Exposes meta-tools:
  - `find_tools`, `describe_tools`, `execute`
  - `list_namespaces`, `clear_selection_cache`
- **`src/retriever/`** - Search and retrieval logic (FTS5, semantic, hybrid)
- **`src/index/`** - SQLite index store (FTS5 + embeddings + co-occurrence)
- **`src/embeddings/`** - Transformers.js embedding generation (BGE-small)
- **`src/upstream/`** - Connectivity to upstream MCP servers (stdio + SSE/HTTP)
- **`src/oauth/`** - OAuth 2.0 dynamic client registration + token storage
- **`src/security/`** - Policy enforcement (allow/block/confirm) and sanitization
- **`src/background/`** - Background index refresh + change detection
- **`src/caching/`** - Selection cache tracking for co-occurrence suggestions
- **`src/tui/`** - OpenTUI-based configuration and monitor UIs
- **`src/import/`** - Import MCP configs from other tools
- **`src/install/`** - Install MCP² into other MCP clients
- **`src/cli/`** - Argument parsing and help output
- **`src/utils/`** - Shared utility helpers

### Configuration System

Config is stored in TOML format with this discovery order:
1. `$MCP_SQUARED_CONFIG` environment variable
2. Project-local: `mcp-squared.toml` or `.mcp-squared/config.toml` (walks up directories)
3. User-level: `~/.config/mcp-squared/config.toml` (Linux/macOS) or `%APPDATA%/mcp-squared/config.toml` (Windows)

Schema is validated with Zod (`src/config/schema.ts`). Key sections:
- `upstreams` - Map of named upstream servers (stdio or SSE/HTTP transport)
- `security.tools` - Allow/block/confirm lists for tool access
- `operations.findTools` - Default search mode, limits, and detail level
- `operations.index` - Background refresh interval
- `operations.selectionCache` - Co-occurrence suggestion settings
- `operations.logging` - Log level

### Upstream Configuration

Two transport types supported in schema:
- **stdio**: Launches subprocess with command/args/env
- **sse**: HTTP streaming connection (Streamable HTTP transport)

SSE upstreams can enable OAuth via `auth = true` (or an object with `callbackPort`/`clientName`). Tokens are stored under `~/.config/mcp-squared/tokens/<upstream>.json`.

## Key Conventions

- **Runtime**: Bun (not Node.js)
- **Config format**: TOML with Zod validation (`smol-toml` parser)
- **Linting**: Biome (not ESLint)
- **TypeScript**: Strict mode with `noUncheckedIndexedAccess`
- **Imports**: Use `.js` extension for local imports (ESM)
- **Path alias**: `@/*` maps to `src/*`
- **Embeddings**: Optional; semantic/hybrid search falls back to FTS5 if embeddings are missing

## Issue Tracking

This project uses GitHub Issues and pull requests for issue tracking. See `AGENTS.md` for workflow.

## Key Dependencies

- **@modelcontextprotocol/sdk** - Official MCP SDK for server and client
- **@huggingface/transformers** - Local embedding generation
- **@opentui/core** - Terminal UI framework for config/monitor
- **smol-toml** - TOML parsing
- **zod** - Schema validation
