/**
 * Lazy loader shim for the TUI config module.
 *
 * This file exists as an indirection layer between src/index.ts and
 * src/tui/config.ts.  config.ts has static top-level imports from
 * @opentui/core; those imports are evaluated at module initialisation time,
 * which means they run at binary startup when bundled by `bun build --compile`.
 *
 * By importing config.ts only inside an async function body, bun does not
 * eagerly evaluate the @opentui/core imports on startup.  When TUI is
 * unavailable (e.g. standalone compiled binary without @opentui/core installed)
 * the error is thrown here and caught by the caller in src/index.ts.
 *
 * @module tui/config-loader
 */

export async function runConfigTui(): Promise<void> {
  const { runConfigTui: _run } = await import("./config.js");
  return _run();
}
