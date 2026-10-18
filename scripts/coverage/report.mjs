import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCoverageMap } from "istanbul-lib-coverage";
import { createContext } from "istanbul-lib-report";
import { createSourceMapStore } from "istanbul-lib-source-maps";
import reports from "istanbul-reports";
import { sha256 } from "./prepare.mjs";

export async function reportCoverage(directory, output) {
  const read = (name) =>
    JSON.parse(readFileSync(join(directory, name), "utf8"));
  const manifest = read("manifest.json");
  const seed = read("seed.json");
  const expected = Object.keys(seed).sort();
  for (const [filename, file] of Object.entries(manifest.files)) {
    assert.equal(
      sha256(readFileSync(filename)),
      file.sourceSha256,
      `Source changed during coverage: ${filename}`,
    );
  }
  const map = createCoverageMap(seed);
  const processes = readdirSync(directory).filter((name) =>
    /^process-\d+\.json$/.test(name),
  );
  assert.ok(processes.length > 0, "No instrumented processes ran");
  const records = [];
  for (const filename of processes) {
    const record = read(filename);
    records.push(record);
    assert.deepEqual(
      record.failures,
      [],
      `Loader failures in process ${record.pid}`,
    );
    const counters = `counters-${record.pid}.json`;
    if (!existsSync(join(directory, counters))) {
      // A terminated SDK/test fixture can have no production imports or counters.
      assert.equal(
        record.loaded.length,
        0,
        `Missing final counters for production process ${record.pid}`,
      );
      continue;
    }
    assert.ok(
      record.snapshots.includes("exit") ||
        record.snapshots.includes("afterAll"),
      `No final snapshot for process ${record.pid}`,
    );
    const raw = read(counters);
    assert.deepEqual(
      Object.keys(raw).sort(),
      expected,
      "Source inventory changed",
    );
    for (const name of expected) {
      for (const kind of ["branchMap", "statementMap", "fnMap"]) {
        assert.deepEqual(
          raw[name][kind],
          seed[name][kind],
          `Changed ${kind}: ${name}`,
        );
      }
      for (const kind of ["b", "s", "f"]) {
        assert.deepEqual(
          Object.keys(raw[name][kind]),
          Object.keys(seed[name][kind]),
        );
        for (const key in raw[name][kind]) {
          const values =
            kind === "b" ? raw[name][kind][key] : [raw[name][kind][key]];
          if (kind === "b")
            assert.equal(values.length, seed[name].b[key].length);
          assert.ok(
            values.every((value) => Number.isSafeInteger(value) && value >= 0),
            `Invalid counters in ${name}`,
          );
        }
      }
    }
    map.merge(raw);
  }
  const summary = map.getCoverageSummary().toJSON();
  assert.ok(summary.branches.total > 0, "No measured branch denominator");
  const remapped = await createSourceMapStore().transformCoverage(map);
  for (const name of expected) {
    if (remapped.files().includes(name)) continue;
    const file = map.fileCoverageFor(name);
    const totals = file.toSummary();
    for (const kind of ["statements", "functions", "branches"]) {
      assert.equal(
        totals[kind].total,
        0,
        `Source map dropped executable code: ${name}`,
      );
    }
    remapped.addFileCoverage(file);
  }
  assert.deepEqual(
    remapped.files().sort(),
    expected,
    "Source map changed source inventory",
  );
  assert.deepEqual(
    remapped.getCoverageSummary().branches,
    map.getCoverageSummary().branches,
    "Source map changed branch counts",
  );
  const context = createContext({ dir: output, coverageMap: remapped });
  for (const reporter of ["lcovonly", "json-summary", "text-summary"])
    reports.create(reporter).execute(context);
  writeFileSync(
    join(output, "coverage-final.json"),
    JSON.stringify(remapped.toJSON()),
  );
  writeFileSync(
    join(output, "coverage-provenance.json"),
    JSON.stringify(
      {
        manifest,
        processes: records,
        summary: remapped.getCoverageSummary().toJSON(),
      },
      null,
      2,
    ),
  );
  return remapped.getCoverageSummary().toJSON();
}
