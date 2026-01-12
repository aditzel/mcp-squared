# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP² (Mercury Control Plane) is a local-first meta-server and proxy for the Model Context Protocol (MCP). It reduces tool context bloat by exposing a minimal surface area (`find_tools`, `describe_tools`, `execute`) instead of loading all tool schemas into LLM context.

**Status**: Pre-alpha / Inception

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

# Build
bun run build            # Build to dist/
bun run clean            # Remove dist/
```

### Running a Single Test

```bash
bun test tests/config.test.ts        # Run specific test file
bun test -t "test name pattern"      # Filter by test name
```

## CLI Usage

```bash
mcp-squared              # Start MCP server (stdio mode)
mcp-squared config       # Launch TUI configuration interface
mcp-squared test         # Test all configured upstreams
mcp-squared test <name>  # Test specific upstream
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

- **`src/index.ts`** - Entry point; CLI argument handling and mode dispatch (server, config TUI, test)
- **`src/server/`** - MCP server implementation using `@modelcontextprotocol/sdk`. Exposes three meta-tools:
  - `find_tools` - Semantic search for tools across upstreams
  - `describe_tools` - Get full schemas for specific tools
  - `execute` - Passthrough execution to upstream servers
- **`src/upstream/`** - Client for connecting to upstream MCP servers (stdio transport implemented, SSE planned)
- **`src/config/`** - Configuration management with TOML format, Zod validation, and schema migrations
- **`src/tui/`** - OpenTUI-based interactive configuration interface
- **`src/cli/`** - Argument parsing and help output

### Configuration System

Config is stored in TOML format with this discovery order:
1. `$MCP_SQUARED_CONFIG` environment variable
2. Project-local: `mcp-squared.toml` or `.mcp-squared/config.toml` (walks up directories)
3. User-level: `~/.config/mcp-squared/config.toml` (Linux/macOS) or `%APPDATA%/mcp-squared/config.toml` (Windows)

Schema is validated with Zod (`src/config/schema.ts`). Key sections:
- `upstreams` - Map of named upstream servers (stdio or SSE transport)
- `security.tools` - Allow/block/confirm lists for tool access
- `operations` - Runtime settings (find_tools limits, index refresh, logging)

### Upstream Configuration

Two transport types supported in schema:
- **stdio**: Launches subprocess with command/args/env
- **sse**: HTTP SSE connection (not yet implemented for testing)

Environment variables in upstream `env` config can reference process env with `$VAR` syntax.

## Key Conventions

- **Runtime**: Bun (not Node.js)
- **Config format**: TOML with Zod validation (`smol-toml` parser)
- **Linting**: Biome (not ESLint)
- **TypeScript**: Strict mode with `noUncheckedIndexedAccess`
- **Imports**: Use `.js` extension for local imports (ESM)
- **Path alias**: `@/*` maps to `src/*`

## Issue Tracking

This project uses **bd** (beads) for issue tracking. See AGENTS.md for workflow.

## Key Dependencies

- **@modelcontextprotocol/sdk** - Official MCP SDK for server and client
- **@opentui/core** - Terminal UI framework for config interface
- **smol-toml** - TOML parsing
- **zod** - Schema validation
