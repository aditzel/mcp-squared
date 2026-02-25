import { afterAll, afterEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { type Subprocess, spawn } from "bun";

// Use the running bun binary directly so tests work regardless of whether
// "bun" is on $PATH (e.g. CI environments where bun is installed to a
// non-standard location).
const BUN_EXEC = process.execPath;

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const ENTRY_POINT = resolve(PROJECT_ROOT, "src/index.ts");
const TEST_TMP_DIR = mkdtempSync(
  resolve(tmpdir(), "mcp-squared-process-lifecycle-"),
);
const UDS_SUPPORTED = await new Promise<boolean>((resolveCapability) => {
  const testSocketPath = resolve(
    TEST_TMP_DIR,
    `uds-capability-${Date.now()}.sock`,
  );
  const server = createServer();
  server.once("error", () => resolveCapability(false));
  server.listen(testSocketPath, () => {
    server.close(() => {
      try {
        rmSync(testSocketPath, { force: true });
      } catch {
        // best-effort cleanup
      }
      resolveCapability(true);
    });
  });
});

/**
 * Tests for process lifecycle management.
 * Verifies that mcp-squared properly exits when its parent process dies
 * (stdin closes), preventing orphaned processes.
 */
if (!UDS_SUPPORTED) {
  test.skip("Process Lifecycle (UDS listen unsupported in this environment)", () => {});
} else {
  describe("Process Lifecycle", () => {
    let childProcess: Subprocess | null = null;
    let trackedMarkerPath: string | null = null;
    const testId = crypto.randomUUID();

    function wait(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function makeTempPath(prefix: string, extension: string): string {
      return resolve(
        TEST_TMP_DIR,
        `${prefix}-${crypto.randomUUID()}.${extension}`,
      );
    }

    async function waitForExit(
      process: Subprocess,
      timeoutMs = 5000,
    ): Promise<number> {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Process did not exit within ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      return Promise.race([process.exited, timeoutPromise]);
    }

    async function waitForMarkerFile(
      markerPath: string,
      timeoutMs = 5000,
    ): Promise<number> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (existsSync(markerPath)) {
          const raw = readFileSync(markerPath, "utf8").trim();
          const pid = Number.parseInt(raw, 10);
          if (!Number.isNaN(pid)) {
            return pid;
          }
        }
        await wait(50);
      }
      throw new Error(`Marker file not created in time: ${markerPath}`);
    }

    async function waitForMarkerRemoval(
      markerPath: string,
      timeoutMs = 5000,
    ): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (!existsSync(markerPath)) {
          return;
        }
        await wait(50);
      }
      throw new Error(`Marker file was not removed in time: ${markerPath}`);
    }

    function spawnServer(configPath: string): Subprocess {
      const configHome = mkdtempSync(resolve(TEST_TMP_DIR, "xdg-config-home-"));
      return spawn({
        cmd: [BUN_EXEC, "run", ENTRY_POINT, "--stdio"],
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: configHome,
          MCP_SQUARED_CONFIG: configPath,
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    }

    afterEach(async () => {
      if (childProcess) {
        try {
          childProcess.kill();
        } catch {
          // Process may already be dead
        }
        childProcess = null;
      }

      if (trackedMarkerPath && existsSync(trackedMarkerPath)) {
        try {
          const pid = Number.parseInt(
            readFileSync(trackedMarkerPath, "utf8"),
            10,
          );
          if (!Number.isNaN(pid)) {
            process.kill(pid);
          }
        } catch {
          // best-effort cleanup
        }
        try {
          unlinkSync(trackedMarkerPath);
        } catch {
          // best-effort cleanup
        }
        trackedMarkerPath = null;
      }
    });

    afterAll(() => {
      rmSync(TEST_TMP_DIR, { recursive: true, force: true });
    });

    test("server exits when stdin closes (parent death simulation)", async () => {
      const configPath = makeTempPath("lifecycle-stdin-close", "toml");
      await Bun.write(configPath, "schemaVersion = 1\n");

      childProcess = spawnServer(configPath);

      await wait(300);

      const stdin = childProcess.stdin;
      if (!stdin || typeof stdin === "number") {
        throw new Error("Expected child stdin to be piped");
      }
      stdin.end();

      const exitCode = await waitForExit(childProcess);
      expect(exitCode).toBe(0);
    });

    test("server exits when stdin is ended with an error", async () => {
      const configPath = makeTempPath("lifecycle-stdin-abrupt", "toml");
      await Bun.write(configPath, "schemaVersion = 1\n");

      childProcess = spawnServer(configPath);

      await wait(300);

      const stdin = childProcess.stdin;
      if (!stdin || typeof stdin === "number") {
        throw new Error("Expected child stdin to be piped");
      }
      stdin.end(new Error("Simulated parent pipe failure"));

      const exitCode = await waitForExit(childProcess);
      expect(exitCode).toBe(0);
    });

    test("upstream stdio processes are cleaned up on server exit", async () => {
      // Path to our mock echo server
      const echoServerPath = resolve(
        PROJECT_ROOT,
        "tests/fixtures/echo-server.ts",
      );

      const markerPath = makeTempPath("echo-server-marker", "pid");
      trackedMarkerPath = markerPath;
      const configPath = makeTempPath("lifecycle-upstream-cleanup", "toml");
      const configContent = `
schemaVersion = 1

[upstreams.test-echo]
transport = "stdio"
enabled = true
[upstreams.test-echo.stdio]
command = "${BUN_EXEC}"
args = ["run", "${echoServerPath}", "${markerPath}", "${testId}"]
[upstreams.test-echo.env]
`;

      await Bun.write(configPath, configContent);

      childProcess = spawnServer(configPath);

      // Pipe stderr to console so we can see what's happening
      const stderrStream = childProcess.stderr;
      if (stderrStream && typeof stderrStream !== "number") {
        const reader = stderrStream.getReader();
        (async () => {
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) break;
              // process.stderr.write(value); // Commented out to reduce noise
            }
          } catch {}
        })();
      }

      const pid = childProcess.pid;
      expect(pid).toBeDefined();

      // Wait for upstream process to start and write its PID marker
      const upstreamPid = await waitForMarkerFile(markerPath);
      expect(upstreamPid).toBeGreaterThan(0);

      // Kill mcp-squared and verify the upstream process exits too
      childProcess.kill();

      await waitForExit(childProcess);
      await waitForMarkerRemoval(markerPath);
    });
  });
}
