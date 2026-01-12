/**
 * Policy evaluation for tool execution gates.
 *
 * Implements allow/block/confirm patterns with precedence:
 * Block > Confirm > Allow > Deny
 */

import type { McpSquaredConfig } from "../config/schema.js";

export type PolicyDecision = "allow" | "block" | "confirm";

export interface PolicyContext {
  serverKey: string;
  toolName: string;
  confirmationToken?: string | undefined;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
  /** Token required for confirmation flow (only set when decision is "confirm") */
  confirmationToken?: string;
}

interface PendingConfirmation {
  serverKey: string;
  toolName: string;
  createdAt: number;
}

const CONFIRMATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory store for pending confirmations
const pendingConfirmations = new Map<string, PendingConfirmation>();

/**
 * Match a pattern against a server key and tool name.
 * Patterns use glob-style wildcards:
 * - "*:*" matches all tools on all servers
 * - "fs:*" matches all tools on server "fs"
 * - "*:file_write" matches tool "file_write" on any server
 * - "fs:file_write" matches exact tool on exact server
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
 * Check if any pattern in the list matches the given server and tool.
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
  serverKey: string,
  toolName: string,
): boolean {
  cleanupExpiredTokens();

  const confirmation = pendingConfirmations.get(token);
  if (!confirmation) {
    return false;
  }

  // Check if token matches the expected context
  if (
    confirmation.serverKey !== serverKey ||
    confirmation.toolName !== toolName
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
  serverKey: string,
  toolName: string,
): string {
  cleanupExpiredTokens();

  const token = generateToken();
  pendingConfirmations.set(token, {
    serverKey,
    toolName,
    createdAt: Date.now(),
  });

  return token;
}

/**
 * Evaluate the execution policy for a tool.
 *
 * Precedence: Block > Confirm > Allow > Deny
 *
 * @param context - The execution context (server, tool, optional confirmation token)
 * @param config - The MCP² configuration
 * @returns Policy decision with reason
 */
export function evaluatePolicy(
  context: PolicyContext,
  config: McpSquaredConfig,
): PolicyResult {
  const { serverKey, toolName, confirmationToken } = context;
  const { block, confirm, allow } = config.security.tools;

  // 1. Check block list (highest priority)
  if (matchesAnyPattern(block, serverKey, toolName)) {
    return {
      decision: "block",
      reason: `Tool "${toolName}" on server "${serverKey}" is blocked by security policy`,
    };
  }

  // 2. Check confirm list
  if (matchesAnyPattern(confirm, serverKey, toolName)) {
    // If a valid confirmation token is provided, allow execution
    if (
      confirmationToken &&
      validateConfirmationToken(confirmationToken, serverKey, toolName)
    ) {
      return {
        decision: "allow",
        reason: `Tool "${toolName}" confirmed with valid token`,
      };
    }

    // Generate a new confirmation token
    const token = createConfirmationToken(serverKey, toolName);
    return {
      decision: "confirm",
      reason: `Tool "${toolName}" on server "${serverKey}" requires confirmation`,
      confirmationToken: token,
    };
  }

  // 3. Check allow list
  if (matchesAnyPattern(allow, serverKey, toolName)) {
    return {
      decision: "allow",
      reason: `Tool "${toolName}" is allowed by security policy`,
    };
  }

  // 4. Deny by default (not in allow list)
  return {
    decision: "block",
    reason: `Tool "${toolName}" on server "${serverKey}" is not in the allow list`,
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
 * Get tool visibility for discovery operations.
 *
 * Unlike evaluatePolicy (which is for execution), this determines:
 * - Whether a tool should appear in find_tools/describe_tools results
 * - Whether the tool will require confirmation when executed
 *
 * Precedence: Block > Confirm > Allow > Deny (implicit)
 *
 * @param serverKey - The upstream server key
 * @param toolName - The tool name
 * @param config - The MCP² configuration
 * @returns Visibility result with visible and requiresConfirmation flags
 */
export function getToolVisibility(
  serverKey: string,
  toolName: string,
  config: McpSquaredConfig,
): ToolVisibility {
  const { block, confirm, allow } = config.security.tools;
  return getToolVisibilityFromPatterns(serverKey, toolName, block, confirm, allow);
}

/**
 * Get tool visibility using pre-compiled policy (for batch operations).
 *
 * @param serverKey - The upstream server key
 * @param toolName - The tool name
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

  // 2. Confirm-list tools are visible but marked
  if (matchesAnyPattern(confirm, serverKey, toolName)) {
    return { visible: true, requiresConfirmation: true };
  }

  // 3. Allow-list tools are visible
  if (matchesAnyPattern(allow, serverKey, toolName)) {
    return { visible: true, requiresConfirmation: false };
  }

  // 4. Not in allow list = not visible (implicit deny)
  return { visible: false, requiresConfirmation: false };
}
