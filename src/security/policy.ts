/**
 * Policy evaluation for tool execution gates.
 *
 * Implements allow/block/confirm patterns with precedence:
 * Block > Allow > Confirm > Deny
 */

import type { McpSquaredConfig } from "../config/schema.js";

export type PolicyDecision = "allow" | "block" | "confirm";

export interface PolicyContext {
  /** Preferred fields for capability-first routing. */
  capability?: string;
  action?: string;
  /** Legacy aliases retained for compatibility with existing callers/tests. */
  serverKey?: string;
  toolName?: string;
  confirmationToken?: string | undefined;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
  /** Token required for confirmation flow (only set when decision is "confirm") */
  confirmationToken?: string;
}

interface PendingConfirmation {
  capability: string;
  action: string;
  createdAt: number;
}

const CONFIRMATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory store for pending confirmations
const pendingConfirmations = new Map<string, PendingConfirmation>();

/**
 * Match a pattern against a scope and action key.
 * Patterns use glob-style wildcards:
 * - "*:*" matches all actions on all scopes
 * - "code_search:*" matches all actions in the code_search capability
 * - "*:codebase_retrieval" matches an action on any capability
 * - "code_search:codebase_retrieval" matches exact capability+action
 */
export function matchesPattern(
  pattern: string,
  serverKey: string,
  toolName: string,
): boolean {
  const [patternServer, patternTool] = pattern.split(":", 2);

  if (!patternServer || !patternTool) {
    // Invalid pattern format
    return false;
  }

  const serverMatches = patternServer === "*" || patternServer === serverKey;
  const toolMatches = patternTool === "*" || patternTool === toolName;

  return serverMatches && toolMatches;
}

/**
 * Check if any pattern in the list matches the given scope/action pair.
 */
function matchesAnyPattern(
  patterns: string[],
  serverKey: string,
  toolName: string,
): boolean {
  return patterns.some((pattern) =>
    matchesPattern(pattern, serverKey, toolName),
  );
}

/**
 * Generate a secure confirmation token.
 */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Clean up expired confirmation tokens.
 */
function cleanupExpiredTokens(): void {
  const now = Date.now();
  for (const [token, confirmation] of pendingConfirmations) {
    if (now - confirmation.createdAt > CONFIRMATION_TTL_MS) {
      pendingConfirmations.delete(token);
    }
  }
}

/**
 * Validate a confirmation token.
 */
export function validateConfirmationToken(
  token: string,
  capability: string,
  action: string,
): boolean {
  cleanupExpiredTokens();

  const confirmation = pendingConfirmations.get(token);
  if (!confirmation) {
    return false;
  }

  // Check if token matches the expected context
  if (
    confirmation.capability !== capability ||
    confirmation.action !== action
  ) {
    return false;
  }

  // Token is valid, remove it (one-time use)
  pendingConfirmations.delete(token);
  return true;
}

/**
 * Create a pending confirmation and return the token.
 */
export function createConfirmationToken(
  capability: string,
  action: string,
): string {
  cleanupExpiredTokens();

  const token = generateToken();
  pendingConfirmations.set(token, {
    capability,
    action,
    createdAt: Date.now(),
  });

  return token;
}

/**
 * Evaluate the execution policy for a capability action.
 *
 * Precedence: Block > Allow > Confirm > Deny
 *
 * @param context - The execution context (capability/action + optional token)
 * @param config - The MCP² configuration
 * @returns Policy decision with reason
 */
export function evaluatePolicy(
  context: PolicyContext,
  config: McpSquaredConfig,
): PolicyResult {
  const capability = context.capability ?? context.serverKey;
  const action = context.action ?? context.toolName;
  const confirmationToken = context.confirmationToken;
  const { block, confirm, allow } = config.security.tools;

  if (!capability || !action) {
    return {
      decision: "block",
      reason: "Missing capability/action in security policy context",
    };
  }

  // 1. Check block list (highest priority)
  if (matchesAnyPattern(block, capability, action)) {
    return {
      decision: "block",
      reason: `Action "${action}" in capability "${capability}" is blocked by security policy`,
    };
  }

  // 2. Check allow list (explicitly allowed tools bypass confirmation)
  if (matchesAnyPattern(allow, capability, action)) {
    return {
      decision: "allow",
      reason: `Action "${action}" is allowed by security policy`,
    };
  }

  // 3. Check confirm list
  if (matchesAnyPattern(confirm, capability, action)) {
    // If a valid confirmation token is provided, allow execution
    if (
      confirmationToken &&
      validateConfirmationToken(confirmationToken, capability, action)
    ) {
      return {
        decision: "allow",
        reason: `Action "${action}" confirmed with valid token`,
      };
    }

    // Generate a new confirmation token
    const token = createConfirmationToken(capability, action);
    return {
      decision: "confirm",
      reason: `Action "${action}" in capability "${capability}" requires confirmation`,
      confirmationToken: token,
    };
  }

  // 4. Deny by default (not in allow or confirm list)
  return {
    decision: "block",
    reason: `Action "${action}" in capability "${capability}" is not in the allow or confirm list`,
  };
}

