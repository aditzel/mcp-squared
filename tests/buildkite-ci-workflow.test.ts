import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

type Step = {
  name: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean>;
};
type Job = {
  name?: string;
  if?: string;
  "runs-on": string;
  "timeout-minutes"?: number;
  permissions?: Record<string, string>;
  strategy?: {
    "fail-fast": boolean;
    matrix: { include: string; os?: string[] };
  };
  steps: Step[];
};
const workflow = parse(
  readFileSync(
    resolve(import.meta.dir, "../.github/workflows/test-and-coverage.yml"),
    "utf8",
  ),
);
const jobs = workflow.jobs as Record<string, Job>;
const hosted = jobs["verify-janus-ci"];

/** Evaluate routing with the event fields GitHub supplies for each trigger. */
function evaluate(
  expression: string | undefined,
  mode: string,
  fork = false,
  event = "pull_request",
) {
  return Function(
    "vars",
    "github",
    "fromJSON",
    `return (${expression?.replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`,
  )(
    { JANUS_MCP_CI_MODE: mode },
    {
      repository: "aditzel/mcp-squared",
      event_name: event,
      event:
        event === "pull_request"
          ? {
              pull_request: {
                head: {
                  repo: {
                    full_name: fork
                      ? "someone/mcp-squared"
                      : "aditzel/mcp-squared",
                  },
                },
              },
            }
          : {},
    },
    JSON.parse,
  );
}

test("ordinary triggers and global cancellation remain unchanged", () => {
  expect(workflow.on).toEqual({
    push: { branches: ["main"] },
    pull_request: { branches: ["main"] },
  });
  expect(workflow.concurrency).toEqual({
    group: "test-and-coverage",
    "cancel-in-progress": true,
  });
});

test("hosted default, explicit cutover, and fork fallback are disjoint", () => {
  expect(hosted).toBeDefined();
  for (const mode of ["", "janus", "typo"]) {
    for (const fork of [false, true]) {
      for (const event of ["push", "pull_request"]) {
        const admitted = event === "push" || !fork;
        expect(evaluate(hosted?.if, mode, fork, event)).toBe(
          mode !== "" && admitted,
        );
        expect(evaluate(jobs["test-and-coverage"]?.if, mode, fork, event)).toBe(
          mode !== "janus" || !admitted,
        );
      }
    }
  }
});

