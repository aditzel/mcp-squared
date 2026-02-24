/**
 * Security utilities for MCP²
 *
 * This module provides sanitization and policy enforcement for
 * tool descriptions and execution requests from upstream MCP servers.
 */

export type {
  CompiledPolicy,
  PolicyContext,
  PolicyDecision,
  PolicyResult,
  ToolVisibility,
} from "./policy.js";
export {
  clearPendingConfirmations,
  compilePolicy,
  createConfirmationToken,
  evaluatePolicy,
  getPendingConfirmationCount,
  getToolVisibility,
  getToolVisibilityCompiled,
  matchesPattern,
  validateConfirmationToken,
} from "./policy.js";
export type { SanitizeOptions } from "./sanitize.js";
export {
  containsSuspiciousPatterns,
  getDefaultInjectionPatterns,
  sanitizeDescription,
  sanitizeToolName,
} from "./sanitize.js";
