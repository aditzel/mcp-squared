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

type ConfigLoaderModule = {
  runConfigTui: () => Promise<void>;
};

/**
 * Resolves the config module path relative to the current file.
 *
 * In dev mode (running from source), this file is src/tui/config-loader.ts
 * and the target is ./config.ts (same directory). When bundled into
 * dist/index.js, the inlined code runs from the root so it needs
 * ./tui/config.js. We detect which case by checking whether our own URL
 * already contains a /tui/ segment.
 */
function getConfigModuleSpecifier(): string {
  const self = import.meta.url;
  // When running from src/tui/ or dist/tui/, config.js is a sibling
  if (self.includes("/tui/")) {
    return new URL("./config.js", self).href;
  }
  // When bundled into dist/index.js (root), config.js is in ./tui/
  return "./tui/config.js";
}

function loadConfigModule(): Promise<ConfigLoaderModule> {
  return import(getConfigModuleSpecifier()) as Promise<ConfigLoaderModule>;
}

export async function runConfigTui(): Promise<void> {
  const { runConfigTui: _run } = await loadConfigModule();
  return _run();
}
