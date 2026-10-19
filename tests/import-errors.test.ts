import { describe, expect, test } from "bun:test";
import {
  formatImportError,
  ImportCancelledError,
  ImportDiscoveryError,
  ImportError,
  ImportMergeError,
  ImportParseError,
  ImportParserNotFoundError,
  ImportValidationError,
  ImportWriteError,
  isImportError,
} from "@/import/errors";
import type { ImportConflict } from "@/import/types";

describe("import diagnostics", () => {
  test("preserves typed context and causes for actionable CLI errors", () => {
    const cause = new Error("permission denied");
    const cases: Array<[ImportError, string[]]> = [
      [
        new ImportDiscoveryError("cursor", "/config.json", cause),
        ["Tool: cursor", "Path: /config.json", "Cause: permission denied"],
      ],
      [
        new ImportParseError("/config.json", "cursor", cause),
        [
          "Failed to parse config file (cursor)",
          "Tool: cursor",
          "Cause: permission denied",
        ],
      ],
      [
        new ImportParseError("/config.json"),
        ["Failed to parse config file: /config.json", "Path: /config.json"],
      ],
      [
        new ImportValidationError("cursor", "worker", [
          "missing command",
          "invalid URL",
        ]),
        ["Server: worker", "- missing command", "- invalid URL"],
      ],
      [
        new ImportWriteError("/out.toml", cause),
        ["Target: /out.toml", "Cause: permission denied"],
      ],
      [new ImportCancelledError(), ["Import cancelled by user"]],
      [
        new ImportCancelledError("explicit cancellation"),
        ["explicit cancellation"],
      ],
      [
        new ImportParserNotFoundError("cursor"),
        ["No parser available for tool: cursor"],
      ],
      [new ImportError("failure", "opaque cause"), ["Error: failure"]],
    ];
    for (const [error, details] of cases) {
      expect(isImportError(error)).toBe(true);
      expect(error).toBeInstanceOf(Error);
      for (const detail of details)
        expect(formatImportError(error)).toContain(detail);
    }
    expect(isImportError(new Error("ordinary"))).toBe(false);
    expect(isImportError(null)).toBe(false);
    expect(
      formatImportError(new ImportParseError("/config.json")),
    ).not.toContain("Tool:");
  });

  test("bounds conflict summaries while retaining total count", () => {
    const conflicts = ["one", "two", "three", "four"].map(
      (serverName) => ({ serverName, sourceTool: "cursor" }) as ImportConflict,
    );
    const output = formatImportError(
      new ImportMergeError("conflicts", conflicts),
    );
    expect(output).toContain("Conflicts: 4");
    expect(output).toContain("three (from cursor)");
    expect(output).toContain("... and 1 more");
    expect(output).not.toContain("four (from cursor)");
    expect(formatImportError(new ImportMergeError("none", []))).toContain(
      "Conflicts: 0",
    );
    expect(
      formatImportError(new ImportMergeError("one", conflicts.slice(0, 1))),
    ).not.toContain("more");
  });
});
