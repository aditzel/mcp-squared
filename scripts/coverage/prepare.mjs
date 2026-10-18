import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { transformSync } from "@babel/core";
import transformTypescript from "@babel/plugin-transform-typescript";
import { createInstrumenter } from "istanbul-lib-instrument";

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = join(directory, entry.name);
    assert.ok(
      !entry.isSymbolicLink(),
      `Unexpected source symlink: ${filename}`,
    );
    return entry.isDirectory() ? sourceFiles(filename) : [filename];
  });
}

export function prepareCoverage(root, output) {
  const sourceRoot = realpathSync(resolve(root, "src"));
  mkdirSync(output, { recursive: true });
  const manifest = { root: realpathSync(root), sourceRoot, files: {} };
  const seed = {};
  for (const filename of sourceFiles(sourceRoot).sort()) {
    assert.ok(
      /\.[cm]?[jt]sx?$/.test(filename),
      `Unclassified production source: ${filename}`,
    );
    const source = readFileSync(filename, "utf8");
    assert.ok(
      !/istanbul ignore/.test(source),
      `Coverage exclusion in ${filename}`,
    );
    const transformed = transformSync(source, {
      filename,
      sourceFileName: filename,
      configFile: false,
      babelrc: false,
      sourceMaps: true,
      plugins: [
        [
          transformTypescript,
          { allowDeclareFields: true, onlyRemoveTypeImports: true },
        ],
      ],
    });
    assert.ok(
      transformed?.code && transformed.map,
      `Cannot transpile ${filename}`,
    );
    const instrumenter = createInstrumenter({
      coverageVariable: "__coverage__",
      coverageGlobalScope: "globalThis",
      coverageGlobalScopeFunc: false,
      esModules: true,
      produceSourceMap: true,
      compact: false,
      reportLogic: false,
    });
    const code = instrumenter.instrumentSync(
      transformed.code,
      filename,
      transformed.map,
    );
    const coverage = instrumenter.lastFileCoverage();
    assert.equal(coverage.path, filename);
    const instrumentedPath = join(output, `${sha256(filename)}.js`);
    writeFileSync(instrumentedPath, code);
    seed[filename] = coverage;
    manifest.files[filename] = {
      sourceSha256: sha256(source),
      transpiledSha256: sha256(transformed.code),
      instrumentedSha256: sha256(code),
      instrumentedPath,
    };
  }
  assert.ok(Object.keys(seed).length > 0, "No production source found");
  writeFileSync(join(output, "seed.json"), JSON.stringify(seed));
  writeFileSync(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}
