/**
 * Sanitization utilities for tool descriptions and other untrusted input
 * from upstream MCP servers.
 */

export interface SanitizeOptions {
  maxLength?: number;
  stripPatterns?: RegExp[];
  normalizeWhitespace?: boolean;
}

const DEFAULT_MAX_LENGTH = 2000;

/**
 * Patterns that indicate potential prompt injection attempts.
 * These are stripped from tool descriptions to prevent LLM manipulation.
 */
const DEFAULT_INJECTION_PATTERNS: RegExp[] = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?previous\s+instructions?/gi,
  /disregard\s+(all\s+)?previous/gi,
  /forget\s+(everything|all|what)\s+(you('ve)?|i)\s+(said|told|learned)/gi,
  /override\s+(all\s+)?(previous\s+)?instructions?/gi,

  // Role/persona manipulation
  /you\s+are\s+(now\s+)?(a|an|the)\s+\w+/gi,
  /act\s+as\s+(a|an|the)?\s*\w+/gi,
  /pretend\s+(to\s+be|you('re)?)\s+/gi,
  /your\s+new\s+(role|persona|identity)/gi,
  /from\s+now\s+on\s+(you|act|behave)/gi,

  // System prompt extraction attempts
  /show\s+(me\s+)?(your\s+)?(system\s+)?prompt/gi,
  /print\s+(your\s+)?instructions/gi,
  /reveal\s+(your\s+)?configuration/gi,
  /what\s+(are|is)\s+your\s+(system\s+)?(prompt|instructions)/gi,
  /repeat\s+(your\s+)?(system\s+)?prompt/gi,

  // Jailbreak markers
  /developer\s+mode/gi,
  /\bdan\s+mode\b/gi,
  /\bdeveloper\s+override\b/gi,

  // Fake system/admin markers (commonly used in injections)
  /\[system\]/gi,
  /\[admin\]/gi,
  /\[assistant\]/gi,
  /\[user\]/gi,
  /<<\s*system\s*>>/gi,
  /<<\s*admin\s*>>/gi,

  // Encoding/obfuscation markers
  /base64[:\s]/gi,
  /decode\s+this/gi,
  /execute\s+the\s+following/gi,
];

/**
 * Sanitize a tool description to prevent prompt injection attacks.
 *
 * @param description - The raw description from an upstream server
 * @param options - Sanitization options
 * @returns Sanitized description or undefined if input was undefined/null
 */
export function sanitizeDescription(
  description: string | undefined | null,
  options: SanitizeOptions = {},
): string | undefined {
  if (description === undefined || description === null) {
    return undefined;
  }

  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const patterns = options.stripPatterns ?? DEFAULT_INJECTION_PATTERNS;
  const normalizeWs = options.normalizeWhitespace ?? true;

  let sanitized = description;

  // 1. Normalize unicode to NFC form for consistent matching
  sanitized = sanitized.normalize("NFC");

  // 2. Strip null bytes and control characters (except newlines/tabs)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control chars for security
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 3. Strip injection patterns, replacing with [REDACTED]
  for (const pattern of patterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }

  // 4. Normalize whitespace if enabled
  if (normalizeWs) {
    // Collapse multiple spaces/newlines but preserve single newlines for formatting
    sanitized = sanitized
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // 5. Length limit with ellipsis
  if (sanitized.length > maxLength) {
    sanitized = `${sanitized.slice(0, maxLength - 3)}...`;
  }

  return sanitized;
}

/**
 * Check if a description contains suspicious patterns that may indicate
 * prompt injection attempts. Does not modify the input.
 *
 * @param description - The description to check
 * @returns true if suspicious patterns were detected
 */
export function containsSuspiciousPatterns(description: string): boolean {
  for (const pattern of DEFAULT_INJECTION_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(description)) {
      return true;
    }
  }
  return false;
}

/**
 * Sanitize a tool name to ensure it contains only safe characters.
 *
 * @param name - The tool name to sanitize
 * @returns Sanitized tool name
 */
export function sanitizeToolName(name: string): string {
  // Keep only alphanumeric, underscore, and hyphen
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 256);
}

/**
 * Get the list of default injection patterns (for testing/debugging).
 */
export function getDefaultInjectionPatterns(): RegExp[] {
  return [...DEFAULT_INJECTION_PATTERNS];
}
