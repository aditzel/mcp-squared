# Coverage gate

Run `bun run test:coverage`, then `bun run coverage:check`. Both line and branch
coverage must reach 80%. `test:coverage` accepts Bun test file arguments for local
iteration. A targeted run retains every production module in the denominator;
its overall percentage is not a full-suite result.

Bun's native LCOV output in 1.3.5 does not contain branch counters. This development
runner erases TypeScript syntax with Babel (without lowering JavaScript control
flow), instruments every file under `src/` with Istanbul, and uses a Bun runtime
plugin to load the instrumented code at its original path. Tests, dependencies,
and development scripts are outside the production scope. Unvisited modules
remain in the report with zero counters. Source maps restore original TypeScript
locations; empty barrels remain in the source inventory.

The runtime preload is passed to Bun children through `BUN_INSPECT_PRELOAD` and
writes separate process counters on exit. The test runner also snapshots at
`afterAll`, because Bun 1.3.5's test runner does not emit the usual exit event.
A process that loaded production source must supply a final snapshot. A terminated
fixture that loaded no production source contributes no coverage. SIGKILL and
unhandled termination after a production import fail collection rather than
silently dropping that process. No signal handlers are installed by coverage.

The collector verifies source hashes, source inventory, counter shapes and
nonnegative counters before merging, and verifies the branch denominator after
source-map remapping. `coverage/coverage-provenance.json` records source and
instrumentation hashes plus process records. `coverage/raw/` contains the exact
instrumented files and per-process counters. Each invocation starts a new report;
results from different source revisions must never be merged.

Collector self-tests and TUI runtime suites run in separate Bun processes so
compiler and renderer module caches do not affect the application memory
benchmark. The TUI children use the same preload and final snapshot hook; their
production counters are merged into the complete source report.

Instrumentation is loaded only by this test command. The application, build
entrypoints and published files do not import it. Regression controls verify
positive and negative branches, unvisited files, empty barrels, inherited child
execution, natural/explicit/handled-signal exits, lost/invalid counters, changed
source, missing branch data, and build exclusion. The ordinary workflow retains
its separate threshold check and coverage artifact upload.
