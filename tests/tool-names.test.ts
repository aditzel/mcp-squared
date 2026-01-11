import { describe, expect, test } from "bun:test";
import {
  formatQualifiedName,
  isQualifiedName,
  parseQualifiedName,
} from "../src/utils/tool-names.js";

describe("parseQualifiedName", () => {
  test("parses bare tool name", () => {
    const result = parseQualifiedName("read_file");
    expect(result).toEqual({
      serverKey: null,
      toolName: "read_file",
    });
  });

  test("parses qualified name with server key", () => {
    const result = parseQualifiedName("filesystem:read_file");
    expect(result).toEqual({
      serverKey: "filesystem",
      toolName: "read_file",
    });
  });

  test("handles tool name with multiple colons", () => {
    // Only splits at first colon
    const result = parseQualifiedName("server:tool:with:colons");
    expect(result).toEqual({
      serverKey: "server",
      toolName: "tool:with:colons",
    });
  });

  test("handles empty server key", () => {
    const result = parseQualifiedName(":tool_name");
    expect(result).toEqual({
      serverKey: "",
      toolName: "tool_name",
    });
  });

  test("handles empty tool name", () => {
    const result = parseQualifiedName("server:");
    expect(result).toEqual({
      serverKey: "server",
      toolName: "",
    });
  });
});

describe("formatQualifiedName", () => {
  test("formats server key and tool name", () => {
    expect(formatQualifiedName("filesystem", "read_file")).toBe(
      "filesystem:read_file",
    );
  });

  test("handles special characters", () => {
    expect(formatQualifiedName("my-server", "my_tool")).toBe(
      "my-server:my_tool",
    );
  });
});

describe("isQualifiedName", () => {
  test("returns true for qualified names", () => {
    expect(isQualifiedName("server:tool")).toBe(true);
  });

  test("returns false for bare names", () => {
    expect(isQualifiedName("tool_name")).toBe(false);
  });

  test("returns true for names with multiple colons", () => {
    expect(isQualifiedName("server:tool:extra")).toBe(true);
  });
});
