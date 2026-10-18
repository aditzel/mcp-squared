import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareCoverage } from "../../scripts/coverage/prepare.mjs";
import { reportCoverage } from "../../scripts/coverage/report.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(calls: string) {
  const root = mkdtempSync(join(tmpdir(), "mcp-coverage-"));
  directories.push(root);
  const raw = join(root, "raw");
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "src/branch.ts"),
    "export const choose = (flag: boolean) => flag ? 'yes' : 'no';\n",
  );
  writeFileSync(
    join(root, "src/unvisited.ts"),
    "export const never = (flag: boolean) => flag ? 1 : 2;\n",
  );
  writeFileSync(
    join(root, "src/barrel.ts"),
    "export { choose } from './branch';\n",
  );
  writeFileSync(
    join(root, "run.ts"),
    `import {choose} from './src/branch'; ${calls}\n`,
  );
  prepareCoverage(root, raw);
  const env = {
    ...process.env,
    MCP_SQUARED_COVERAGE_DIR: raw,
    BUN_INSPECT_PRELOAD: resolve("scripts/coverage/preload.mjs"),
  };
  return { root, raw, env };
}

describe("source and child coverage integrity", () => {
  test("counts both arms without treating an unvisited module or empty barrel as covered", async () => {
    const { root, raw, env } = fixture(
      "console.log(choose(true), choose(false));",
    );
    const result = spawnSync(process.execPath, ["run", join(root, "run.ts")], {
      env,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("yes no");
    const summary = await reportCoverage(raw, root);
    expect(summary.branches).toMatchObject({ covered: 2, total: 4, pct: 50 });
    const lcov = readFileSync(join(root, "lcov.info"), "utf8");
    expect(lcov.match(/^SF:/gm)).toHaveLength(3);
    expect(lcov).toContain("BRF:2");
  });

  test("inherits the preload into a child and collects explicit exit counters", async () => {
    const { root, raw, env } = fixture(
      "console.log(choose(false)); process.exit(0);",
    );
    writeFileSync(
      join(root, "parent.ts"),
      `const p=Bun.spawn([process.execPath,'run',${JSON.stringify(join(root, "run.ts"))}],{stdout:'inherit'}); process.exit(await p.exited);`,
    );
    const result = spawnSync(
      process.execPath,
      ["run", join(root, "parent.ts")],
      { env, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("no");
    expect(
      readdirSync(raw).filter((name) => name.startsWith("counters-")),
    ).toHaveLength(2);
    expect((await reportCoverage(raw, root)).branches).toMatchObject({
      covered: 1,
      total: 4,
      pct: 25,
    });
  });

  test("retains distinct counters and receipts when a PID is reused", async () => {
    const { root, raw, env } = fixture("choose(true);");
    const preload = join(root, "reused-pid-preload.mjs");
    writeFileSync(
      preload,
      `Object.defineProperty(process, "pid", { value: 424242 }); await import(${JSON.stringify(resolve("scripts/coverage/preload.mjs"))});`,
    );
    for (const flag of [true, false]) {
      writeFileSync(
        join(root, "run.ts"),
        `import {choose} from './src/branch'; choose(${flag});`,
      );
      const child = spawnSync(process.execPath, ["run", join(root, "run.ts")], {
        env: { ...env, BUN_INSPECT_PRELOAD: preload },
        encoding: "utf8",
      });
      expect(child.status).toBe(0);
    }
    const receipts = readdirSync(raw).filter((name) =>
      name.startsWith("process-424242"),
    );
    expect(receipts).toHaveLength(2);
    const records = receipts.map((name) =>
      JSON.parse(readFileSync(join(raw, name), "utf8")),
    );
    expect(records.map((record) => record.pid)).toEqual([424242, 424242]);
    expect(new Set(records.map((record) => record.id)).size).toBe(2);
    expect((await reportCoverage(raw, root)).branches).toMatchObject({
      covered: 2,
      total: 4,
      pct: 50,
    });
    const receipt = receipts[0];
    if (!receipt) throw new Error("Missing process receipt");
    rmSync(join(raw, receipt.replace(/^process-/, "counters-")));
    await expect(reportCoverage(raw, root)).rejects.toThrow(
      "Missing final counters",
    );
  });

  test("rejects lost counters from a process that loaded production source", async () => {
    const { root, raw, env } = fixture("choose(true);");
    expect(
      spawnSync(process.execPath, ["run", join(root, "run.ts")], { env })
        .status,
    ).toBe(0);
    for (const name of readdirSync(raw).filter((name) =>
      name.startsWith("counters-"),
    ))
      rmSync(join(raw, name));
    await expect(reportCoverage(raw, root)).rejects.toThrow(
      "Missing final counters",
    );
  });

  test("rejects counters from changed source", async () => {
    const { root, raw, env } = fixture("choose(true);");
    expect(
      spawnSync(process.execPath, ["run", join(root, "run.ts")], { env })
        .status,
    ).toBe(0);
    writeFileSync(
      join(root, "src/branch.ts"),
      "export const choose = () => 'changed';",
    );
    await expect(reportCoverage(raw, root)).rejects.toThrow(
      "Source changed during coverage",
    );
  });

  test("keeps runtime instrumentation out of built artifacts", () => {
    const { root, raw, env } = fixture("choose(true);");
    const result = spawnSync(
      process.execPath,
      [
        "build",
        join(root, "src/branch.ts"),
        "--target",
        "bun",
        "--outfile",
        join(root, "built.js"),
      ],
      { env },
    );
    expect(result.status).toBe(0);
    expect(
      readdirSync(raw).filter((name) => name.startsWith("process-")),
    ).toHaveLength(0);
    expect(readFileSync(join(root, "built.js"), "utf8")).not.toContain(
      "__coverage__",
    );
  });
  test("collects handled SIGTERM exit counters without changing the process exit contract", async () => {
    const { root, raw, env } = fixture(
      "choose(true); process.on('SIGTERM', () => process.exit(0)); process.kill(process.pid, 'SIGTERM'); await Bun.sleep(100);",
    );
    const result = spawnSync(process.execPath, ["run", join(root, "run.ts")], {
      env,
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect((await reportCoverage(raw, root)).branches).toMatchObject({
      covered: 1,
      total: 4,
      pct: 25,
    });
  });

  test("rejects invalid branch counters and missing source inventory", async () => {
    const { root, raw, env } = fixture("choose(true);");
    expect(
      spawnSync(process.execPath, ["run", join(root, "run.ts")], { env })
        .status,
    ).toBe(0);
    const filename = readdirSync(raw).find((name) =>
      name.startsWith("counters-"),
    );
    if (!filename) throw new Error("Missing test counters");
    const path = join(raw, filename);
    const original = readFileSync(path, "utf8");
    const data = JSON.parse(original);
    const branch = Object.keys(data).find((name) => name.endsWith("branch.ts"));
    if (!branch) throw new Error("Missing branch fixture");
    data[branch].b[0][0] = -1;
    writeFileSync(path, JSON.stringify(data));
    await expect(reportCoverage(raw, root)).rejects.toThrow("Invalid counters");
    delete data[branch];
    writeFileSync(path, JSON.stringify(data));
    await expect(reportCoverage(raw, root)).rejects.toThrow(
      "Source inventory changed",
    );
  });

  test("the ordinary gate fails on absent branches despite a 100 percent legacy text summary", () => {
    const { root, env } = fixture("choose(true);");
    const lcov = join(root, "lcov.info");
    const text = join(root, "summary.txt");
    writeFileSync(lcov, "SF:src/branch.ts\nLF:1\nLH:1\nend_of_record\n");
    writeFileSync(text, "All files | 100.00 | 100.00 |\n");
    const result = spawnSync(
      process.execPath,
      ["run", resolve("scripts/check-line-coverage.ts"), text, lcov, "80"],
      { env, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LCOV contains no measured branches");
  });
  test("rejects modified instrumentation before loading production code", async () => {
    const { root, raw, env } = fixture("choose(true);");
    const manifest = JSON.parse(
      readFileSync(join(raw, "manifest.json"), "utf8"),
    );
    const name = Object.keys(manifest.files).find((name) =>
      name.endsWith("branch.ts"),
    );
    if (!name) throw new Error("Missing instrumentation fixture");
    writeFileSync(
      manifest.files[name].instrumentedPath,
      "export const choose = () => 'tampered';",
    );
    const result = spawnSync(process.execPath, ["run", join(root, "run.ts")], {
      env,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Changed instrumentation");
    await expect(reportCoverage(raw, root)).rejects.toThrow("Loader failures");
  });
});
