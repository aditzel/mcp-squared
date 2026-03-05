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

type MonitorTuiOptions = {
  socketPath?: string;
  refreshInterval?: number;
  instances?: unknown[];
};

type MonitorLoaderModule = {
  runMonitorTui: (options?: MonitorTuiOptions) => Promise<void>;
};

/**
 * Resolves the monitor module path relative to the current file.
 *
 * In dev mode (running from source), this file is src/tui/monitor-loader.ts
 * and the target is ./monitor.ts (same directory). When bundled into
 * dist/index.js, the inlined code runs from the root so it needs
 * ./tui/monitor.js. We detect which case by checking whether our own URL
 * already contains a /tui/ segment.
 */
function getMonitorModuleSpecifier(): string {
  const self = import.meta.url;
  if (self.includes("/tui/")) {
    return new URL("./monitor.js", self).href;
  }
  return "./tui/monitor.js";
}

async function loadMonitorModule(): Promise<MonitorLoaderModule> {
  return import(getMonitorModuleSpecifier()) as Promise<MonitorLoaderModule>;
}

export async function runMonitorTui(
  options: MonitorTuiOptions = {},
): Promise<void> {
  const { runMonitorTui: runMonitor } = await loadMonitorModule();
  return runMonitor(options);
}
