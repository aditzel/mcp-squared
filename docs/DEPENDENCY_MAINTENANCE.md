# Dependency Maintenance

This document defines how maintainers keep dependencies current and handle unavoidable advisory risk.

## Cadence

- Weekly: run `bun outdated` and `bun run audit` on `main`.
- Before every release: run `bun run release:check` (includes `bun run audit`).
- After major upstream SDK bumps: rerun full gates and targeted integration checks.

## Required checks

```bash
bun run audit
bun outdated
```

- `bun run audit` is a hard gate in CI and release validation.
- `bun outdated` is informational and used to schedule dependency refreshes.

## Risk acceptance process

If `bun run audit` reports an advisory that cannot be remediated immediately:

1. Open or link a Linear issue for the exception and remediation follow-up.
2. Add or update an entry in `docs/DEPENDENCY_EXCEPTIONS.md` with:
   - advisory ID/link
   - affected package(s)
   - severity
   - rationale for temporary acceptance
   - compensating controls
   - owner
   - expiry/review date
3. Keep the issue open until remediation lands or the exception is renewed with updated rationale.

Exceptions are temporary and must have an explicit review date.
