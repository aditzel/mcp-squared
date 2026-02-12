import type { ObsSink } from "../observability/sinks/base.js";
import type { LoadedPolicy } from "../policy/load.js";
import {
  estimatePatchSizeBytes,
  extractCommandCandidates,
  extractDomainCandidates,
  extractPathCandidates,
  pickMostSpecificRule,
  valuesConstrainedByGlob,
} from "../policy/matchers.js";
import type { PolicyRule } from "../policy/schema.js";
import { PolicyDenied } from "./errors.js";
import { SlidingWindowRateLimiter } from "./ratelimit.js";

const SECRET_KEY_RE = /(token|secret|password|api[_-]?key|authorization)/i;

export interface GuardContext {
  agent: string;
  tool: string;
  action: string;
  params: unknown;
}

export interface GuardDecision {
  allowed: boolean;
  wouldDeny: boolean;
  reportOnly: boolean;
  reason: string;
  violations: string[];
  matchedRule?: PolicyRule;
}

export interface GuardOptions {
  enabled: boolean;
  policy: LoadedPolicy | null;
  sink: ObsSink;
  rateLimiter?: SlidingWindowRateLimiter;
}

function redactionKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

export function redactSecrets(value: unknown, key = "", depth = 0): unknown {
  if (depth > 8) {
    return "[TRUNCATED]";
  }

  if (redactionKey(key)) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, key, depth + 1));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      output[nestedKey] = redactSecrets(nestedValue, nestedKey, depth + 1);
    }
    return output;
  }

  return value;
}

function parseRegex(pattern: string): RegExp | undefined {
  const trimmed = pattern.trim();

  const slashDelimited = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
  if (slashDelimited) {
    try {
      const regexBody = slashDelimited[1] ?? "";
      const regexFlags = slashDelimited[2] ?? "";
      return new RegExp(regexBody, regexFlags);
    } catch {
      return undefined;
    }
  }

  if (trimmed.startsWith("(?i)")) {
    try {
      return new RegExp(trimmed.slice(4), "i");
    } catch {
      return undefined;
    }
  }

  try {
    return new RegExp(trimmed);
  } catch {
    return undefined;
  }
}

export class Guard {
  private readonly enabled: boolean;
  private readonly policy: LoadedPolicy | null;
  private readonly sink: ObsSink;
  private readonly rateLimiter: SlidingWindowRateLimiter;

  constructor(options: GuardOptions) {
    this.enabled = options.enabled;
    this.policy = options.policy;
    this.sink = options.sink;
    this.rateLimiter = options.rateLimiter ?? new SlidingWindowRateLimiter();
  }

  get playbook(): string {
    return this.policy?.playbook ?? "disabled";
  }

  get agentEnv(): string {
    return this.policy?.agentEnv ?? process.env["AGENT_ENV"] ?? "DEV";
  }

  enforce(context: GuardContext): GuardDecision {
    const decision = this.evaluate(context);

    this.sink.emit("policy.decision", {
      agent: context.agent,
      tool: context.tool,
      action: context.action,
      allowed: decision.allowed,
      would_deny: decision.wouldDeny,
      report_only: decision.reportOnly,
      reason: decision.reason,
      violations: decision.violations,
      params: redactSecrets(context.params),
      playbook: this.policy?.playbook,
      policy_path: this.policy?.sourcePath,
      rule: decision.matchedRule,
    });

    if (decision.wouldDeny && !decision.reportOnly) {
      throw new PolicyDenied(decision.reason, decision);
    }

    return decision;
  }

  private evaluate(context: GuardContext): GuardDecision {
    if (!this.enabled) {
      return {
        allowed: true,
        wouldDeny: false,
        reportOnly: true,
        reason: "Agent safety kit disabled",
        violations: [],
      };
    }

    if (!this.policy) {
      return {
        allowed: true,
        wouldDeny: false,
        reportOnly: true,
        reason: "No policy loaded",
        violations: [],
      };
    }

    const matchedRule = pickMostSpecificRule(this.policy.rules, {
      agent: context.agent,
      tool: context.tool,
      action: context.action,
    });

    const violations: string[] = [];

    if (!matchedRule) {
      if (this.policy.denyByDefault) {
        violations.push(
          `No policy rule matched ${context.agent}:${context.tool}:${context.action}`,
        );
      }
    } else {
      this.evaluateRule(context, matchedRule, violations);
    }

    const wouldDeny = violations.length > 0;
    const reportOnly = this.policy.reportOnly;
    const reason =
      violations.length > 0
        ? violations.join("; ")
        : matchedRule
          ? `Allowed by rule ${matchedRule.agent}:${matchedRule.tool}:${matchedRule.action}`
          : "Allowed (no matching rule and deny_by_default disabled)";

    return {
      allowed: !wouldDeny || reportOnly,
      wouldDeny,
      reportOnly,
      reason,
      violations,
      ...(matchedRule ? { matchedRule } : {}),
    };
  }

  private evaluateRule(
    context: GuardContext,
    rule: PolicyRule,
    violations: string[],
  ): void {
    const paths = extractPathCandidates(context.params);
    if (rule.paths_allow && paths.length > 0) {
      const pathsAllowed = valuesConstrainedByGlob(paths, rule.paths_allow);
      if (!pathsAllowed) {
        violations.push("One or more paths violate paths_allow");
      }
    }

    const domains = extractDomainCandidates(context.params);
    if (rule.domains_allow && domains.length > 0) {
      const domainsAllowed = valuesConstrainedByGlob(
        domains,
        rule.domains_allow,
      );
      if (!domainsAllowed) {
        violations.push("One or more domains violate domains_allow");
      }
    }

    const commands = extractCommandCandidates(context.params);
    if (rule.allowlist_cmd_prefix && commands.length > 0) {
      const commandAllowed = commands.every((command) =>
        rule.allowlist_cmd_prefix?.some((prefix) => command.startsWith(prefix)),
      );
      if (!commandAllowed) {
        violations.push("Command does not match allowlist_cmd_prefix");
      }
    }

    if (rule.denylist_cmd_regex && commands.length > 0) {
      const patterns = rule.denylist_cmd_regex
        .map(parseRegex)
        .filter((regex): regex is RegExp => regex !== undefined);

      const denied = commands.some((command) =>
        patterns.some((regex) => regex.test(command)),
      );

      if (denied) {
        violations.push("Command matched denylist_cmd_regex");
      }
    }

    if (rule.rate_limit_per_min) {
      const key = `${context.agent}:${context.tool}:${context.action}`;
      const rate = this.rateLimiter.check(key, rule.rate_limit_per_min);
      if (!rate.allowed) {
        violations.push(
          `Rate limit exceeded (${rule.rate_limit_per_min}/min, retry in ${rate.retryAfterMs}ms)`,
        );
      }
    }

    if (rule.max_patch_size_bytes) {
      const patchBytes = estimatePatchSizeBytes(context.params);
      if (patchBytes > rule.max_patch_size_bytes) {
        violations.push(
          `Patch payload exceeds max_patch_size_bytes (${patchBytes} > ${rule.max_patch_size_bytes})`,
        );
      }
    }
  }
}
