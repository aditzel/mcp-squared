# Releasing to npm

This checklist is for maintainers publishing `mcp-squared` to npm.

## Current release target

- Version: `0.7.0`
- Git tag: `v0.7.0`

## One-time local setup

1. Fix npm cache permissions if needed:
   ```bash
   sudo chown -R "$(id -u):$(id -g)" ~/.npm
   ```
2. Authenticate:
   ```bash
   npm login --registry=https://registry.npmjs.org
   npm whoami
   bun pm whoami
   ```

## Per-release checklist

1. Ensure clean branch and latest remote:
   ```bash
   git status
   git pull --rebase
   ```
2. Update changelog under a new version heading in `CHANGELOG.md`.
3. Set package version for this release:
   ```bash
   bun pm version 0.7.0
   ```
   This creates the release tag `v0.7.0`.
4. Run release gates:
   ```bash
   bun run release:check
   ```
   This includes `bun run audit` as a hard gate and verifies `dist/index.js` has no unresolved `@/...` runtime imports.
   If an advisory is temporarily accepted, record it in `docs/DEPENDENCY_EXCEPTIONS.md`, verify the reviewed reachability is still low for the current release, and link the tracking issue before proceeding.
5. Confirm npm will accept the version:
   ```bash
   npm view mcp-squared version
   ```
   The published version must be lower than your local `package.json` version.
6. Publish:
   ```bash
   npm publish --access public
   ```
   If your npm account enforces publish 2FA, enter the OTP when prompted.
7. Push commit and the explicit release tag:
   ```bash
   git push
   git push origin v0.7.0
   ```
   Verify the tag on the release commit:
   ```bash
   git tag --points-at HEAD | rg '^v0\\.7\\.0$'
   ```
8. Verify on registry:
   ```bash
   npm view mcp-squared version
   ```

## Packaging policy

The npm package intentionally ships only runtime files:

- `bin/mcp-squared`
- `dist/index.js`
- `dist/tui/*.js`
- `dist/*.scm`
- `dist/*.wasm`

Compiled standalone binaries and compile logs in `dist/compile/` are excluded from npm publishes.

## Dependency hygiene

- Follow `docs/DEPENDENCY_MAINTENANCE.md` for weekly cadence and risk handling.
- Keep `docs/DEPENDENCY_EXCEPTIONS.md` current (or explicitly empty).
