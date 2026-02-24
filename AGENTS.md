# Agent Instructions

## Team & Ownership (Current)
- Maintainer/Owner: Allan Ditzel (GitHub: `aditzel`, email: `allan@allanditzel.com`)
- Additional maintainers: none. External contributions are reviewed and merged by the maintainer.

This project uses GitHub Issues and pull requests for issue tracking.

## Quick Reference

```bash
gh issue list --limit 20           # Find available work
gh issue view <id>                 # View issue details
gh issue create --title "..."      # Create a follow-up issue
gh pr status                       # Review PR status
```

## Package Manager Policy

- ALWAYS use bun instead of npm or pnpm.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue/PR status** - Close finished work and update linked issues/PRs
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
