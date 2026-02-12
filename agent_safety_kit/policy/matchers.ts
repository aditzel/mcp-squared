import type { PolicyRule } from "./schema.js";

const GLOB_SPECIALS = /[.+^${}()|[\]\\]/g;
const PATH_KEY_RE = /(path|file|dir|cwd|workspace|root)/i;
const DOMAIN_KEY_RE = /(url|uri|endpoint|domain|host)/i;
const COMMAND_KEY_RE = /(command|cmd|script|shell)/i;
const PATCH_KEY_RE = /(patch|diff|changes?|content)/i;

function escapeRegex(value: string): string {
  return value.replace(GLOB_SPECIALS, "\\$&");
}

export function globToRegExp(pattern: string): RegExp {
  const escaped = escapeRegex(pattern).replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function matchesGlob(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

export function matchesAnyGlob(patterns: string[], value: string): boolean {
  return patterns.some((pattern) => matchesGlob(pattern, value));
}

export function patternSpecificity(pattern: string): number {
  return pattern.replace(/[\*\?]/g, "").length;
}

export function pickMostSpecificRule(
  rules: PolicyRule[],
  context: { agent: string; tool: string; action: string },
): PolicyRule | undefined {
  let best: { rule: PolicyRule; score: number } | undefined;

  for (const rule of rules) {
    const agentMatches = matchesGlob(rule.agent, context.agent);
    const toolMatches = matchesGlob(rule.tool, context.tool);
    const actionMatches = matchesGlob(rule.action, context.action);

    if (!agentMatches || !toolMatches || !actionMatches) {
      continue;
    }

    const score =
      patternSpecificity(rule.agent) +
      patternSpecificity(rule.tool) +
      patternSpecificity(rule.action);

    if (!best || score > best.score) {
      best = { rule, score };
    }
  }

  return best?.rule;
}

function collectStringValues(
  value: unknown,
  keyMatcher: RegExp,
  output: string[],
  seen: WeakSet<object>,
  currentKey = "",
): void {
  if (typeof value === "string") {
    if (currentKey === "" || keyMatcher.test(currentKey)) {
      output.push(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, keyMatcher, output, seen, currentKey);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) {
    return;
  }

  seen.add(obj);

  for (const [key, nested] of Object.entries(obj)) {
    collectStringValues(nested, keyMatcher, output, seen, key);

    if (keyMatcher.test(key)) {
      if (typeof nested === "string") {
        output.push(nested);
      }
      if (Array.isArray(nested)) {
        for (const item of nested) {
          if (typeof item === "string") {
            output.push(item);
          }
        }
      }
    }

    if (
      COMMAND_KEY_RE.test(key) &&
      nested &&
      typeof nested === "object" &&
      !Array.isArray(nested)
    ) {
      const commandObj = nested as Record<string, unknown>;
      const commandValue = commandObj["command"];
      const argsValue = commandObj["args"];
      if (typeof commandValue === "string") {
        if (Array.isArray(argsValue)) {
          const argsJoined = argsValue
            .filter((arg): arg is string => typeof arg === "string")
            .join(" ");
          output.push(
            argsJoined.length > 0
              ? `${commandValue} ${argsJoined}`
              : commandValue,
          );
        } else {
          output.push(commandValue);
        }
      }
    }
  }
}

function parseDomain(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate) {
    return undefined;
  }

  try {
    const url = new URL(candidate);
    return url.hostname.toLowerCase();
  } catch {
    // continue with fallbacks
  }

  const normalized = candidate
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();

  if (/^[a-z0-9.-]+$/.test(normalized) && normalized.includes(".")) {
    return normalized;
  }

  return undefined;
}

export function extractPathCandidates(params: unknown): string[] {
  const values: string[] = [];
  collectStringValues(params, PATH_KEY_RE, values, new WeakSet<object>());
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

export function extractDomainCandidates(params: unknown): string[] {
  const values: string[] = [];
  collectStringValues(params, DOMAIN_KEY_RE, values, new WeakSet<object>());
  const domains = values
    .map((value) => parseDomain(value))
    .filter((value): value is string => value !== undefined);
  return Array.from(new Set(domains));
}

export function extractCommandCandidates(params: unknown): string[] {
  const values: string[] = [];
  collectStringValues(params, COMMAND_KEY_RE, values, new WeakSet<object>());
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

export function estimatePatchSizeBytes(params: unknown): number {
  const values: string[] = [];
  collectStringValues(params, PATCH_KEY_RE, values, new WeakSet<object>());

  if (typeof params === "string") {
    values.push(params);
  }

  if (values.length === 0) {
    return 0;
  }

  return values.reduce((max, value) => {
    const size = Buffer.byteLength(value, "utf8");
    return Math.max(max, size);
  }, 0);
}

export function valuesConstrainedByGlob(
  values: string[],
  allowlist: string[],
): boolean {
  return values.every((value) => matchesAnyGlob(allowlist, value));
}
