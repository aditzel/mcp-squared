import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const packageBytes = readFileSync("package.json");
const lockBytes = readFileSync("bun.lock");
const pkg = JSON.parse(packageBytes.toString());
const tag = process.argv[2];
if (
  process.argv.length !== 3 ||
  pkg.name !== "mcp-squared" ||
  typeof pkg.version !== "string" ||
  // Require the complete package version to match the SemVer grammar.
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
    pkg.version,
  )?.[0] !== pkg.version ||
  tag !== `v${pkg.version}`
) {
  throw new Error("Release tag must match the mcp-squared package version");
}
// Packing cannot preserve hooks whose meaning depends on a completed publication.
if (pkg.scripts?.publish || pkg.scripts?.postpublish) {
  throw new Error(
    "Publication hooks need a reviewed hosted publisher contract",
  );
}

const parent = resolve("build");
if (existsSync(parent)) {
  const info = lstatSync(parent);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Release output parent must be a real directory");
  }
} else {
  mkdirSync(parent);
}
const output = join(parent, "npm-release");
if (existsSync(output)) {
  throw new Error("Refusing to overwrite an existing release result");
}
const temporary = mkdtempSync(join(parent, ".npm-release-"));
try {
  execFileSync("bun", ["install", "--frozen-lockfile"], { stdio: "inherit" });
  if (pkg.scripts?.prepublishOnly) {
    execFileSync("bun", ["run", "prepublishOnly"], { stdio: "inherit" });
  }
  const tarball = join(temporary, "package.tgz");
  // Bun pack runs prepack (build + build:verify), prepare, and postpack.
  // The existing package whitelist determines the npm-compatible payload.
  execFileSync("bun", ["pm", "pack", "--filename", tarball], {
    stdio: "inherit",
  });
  const info = lstatSync(tarball);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size <= 0 ||
    info.size > 64 * 1024 * 1024
  ) {
    throw new Error("Package must be one bounded regular tarball");
  }
  const bytes = readFileSync(tarball);
  if (
    !readFileSync("package.json").equals(packageBytes) ||
    !readFileSync("bun.lock").equals(lockBytes)
  ) {
    throw new Error("Package metadata changed during release preparation");
  }
  writeFileSync(
    join(temporary, "package.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: pkg.name,
        version: pkg.version,
        tag,
        tarball: "package.tgz",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  renameSync(temporary, output);
  console.log("Prepared build/npm-release/package.tgz; nothing was published");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
