# Releasing to npm

This checklist is for maintainers publishing `mcp-squared` to npm.

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
3. Bump package version:
   ```bash
   bun pm version patch
   ```
   Use `minor` or `major` as appropriate.
4. Run release gates:
   ```bash
   bun run release:check
   ```
   This includes `bun run audit` as a hard gate.
   If an advisory is temporarily accepted, record it in `docs/DEPENDENCY_EXCEPTIONS.md` and link the tracking issue before proceeding.
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
7. Push commit and tag:
   ```bash
   git push
   git push --tags
   ```
8. Verify on registry:
   ```bash
   npm view mcp-squared version
   ```

## Packaging policy

The npm package intentionally ships only runtime files:

- `bin/mcp-squared`
- `dist/index.js`
- `dist/*.scm`
- `dist/*.wasm`

Compiled standalone binaries and compile logs in `dist/compile/` are excluded from npm publishes.

## Dependency hygiene

- Follow `docs/DEPENDENCY_MAINTENANCE.md` for weekly cadence and risk handling.
- Keep `docs/DEPENDENCY_EXCEPTIONS.md` current (or explicitly empty).
