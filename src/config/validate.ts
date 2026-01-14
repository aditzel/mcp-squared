/**
 * Configuration validation utilities.
 *
 * Provides validation functions that go beyond schema validation
 * to catch configurations that are technically valid but will fail at runtime.
 *
 * @module config/validate
 */

import type {
  McpSquaredConfig,
  UpstreamServerConfig,
  UpstreamStdioServerConfig,
} from "./schema.js";

/**
 * Validation issue severity levels.
 */
export type ValidationSeverity = "error" | "warning";

/**
 * A validation issue found in the configuration.
 */
export interface ValidationIssue {
  /** Severity of the issue */
  severity: ValidationSeverity;
  /** Name of the upstream with the issue */
  upstream: string;
  /** Human-readable description of the issue */
  message: string;
  /** Suggestion for how to fix the issue */
  suggestion?: string;
}

/**
 * Commands that require arguments to function properly.
 * Running these with empty args typically causes them to read from stdin
 * or show help, neither of which works for MCP servers.
 */
const COMMANDS_REQUIRING_ARGS = new Set([
  "npx",
  "npm",
  "bunx",
  "bun",
  "pnpx",
  "yarn",
  "node",
  "deno",
  "python",
  "python3",
  "uvx",
  "uv",
]);

/**
 * Validates a single stdio upstream configuration.
 *
 * @param name - Name of the upstream
 * @param config - Stdio upstream configuration
 * @returns Array of validation issues found
 */
export function validateStdioUpstream(
  name: string,
  config: UpstreamStdioServerConfig,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { command, args } = config.stdio;

  // Check for commands that require args but have empty args
  const commandBase = command.split("/").pop() ?? command;
  if (COMMANDS_REQUIRING_ARGS.has(commandBase) && args.length === 0) {
    issues.push({
      severity: "error",
      upstream: name,
      message: `Command '${command}' requires arguments but args is empty`,
      suggestion: `Add the package/script to run, e.g., args = ["-y", "package-name"]`,
    });
  }

  // Check for bash/sh with empty args (likely misconfigured)
  if ((commandBase === "bash" || commandBase === "sh") && args.length === 0) {
    issues.push({
      severity: "error",
      upstream: name,
      message: `Command '${command}' with empty args will read from stdin, not run an MCP server`,
      suggestion: `Add a script to run, e.g., args = ["-c", "your-command"]`,
    });
  }

  // Check for docker with empty args
  if (commandBase === "docker" && args.length === 0) {
    issues.push({
      severity: "error",
      upstream: name,
      message: `Command 'docker' requires arguments to run a container`,
      suggestion: `Add docker subcommand and image, e.g., args = ["run", "-i", "image-name"]`,
    });
  }

  return issues;
}

/**
 * Validates a single upstream configuration.
 *
 * @param name - Name of the upstream
 * @param config - Upstream configuration
 * @returns Array of validation issues found
 */
export function validateUpstreamConfig(
  name: string,
  config: UpstreamServerConfig,
): ValidationIssue[] {
  if (config.transport === "stdio") {
    return validateStdioUpstream(name, config);
  }
  // SSE upstreams don't have these issues
  return [];
}

/**
 * Validates an entire configuration for runtime issues.
 *
 * @param config - Complete MCP² configuration
 * @returns Array of validation issues found
 */
export function validateConfig(config: McpSquaredConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [name, upstream] of Object.entries(config.upstreams)) {
    // Skip disabled upstreams
    if (!upstream.enabled) continue;

    issues.push(...validateUpstreamConfig(name, upstream));
  }

  return issues;
}

/**
 * Formats validation issues for display.
 *
 * @param issues - Array of validation issues
 * @returns Formatted string for display
 */
export function formatValidationIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) return "";

  const lines: string[] = [];
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  if (errors.length > 0) {
    lines.push(`\n\x1b[31mConfiguration Errors:\x1b[0m`);
    for (const error of errors) {
      lines.push(`  \x1b[31m✗\x1b[0m ${error.upstream}: ${error.message}`);
      if (error.suggestion) {
        lines.push(`    \x1b[90m→ ${error.suggestion}\x1b[0m`);
      }
    }
  }

  if (warnings.length > 0) {
    lines.push(`\n\x1b[33mConfiguration Warnings:\x1b[0m`);
    for (const warning of warnings) {
      lines.push(`  \x1b[33m⚠\x1b[0m ${warning.upstream}: ${warning.message}`);
      if (warning.suggestion) {
        lines.push(`    \x1b[90m→ ${warning.suggestion}\x1b[0m`);
      }
    }
  }

  return lines.join("\n");
}
