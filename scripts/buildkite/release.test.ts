import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
async function invoke(
  args: string[],
  options: {
    failure?: string;
    invalid?: string;
    node?: string;
    bun?: string;
    existing?: boolean;
    parentLink?: boolean;
    publishHook?: boolean;
    prepublishHook?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "mcp-release-test-"));
  roots.push(root);
  const scripts = join(root, "scripts/buildkite");
  const bin = join(root, "fake-bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  for (const name of ["release.sh", "package-release.ts", "check.sh"]) {
    copyFileSync(new URL(`./${name}`, import.meta.url), join(scripts, name));
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "mcp-squared",
      version: "0.8.1",
      scripts: {
        prepack: "bun run build && bun run build:verify",
        ...(options.prepublishHook ? { prepublishOnly: "existing hook" } : {}),
        ...(options.publishHook ? { publish: "unexpected publish hook" } : {}),
      },
    }),
  );
  writeFileSync(join(root, "bun.lock"), "{}\n");
  writeFileSync(
    join(bin, "node"),
    "#!/bin/sh\nprintf '%s\\n' \"$TEST_NODE\"\n",
    {
      mode: 0o755,
    },
  );
  writeFileSync(
    join(bin, "bun"),
    `#!/bin/sh
if [ "$1" = --version ]; then printf '%s\\n' "$TEST_BUN"; exit 0; fi
if [ "$1" = run ] && [ "$2" = scripts/buildkite/package-release.ts ]; then
  shift 2
  exec "$TEST_REAL_BUN" scripts/buildkite/package-release.ts "$@"
fi
printf '%s\\n' "$*" >> commands.log
if [ "$*" = "$TEST_FAILURE" ] || [ "$1 $2" = "$TEST_FAILURE" ]; then exit 23; fi
if [ "$1" = pm ] && [ "$2" = pack ]; then
  exec "$TEST_REAL_BUN" fixture.ts "$4"
fi
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, "fixture.ts"),
    `import { writeFileSync, symlinkSync, linkSync } from "node:fs";
const out=process.argv[2];
const invalid=process.env.TEST_INVALID;
if(invalid==="symlink") symlinkSync(process.cwd()+"/package.json",out);
else if(invalid==="hardlink") linkSync("package.json",out);
else writeFileSync(out,invalid==="empty"?"":"candidate tarball");
if(invalid==="metadata") writeFileSync("package.json","{}");
if(invalid==="lock") writeFileSync("bun.lock","changed");
`,
  );
  if (options.parentLink) {
    mkdirSync(join(root, "outside"));
    symlinkSync(join(root, "outside"), join(root, "build"));
  }
  const output = join(root, "build/npm-release");
  if (options.existing) {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "keep"), "preserve");
  }
  const result = await new Promise<{
    status: number;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    // Keep the event loop available for child reaping and the fixture deadline.
    execFile(
      "bash",
      [join(scripts, "release.sh"), ...args],
      {
        cwd: "/",
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          HOME: root,
          TEST_REAL_BUN: process.execPath,
          TEST_BUN: options.bun ?? "1.3.5",
          TEST_NODE: options.node ?? "v24.22.0",
          TEST_FAILURE: options.failure ?? "",
          TEST_INVALID: options.invalid ?? "",
        },
        encoding: "utf8",
        timeout: 15_000,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({ status: error?.code ?? 0, stdout, stderr });
      },
    );
  });
  const log = join(root, "commands.log");
  if (existsSync(join(root, "build"))) {
    expect(
      readdirSync(join(root, "build")).filter((name) =>
        name.startsWith(".npm-release-"),
      ),
    ).toEqual([]);
  }
  return {
    root,
    output,
    result,
    calls: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("credential-free release preparation", () => {
  it("uses the measured release checks and keeps Codecov pending", async () => {
    const { result, calls, output } = await invoke(["check"]);
    expect(result.status).toBe(0);
    expect(calls).toEqual([
      "install --frozen-lockfile",
      "run audit",
      "run test:coverage",
      "run coverage:check",
      "run eval:routing --strict",
      "run lint",
      "run typecheck",
    ]);
    expect(result.stdout).toContain("PENDING: Codecov upload");
    expect(existsSync(output)).toBe(false);
  });

  it("packs through Bun's prepack lifecycle without publication", async () => {
    const { result, calls, output } = await invoke(["pack", "v0.8.1"]);
    expect(result.status).toBe(0);
    expect(calls[0]).toBe("install --frozen-lockfile");
    expect(calls[1]).toMatch(/^pm pack --filename .+\/package\.tgz$/);
    expect(calls).toHaveLength(2);
    const tarball = readFileSync(join(output, "package.tgz"));
    const report = JSON.parse(
      readFileSync(join(output, "package.json"), "utf8"),
    );
    expect(report).toEqual({
      schemaVersion: 1,
      name: "mcp-squared",
      version: "0.8.1",
      tag: "v0.8.1",
      tarball: "package.tgz",
      size: tarball.length,
      sha256: createHash("sha256").update(tarball).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    });
  });

  it.each([
    [],
    ["unknown"],
    ["check", "extra"],
    ["pack"],
    ["pack", "v0.8.1", "extra"],
    ["pack", "v0.8.2"],
    ["pack", "0.8.1"],
  ])("rejects invalid invocation before installation: %j", async (...args) => {
    const { result, calls, output } = await invoke(args);
    expect(result.status).not.toBe(0);
    expect(calls).toEqual([]);
    expect(existsSync(output)).toBe(false);
  });

  it.each([
    { bun: "1.3.14" },
    { node: "v22.23.3" },
  ])("rejects the wrong runtime before installation: %j", async (options) => {
    const { result, calls } = await invoke(["pack", "v0.8.1"], options);
    expect(result.status).not.toBe(0);
    expect(calls).toEqual([]);
  });

  it.each([
    "install --frozen-lockfile",
    "run audit",
    "run test:coverage",
    "run coverage:check",
    "run eval:routing --strict",
    "run lint",
    "run typecheck",
  ])("propagates the release check failure from %s", async (failure) => {
    const { result, calls } = await invoke(["check"], { failure });
    expect(result.status).toBe(23);
    expect(calls.at(-1)).toBe(failure);
  });

  it.each([
    "symlink",
    "hardlink",
    "empty",
    "metadata",
    "lock",
  ])("does not export invalid candidate output: %s", async (invalid) => {
    const { result, output } = await invoke(["pack", "v0.8.1"], { invalid });
    expect(result.status).not.toBe(0);
    expect(existsSync(output)).toBe(false);
  });

  it("preserves existing results and refuses symlinked output parents", async () => {
    const first = await invoke(["pack", "v0.8.1"], { existing: true });
    expect(first.result.status).not.toBe(0);
    expect(first.calls).toEqual([]);
    expect(readFileSync(join(first.output, "keep"), "utf8")).toBe("preserve");
    const second = await invoke(["pack", "v0.8.1"], { parentLink: true });
    expect(second.result.status).not.toBe(0);
    expect(second.calls).toEqual([]);
  });

  it("fails closed when new publication hooks need a lifecycle decision", async () => {
    const { result, calls } = await invoke(["pack", "v0.8.1"], {
      publishHook: true,
    });
    expect(result.status).not.toBe(0);
    expect(calls).toEqual([]);
  });

  it("preserves prepublishOnly before packing when present", async () => {
    const { result, calls } = await invoke(["pack", "v0.8.1"], {
      prepublishHook: true,
    });
    expect(result.status).toBe(0);
    expect(calls.slice(0, 2)).toEqual([
      "install --frozen-lockfile",
      "run prepublishOnly",
    ]);
    expect(calls[2]).toMatch(/^pm pack --filename /);
  });

  it.each([
    "install --frozen-lockfile",
    "run prepublishOnly",
    "pm pack",
  ])("exports no candidate when packaging fails at %s", async (failure) => {
    const { result, output } = await invoke(["pack", "v0.8.1"], {
      prepublishHook: true,
      failure,
    });
    expect(result.status).not.toBe(0);
    expect(existsSync(output)).toBe(false);
  });

  it("uses measured branch coverage in the retained tag workflow", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/publish.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain(
      "bun run test:coverage |& tee coverage/coverage-summary.txt",
    );
    expect(workflow).not.toContain("bun test --coverage");
  });
});
