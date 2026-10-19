import { test } from "bun:test";
import { runIsolatedSuite } from "./helpers/isolated-suite";

test("real Transformers and Sharp compatibility", () => {
  runIsolatedSuite(
    "./tests/fixtures/transformers-sharp-compatibility.fixture.ts",
  );
}, 35000);
