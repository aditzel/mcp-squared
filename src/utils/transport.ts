import type { ChildProcess } from "node:child_process";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * Safely closes an MCP transport, ensuring subprocesses are killed for StdioClientTransport.
 * Workaround for SDK issue: https://github.com/modelcontextprotocol/typescript-sdk/issues/271
 *
 * @param transport - The transport to close
 * @param timeoutMs - Timeout for graceful close (default: 1000ms)
 */
export async function safelyCloseTransport(
  transport: Transport,
  timeoutMs = 1000,
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: accessing private _process property
  const childProcess = (transport as any)?._process as ChildProcess | undefined;

  if (childProcess && typeof childProcess.kill === "function") {
    // Attempt standard close with timeout
    try {
      await Promise.race([
        transport.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Close timeout")), timeoutMs),
        ),
      ]);
    } catch (err) {
      // Log close errors for debugging, but don't fail
      if (err instanceof Error && err.message !== "Close timeout") {
        console.warn(`[mcp²] Transport close warning: ${err.message}`);
      }
    }

    // Force cleanup if process still exists and hasn't exited
    // Check both exitCode (most reliable) and killed (for mocks/compatibility)
    // Process is still running if exitCode is null/undefined AND killed is false
    const processStillRunning =
      childProcess.exitCode == null && !childProcess.killed;

    if (processStillRunning) {
      try {
        childProcess.kill("SIGTERM");

        // Wait for process to exit with timeout, then escalate to SIGKILL
        // Only if the process has proper event emitter methods
        if (typeof childProcess.once === "function") {
          await waitForProcessExit(childProcess, 5000);
        }
      } catch (err) {
        if (err instanceof Error) {
          console.warn(`[mcp²] Process cleanup warning: ${err.message}`);
        }
      }
    }
    return;
  }

  try {
    await transport.close();
  } catch (err) {
    if (err instanceof Error) {
      console.warn(`[mcp²] Transport close warning: ${err.message}`);
    }
  }
}

/**
 * Waits for a process to exit, escalating to SIGKILL if it doesn't exit in time.
 *
 * @param proc - The child process to wait for
 * @param timeoutMs - How long to wait before sending SIGKILL
 */
async function waitForProcessExit(
  proc: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  // If already exited, nothing to do
  // Use loose inequality to handle both null and undefined
  if (proc.exitCode != null) {
    return;
  }

  return new Promise<void>((resolve) => {
    // Set up the SIGKILL escalation timeout first
    const timeoutId = setTimeout(() => {
      if (proc.exitCode == null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Process may have exited between check and kill
        }
      }
      proc.off("exit", onExit);
      resolve();
    }, timeoutMs);

    // Unref so we don't hold the parent process open
    timeoutId.unref();

    const onExit = () => {
      clearTimeout(timeoutId);
      proc.off("exit", onExit);
      resolve();
    };

    proc.once("exit", onExit);
  });
}
