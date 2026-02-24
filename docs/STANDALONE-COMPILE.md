# Standalone Compile Validation (`bun build --compile`)

This document tracks current standalone binary viability for `mcp-squared`.

## How to Run

```bash
bun run build:compile:matrix
```

This runs `scripts/compile-matrix.sh`, which validates:

1. Compile success for target matrix (`bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`)
2. Binary size threshold (`<120MB`)
3. Standalone runtime smoke test (`--version` with minimal environment)
4. Embeddings probe (`scripts/embedding-probe.ts`) compiled and executed as binary

## Latest Results

Validated on **2026-02-20T20:34:23Z** (native target: `bun-linux-x64`):

- `bun-darwin-arm64`: PASS
  - Size: `61MB` (under `120MB` target)
- `bun-darwin-x64`: PASS
  - Size: `66MB` (under `120MB` target)
- `bun-linux-x64`: PASS
  - Size: `102MB` (under `120MB` target)
  - Standalone smoke (`--version` in clean env): PASS
- Embeddings probe (compiled): PARTIAL
  - Build: PASS
  - Runtime: FAIL (`libonnxruntime.so.1` missing at runtime in compiled mode)

## Criteria Status

- Runtime bundled for all targets: PASS (`bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`)
- Binary size target `<120MB`: PASS on all targets
- No runtime dependencies for core CLI: PASS
- TUI commands (`config`, `monitor`) in standalone binary: PASS when `@opentui/core` is available at runtime; graceful error message when not
- Embeddings runtime in compiled binaries: PARTIAL — depends on external `libonnxruntime` shared lib; degrades gracefully to fast (FTS) search when absent

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
