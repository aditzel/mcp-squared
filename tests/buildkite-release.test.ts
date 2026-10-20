import { expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function release(mode: string, fail = "") {
  const root = mkdtempSync(join(tmpdir(), "mcp-release-phases-"));
  try {
    mkdirSync(join(root, "scripts", "buildkite"), { recursive: true });
    mkdirSync(join(root, "tools"));
    for (const name of ["release.sh", "check.sh"]) {
      cpSync(
        resolve(import.meta.dir, "../scripts/buildkite", name),
        join(root, "scripts", "buildkite", name),
      );
    }
    writeFileSync(join(root, "tools", "node"), "#!/bin/bash\necho v24.22.0\n", {
      mode: 0o755,
    });
    writeFileSync(
      join(root, "tools", "bun"),
      `#!/bin/bash
if [[ "$1" == --version ]]; then echo 1.3.5; exit; fi
printf '%s\\n' "$*" >> "$PHASE_LOG"
[[ "$*" != "$FAIL_COMMAND" ]] || exit 37
`,
      { mode: 0o755 },
    );
    const log = join(root, "commands");
    writeFileSync(log, "");
    const result = Bun.spawnSync(
      ["bash", "scripts/buildkite/release.sh", mode],
      {
        cwd: root,
        env: {
          PATH: `${join(root, "tools")}:/usr/bin:/bin`,
          HOME: root,
          PHASE_LOG: log,
          FAIL_COMMAND: fail,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    return {
      exit: result.exitCode,
      commands: readFileSync(log, "utf8").trim().split("\n").filter(Boolean),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const measured = [
  "install --frozen-lockfile",
  "run audit",
  "run test:coverage",
  "run coverage:check",
  "run eval:routing --strict",
];

test("release measurement stops before lint and typecheck", () => {
  expect(release("measure")).toEqual({ exit: 0, commands: measured });
});

test("release verification uses the already installed measured workspace", () => {
  expect(release("verify")).toEqual({
    exit: 0,
    commands: ["run lint", "run typecheck"],
  });
});

test("legacy release check retains every original check in order", () => {
  expect(release("check")).toEqual({
    exit: 0,
    commands: [...measured, "run lint", "run typecheck"],
  });
});

test("every measurement failure prevents the remaining phase commands", () => {
  for (const [i, command] of measured.entries()) {
    expect(release("measure", command)).toEqual({
      exit: 37,
      commands: measured.slice(0, i + 1),
    });
  }
});

test("lint failure prevents typechecking", () => {
  expect(release("verify", "run lint")).toEqual({
    exit: 37,
    commands: ["run lint"],
  });
});
