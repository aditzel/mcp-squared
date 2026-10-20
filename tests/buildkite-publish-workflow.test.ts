import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

type Step = {
  id?: string;
  name: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Partial<
    Record<
      | "JANUS_GITHUB_READ_TOKEN"
      | "JANUS_BUILDKITE_READ_TOKEN"
      | "CODECOV_TOKEN",
      string
    >
  >;
  with?: Partial<
    Record<
      | "name"
      | "path"
      | "files"
      | "ref"
      | "repository"
      | "persist-credentials"
      | "if-no-files-found"
      | "overwrite"
      | "disable_search"
      | "fail_ci_if_error"
      | "override_commit"
      | "node-version"
      | "token",
      string | boolean
    >
  >;
};
type Job = {
  name: string;
  if: string;
  needs?: string;
  "runs-on": string;
  permissions: Record<string, string>;
  environment?: { name: string; url: string };
  steps: Step[];
};
const workflow = parse(
  readFileSync(
    resolve(import.meta.dir, "../.github/workflows/publish.yml"),
    "utf8",
  ),
);
const jobs = workflow.jobs as Record<"verify-janus" | "publish", Job>;

function stepAt(steps: Step[], index: number): Step {
  const step = steps[index];
  if (!step) throw new Error(`Missing workflow step ${index}`);
  return step;
}

function evaluate(
  expression: string,
  mode: string,
  result = "success",
  canceled = false,
) {
  return Function(
    "vars",
    "needs",
    "github",
    "contains",
    "fromJSON",
    "cancelled",
    "startsWith",
    `return (${expression.replace(/^\$\{\{\s*|\s*\}\}$/g, "").replaceAll("needs.verify-janus", 'needs["verify-janus"]')});`,
  )(
    { JANUS_MCP_RELEASE_MODE: mode },
    { "verify-janus": { result } },
    {
      repository: "aditzel/mcp-squared",
      event_name: "push",
      ref: "refs/tags/v1.0.0",
    },
    (list: string[], value: string) => list.includes(value),
    JSON.parse,
    () => canceled,
    (value: string, prefix: string) => value.startsWith(prefix),
  );
}

test("the original tag trigger, serialization and protected environment survive", () => {
  expect(workflow.on).toEqual({ push: { tags: ["v*"] } });
  expect(workflow.concurrency).toEqual({
    group: "npm-publish",
    "cancel-in-progress": false,
  });
  expect(Object.keys(jobs)).toEqual(["verify-janus", "publish"]);
  expect(jobs.publish.environment).toEqual({
    name: "npm-publish",
    url: "https://www.npmjs.com/package/mcp-squared",
  });
});

test("legacy remains the default while both commissioned modes require verification", () => {
  expect(jobs.publish.needs).toBe("verify-janus");
  for (const mode of ["", "verify", "publish"]) {
    expect(evaluate(jobs["verify-janus"].if, mode)).toBe(mode !== "");
    for (const result of ["success", "failure", "skipped", "cancelled"]) {
      expect(evaluate(jobs.publish.if, mode, result)).toBe(
        mode === "" || result === "success",
      );
      expect(evaluate(jobs.publish.if, mode, result, true)).toBe(false);
    }
    expect(evaluate(jobs.publish["runs-on"], mode)).toEqual(
      mode === "" ? ["self-hosted", "Linux", "X64"] : ["ubuntu-24.04"],
    );
  }
});

