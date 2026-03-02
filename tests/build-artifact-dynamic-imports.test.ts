import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RELATIVE_MODULE_ASSIGNMENT_RE =
  /var\s+([A-Za-z_$][\w$]*)\s*=\s*"(\.\/[^"]+\.js)";/g;
const LITERAL_DYNAMIC_IMPORT_RE = /import\(\s*"(\.\/[^"]+\.js)"\s*\)/g;
const IDENT_DYNAMIC_IMPORT_RE = /import\(\s*([A-Za-z_$][\w$]*)\s*\)/g;

function collectRelativeDynamicImports(source: string): string[] {
  const specifierByIdentifier = new Map<string, string>();
  for (const match of source.matchAll(RELATIVE_MODULE_ASSIGNMENT_RE)) {
    const identifier = match[1];
    const specifier = match[2];
    if (identifier && specifier) {
      specifierByIdentifier.set(identifier, specifier);
    }
  }

  const specifiers = new Set<string>();

  for (const match of source.matchAll(LITERAL_DYNAMIC_IMPORT_RE)) {
    const specifier = match[1];
    if (specifier) {
      specifiers.add(specifier);
    }
  }

  for (const match of source.matchAll(IDENT_DYNAMIC_IMPORT_RE)) {
    const identifier = match[1];
    if (!identifier) {
      continue;
    }
    const specifier = specifierByIdentifier.get(identifier);
    if (specifier) {
      specifiers.add(specifier);
    }
  }

  return [...specifiers];
}

describe("build artifact dynamic imports", () => {
  test("dist/index.js does not reference missing local chunks", () => {
    const outdir = mkdtempSync(join(tmpdir(), "mcp-squared-build-"));

    try {
      const buildResult = spawnSync(
        process.execPath,
        [
          "build",
          "src/index.ts",
          "src/tui/config.ts",
          "src/tui/monitor.ts",
          "--outdir",
          outdir,
          "--target",
          "bun",
          "--packages=external",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
        },
      );

      if (buildResult.status !== 0) {
        throw new Error(
          [
            "Failed to build test artifact.",
            buildResult.stdout,
            buildResult.stderr,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      const indexPath = join(outdir, "index.js");
      expect(existsSync(indexPath)).toBe(true);

      const source = readFileSync(indexPath, "utf8");
      const relativeImports = collectRelativeDynamicImports(source);
      const missingSpecifiers = relativeImports.filter(
        (specifier) => !existsSync(join(outdir, specifier)),
      );

      expect(missingSpecifiers).toEqual([]);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
