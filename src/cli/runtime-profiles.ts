import type { McpSquaredConfig } from "../config/index.js";

/**
 * Logs a one-line security profile notice to stderr on startup.
 * Helps new users understand the active security posture and how to change it.
 */
export function logSecurityProfile(config: McpSquaredConfig): void {
  const { allow, confirm } = config.security.tools;
  const isHardened = confirm.includes("*:*") && allow.length === 0;

  if (isHardened) {
    console.error(
      "[mcp²] Security: confirm-all mode (default). Tools require confirmation before execution. To use permissive mode: mcp-squared init --security=permissive",
    );
  }
}

/**
 * Logs search mode configuration status to stderr on startup.
 * Warns when semantic/hybrid mode is configured but embeddings are disabled.
 */
export function logSearchModeProfile(config: McpSquaredConfig): void {
  const { defaultMode } = config.operations.findTools;
  const { enabled: embeddingsEnabled } = config.operations.embeddings;

  if (
    (defaultMode === "semantic" || defaultMode === "hybrid") &&
    !embeddingsEnabled
  ) {
    console.error(
      `[mcp²] Search: defaultMode is "${defaultMode}" but embeddings are disabled. Searches will fall back to fast (FTS5). Enable with: [operations.embeddings] enabled = true`,
    );
  }
}
