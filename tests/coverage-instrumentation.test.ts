import { test } from "bun:test";
import { runIsolatedSuite } from "./helpers/isolated-suite";

// Babel and Istanbul caches must not alter the application heap benchmark.
test("coverage instrumentation controls", () => {
  runIsolatedSuite("./tests/fixtures/coverage-controls.fixture.ts");
}, 35000);
