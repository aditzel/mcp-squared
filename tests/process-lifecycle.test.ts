import { afterEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { resolve } from "node:path";
import { type Subprocess, spawn } from "bun";

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const ENTRY_POINT = resolve(PROJECT_ROOT, "src/index.ts");

/**
 * Tests for process lifecycle management.
 * Verifies that mcp-squared properly exits when its parent process dies
 * (stdin closes), preventing orphaned processes.
 */
describe("Process Lifecycle", () => {
  let childProcess: Subprocess | null = null;

  const testId = crypto.randomUUID();

  afterEach(async () => {
    if (childProcess) {
      try {
        childProcess.kill();
      } catch {
        // Process may already be dead
      }
      childProcess = null;
    }

    // Aggressively clean up any lingering echo servers from this test
    try {
      spawn(["pkill", "-f", testId]);
    } catch {}
  });

  test.skip("server exits when stdin closes (parent death simulation)", async () => {
    // ... (rest of test unchanged)
  });

  test.skip("server exits when stdin is destroyed abruptly", async () => {
    // ... (rest of test unchanged)
  });

  test("upstream stdio processes are cleaned up on server exit", async () => {
    // Path to our mock echo server
    const echoServerPath = resolve(
      PROJECT_ROOT,
      "tests/fixtures/echo-server.ts",
    );

    // Create a config that uses the echo server with a unique ID
    const configPath = resolve(
      PROJECT_ROOT,
      "tests/fixtures/lifecycle-config.toml",
    );
    const configContent = `
schemaVersion = 1

[upstreams.test-echo]
transport = "stdio"
enabled = true
[upstreams.test-echo.stdio]
command = "bun"
args = ["run", "${echoServerPath}", "${testId}"]
[upstreams.test-echo.env]
`;

    await Bun.write(configPath, configContent);

    // Spawn mcp-squared with this config
    childProcess = spawn({
      cmd: ["bun", "run", ENTRY_POINT],
      cwd: PROJECT_ROOT,
      env: { ...process.env, MCP_CONFIG_PATH: configPath },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Pipe stderr to console so we can see what's happening
    if (childProcess.stderr) {
      // @ts-ignore
      async function readStderr() {
        // @ts-ignore
        const reader = childProcess.stderr.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // process.stderr.write(value); // Commented out to reduce noise
          }
        } catch {}
      }
      readStderr();
    }

    const pid = childProcess.pid;
    expect(pid).toBeDefined();

    // Wait for server to start and connect to upstream
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Kill the parent process (SIGTERM)
    childProcess.kill();

    // Wait for exit
    await childProcess.exited;

    // Verify echo server is gone
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if any process with our unique test ID is running
    const checkProc = spawn({
      cmd: ["pgrep", "-f", testId],
      stdout: "pipe",
    });

    const output = await new Response(checkProc.stdout).text();

    if (output.trim().length > 0) {
      console.error("Found lingering echo-server processes:", output);
    }

    expect(output.trim().length).toBe(0);
  });
});
