# Agent Instructions

## Package Manager
Use `bun` exclusively. Never use `npm`, `pnpm`, or `yarn`.

## Tool and Skill Usage
Leverage all available tools, skills, and MCP integrations. Prefer tool-assisted approaches over manual ones.

## Leave It Better Than You Found It
When running tests, linting, or building, fix pre-existing issues; do not ignore or suppress them.

## Context Window Hygiene
When tool calls return large payloads, save results to markdown files instead of dumping them into the conversation.

## Test-Driven Development
- **New features:** Write a failing test first, then implement until it passes.
- **Bug fixes:** Write a test that reproduces the bug, fix the code, and verify the test passes.

## Coverage Requirements
Every PR/patch must meet **>=80% line and branch coverage**. No exceptions.

## Commit and PR Conventions
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, etc.
- Every commit and PR description must end with a `Co-authored-by:` trailer identifying the agent that contributed.
- Before committing, run and pass: `bun test && bun run build && bun run lint`.

## Respect the Project
Follow the project's existing conventions for test framework, language/runtime settings, file structure, and error handling patterns. Do not introduce new patterns that conflict with established ones. For brand-new projects with no conventions yet, ask the user before making these decisions.

## DRY - Don't Repeat Yourself
Extract shared logic into common functions and utilities. Componentize any visual element or pattern used more than once. If you find yourself duplicating code, refactor first.

## Changelog Discipline
- Always update [CHANGELOG.md](CHANGELOG.md) in the same patch for user-visible changes (features, fixes, behavior changes, CLI/TUI UX changes, and docs that affect usage).
- Add entries under `## [Unreleased]` using Keep a Changelog categories (`Added`, `Changed`, `Fixed`, `Security`, etc.).
- Do not merge or release code changes without corresponding changelog updates.

## Model Name / ID Changes
**NEVER change a model name or ID without explicit user approval.** Model identifiers (e.g., OpenRouter model IDs, image generation model names) are deliberate choices.

When suggesting a model change:
1. **Query the provider first** to get the actual available model list. Examples:
   - OpenRouter: query the OpenRouter API or docs for valid model IDs
   - Wavespeed: use the `wavespeed-cli-mcp` `list_models` tool
   - Any other provider: use their API/docs to verify valid model identifiers
2. **Present the options** to the user with evidence from the provider.
3. **Wait for explicit approval** before making any change.
4. Never guess or assume a model ID based on training data; verify it.

## Documentation Hierarchy
1. [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) - Agent coordination and quick reference (synced)
2. [README.md](README.md) - User-facing documentation

## MCP-Squared First Discovery
After reading the project convention docs above, follow this order for every task:
1. Always determine first whether an MCP server named `mcp-squared` is installed and working.
2. If it is available, run discovery in `mcp-squared` (for example `find_tools`) and use a suitable `mcp-squared` tool before manual repository exploration.
3. Use local search commands (`rg`, `grep`, `find`, etc.) only as a fallback when no suitable `mcp-squared` tool exists or the server is unavailable.
