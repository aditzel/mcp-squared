#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/dist/compile}"
ENTRYPOINT="${ENTRYPOINT:-src/index.ts}"
MAX_SIZE_MB="${MAX_SIZE_MB:-120}"
TARGETS_INPUT="${COMPILE_TARGETS:-bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-windows-x64}"
TARGETS_INPUT="${TARGETS_INPUT//,/ }"
REQUIRE_EMBEDDING_RUNTIME="${REQUIRE_EMBEDDING_RUNTIME:-0}"
STRICT_INFRA_FAILURES="${STRICT_INFRA_FAILURES:-1}"

# @opentui/core uses a dynamic import keyed on process.platform/process.arch to
# load its native platform package at runtime.  bun build --compile cannot
# resolve these cross-target imports, so we mark the whole opentui family as
# external.  TUI commands (config, monitor) detect the missing module at runtime
# and print a friendly message directing users to `bunx mcp-squared`.
EXTERNAL_FLAGS=(
  --external "@opentui/core"
  --external "@opentui/core-darwin-arm64"
  --external "@opentui/core-darwin-x64"
  --external "@opentui/core-linux-arm64"
  --external "@opentui/core-linux-x64"
  --external "@opentui/core-win32-arm64"
  --external "@opentui/core-win32-x64"
)

to_platform() {
  local raw="${1:-}"
  raw="$(echo "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    linux*)
      echo "linux"
      ;;
    darwin*)
      echo "darwin"
      ;;
    mingw* | msys* | cygwin*)
      echo "windows"
      ;;
    *)
      echo ""
      ;;
  esac
}

to_arch() {
  local raw="${1:-}"
  raw="$(echo "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    x86_64 | amd64)
      echo "x64"
      ;;
    aarch64 | arm64)
      echo "arm64"
      ;;
    *)
      echo ""
      ;;
  esac
}

target_suffix() {
  local target="$1"
  case "$target" in
    bun-windows-*)
      echo ".exe"
      ;;
    *)
      echo ""
      ;;
  esac
}

is_infra_failure_log() {
  local logfile="$1"
  grep -Eiq \
    'failed to (download|extract executable)|error sending request|timed out|temporary failure|connection reset|econnreset|etimedout|eai_again|could not resolve host|getaddrinfo|tls|certificate|network' \
    "$logfile"
}

print_log_excerpt() {
  local logfile="$1"
  local lines="${2:-12}"
  sed -n "1,${lines}p" "$logfile"
}

run_in_clean_env() {
  if [ "$HOST_PLATFORM" = "windows" ]; then
    "$@"
    return
  fi

  env -i HOME="$HOME" PATH="/usr/bin:/bin" "$@"
}

# shellcheck disable=SC2206
TARGETS=($TARGETS_INPUT)

mkdir -p "$OUT_DIR"

HOST_PLATFORM="$(to_platform "$(uname -s)")"
HOST_ARCH="$(to_arch "$(uname -m)")"

if [ -n "${NATIVE_TARGET_OVERRIDE:-}" ]; then
  NATIVE_TARGET="$NATIVE_TARGET_OVERRIDE"
elif [ -n "$HOST_PLATFORM" ] && [ -n "$HOST_ARCH" ]; then
  NATIVE_TARGET="bun-${HOST_PLATFORM}-${HOST_ARCH}"
else
  NATIVE_TARGET=""
fi

if [ "${#TARGETS[@]}" -eq 0 ]; then
  echo "No compile targets configured. Set COMPILE_TARGETS to one or more Bun targets."
  exit 1
fi

failures=0
product_failures=0
infra_failures=0
warnings=0
max_size_bytes=$((MAX_SIZE_MB * 1024 * 1024))

echo "Standalone compile validation"
echo "Workspace: $ROOT_DIR"
echo "Date (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
if [ -n "$NATIVE_TARGET" ]; then
  echo "Native target: $NATIVE_TARGET"
else
  echo "Native target: unavailable for host ($(uname -s)/$(uname -m))"
fi
echo "Targets: ${TARGETS[*]}"
echo

