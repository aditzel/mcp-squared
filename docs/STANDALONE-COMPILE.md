# Standalone Compile Validation (`bun build --compile`)

This document tracks current standalone binary viability for `mcp-squared`.

## How to Run

```bash
bun run build:compile:matrix
```

This runs `scripts/compile-matrix.sh`, which validates:

1. Compile success for target matrix (`bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`)
2. Binary size threshold (`<100MB`)
3. Standalone runtime smoke test (`--version` with minimal environment)
4. Embeddings probe (`scripts/embedding-probe.ts`) compiled and executed as binary

## Latest Results

Validated on **2026-02-06T00:08:06Z**:

- `bun-darwin-arm64`: PASS
  - Size: `62.5MB` (under `100MB` target)
  - Standalone smoke (`--version` in clean env): PASS
- `bun-darwin-x64`: FAIL
  - Missing optional runtime package: `@opentui/core-darwin-x64`
- `bun-linux-x64`: FAIL
  - Missing optional runtime package: `@opentui/core-linux-x64`
- Embeddings probe (compiled): FAIL
  - Native `onnxruntime` shared library (`libonnxruntime.1.21.0.dylib`) is not bundled in the executable

## Criteria Status

- Runtime bundled for native target: PASS (`bun-darwin-arm64`)
- Works on macOS x64: BLOCKED (missing `@opentui/core-darwin-x64`)
- Works on Linux x64: BLOCKED (missing `@opentui/core-linux-x64`)
- Binary size target `<100MB`: PASS on native target (`62.5MB`)
- No runtime dependencies for end users: PARTIAL
  - Core CLI startup works standalone on native target
  - Embeddings runtime in compiled binaries currently depends on native ONNX shared libs

## Code Changes Made for Compile Safety

- `src/retriever/retriever.ts` now lazy-loads embeddings module during `initializeEmbeddings()`
  - Prevents eager `onnxruntime` loading during process startup
  - Allows compiled binaries to execute basic CLI commands (`--help`, `--version`) without crashing
