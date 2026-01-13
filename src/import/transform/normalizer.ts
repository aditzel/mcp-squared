/**
 * Server name normalization and deduplication utilities.
 *
 * Ensures server names are valid TOML keys and handles
 * automatic renaming for conflict resolution.
 *
 * @module import/transform/normalizer
 */

/**
 * Valid TOML key pattern.
 * Must start with letter/underscore, followed by letters/digits/underscores/hyphens.
 */
const VALID_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

/**
 * Checks if a server name is a valid TOML key.
 *
 * @param name - Server name to check
 * @returns true if valid
 */
export function isValidServerName(name: string): boolean {
  return VALID_KEY_PATTERN.test(name) && name.length > 0 && name.length <= 64;
}

/**
 * Normalizes a server name to a valid TOML key.
 *
 * Transformations applied:
 * - Convert to lowercase
 * - Replace spaces and dots with hyphens
 * - Remove invalid characters
 * - Ensure starts with letter (prefix with 's-' if needed)
 * - Truncate to 64 characters
 *
 * @param name - Original server name
 * @returns Normalized name
 */
export function normalizeServerName(name: string): string {
  // Start with lowercase
  let normalized = name.toLowerCase();

  // Replace spaces and dots with hyphens
  normalized = normalized.replace(/[\s.]+/g, "-");

  // Remove invalid characters (keep letters, digits, underscores, hyphens)
  normalized = normalized.replace(/[^a-z0-9_-]/g, "");

  // Collapse multiple hyphens
  normalized = normalized.replace(/-+/g, "-");

  // Remove leading/trailing hyphens
  normalized = normalized.replace(/^-+|-+$/g, "");

  // Ensure starts with letter or underscore
  if (normalized.length === 0) {
    normalized = "server";
  } else if (/^[0-9-]/.test(normalized)) {
    normalized = `s-${normalized}`;
  }

  // Truncate to max length
  if (normalized.length > 64) {
    normalized = normalized.slice(0, 64);
    // Remove trailing hyphen if truncation created one
    normalized = normalized.replace(/-+$/, "");
  }

  return normalized;
}

/**
 * Generates a unique name by appending a numeric suffix.
 *
 * @param baseName - Base server name
 * @param existingNames - Set of names already in use
 * @returns Unique name (e.g., "github-2", "github-3")
 */
export function generateUniqueName(
  baseName: string,
  existingNames: Set<string>,
): string {
  // If base name doesn't exist, use it directly
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  // Find next available suffix
  let counter = 2;
  let candidate = `${baseName}-${counter}`;

  while (existingNames.has(candidate)) {
    counter++;
    candidate = `${baseName}-${counter}`;

    // Safety limit
    if (counter > 1000) {
      throw new Error(`Could not generate unique name for "${baseName}"`);
    }
  }

  return candidate;
}

/**
 * Normalizes and deduplicates a list of server names.
 *
 * @param names - Original server names
 * @param existingNames - Names already in use (for conflict detection)
 * @returns Map from original name to normalized unique name
 */
export function normalizeServerNames(
  names: string[],
  existingNames: Set<string> = new Set(),
): Map<string, string> {
  const result = new Map<string, string>();
  const usedNames = new Set(existingNames);

  for (const name of names) {
    // First normalize the name
    const normalized = normalizeServerName(name);

    // Then make it unique
    const unique = generateUniqueName(normalized, usedNames);

    result.set(name, unique);
    usedNames.add(unique);
  }

  return result;
}

/**
 * Checks if a name would conflict with existing names.
 *
 * @param name - Name to check
 * @param existingNames - Set of existing names
 * @returns true if conflict exists
 */
export function hasConflict(name: string, existingNames: Set<string>): boolean {
  const normalized = normalizeServerName(name);
  return existingNames.has(normalized);
}

/**
 * Strips numeric suffix from a name to get the base name.
 * Used for detecting related names (e.g., "github-2" -> "github").
 *
 * @param name - Name potentially with suffix
 * @returns Base name without numeric suffix
 */
export function getBaseName(name: string): string {
  // Match trailing -N where N is 2+
  const match = name.match(/^(.+)-(\d+)$/);
  if (match?.[1] && match[2]) {
    const num = Number.parseInt(match[2], 10);
    if (num >= 2) {
      return match[1];
    }
  }
  return name;
}
