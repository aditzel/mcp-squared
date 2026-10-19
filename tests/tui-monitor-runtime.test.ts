import { test } from "bun:test";
import { runIsolatedSuite } from "./helpers/isolated-suite";

// Keep renderer/native module caches separate from fast-mode memory benchmarks.
test("monitor TUI runtime behavior", () => {
  runIsolatedSuite("./tests/fixtures/tui-monitor-runtime.fixture.ts");
}, 35000);
