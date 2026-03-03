/**
 * Config migration runner.
 *
 * Applies one-time, explicit migrations to existing config files.
 *
 * @module migrate/runner
 */

import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import type { MigrateArgs } from "../cli/index.js";
import {
  discoverConfigPath,
  loadConfigFromPath,
  type McpSquaredConfig,
  saveConfig,
} from "../config/index.js";

const DEFAULT_CODE_SEARCH_NAMESPACES = ["auggie", "ctxdb"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(obj, key);
}

function isCodeSearchExplicitlyConfigured(rawConfig: unknown): boolean {
  if (!isRecord(rawConfig)) {
    return false;
  }

  const operations = rawConfig["operations"];
  if (!isRecord(operations)) {
    return false;
  }

  const findTools = operations["findTools"];
  if (!isRecord(findTools)) {
    return false;
  }

  const preferredNamespacesByIntent = findTools["preferredNamespacesByIntent"];
  if (!isRecord(preferredNamespacesByIntent)) {
    return false;
  }

  return hasOwn(preferredNamespacesByIntent, "codeSearch");
}

/**
 * Applies code-search namespace defaults when none are configured.
 */
export function applyCodeSearchPreferenceMigration(
  config: McpSquaredConfig,
  options: { codeSearchExplicitlyConfigured: boolean },
): {
  config: McpSquaredConfig;
  changed: boolean;
} {
  if (options.codeSearchExplicitlyConfigured) {
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
  const rawConfig = parseToml(
    readFileSync(discovered.path, "utf-8"),
  ) as unknown;
  const codeSearchExplicitlyConfigured =
    isCodeSearchExplicitlyConfigured(rawConfig);
  const { config: migratedConfig, changed } =
    applyCodeSearchPreferenceMigration(loaded.config, {
      codeSearchExplicitlyConfigured,
    });

  if (!changed) {
    console.log(
      `No migration needed: code-search preferences already configured in ${discovered.path}`,
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
