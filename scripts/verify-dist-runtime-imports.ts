import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

if (!existsSync(distPath)) {
  console.error(
    "dist/index.js is missing. Run `bun run build` before verifying runtime imports.",
  );
  process.exit(1);
}

const distSource = readFileSync(distPath, "utf8");
const unresolvedAliasPattern =
  /(?:from\s+["']@\/[^"']+["']|import\s*\(\s*["']@\/[^"']+["']\s*\))/g;
const matches = Array.from(new Set(distSource.match(unresolvedAliasPattern)));

if (matches.length > 0) {
  console.error(
    "Found unresolved @/ runtime imports in dist/index.js. This publish would break installed CLI execution.",
  );
  for (const match of matches) {
    console.error(`  - ${match}`);
  }
  process.exit(1);
}

console.log(
  "Verified dist/index.js runtime imports (no unresolved @/ aliases).",
);
