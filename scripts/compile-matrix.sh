#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/dist/compile}"
ENTRYPOINT="${ENTRYPOINT:-src/index.ts}"
MAX_SIZE_MB="${MAX_SIZE_MB:-100}"
TARGETS=(
  "bun-darwin-arm64"
  "bun-darwin-x64"
  "bun-linux-x64"
)

mkdir -p "$OUT_DIR"

platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64)
    arch="x64"
    ;;
  aarch64)
    arch="arm64"
    ;;
esac
NATIVE_TARGET="bun-${platform}-${arch}"

failures=0
max_size_bytes=$((MAX_SIZE_MB * 1024 * 1024))

echo "Standalone compile validation"
echo "Workspace: $ROOT_DIR"
echo "Date (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Native target: $NATIVE_TARGET"
echo

for target in "${TARGETS[@]}"; do
  outfile="$OUT_DIR/mcp-squared-${target}"
  logfile="$OUT_DIR/mcp-squared-${target}.log"

  printf "%s\n" "[$target] compiling..."
  if bun build "$ENTRYPOINT" --compile --target="$target" --outfile="$outfile" >"$logfile" 2>&1; then
    size_bytes="$(wc -c < "$outfile" | tr -d '[:space:]')"
    size_mb="$(awk -v b="$size_bytes" 'BEGIN { printf "%.1f", b / 1048576 }')"

    size_status="PASS"
    if [ "$size_bytes" -gt "$max_size_bytes" ]; then
      size_status="FAIL"
      failures=$((failures + 1))
    fi

    smoke_status="N/A"
    if [ "$target" = "$NATIVE_TARGET" ]; then
      tmpdir="$(mktemp -d)"
      cp "$outfile" "$tmpdir/mcp-squared"
      chmod +x "$tmpdir/mcp-squared"

      if (
        cd "$tmpdir" && env -i HOME="$HOME" PATH="/usr/bin:/bin" ./mcp-squared --version >/dev/null 2>&1
      ); then
        smoke_status="PASS"
      else
        smoke_status="FAIL"
        failures=$((failures + 1))
      fi

      rm -rf "$tmpdir"
    fi

    echo "  build: PASS"
    echo "  size: ${size_mb}MB ($size_status)"
    echo "  no-runtime-deps smoke: $smoke_status"
    echo "  output: $outfile"
    echo "  log: $logfile"
  else
    failures=$((failures + 1))
    echo "  build: FAIL"
    echo "  log: $logfile"
    echo "  first error lines:"
    sed -n "1,8p" "$logfile"
  fi
  echo
done

probe_out="$OUT_DIR/embedding-probe"
probe_build_log="$OUT_DIR/embedding-probe.build.log"
probe_run_log="$OUT_DIR/embedding-probe.run.log"

echo "[embedding-probe] compiling..."
if bun build scripts/embedding-probe.ts --compile --target="$NATIVE_TARGET" --outfile="$probe_out" >"$probe_build_log" 2>&1; then
  echo "  build: PASS"
  echo "  running compiled probe..."
  if env -i HOME="$HOME" PATH="/usr/bin:/bin" "$probe_out" >"$probe_run_log" 2>&1; then
    echo "  runtime: PASS"
  else
    failures=$((failures + 1))
    echo "  runtime: FAIL"
    echo "  run log: $probe_run_log"
    sed -n "1,12p" "$probe_run_log"
  fi
else
  failures=$((failures + 1))
  echo "  build: FAIL"
  echo "  build log: $probe_build_log"
  sed -n "1,12p" "$probe_build_log"
fi
echo

if [ "$failures" -gt 0 ]; then
  echo "Validation finished with $failures failure(s)."
  exit 1
fi

echo "Validation finished with no failures."
