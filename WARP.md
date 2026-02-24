# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview
MCP² (Mercury Control Plane) is a local-first meta-server and proxy for the Model Context Protocol (MCP). It acts as middleware to manage tool context bloat by progressively disclosing tools to LLMs via a stable interface (`find_tools`, `describe_tools`, `execute`, plus supporting meta-tools).

**Status**: Alpha (v0.1.x)

## Package Manager Policy

- ALWAYS use bun instead of npm or pnpm.

**Key Technologies:**
- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **Linting/Formatting**: [Biome](https://biomejs.dev)
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Embeddings**: `@huggingface/transformers` (Transformers.js)

## Development Workflow

### Prerequisites
- Ensure `bun` is installed and available in the path.

### Common Commands
- **Start Development**: `bun run dev` (Runs `src/index.ts` in watch mode)
- **Build**: `bun run build` (Outputs to `dist/`, targets bun)
- **Test**: `bun test`
- **Lint**: `bun run lint` (Uses Biome)
- **Format**: `bun run format` (Uses Biome)
- **Typecheck**: `bun run typecheck` (tsc --noEmit)
- **Clean**: `bun run clean`

### CLI Commands
- **Start server**: `mcp-squared`
- **Config TUI**: `mcp-squared config`
- **Test upstreams**: `mcp-squared test [name]`
- **OAuth auth**: `mcp-squared auth <name>`
- **Import configs**: `mcp-squared import`
- **Install MCP²**: `mcp-squared install`
- **Monitor TUI**: `mcp-squared monitor`

## Architecture

The codebase is organized to separate the CLI, server logic, indexing, and tooling.

### Directory Structure
- **`src/index.ts`**: Main entry point.
- **`src/server/`**: MCP meta-server and monitor server.
- **`src/retriever/`**: Search logic (FTS5, semantic, hybrid).
- **`src/index/`**: SQLite index store (FTS5 + embeddings + co-occurrence).
- **`src/embeddings/`**: Transformers.js embedding generator.
- **`src/upstream/`**: Upstream connectivity (stdio + SSE/HTTP).
- **`src/oauth/`**: OAuth dynamic client registration and token storage.
- **`src/security/`**: Allow/block/confirm policy enforcement and sanitization.
- **`src/background/`**: Background index refresh and change detection.
- **`src/caching/`**: Selection cache tracking for co-occurrence suggestions.
- **`src/tui/`**: Configuration and monitor TUIs.
- **`src/import/`**: Import MCP configs from other tools.
- **`src/install/`**: Install MCP² into other MCP clients.
- **`src/cli/`**: CLI argument parsing.
- **`src/utils/`**: Shared utilities.

## Task Management & Rules

### Issue Tracking
This project uses GitHub Issues and pull requests for work tracking.
- **Find available work**: `gh issue list --limit 20`
- **View issue details**: `gh issue view <id>`
- **Create follow-up issue**: `gh issue create --title "..." --body "..."`
- **Review PR status**: `gh pr status`

### "Landing the Plane" (Session Completion)
**CRITICAL**: Before finishing a session, you **MUST** perform the following:

1. **Capture Remaining Work**: File new issues for any incomplete tasks or follow-ups.
2. **Quality Gates**: Ensure code passes all checks:
   ```bash
   bun test && bun run build && bun run lint
  ```
   - Do not commit unless the above gates are clean, even if failing checks already exist elsewhere.
3. **Update Issues/PRs**: Close completed tasks and update linked issues/PRs.
4. **Push to Remote**:
   ```bash
   git pull --rebase
   git push
   ```
   *Verify `git status` is clean and up to date.*

### Context Management (mem0)
- **Research**: Before starting, search for project patterns: `search_coding_preferences <topic>`.
- **Documentation**: After completion, store implementation details: `add_coding_preference`.
