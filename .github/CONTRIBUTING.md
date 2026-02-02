# Contributing to MCP²

Thank you for your interest in contributing to MCP²! The project is in **alpha (v0.1.x)** with core functionality implemented and active development underway.

## Getting Started

1. Read `README.md` and `docs/ARCHITECTURE.md` for context.
2. Check existing issues labeled `good first issue` or `help wanted`.
3. Fork the repository and create a feature branch.
4. Submit a PR with a clear description and any relevant context or screenshots.

## Development Workflow

```bash
# Install dependencies
bun install

# Run in watch mode
bun run dev

# Run tests
bun test

# Lint + typecheck
bun run lint
bun run typecheck
```

### Running a Single Test

```bash
bun test tests/config.test.ts
bun test -t "test name pattern"
```

## Code Style

- Follow the `.editorconfig` settings.
- Keep code clean, readable, and well-documented.

## Reporting Issues

If you find a bug or have a feature request, please open an issue using the provided templates.
