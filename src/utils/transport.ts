import type { ChildProcess } from "node:child_process";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * Safely closes an MCP transport, ensuring subprocesses are killed for StdioClientTransport.
 * Workaround for SDK issue: https://github.com/modelcontextprotocol/typescript-sdk/issues/271
 */
export async function safelyCloseTransport(
  transport: Transport,
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: accessing private _process property
  const childProcess = (transport as any)?._process as ChildProcess | undefined;

  // Attempt standard close with timeout
  try {
    await Promise.race([
      transport.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Close timeout")), 1000),
      ),
    ]);
  } catch (e) {
    // Ignore close errors or timeout
  }

  // Force cleanup if process still exists
  if (childProcess && typeof childProcess.kill === "function") {
    if (!childProcess.killed) {
      try {
        // Force kill
        childProcess.kill("SIGTERM");

        // Setup a fallback to SIGKILL if it doesn't exit within 5 seconds
        setTimeout(() => {
          if (!childProcess.killed) {
            try {
              childProcess.kill("SIGKILL");
            } catch {}
          }
        }, 5000).unref(); // unref so we don't hold the parent process open
      } catch (e) {
        // ignore
      }
    }
  }
}
