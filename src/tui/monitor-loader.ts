/**
 * Lazy loader shim for the TUI monitor module.
 *
 * This file exists as an indirection layer between src/index.ts and
 * src/tui/monitor.ts.  monitor.ts has static top-level imports from
 * @opentui/core; those imports are evaluated at module initialisation time,
 * which means they run at binary startup when bundled by `bun build --compile`.
 *
 * By importing monitor.ts only inside an async function body, bun does not
 * eagerly evaluate the @opentui/core imports on startup.  When TUI is
 * unavailable (e.g. standalone compiled binary without @opentui/core installed)
 * the error is thrown here and caught by the caller in src/index.ts.
 *
 * @module tui/monitor-loader
 */

export type { MonitorTuiOptions } from "./monitor.js";

export async function runMonitorTui(
  ...args: Parameters<typeof import("./monitor.js").runMonitorTui>
): Promise<void> {
  const { runMonitorTui: _run } = await import("./monitor.js");
  return _run(...args);
}