test("unknown mode fails explicitly without silently disabling Linux CI", () => {
  const validation = hosted?.steps[0];
  expect(validation?.name).toBe("Validate ordinary CI mode");
  for (const [mode, exitCode] of [
    ["janus", 0],
    ["", 1],
    ["typo", 1],
  ] as const) {
    const result = Bun.spawnSync(
      ["bash", "-e", "-c", validation?.run ?? "exit 99"],
      {
        env: { PATH: "/usr/bin:/bin", CI_MODE: mode },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(exitCode);
  }
});

test("only the Linux compile entry moves; native matrix lanes always remain", () => {
  const compile = jobs["standalone-compile"];
  expect(compile?.strategy?.["fail-fast"]).toBe(false);
  for (const mode of ["", "janus", "typo"]) {
    for (const fork of [false, true]) {
      for (const event of ["push", "pull_request"]) {
        const admitted = event === "push" || !fork;
        const matrix = evaluate(
          compile?.strategy?.matrix.include,
          mode,
          fork,
          event,
        ) as { os: string; label: string; compileTargets: string }[];
        expect(matrix.filter((row) => row.os !== "ubuntu-24.04")).toEqual([
          {
            os: "macos-latest",
            label: "macos-native-smoke",
            compileTargets: "bun-darwin-arm64 bun-darwin-x64",
          },
          {
            os: "windows-latest",
            label: "windows-native-smoke",
            compileTargets: "bun-windows-x64",
          },
        ]);
        expect(matrix.some((row) => row.os === "ubuntu-24.04")).toBe(
          mode !== "janus" || !admitted,
        );
      }
    }
  }
  expect(jobs["cross-platform-smoke"]?.strategy?.matrix.os).toEqual([
    "macos-latest",
    "windows-latest",
  ]);
});

test("coverage retrieval upload and exact acknowledgement precede both-lane verification", () => {
  const steps = hosted?.steps ?? [];
  const coverage = steps.findIndex((step) => step.id === "coverage");
  expect(coverage).toBeGreaterThan(-1);
  expect(steps[coverage]?.name).toBe(
    "Retrieve measured Janus ordinary coverage",
  );
  expect(steps[coverage + 1]?.name).toBe("Upload coverage to Codecov");
  expect(steps[coverage + 2]?.name).toContain(
    "steps.coverage.outputs.acknowledgement",
  );
  expect(steps[coverage + 2]?.if).toBe(
    "steps.coverage.outputs.acknowledgement != ''",
  );
  expect(steps[coverage + 3]?.run).toContain("mcp-ci-workflow.py finish");
  expect(steps[coverage + 3]?.if).toBeUndefined();
  expect(steps.every((step) => !("continue-on-error" in step))).toBe(true);
});

test("Codecov uploads only verified bytes under authenticated head branch and PR", () => {
  const upload = hosted?.steps.find(
    (step) => step.name === "Upload coverage to Codecov",
  );
  expect(upload?.if).toBe("steps.coverage.outputs.measured == 'true'");
  expect(upload?.uses).toMatch(/^codecov\/codecov-action@[a-f0-9]{40}$/);
  expect(upload?.with).toMatchObject({
    token: `\${{ secrets.CODECOV_TOKEN }}`,
    files: ["lcov.info", "coverage-final.json"]
      .map((name) => `\${{ steps.coverage.outputs.reports-directory }}/${name}`)
      .join(","),
    disable_search: true,
    fail_ci_if_error: false,
    plugins: "noop",
    override_commit: `\${{ steps.coverage.outputs.source-sha }}`,
    override_branch: `\${{ steps.coverage.outputs.source-branch }}`,
    override_pr: `\${{ steps.coverage.outputs.pull-request }}`,
  });
});

test("hosted credentials are scoped and repository code is never executed there", () => {
  expect(hosted?.name).toBe("Verify Janus ordinary coverage");
  expect(hosted?.["runs-on"]).toBe("ubuntu-24.04");
  expect(hosted?.["timeout-minutes"]).toBe(360);
  expect(hosted?.permissions).toEqual({ contents: "read", actions: "read" });
  const helpers = hosted?.steps.find((step) => step.id === "helpers");
  expect(helpers?.with?.["repository"]).toBe("MiraiForge/devops");
  expect(helpers?.with?.["ref"]).toMatch(/^[a-f0-9]{40}$/);
  expect(helpers?.with?.["persist-credentials"]).toBe(false);
  const commands = hosted?.steps.map((step) => step.run ?? "").join("\n") ?? "";
  expect(commands).not.toMatch(/bun|npm|pip|scripts\/buildkite\/check/);
  for (const step of hosted?.steps.filter((step) =>
    ["coverage", "finish"].includes(step.id ?? ""),
  ) ?? []) {
    expect(step.env?.["JANUS_MCP_CI_MODE"]).toBe(
      `\${{ vars.JANUS_MCP_CI_MODE }}`,
    );
    expect(step.env?.["JANUS_MCP_CI_POLICY"]).toBe(
      `\${{ vars.JANUS_MCP_CI_POLICY }}`,
    );
    expect(step.env?.["JANUS_GITHUB_READ_TOKEN"]).toBe(
      `\${{ secrets.GITHUB_TOKEN }}`,
    );
    expect(step.env?.["JANUS_BUILDKITE_READ_TOKEN"]).toBe(
      `\${{ secrets.BUILDKITE_MCP_CI_READ_TOKEN }}`,
    );
    expect(step.env?.["CC_TOKEN"]).toBe("");
    expect(step.env?.["CODECOV_TOKEN"]).toBeUndefined();
  }
  const cleanup = hosted?.steps.at(-1);
  expect(cleanup?.if).toBe("always() && steps.helpers.outcome == 'success'");
  expect(cleanup?.run).toContain("mcp-ci-workflow.py cleanup");
});

test("legacy coverage command order and native build commands are preserved", () => {
  expect(jobs["test-and-coverage"]?.steps.map((step) => step.name)).toEqual([
    "Checkout",
    "Setup Node",
    "Setup Bun",
    "Install",
    "Dependency audit",
    "Test with Coverage",
    "Enforce line and branch coverage thresholds",
    "Routing evaluation (strict)",
    "Upload coverage reports to Codecov",
    "Lint",
    "Typecheck",
  ]);
  expect(jobs["standalone-compile"]?.steps.at(-1)?.run).toBe(
    "bun run build:compile:matrix",
  );
  expect(jobs["cross-platform-smoke"]?.steps.at(-1)?.run).toContain(
    "bun test tests/version.test.ts",
  );
});
