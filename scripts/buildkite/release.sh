#!/usr/bin/env bash
set -euo pipefail

case "${1-}" in
  check) [[ $# -eq 1 ]] || exit 2 ;;
  pack) [[ $# -eq 2 ]] || exit 2 ;;
  *) printf 'Usage: bash scripts/buildkite/release.sh check | pack VERSION_TAG\n' >&2; exit 2 ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
if [[ "$(node --version)" != v24.* || "$(bun --version)" != 1.3.5 ]]; then
  printf 'Expected Node 24 and Bun 1.3.5 for release preparation\n' >&2
  exit 1
fi
export CI=true
if [[ "$1" == check ]]; then
  # Reuse the repaired measured-coverage gate, including its pending Codecov notice.
  exec bash scripts/buildkite/check.sh shadow-test-and-coverage
fi
exec bun run scripts/buildkite/package-release.ts "$2"
