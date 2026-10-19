import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const coverageCommand = "run test:coverage";

function runShadow(args: string[], env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "mcp-squared-ci-test-"));
  roots.push(root);
  const scripts = join(root, "scripts", "buildkite");
  const bin = join(root, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  copyFileSync(
    new URL("./check.sh", import.meta.url),
    join(scripts, "check.sh"),
  );
  writeFileSync(
    join(bin, "node"),
    `#!/bin/sh\nprintf "%s\\n" "\${TEST_NODE_VERSION:-v24.22.0}"\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "bun"),
    `#!/bin/sh
if [ "$1" = --version ]; then
  printf '%s\\n' "\${TEST_BUN_VERSION:-1.3.5}"
  exit 0
fi
printf '%s\\n' "$*" >> commands.log
if [ "$*" = 'run test:coverage' ]; then
  printf 'coverage stdout\\n'
  printf 'coverage stderr\\n' >&2
fi
if [ "$*" = 'run build:compile:matrix' ]; then
  printf '%s\\n%s\\n' "$COMPILE_TARGETS" "$STRICT_INFRA_FAILURES" > compile-environment.txt
fi
if [ "$*" = "\${TEST_FAIL_STAGE:-}" ]; then exit 23; fi
`,
    { mode: 0o755 },
  );
  const result = spawnSync("/bin/bash", [join(scripts, "check.sh"), ...args], {
    cwd: root,
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, ...env },
    encoding: "utf8",
    timeout: 10_000,
  });
  return { root, result };
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("protected shadow jobs", () => {
  it("runs every credential-free coverage stage in order and names the pending upload", () => {
    const { root, result } = runShadow(["shadow-test-and-coverage"]);
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, "commands.log"), "utf8")).toBe(
      [
        "install --frozen-lockfile",
        "run audit",
        coverageCommand,
        "run coverage:check",
        "run eval:routing --strict",
        "run lint",
        "run typecheck",
        "",
      ].join("\n"),
    );
    expect(
      readFileSync(join(root, "coverage/coverage-summary.txt"), "utf8"),
    ).toBe("coverage stdout\ncoverage stderr\n");
    expect(result.stdout).toContain("PENDING: Codecov upload");
    expect(result.stdout).toContain("GitHub Actions remains authoritative");
  });

  it.each([
    "install --frozen-lockfile",
    "run audit",
    coverageCommand,
    "run coverage:check",
    "run eval:routing --strict",
    "run lint",
    "run typecheck",
  ])("preserves failure from %s, including the coverage pipe", (stage) => {
    const { root, result } = runShadow(["shadow-test-and-coverage"], {
      TEST_FAIL_STAGE: stage,
    });
    expect(result.status).toBe(23);
    expect(
      readFileSync(join(root, "commands.log"), "utf8")
        .trim()
        .split("\n")
        .at(-1),
    ).toBe(stage);
  });

  it("preserves the four-target matrix and non-blocking infrastructure policy", () => {
    const { root, result } = runShadow(["shadow-standalone-compile"], {
      COMPILE_TARGETS: "incorrect",
      STRICT_INFRA_FAILURES: "1",
    });
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, "commands.log"), "utf8")).toBe(
      "install --frozen-lockfile\nrun build:compile:matrix\n",
    );
    expect(readFileSync(join(root, "compile-environment.txt"), "utf8")).toBe(
      "bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-windows-x64\n0\n",
    );
  });

  it("preserves product compilation failures", () => {
    expect(
      runShadow(["shadow-standalone-compile"], {
        TEST_FAIL_STAGE: "run build:compile:matrix",
      }).result.status,
    ).toBe(23);
  });

  it.each([
    [],
    ["test-and-coverage"],
    ["standalone-compile"],
    ["shadow-test-and-coverage", "extra"],
  ])("requires an explicit single shadow command %j", (...args) => {
    expect(runShadow(args).result.status).toBe(2);
  });

  it.each([
    { TEST_NODE_VERSION: "v22.23.3" },
    { TEST_BUN_VERSION: "1.3.14" },
  ])("rejects the wrong toolchain %j", (env) => {
    expect(runShadow(["shadow-test-and-coverage"], env).result.status).toBe(1);
  });
});
