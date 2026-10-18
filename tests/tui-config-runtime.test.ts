import { test } from "bun:test";
import { runIsolatedSuite } from "./helpers/isolated-suite";

// Keep renderer/native module caches separate from fast-mode memory benchmarks.
test("config TUI runtime behavior", () => {
  runIsolatedSuite("./tests/fixtures/tui-config-runtime.fixture.ts");
}, 35000);
