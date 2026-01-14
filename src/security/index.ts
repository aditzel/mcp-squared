/**
 * Security utilities for MCP²
 *
 * This module provides sanitization and policy enforcement for
 * tool descriptions and execution requests from upstream MCP servers.
 */

export {
  containsSuspiciousPatterns,
  getDefaultInjectionPatterns,
  sanitizeDescription,
  sanitizeToolName,
} from "./sanitize.js";
export type { SanitizeOptions } from "./sanitize.js";

export {
  clearPendingConfirmations,
  createConfirmationToken,
  evaluatePolicy,
  getPendingConfirmationCount,
  matchesPattern,
  validateConfirmationToken,
} from "./policy.js";
export type { PolicyContext, PolicyDecision, PolicyResult } from "./policy.js";