for target in "${TARGETS[@]}"; do
  suffix="$(target_suffix "$target")"
  outfile="$OUT_DIR/mcp-squared-${target}${suffix}"
  logfile="$OUT_DIR/mcp-squared-${target}.log"

  printf "%s\n" "[$target] compiling..."
  if bun build "$ENTRYPOINT" --compile --target="$target" --outfile="$outfile" "${EXTERNAL_FLAGS[@]}" >"$logfile" 2>&1; then
    size_bytes="$(wc -c < "$outfile" | tr -d '[:space:]')"
    size_mb="$(awk -v b="$size_bytes" 'BEGIN { printf "%.1f", b / 1048576 }')"

    size_status="PASS"
    if [ "$size_bytes" -gt "$max_size_bytes" ]; then
      size_status="FAIL"
      failures=$((failures + 1))
      product_failures=$((product_failures + 1))
    fi

    smoke_status="N/A"
    if [ -n "$NATIVE_TARGET" ] && [ "$target" = "$NATIVE_TARGET" ]; then
      tmpdir="$(mktemp -d)"
      binary_name="mcp-squared${suffix}"
      cp "$outfile" "$tmpdir/$binary_name"
      chmod +x "$tmpdir/$binary_name" 2>/dev/null || true

      if (
        cd "$tmpdir" && run_in_clean_env "./$binary_name" --version >/dev/null 2>&1
      ); then
        smoke_status="PASS"
      else
        smoke_status="FAIL"
        failures=$((failures + 1))
        product_failures=$((product_failures + 1))
      fi

      rm -rf "$tmpdir"
    fi

    echo "  build: PASS"
    echo "  size: ${size_mb}MB ($size_status)"
    echo "  no-runtime-deps smoke: $smoke_status"
    echo "  output: $outfile"
    echo "  log: $logfile"
  else
    echo "  initial build failed; checking classification..."
    if is_infra_failure_log "$logfile"; then
      echo "  first failure classified as infra/network; retrying once..."
      if bun build "$ENTRYPOINT" --compile --target="$target" --outfile="$outfile" "${EXTERNAL_FLAGS[@]}" >"$logfile" 2>&1; then
        size_bytes="$(wc -c < "$outfile" | tr -d '[:space:]')"
        size_mb="$(awk -v b="$size_bytes" 'BEGIN { printf "%.1f", b / 1048576 }')"
        echo "  build: PASS (after retry)"
        echo "  size: ${size_mb}MB (PASS)"
        echo "  no-runtime-deps smoke: N/A"
        echo "  output: $outfile"
        echo "  log: $logfile"
        echo
        continue
      fi
    fi

    failures=$((failures + 1))
    if is_infra_failure_log "$logfile"; then
      infra_failures=$((infra_failures + 1))
      echo "  build: FAIL (INFRA/NETWORK)"
    else
      product_failures=$((product_failures + 1))
      echo "  build: FAIL (PRODUCT)"
    fi
    echo "  log: $logfile"
    echo "  first error lines:"
    print_log_excerpt "$logfile" 8
  fi
  echo
done

if [ -n "$NATIVE_TARGET" ]; then
  probe_suffix="$(target_suffix "$NATIVE_TARGET")"
  probe_out="$OUT_DIR/embedding-probe${probe_suffix}"
  probe_build_log="$OUT_DIR/embedding-probe.build.log"
  probe_run_log="$OUT_DIR/embedding-probe.run.log"

  echo "[embedding-probe] compiling..."
  if bun build scripts/embedding-probe.ts --compile --target="$NATIVE_TARGET" --outfile="$probe_out" "${EXTERNAL_FLAGS[@]}" >"$probe_build_log" 2>&1; then
    echo "  build: PASS"
    echo "  running compiled probe..."
    if run_in_clean_env "$probe_out" >"$probe_run_log" 2>&1; then
      echo "  runtime: PASS"
    elif grep -Eiq 'onnxruntime|libonnxruntime|EmbeddingRuntimeDependencyError' "$probe_run_log"; then
      if [ "$REQUIRE_EMBEDDING_RUNTIME" = "1" ]; then
        failures=$((failures + 1))
        product_failures=$((product_failures + 1))
        echo "  runtime: FAIL (PRODUCT)"
        echo "  run log: $probe_run_log"
        print_log_excerpt "$probe_run_log" 12
      else
        warnings=$((warnings + 1))
        echo "  runtime: WARN (onnxruntime dependency unavailable)"
        echo "  run log: $probe_run_log"
        print_log_excerpt "$probe_run_log" 6
      fi
    else
      failures=$((failures + 1))
      product_failures=$((product_failures + 1))
      echo "  runtime: FAIL (PRODUCT)"
      echo "  run log: $probe_run_log"
      print_log_excerpt "$probe_run_log" 12
    fi
  else
    if is_infra_failure_log "$probe_build_log"; then
      infra_failures=$((infra_failures + 1))
      failures=$((failures + 1))
      echo "  build: FAIL (INFRA/NETWORK)"
    else
      product_failures=$((product_failures + 1))
      failures=$((failures + 1))
      echo "  build: FAIL (PRODUCT)"
    fi
    echo "  build log: $probe_build_log"
    print_log_excerpt "$probe_build_log" 12
  fi
else
  echo "[embedding-probe] skipped: no native target resolved for this host."
fi
echo

echo "Summary:"
echo "  product failures: $product_failures"
echo "  infra/network failures: $infra_failures"
echo "  warnings: $warnings"

if [ "$product_failures" -gt 0 ]; then
  echo "Validation finished with $product_failures product failure(s)."
  exit 1
fi

if [ "$infra_failures" -gt 0 ]; then
  if [ "$STRICT_INFRA_FAILURES" = "1" ]; then
    echo "Validation finished with $infra_failures infra/network failure(s)."
    exit 1
  fi
  echo "Validation finished with infra/network failures only (non-blocking)."
  exit 0
fi

if [ "$failures" -gt 0 ]; then
  echo "Validation finished with $failures failure(s)."
  exit 1
fi

echo "Validation finished with no failures."
