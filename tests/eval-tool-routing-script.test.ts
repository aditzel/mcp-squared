import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const evalRoutingScriptPath = fileURLToPath(
  new URL("../scripts/eval-tool-routing.ts", import.meta.url),
);

describe("eval-tool-routing strict failure behavior", () => {
  test("uses process.exitCode instead of process.exit for strict failures", () => {
    const source = readFileSync(evalRoutingScriptPath, "utf-8");

    expect(source).toContain("process.exitCode = 1");
    expect(source).not.toContain("process.exit(1)");
  });
});
