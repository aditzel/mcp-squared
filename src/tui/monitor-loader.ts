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

function getMonitorModuleSpecifier(): string {
  // Build the module path at runtime so Bun doesn't eagerly include the TUI module.
  const modulePath = ["./", "monitor", ".js"].join("");
  const baseUrl = new URL(".", import.meta.url);
  return new URL(modulePath, baseUrl).href;
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
