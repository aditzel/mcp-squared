# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview
MCP² (Mercury Control Plane) is a local-first meta-server and proxy for the Model Context Protocol (MCP). It acts as middleware to manage tool context bloat by progressively disclosing tools to LLMs via a stable interface (`find_tools`, `describe_tools`, `execute`).

**Key Technologies:**
- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **Linting/Formatting**: [Biome](https://biomejs.dev)
- **MCP SDK**: `@modelcontextprotocol/sdk`

## Development Workflow

### Prerequisites
- Ensure `bun` is installed and available in the path.

### Common Commands
- **Start Development**: `bun run dev` (Runs `src/index.ts` in watch mode)
- **Build**: `bun run build` (Outputs to `dist/`, targets bun)
- **Test**: `bun test`
  - Watch mode: `bun test --watch`
- **Lint**: `bun run lint` (Uses Biome)
  - Fix issues: `bun run lint:fix`
- **Format**: `bun run format` (Uses Biome)
- **Typecheck**: `bun run typecheck` (tsc --noEmit)
- **Clean**: `bun run clean`

## Architecture

The codebase is organized to separate the CLI, server logic, and TUI components.

### Directory Structure
- **`src/index.ts`**: Main entry point.
- **`src/server/`**: Core MCP server implementation. This is where the "meta-server" logic resides, handling:
  - Discovery of upstream tools.
  - Semantic search (`find_tools`).
  - Schema disclosure (`describe_tools`).
  - Request forwarding (`execute`).
- **`src/tui/`**: Terminal User Interface components, built with `@opentui/core`.
- **`src/cli/`**: Command-line interface parsing and setup.
- **`src/lib/`**: Shared utilities and helper functions.

## Task Management & Rules

### Issue Tracking (Beads)
This project uses **bd** (beads) for local issue tracking.
- **Find available work**: `bd ready`
- **View issue details**: `bd show <id>`
- **Claim work**: `bd update <id> --status in_progress`
- **Close work**: `bd close <id>`
- **Sync**: `bd sync`

### "Landing the Plane" (Session Completion)
**CRITICAL**: Before finishing a session, you **MUST** perform the following:

1. **Capture Remaining Work**: File new issues for any incomplete tasks or follow-ups.
2. **Quality Gates**: Ensure code passes all checks:
   ```bash
   bun run lint && bun run typecheck && bun test
   ```
3. **Update Issues**: Close completed tasks in `bd`.
4. **Push to Remote**:
   ```bash
   git pull --rebase
   bd sync
   git push
   ```
   *Verify `git status` is clean and up to date.*

### Context Management (mem0)
- **Research**: Before starting, search for project patterns: `search_coding_preferences <topic>`.
- **Documentation**: After completion, store implementation details: `add_coding_preference`.
