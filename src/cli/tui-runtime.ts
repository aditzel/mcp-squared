function hasMissingModuleErrorCode(error: { code?: unknown }): boolean {
  const code = error.code;
  return code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
}

function hasMissingModuleMessage(message: string): boolean {
  return (
    message.includes("Cannot find module") ||
    message.includes("Cannot find package")
  );
}

function containsOpentuiMarker(message: string): boolean {
  const lowercaseMessage = message.toLowerCase();
  return (
    lowercaseMessage.includes("@opentui") ||
    lowercaseMessage.includes("opentui")
  );
}

export function isTuiModuleNotFoundError(error: unknown): boolean {
  const cause =
    error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  if (
    cause !== undefined &&
    cause !== error &&
    isTuiModuleNotFoundError(cause)
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  const hasMissingModule =
    hasMissingModuleMessage(message) ||
    hasMissingModuleErrorCode(error as { code?: unknown });
  const hasOpentuiMarker = containsOpentuiMarker(message);

  return hasMissingModule && hasOpentuiMarker;
}

export function printTuiUnavailableError(command: string): void {
  console.error(
    `Error: The '${command}' command requires the TUI runtime (@opentui/core),`,
  );
  console.error("which is not available in this environment.");
  console.error("");
  console.error("To use TUI commands, run mcp-squared via bun:");
  console.error(`  bunx mcp-squared ${command}`);
  console.error("  # or");
  console.error(`  bun run src/index.ts ${command}`);
}
