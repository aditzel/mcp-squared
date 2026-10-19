import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  isTuiModuleNotFoundError,
  printTuiUnavailableError,
} from "@/cli/tui-runtime";

afterEach(() => mock.restore());

describe("TUI runtime diagnostics", () => {
  test("recognizes runtime/package missing errors through causes without hiding unrelated failures", () => {
    for (const error of [
      new Error("Cannot find module '@opentui/core'"),
      "Cannot find package opentui",
      Object.assign(new Error("@opentui/core"), { code: "MODULE_NOT_FOUND" }),
      Object.assign(new Error("opentui library"), {
        code: "ERR_MODULE_NOT_FOUND",
      }),
      new Error("wrapper", {
        cause: new Error("Cannot find package @opentui/core"),
      }),
    ])
      expect(isTuiModuleNotFoundError(error)).toBe(true);
    for (const error of [
      new Error("Cannot find module unrelated"),
      new Error("opentui rendering failure"),
      new Error("wrapper", { cause: new Error("other failure") }),
      "ordinary failure",
      { code: "ENOENT", message: "missing" },
    ])
      expect(isTuiModuleNotFoundError(error)).toBe(false);
    const self = new Error("ordinary failure");
    self.cause = self;
    expect(isTuiModuleNotFoundError(self)).toBe(false);
  });

  test("prints command-specific Bun recovery instructions", () => {
    const output = spyOn(console, "error").mockImplementation(() => {});
    printTuiUnavailableError("monitor");
    const text = output.mock.calls.flat().join("\n");
    expect(text).toContain("'monitor' command requires the TUI runtime");
    expect(text).toContain("bunx mcp-squared monitor");
    expect(text).toContain("bun run src/index.ts monitor");
  });
});
