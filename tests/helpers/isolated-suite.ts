import { expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export function runIsolatedSuite(file: string): void {
  const args = ["test"];
  if (process.env["MCP_SQUARED_COVERAGE_DIR"]) {
    args.push("--preload", resolve("scripts/coverage/test-hook.mjs"));
  }
  args.push(file);
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: 30000,
  });
  if (result.status !== 0)
    throw new Error(`${result.stdout}\n${result.stderr}`);
  expect(result.status).toBe(0);
  const summary = result.stderr.match(/\d+ pass\n[\s\S]*?Ran [^\n]+/);
  expect(summary).not.toBeNull();
  console.log(`[isolated suite ${file}]\n${summary?.[0]}`);
}
