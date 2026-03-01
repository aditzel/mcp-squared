# Standalone Compile Validation (`bun build --compile`)

This document tracks current standalone binary viability for `mcp-squared`.

## How to Run

```bash
bun run build:compile:matrix
```

This runs `scripts/compile-matrix.sh`, which validates:

1. Compile success for target matrix (`bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-windows-x64`)
2. Binary size threshold (`<120MB`)
3. Native standalone runtime smoke test (`--version` with minimal environment)
4. Embeddings probe (`scripts/embedding-probe.ts`) compiled and executed as binary
5. Failure classification (`PRODUCT` vs `INFRA/NETWORK`) with log excerpts
6. One retry for infra/network-signature compile failures

### Environment Knobs

- `COMPILE_TARGETS`: Space- or comma-delimited list of targets (default: `bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-windows-x64`)
- `NATIVE_TARGET_OVERRIDE`: Override host-derived native target when needed
- `REQUIRE_EMBEDDING_RUNTIME=1`: Treat missing onnxruntime shared library as a hard failure (default: warning only)
- `STRICT_INFRA_FAILURES=0`: Treat infra/network-only failures as non-blocking (default: strict failure)

## CI Strategy

The CI workflow (`.github/workflows/test-and-coverage.yml`) validates compile behavior in two modes:

1. `ubuntu-latest` cross-target compile matrix:
   - `bun-darwin-arm64`
   - `bun-darwin-x64`
   - `bun-linux-x64`
   - `bun-windows-x64`
2. `windows-latest` native compile/smoke path:
   - `bun-windows-x64`

This gives both broad cross-target compile signal and an explicit Windows-native execution check.

## Criteria Status

- Runtime bundled for all four matrix targets: expected via compile matrix checks
- Binary size target `<120MB`: enforced per target
- No runtime dependencies for core CLI: enforced for native smoke target
- Compile failures now include explicit category:
  - `PRODUCT`: likely code/config regression
  - `INFRA/NETWORK`: transient environment/download/extraction issue
- Embeddings runtime in compiled binaries: `WARN` by default when ONNX shared libs are unavailable, `FAIL` only when `REQUIRE_EMBEDDING_RUNTIME=1`

## Code Changes Made for Compile Safety

- `src/tui/monitor-loader.ts` and `src/tui/config-loader.ts` added as lazy loader shims
  - `monitor.ts` / `config.ts` have static top-level `@opentui/core` imports that bun evaluates at binary startup when bundled
  - The shim files wrap the actual module import inside an async function body, deferring evaluation until the TUI command is actually invoked
  - `src/index.ts` imports from the shims rather than the TUI modules directly
- `@opentui/core` and all platform packages marked `--external` in compile builds
  - Prevents cross-compilation failures when building macOS targets on Linux (and vice versa)
  - `@opentui/core` dynamic-imports its native platform package at runtime using `process.platform`/`process.arch`; bun cannot resolve these cross-target at bundle time
  - TUI commands detect and report missing runtime gracefully via `isTuiModuleNotFoundError()`
- `src/embeddings/generator.ts` detects missing ONNX runtime shared libraries and throws a descriptive dependency error
- `src/retriever/retriever.ts` catches embedding runtime dependency failures, logs a clear warning, and falls back to fast search mode instead of crashing
- `scripts/compile-matrix.sh` size threshold: `120MB`
- `scripts/compile-matrix.sh` includes explicit Windows target handling (`.exe` outputs), host-aware native target detection, and categorized failure summaries
