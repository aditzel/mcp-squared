import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { plugin } from "bun";

const directory = process.env.MCP_SQUARED_COVERAGE_DIR;
if (!directory) throw new Error("Missing coverage directory");
const manifest = JSON.parse(
  readFileSync(join(directory, "manifest.json"), "utf8"),
);
const seed = JSON.parse(readFileSync(join(directory, "seed.json"), "utf8"));
if (globalThis.__coverage__) throw new Error("Coverage was initialized twice");
globalThis.__coverage__ = seed;
const record = {
  pid: process.pid,
  ppid: process.ppid,
  argv: process.argv,
  loaded: [],
  failures: [],
  snapshots: [],
};
const progressPath = join(directory, `process-${process.pid}.json`);
function progress() {
  writeFileSync(progressPath, JSON.stringify(record));
}
function snapshot(phase) {
  record.snapshots.push(phase);
  writeFileSync(
    join(directory, `counters-${process.pid}.json`),
    JSON.stringify(globalThis.__coverage__),
  );
  progress();
}
globalThis.__mcpCoverageSnapshot = snapshot;
progress();
process.on("beforeExit", () => snapshot("beforeExit"));
process.on("exit", () => snapshot("exit"));

const prefix = `${manifest.sourceRoot}${sep}`;
plugin({
  name: "mcp-squared-test-coverage",
  setup(build) {
    build.onLoad(
      {
        filter: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        namespace: "file",
      },
      (args) => {
        const filename = resolve(args.path);
        const file = manifest.files[filename];
        if (!file || !existsSync(file.instrumentedPath)) {
          record.failures.push(`Uninstrumented source: ${filename}`);
          progress();
          throw new Error(record.failures.at(-1));
        }
        const contents = readFileSync(file.instrumentedPath, "utf8");
        if (
          createHash("sha256").update(contents).digest("hex") !==
          file.instrumentedSha256
        ) {
          record.failures.push(`Changed instrumentation: ${filename}`);
          progress();
          throw new Error(record.failures.at(-1));
        }
        record.loaded.push(filename);
        progress();
        return { contents, loader: "js" };
      },
    );
  },
});