/**
 * Get the number of pending confirmations (for testing/debugging).
 */
export function getPendingConfirmationCount(): number {
  cleanupExpiredTokens();
  return pendingConfirmations.size;
}

/**
 * Clear all pending confirmations (for testing).
 */
export function clearPendingConfirmations(): void {
  pendingConfirmations.clear();
}

/**
 * Result of tool visibility check.
 */
export interface ToolVisibility {
  /** Whether the tool should be visible in discovery (find_tools/describe_tools) */
  visible: boolean;
  /** Whether the tool requires confirmation when executed */
  requiresConfirmation: boolean;
}

/**
 * Pre-compiled policy patterns for efficient filtering of multiple tools.
 */
export interface CompiledPolicy {
  blockPatterns: string[];
  confirmPatterns: string[];
  allowPatterns: string[];
}

/**
 * Pre-compile policy patterns for efficient filtering.
 * Use this when filtering many tools to avoid repeated config access.
 *
 * @param config - The MCP² configuration
 * @returns Compiled policy patterns
 */
export function compilePolicy(config: McpSquaredConfig): CompiledPolicy {
  return {
    blockPatterns: config.security.tools.block,
    confirmPatterns: config.security.tools.confirm,
    allowPatterns: config.security.tools.allow,
  };
}

/**
 * Get action visibility for router introspection operations.
 *
 * Unlike evaluatePolicy (which is for execution), this determines:
 * - Whether an action should appear in `__describe_actions`
 * - Whether the action will require confirmation when executed
 *
 * Precedence: Block > Allow > Confirm > Deny (implicit)
 *
 * @param serverKey - Scope key (typically capability ID)
 * @param toolName - Action key
 * @param config - The MCP² configuration
 * @returns Visibility result with visible and requiresConfirmation flags
 */
export function getToolVisibility(
  serverKey: string,
  toolName: string,
  config: McpSquaredConfig,
): ToolVisibility {
  const { block, confirm, allow } = config.security.tools;
  return getToolVisibilityFromPatterns(
    serverKey,
    toolName,
    block,
    confirm,
    allow,
  );
}

/**
 * Get visibility using pre-compiled policy (for batch operations).
 *
 * @param serverKey - Scope key (typically capability ID)
 * @param toolName - Action key
 * @param policy - Pre-compiled policy patterns
 * @returns Visibility result with visible and requiresConfirmation flags
 */
export function getToolVisibilityCompiled(
  serverKey: string,
  toolName: string,
  policy: CompiledPolicy,
): ToolVisibility {
  return getToolVisibilityFromPatterns(
    serverKey,
    toolName,
    policy.blockPatterns,
    policy.confirmPatterns,
    policy.allowPatterns,
  );
}

/**
 * Internal helper for visibility checking.
 * @internal
 */
function getToolVisibilityFromPatterns(
  serverKey: string,
  toolName: string,
  block: string[],
  confirm: string[],
  allow: string[],
): ToolVisibility {
  // 1. Blocked tools are not visible
  if (matchesAnyPattern(block, serverKey, toolName)) {
    return { visible: false, requiresConfirmation: false };
  }

  // 2. Allow-list tools are visible (bypass confirmation)
  if (matchesAnyPattern(allow, serverKey, toolName)) {
    return { visible: true, requiresConfirmation: false };
  }

  // 3. Confirm-list tools are visible but marked
  if (matchesAnyPattern(confirm, serverKey, toolName)) {
    return { visible: true, requiresConfirmation: true };
  }

  // 4. Not in allow or confirm list = not visible (implicit deny)
  return { visible: false, requiresConfirmation: false };
}
