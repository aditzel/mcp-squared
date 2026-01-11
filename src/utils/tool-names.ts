/**
 * Utilities for parsing and formatting qualified tool names.
 *
 * Qualified tool names follow the format: `serverKey:toolName`
 * This allows disambiguation when multiple upstream servers
 * expose tools with the same name.
 *
 * @module utils/tool-names
 */

/**
 * Result of parsing a tool name that may be qualified.
 */
export interface ParsedToolName {
  /** Server key if qualified name was provided, null otherwise */
  serverKey: string | null;
  /** The bare tool name */
  toolName: string;
}

/**
 * Parses a tool name that may be qualified with a server key.
 *
 * Qualified format: `serverKey:toolName`
 * Bare format: `toolName`
 *
 * @param input - The tool name to parse (qualified or bare)
 * @returns Parsed result with serverKey (or null) and toolName
 *
 * @example
 * ```ts
 * parseQualifiedName("filesystem:read_file")
 * // { serverKey: "filesystem", toolName: "read_file" }
 *
 * parseQualifiedName("read_file")
 * // { serverKey: null, toolName: "read_file" }
 * ```
 */
export function parseQualifiedName(input: string): ParsedToolName {
  const colonIndex = input.indexOf(":");

  if (colonIndex === -1) {
    // Bare name - no server key
    return {
      serverKey: null,
      toolName: input,
    };
  }

  // Qualified name - split at first colon
  return {
    serverKey: input.slice(0, colonIndex),
    toolName: input.slice(colonIndex + 1),
  };
}

/**
 * Formats a server key and tool name into a qualified name.
 *
 * @param serverKey - The upstream server key
 * @param toolName - The bare tool name
 * @returns Qualified name in format `serverKey:toolName`
 *
 * @example
 * ```ts
 * formatQualifiedName("filesystem", "read_file")
 * // "filesystem:read_file"
 * ```
 */
export function formatQualifiedName(
  serverKey: string,
  toolName: string,
): string {
  return `${serverKey}:${toolName}`;
}

/**
 * Checks if a tool name is qualified (contains a server key).
 *
 * @param input - The tool name to check
 * @returns true if the name contains a colon (is qualified)
 */
export function isQualifiedName(input: string): boolean {
  return input.includes(":");
}
