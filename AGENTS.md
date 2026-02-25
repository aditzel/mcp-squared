# Agent Instructions

## Team & Ownership (Current)
- Maintainer/Owner: Allan Ditzel (GitHub: `aditzel`, email: `allan@allanditzel.com`)
- Additional maintainers: none. External contributions are reviewed and merged by the maintainer.

This project uses Linear for issue tracking and execution lifecycle management. GitHub pull requests are used for code review and merge.

## Quick Reference

```bash
# Linear (preferred via MCP tools):
# - mcp__linear__list_issues
# - mcp__linear__get_issue
# - mcp__linear__create_issue
# - mcp__linear__update_issue
gh pr status                       # Review PR status
```

## Package Manager Policy

- ALWAYS use bun instead of npm or pnpm.

## Linear Planning & Execution Discipline (MANDATORY)

- If you create a plan, **every step in the plan MUST have a corresponding Linear issue** in the `MCP Squared` project.
- Do not start implementation for a step until its Linear issue exists (create missing issues immediately).
- Maintain a clear 1:1 mapping between plan steps and Linear issues whenever possible; if one issue covers multiple sub-steps, split it before execution.
- When execution of an issue begins, move it to an active state (for example, `In Progress`).
- During execution, continuously add detailed progress notes to the issue:
  - discoveries, debugging findings, design decisions, scope changes, and concrete code/config changes
  - references to related PRs/commits/files as applicable
- Before closing an issue, record gating results directly in the issue, including commands run and outcomes.
- Required default gates for code changes: `bun test && bun run build && bun run lint`.
- An issue may be moved to a closed/done state **only** when:
  - acceptance criteria are satisfied
  - all required gates pass cleanly
  - the issue contains sufficient implementation and verification notes for handoff/audit
- If gates fail or work is partial, keep the issue open, document exact failures/blockers, and create follow-up issues as needed.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create Linear issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update Linear issue + PR status** - Ensure active issues are in the correct state, add implementation/gate notes, and close only after all criteria pass
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
- **NEVER commit if test, build, and lint are not cleanly passing first**, even if issues pre-exist in the repository.
  - Use this gate before commit: `bun test && bun run build && bun run lint`
