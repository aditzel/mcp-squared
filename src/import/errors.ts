/**
 * Import-specific error classes.
 *
 * This module defines error types for the MCP configuration import feature,
 * providing structured error handling with detailed context.
 *
 * @module import/errors
 */

import type { ImportConflict, ToolId } from "./types.js";

/**
 * Base error class for import operations.
 * All import errors extend this class.
 */
export class ImportError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ImportError";

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error during configuration discovery.
 * Thrown when a config file cannot be found or accessed.
 */
export class ImportDiscoveryError extends ImportError {
  constructor(
    public readonly tool: ToolId,
    public readonly path: string,
    cause?: unknown,
  ) {
    super(`Failed to discover config for ${tool} at ${path}`, cause);
    this.name = "ImportDiscoveryError";
  }
}

/**
 * Error during configuration parsing.
 * Thrown when a config file cannot be parsed as valid JSON
 * or doesn't match the expected format.
 */
export class ImportParseError extends ImportError {
  constructor(
    public readonly path: string,
    public readonly tool?: ToolId,
    cause?: unknown,
  ) {
    const toolInfo = tool ? ` (${tool})` : "";
    super(`Failed to parse config file${toolInfo}: ${path}`, cause);
    this.name = "ImportParseError";
  }
}

/**
 * Error during configuration validation.
 * Thrown when a parsed server config doesn't meet requirements.
 */
export class ImportValidationError extends ImportError {
  constructor(
    public readonly tool: ToolId,
    public readonly serverName: string,
    public readonly issues: string[],
  ) {
    const issueList = issues.join(", ");
    super(`Invalid server config "${serverName}" from ${tool}: ${issueList}`);
    this.name = "ImportValidationError";
  }
}

/**
 * Error during configuration merge.
 * Thrown when conflicts cannot be resolved or merge fails.
 */
export class ImportMergeError extends ImportError {
  constructor(
    message: string,
    public readonly conflicts: ImportConflict[],
  ) {
    super(message);
    this.name = "ImportMergeError";
  }
}

/**
 * Error during configuration write.
 * Thrown when the merged config cannot be written to disk.
 */
export class ImportWriteError extends ImportError {
  constructor(
    public readonly targetPath: string,
    cause?: unknown,
  ) {
    super(`Failed to write config to ${targetPath}`, cause);
    this.name = "ImportWriteError";
  }
}

/**
 * Error when user cancels an interactive operation.
 * Not necessarily an error condition, but signals abort.
 */
export class ImportCancelledError extends ImportError {
  constructor(message = "Import cancelled by user") {
    super(message);
    this.name = "ImportCancelledError";
  }
}

/**
 * Error when a tool parser is not found.
 * Thrown when trying to import from an unsupported tool.
 */
export class ImportParserNotFoundError extends ImportError {
  constructor(public readonly tool: ToolId) {
    super(`No parser available for tool: ${tool}`);
    this.name = "ImportParserNotFoundError";
  }
}

/**
 * Type guard to check if an error is an ImportError.
 */
export function isImportError(error: unknown): error is ImportError {
  return error instanceof ImportError;
}

/**
 * Formats an ImportError for CLI display.
 * Returns a user-friendly error message.
 */
export function formatImportError(error: ImportError): string {
  const lines: string[] = [`Error: ${error.message}`];

  if (error instanceof ImportDiscoveryError) {
    lines.push(`  Tool: ${error.tool}`);
    lines.push(`  Path: ${error.path}`);
  } else if (error instanceof ImportParseError) {
    lines.push(`  Path: ${error.path}`);
    if (error.tool) {
      lines.push(`  Tool: ${error.tool}`);
    }
  } else if (error instanceof ImportValidationError) {
    lines.push(`  Tool: ${error.tool}`);
    lines.push(`  Server: ${error.serverName}`);
    lines.push("  Issues:");
    for (const issue of error.issues) {
      lines.push(`    - ${issue}`);
    }
  } else if (error instanceof ImportMergeError) {
    lines.push(`  Conflicts: ${error.conflicts.length}`);
    for (const conflict of error.conflicts.slice(0, 3)) {
      lines.push(`    - ${conflict.serverName} (from ${conflict.sourceTool})`);
    }
    if (error.conflicts.length > 3) {
      lines.push(`    ... and ${error.conflicts.length - 3} more`);
    }
  } else if (error instanceof ImportWriteError) {
    lines.push(`  Target: ${error.targetPath}`);
  }

  if (error.cause instanceof Error) {
    lines.push(`  Cause: ${error.cause.message}`);
  }

  return lines.join("\n");
}
