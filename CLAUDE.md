# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP² (Mercury Control Plane) is a local-first meta-server and proxy for the Model Context Protocol (MCP). It reduces tool context bloat by providing progressive disclosure of tools to LLMs instead of flooding them with every schema upfront.

**Status**: Pre-alpha / Inception phase

## Development Commands

```bash
# Install dependencies
bun install

# Run the server (stdio mode)
bun run start

# Run with hot-reload
bun run dev

# Launch configuration TUI
bun run start config

# Test upstream connections
bun run start test [upstream-name]

# Run tests
bun test
bun test --watch
bun test tests/config.test.ts  # Single test file

# Type checking and linting
bun run typecheck
bun run lint
bun run lint:fix

# Build
bun run build
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

### Core Components (Planned)

| Component | Purpose |
|-----------|---------|
| **Cataloger** | Manages connections to upstream MCP servers |
| **Index** | Local SQLite + FTS + embeddings for tool search |
| **Retriever** | Hybrid search (lexical + semantic) for `find_tools` |
| **Composer** | Builds responses at different detail levels (L0-L2) |
| **Executor** | Routes `execute` calls to correct upstream |

### Public API (3 meta-tools)

- `find_tools(query, limit)` - Semantic search for tools
- `describe_tools(tool_names)` - Get full schemas on demand
- `execute(tool_name, arguments)` - Proxy execution to upstream

### Source Structure

```
src/
├── index.ts           # Entry point, CLI dispatch
├── cli/               # Argument parsing, help text
├── config/            # TOML config loading/saving, schema, migrations
├── server/            # MCP server implementation (meta-tools)
├── tui/               # Interactive configuration interface (@opentui/core)
└── upstream/          # MCP client for connecting to upstream servers
```

### Configuration

Config file: `~/.config/mcp-squared/config.toml` (or `$XDG_CONFIG_HOME`)

Upstream servers support:
- `stdio` transport (command + args)
- `sse` transport (URL-based)
- Environment variable injection with `$VAR_NAME` syntax

## Key Conventions

- **Runtime**: Bun (not Node.js)
- **Config format**: TOML with Zod validation (`smol-toml` parser)
- **Linting**: Biome (not ESLint)
- **TypeScript**: Strict mode with `noUncheckedIndexedAccess`
- **Imports**: Use `.js` extension for local imports (ESM)
- **Path alias**: `@/*` maps to `src/*`

## Issue Tracking

This project uses `bd` (beads) for issue tracking. See AGENTS.md for workflow commands.
