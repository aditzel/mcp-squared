import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { prepareCoverage } from "./prepare.mjs";
import { reportCoverage } from "./report.mjs";

const root = process.cwd();
const output = resolve(root, "coverage");
const raw = join(output, "raw");
assert.ok(
  !process.env.BUN_INSPECT_PRELOAD && !process.env.MCP_SQUARED_COVERAGE_DIR,
  "Do not nest coverage runs or replace an existing runtime preload",
);
rmSync(raw, { recursive: true, force: true });
for (const name of [
  "lcov.info",
  "coverage-final.json",
  "coverage-summary.json",
  "coverage-provenance.json",
]) {
  rmSync(join(output, name), { force: true });
}
mkdirSync(raw, { recursive: true });
prepareCoverage(root, raw);
const result = spawnSync(
  process.execPath,
  [
    "test",
    "--preload",
    join(import.meta.dirname, "test-hook.mjs"),
    ...process.argv.slice(2),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      MCP_SQUARED_COVERAGE_DIR: raw,
      BUN_INSPECT_PRELOAD: join(import.meta.dirname, "preload.mjs"),
    },
  },
);
await reportCoverage(raw, output);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
