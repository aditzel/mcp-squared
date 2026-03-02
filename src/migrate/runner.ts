/**
 * Config migration runner.
 *
 * Applies one-time, explicit migrations to existing config files.
 *
 * @module migrate/runner
 */

import type { MigrateArgs } from "../cli/index.js";
import {
  discoverConfigPath,
  loadConfigFromPath,
  type McpSquaredConfig,
  saveConfig,
} from "../config/index.js";

const DEFAULT_CODE_SEARCH_NAMESPACES = ["auggie", "ctxdb"] as const;

/**
 * Applies code-search namespace defaults when none are configured.
 */
export function applyCodeSearchPreferenceMigration(config: McpSquaredConfig): {
  config: McpSquaredConfig;
  changed: boolean;
} {
  const existing =
    config.operations.findTools.preferredNamespacesByIntent.codeSearch;

  if (existing.length > 0) {
    return { config, changed: false };
  }

  return {
    changed: true,
    config: {
      ...config,
      operations: {
        ...config.operations,
        findTools: {
          ...config.operations.findTools,
          preferredNamespacesByIntent: {
            ...config.operations.findTools.preferredNamespacesByIntent,
            codeSearch: [...DEFAULT_CODE_SEARCH_NAMESPACES],
          },
        },
      },
    },
  };
}

/**
 * Runs explicit config migrations against the discovered config file.
 */
export async function runMigrate(args: MigrateArgs): Promise<void> {
  const discovered = discoverConfigPath();
  if (!discovered) {
    console.error(
      "No configuration file found. Run 'mcp-squared init' to create one first.",
    );
    process.exit(1);
  }

  const loaded = await loadConfigFromPath(discovered.path, discovered.source);
  const { config: migratedConfig, changed } =
    applyCodeSearchPreferenceMigration(loaded.config);

  if (!changed) {
    console.log(
      `No migration needed: code-search preferences already set in ${discovered.path}`,
    );
    return;
  }

  if (args.dryRun) {
    console.log(`[dry-run] Would update ${discovered.path}`);
    console.log(
      '[dry-run] Set operations.findTools.preferredNamespacesByIntent.codeSearch = ["auggie", "ctxdb"]',
    );
    return;
  }

  await saveConfig(discovered.path, migratedConfig);
  console.log(`Updated ${discovered.path}`);
  console.log(
    'Set operations.findTools.preferredNamespacesByIntent.codeSearch = ["auggie", "ctxdb"]',
  );
}
