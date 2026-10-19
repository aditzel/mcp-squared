#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: bash scripts/buildkite/check.sh shadow-test-and-coverage|shadow-standalone-compile\n' >&2
  exit 2
fi
case "$1" in
  shadow-test-and-coverage|shadow-standalone-compile) ;;
  *) printf 'An explicit shadow command is required\n' >&2; exit 2 ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
if [[ "$(node --version)" != v24.* ]]; then
  printf 'Expected Node 24\n' >&2
  exit 1
fi
if [[ "$(bun --version)" != 1.3.5 ]]; then
  printf 'Expected Bun 1.3.5\n' >&2
  exit 1
fi

export CI=true
printf 'SHADOW ONLY: GitHub Actions remains authoritative, including Codecov and native-platform jobs.\n'
bun install --frozen-lockfile

case "$1" in
  shadow-test-and-coverage)
    bun run audit
    mkdir -p coverage
    bun run test:coverage 2>&1 | tee coverage/coverage-summary.txt
    bun run coverage:check
    bun run eval:routing --strict
    printf 'PENDING: Codecov upload requires a separate authenticated handoff; this shadow job does not satisfy that stage.\n'
    bun run lint
    bun run typecheck
    ;;
  shadow-standalone-compile)
    COMPILE_TARGETS='bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-windows-x64' \
    STRICT_INFRA_FAILURES=0 \
      bun run build:compile:matrix
    ;;
esac