test("unknown modes reach an explicit failure instead of silent success or legacy publication", () => {
  expect(evaluate(jobs.publish.if, "typo", "skipped")).toBe(true);
  const validation = stepAt(jobs.publish.steps, 0);
  expect(validation.name).toBe("Validate release mode");
  for (const [mode, code] of [
    ["", 0],
    ["verify", 0],
    ["publish", 0],
    ["typo", 1],
  ] as const) {
    const result = Bun.spawnSync(["bash", "-e", "-c", validation.run ?? ""], {
      env: { PATH: "/usr/bin:/bin", RELEASE_MODE: mode },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(code);
  }
});

test("only authenticated measured LCOV is uploaded before the producer failure is propagated", () => {
  const steps = jobs["verify-janus"].steps;
  const coverage = steps.findIndex((step) => step.id === "coverage");
  const upload = steps.findIndex(
    (step) => step.name === "Upload authenticated coverage",
  );
  const gate = steps.findIndex(
    (step) => step.name === "Require successful Janus producer",
  );
  const handoff = steps.findIndex((step) => step.id === "handoff");
  expect(coverage).toBeGreaterThan(-1);
  expect(coverage).toBeLessThan(upload);
  expect(upload).toBeLessThan(gate);
  expect(gate).toBeLessThan(handoff);
  expect(stepAt(steps, upload).if).toBe(
    "steps.coverage.outputs.measured == 'true'",
  );
  expect(stepAt(steps, upload).with?.files).toBe(
    `\${{ steps.coverage.outputs.reports-directory }}/lcov.info`,
  );
  expect(stepAt(steps, upload).with?.disable_search).toBe(true);
  expect(stepAt(steps, upload).with?.fail_ci_if_error).toBe(false);
  expect(stepAt(steps, upload).with?.override_commit).toBe(
    `\${{ github.sha }}`,
  );
  for (const [successful, code] of [
    ["true", 0],
    ["false", 1],
    ["", 1],
  ] as const) {
    const result = Bun.spawnSync(
      ["bash", "-e", "-c", stepAt(steps, gate).run ?? ""],
      {
        env: { PATH: "/usr/bin:/bin", PRODUCER_SUCCESSFUL: successful },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(code);
  }
  expect(stepAt(steps, handoff).if).toBeUndefined();
  expect(steps.every((step) => !("continue-on-error" in step))).toBe(true);
});

test("both hosted jobs use the same immutable helper closure with no persisted checkout credential", () => {
  const helpers = Object.values(jobs).map((job) =>
    job.steps.find((step) => step.id === "helpers"),
  );
  const revision = helpers[0]?.with?.ref;
  expect(revision).toMatch(/^[a-f0-9]{40}$/);
  for (const helper of helpers) {
    expect(helper?.with?.repository).toBe("MiraiForge/devops");
    expect(helper?.with?.ref).toBe(revision);
    expect(helper?.with?.["persist-credentials"]).toBe(false);
  }
  expect(jobs["verify-janus"].permissions).toEqual({
    contents: "read",
    actions: "read",
  });
  expect(jobs.publish.permissions).toEqual({
    contents: "read",
    actions: "read",
    "id-token": "write",
  });
});

test("hosted publication runs no project code and keeps provider credentials scoped to authentication", () => {
  const hosted = jobs.publish.steps.filter(
    (step) => step.if !== "vars.JANUS_MCP_RELEASE_MODE == ''",
  );
  expect(
    hosted.filter((step) => step.uses?.startsWith("actions/checkout@")).length,
  ).toBe(1);
  expect(
    hosted.filter((step) => step.uses?.startsWith("actions/checkout@"))[0]?.with
      ?.repository,
  ).toBe("MiraiForge/devops");
  expect(
    hosted.some((step) => /bun|npm install|npm publish/.test(step.run ?? "")),
  ).toBe(false);
  const publish = hosted.find(
    (step) => step.name === "Publish authenticated package",
  );
  expect(publish?.run).toContain("mcp-workflow.py publish");
  expect(publish?.env?.JANUS_GITHUB_READ_TOKEN).toBe(
    `\${{ secrets.GITHUB_TOKEN }}`,
  );
  expect(publish?.env?.JANUS_BUILDKITE_READ_TOKEN).toBe(
    `\${{ secrets.BUILDKITE_MCP_RELEASE_READ_TOKEN }}`,
  );
  expect(publish?.env?.CODECOV_TOKEN).toBeUndefined();
  const setup = hosted.find(
    (step) => step.name === "Setup hosted publisher Node",
  );
  expect(setup?.with).toEqual({ "node-version": "24.22.0" });
});

test("the legacy command order and coverage defaults stay intact", () => {
  const legacy = jobs.publish.steps.filter(
    (step) => step.if === "vars.JANUS_MCP_RELEASE_MODE == ''",
  );
  expect(legacy.map((step) => step.name)).toEqual([
    "Checkout",
    "Setup Node",
    "Setup Bun",
    "Install",
    "Dependency audit",
    "Test",
    "Enforce line and branch coverage thresholds",
    "Routing evaluation (strict)",
    "Upload coverage reports to Codecov",
    "Lint",
    "Typecheck",
    "Publish",
  ]);
  expect(legacy.at(-1)?.run).toBe("npm publish");
  expect(
    legacy.find((step) => step.name === "Upload coverage reports to Codecov")
      ?.with,
  ).toEqual({
    token: `\${{ secrets.CODECOV_TOKEN }}`,
  });
});

test("handoff is immutable and private workspace cleanup runs after success or failure", () => {
  const upload = jobs["verify-janus"].steps.find(
    (step) => step.name === "Upload authenticated handoff",
  );
  expect(upload?.with?.name).toBe(
    `\${{ steps.handoff.outputs.artifact-name }}`,
  );
  expect(upload?.with?.path).toBe(`\${{ steps.handoff.outputs.handoff-file }}`);
  expect(upload?.with?.["if-no-files-found"]).toBe("error");
  expect(upload?.with?.overwrite).toBe(false);
  for (const job of Object.values(jobs)) {
    expect(job.steps.at(-1)?.if).toContain("always()");
    expect(job.steps.at(-1)?.run).toContain("mcp-workflow.py cleanup");
  }
});
