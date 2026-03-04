/**
 * Config migration runner.
 *
 * Applies one-time, explicit migrations to existing config files.
 *
 * @module migrate/runner
 */

import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import {
  CAPABILITY_IDS,
  type CapabilityId,
  inferNamespaceCapability,
} from "../capabilities/inference.js";
import type { MigrateArgs } from "../cli/index.js";
import {
  discoverConfigPath,
  loadConfigFromPath,
  type McpSquaredConfig,
  saveConfig,
} from "../config/index.js";

const DEFAULT_CODE_SEARCH_NAMESPACES = ["auggie", "ctxdb"] as const;
const RESERVED_DESCRIBE_ACTION = "__describe_actions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(obj, key);
}

function toActionToken(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  const token = normalized.length > 0 ? normalized : "tool";
  const reservedNormalized = RESERVED_DESCRIBE_ACTION.replace(
    /^_+|_+$/g,
    "",
  ).replace(/_+/g, "_");
  if (token === reservedNormalized) {
    return `${RESERVED_DESCRIBE_ACTION}__tool`;
  }
  return token;
}

function isCapabilityId(value: string): value is CapabilityId {
  return (CAPABILITY_IDS as readonly string[]).includes(value);
}

function hasLegacyDynamicToolSurfaceKeys(rawConfig: unknown): boolean {
  if (!isRecord(rawConfig)) {
    return false;
  }
  const operations = rawConfig["operations"];
  if (!isRecord(operations)) {
    return false;
  }
  const dynamicToolSurface = operations["dynamicToolSurface"];
  if (!isRecord(dynamicToolSurface)) {
    return false;
  }
  return (
    hasOwn(dynamicToolSurface, "mode") || hasOwn(dynamicToolSurface, "naming")
  );
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

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

type PatternTranslation = {
  original: string;
  translated: string;
  changed: boolean;
  unresolvedReason?: string;
};

function translateSecurityPattern(
  pattern: string,
  config: McpSquaredConfig,
): PatternTranslation {
  const [scopeRaw, actionRaw] = pattern.split(":", 2);
  if (!scopeRaw || !actionRaw) {
    return {
      original: pattern,
      translated: pattern,
      changed: false,
      unresolvedReason: "invalid pattern format",
    };
  }

  const translatedAction = actionRaw === "*" ? "*" : toActionToken(actionRaw);
  if (scopeRaw === "*") {
    const translated = `*:${translatedAction}`;
    return {
      original: pattern,
      translated,
      changed: translated !== pattern,
    };
  }

  if (isCapabilityId(scopeRaw)) {
    const translated = `${scopeRaw}:${translatedAction}`;
    return {
      original: pattern,
      translated,
      changed: translated !== pattern,
    };
  }

  const override =
    config.operations.dynamicToolSurface.capabilityOverrides[scopeRaw];
  const capability = override ?? inferNamespaceCapability(scopeRaw, [], {});
  const translated = `${capability}:${translatedAction}`;
  return {
    original: pattern,
    translated,
    changed: translated !== pattern,
  };
}

type SecurityMigrationReport = {
  translated: Array<{ from: string; to: string }>;
  unresolved: Array<{ pattern: string; reason: string }>;
};

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
 * Translates legacy security patterns from namespace:tool to
 * capability:action best-effort.
 */
export function applySecurityPatternMigration(config: McpSquaredConfig): {
  config: McpSquaredConfig;
  changed: boolean;
  report: SecurityMigrationReport;
} {
  const report: SecurityMigrationReport = {
    translated: [],
    unresolved: [],
  };

  const migrateList = (patterns: string[]): string[] => {
    const next: string[] = [];
    for (const pattern of patterns) {
      const translation = translateSecurityPattern(pattern, config);
      next.push(translation.translated);
      if (translation.unresolvedReason) {
        report.unresolved.push({
          pattern: translation.original,
          reason: translation.unresolvedReason,
        });
      } else if (translation.changed) {
        report.translated.push({
          from: translation.original,
          to: translation.translated,
        });
      }
    }
    return dedupePreserveOrder(next);
  };

  const allow = migrateList(config.security.tools.allow);
  const block = migrateList(config.security.tools.block);
  const confirm = migrateList(config.security.tools.confirm);
  const changed =
    allow.join("|") !== config.security.tools.allow.join("|") ||
    block.join("|") !== config.security.tools.block.join("|") ||
    confirm.join("|") !== config.security.tools.confirm.join("|");

  if (!changed && report.unresolved.length === 0) {
    return { config, changed: false, report };
  }

  return {
    changed,
    report,
    config: {
      ...config,
      security: {
        ...config.security,
        tools: {
          allow,
          block,
          confirm,
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
  const hasLegacySurfaceKeys = hasLegacyDynamicToolSurfaceKeys(rawConfig);

  const codeSearchMigration = applyCodeSearchPreferenceMigration(
    loaded.config,
    {
      codeSearchExplicitlyConfigured,
    },
  );
  const securityMigration = applySecurityPatternMigration(
    codeSearchMigration.config,
  );

  const changed =
    codeSearchMigration.changed ||
    securityMigration.changed ||
    hasLegacySurfaceKeys;

  if (!changed && securityMigration.report.unresolved.length === 0) {
    console.log(`No migration needed for ${discovered.path}`);
    return;
  }

  if (args.dryRun) {
    console.log(`[dry-run] Would update ${discovered.path}`);
    if (codeSearchMigration.changed) {
      console.log(
        '[dry-run] Set operations.findTools.preferredNamespacesByIntent.codeSearch = ["auggie", "ctxdb"]',
      );
    }
    if (securityMigration.report.translated.length > 0) {
      for (const item of securityMigration.report.translated) {
        console.log(
          `[dry-run] Translate security pattern: ${item.from} -> ${item.to}`,
        );
      }
    }
    if (hasLegacySurfaceKeys) {
      console.log(
        "[dry-run] Remove deprecated keys: operations.dynamicToolSurface.mode, operations.dynamicToolSurface.naming",
      );
    }
    if (securityMigration.report.unresolved.length > 0) {
      for (const unresolved of securityMigration.report.unresolved) {
        console.warn(
          `[dry-run] Unresolved security pattern '${unresolved.pattern}': ${unresolved.reason}`,
        );
      }
    }
    return;
  }

  await saveConfig(discovered.path, securityMigration.config);
  console.log(`Updated ${discovered.path}`);
  if (codeSearchMigration.changed) {
    console.log(
      'Set operations.findTools.preferredNamespacesByIntent.codeSearch = ["auggie", "ctxdb"]',
    );
  }
  for (const item of securityMigration.report.translated) {
    console.log(`Translated security pattern: ${item.from} -> ${item.to}`);
  }
  if (hasLegacySurfaceKeys) {
    console.log(
      "Removed deprecated keys: operations.dynamicToolSurface.mode, operations.dynamicToolSurface.naming",
    );
  }
  for (const unresolved of securityMigration.report.unresolved) {
    console.warn(
      `Unresolved security pattern '${unresolved.pattern}': ${unresolved.reason}. Please review manually.`,
    );
  }
}
