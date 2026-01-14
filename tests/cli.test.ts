import { describe, expect, test } from "bun:test";
import { parseArgs } from "@/cli/index";

describe("parseArgs", () => {
  describe("defaults and basic flags", () => {
    test("defaults to server mode with no args", () => {
      const result = parseArgs([]);
      expect(result.mode).toBe("server");
      expect(result.help).toBe(false);
      expect(result.version).toBe(false);
    });

    test("parses 'config' command", () => {
      const result = parseArgs(["config"]);
      expect(result.mode).toBe("config");
    });

    test("parses '--config' flag", () => {
      const result = parseArgs(["--config"]);
      expect(result.mode).toBe("config");
    });

    test("parses '-c' flag", () => {
      const result = parseArgs(["-c"]);
      expect(result.mode).toBe("config");
    });

    test("parses '--help' flag", () => {
      const result = parseArgs(["--help"]);
      expect(result.help).toBe(true);
    });

    test("parses '-h' flag", () => {
      const result = parseArgs(["-h"]);
      expect(result.help).toBe(true);
    });

    test("parses '--version' flag", () => {
      const result = parseArgs(["--version"]);
      expect(result.version).toBe(true);
    });

    test("parses '-v' flag", () => {
      const result = parseArgs(["-v"]);
      expect(result.version).toBe(true);
    });
  });

  describe("test command", () => {
    test("parses 'test' command", () => {
      const result = parseArgs(["test"]);
      expect(result.mode).toBe("test");
      expect(result.testTarget).toBeUndefined();
    });

    test("parses '--test' flag", () => {
      const result = parseArgs(["--test"]);
      expect(result.mode).toBe("test");
    });

    test("parses '-t' flag", () => {
      const result = parseArgs(["-t"]);
      expect(result.mode).toBe("test");
    });

    test("parses 'test <name>' with target", () => {
      const result = parseArgs(["test", "github"]);
      expect(result.mode).toBe("test");
      expect(result.testTarget).toBe("github");
    });

    test("parses 'test' with --verbose", () => {
      const result = parseArgs(["test", "--verbose"]);
      expect(result.mode).toBe("test");
      expect(result.testVerbose).toBe(true);
    });

    test("parses '-V' sets testVerbose", () => {
      const result = parseArgs(["-V"]);
      expect(result.testVerbose).toBe(true);
    });

    test("parses 'test <name> --verbose' combined", () => {
      const result = parseArgs(["test", "github", "--verbose"]);
      expect(result.mode).toBe("test");
      expect(result.testTarget).toBe("github");
      expect(result.testVerbose).toBe(true);
    });

    test("does not treat flag as target", () => {
      const result = parseArgs(["test", "--verbose"]);
      expect(result.testTarget).toBeUndefined();
    });
  });

  describe("auth command", () => {
    test("parses 'auth' command", () => {
      const result = parseArgs(["auth"]);
      expect(result.mode).toBe("auth");
      expect(result.authTarget).toBeUndefined();
    });

    test("parses 'auth <name>' with target", () => {
      const result = parseArgs(["auth", "vercel"]);
      expect(result.mode).toBe("auth");
      expect(result.authTarget).toBe("vercel");
    });

    test("does not treat flag as target", () => {
      const result = parseArgs(["auth", "--help"]);
      expect(result.authTarget).toBeUndefined();
      expect(result.help).toBe(true);
    });
  });

  describe("import command", () => {
    test("parses 'import' command", () => {
      const result = parseArgs(["import"]);
      expect(result.mode).toBe("import");
    });

    test("has default import options", () => {
      const result = parseArgs(["import"]);
      expect(result.import.scope).toBe("both");
      expect(result.import.strategy).toBe("skip");
      expect(result.import.interactive).toBe(true);
      expect(result.import.dryRun).toBe(false);
      expect(result.import.list).toBe(false);
      expect(result.import.verbose).toBe(false);
    });

    test("parses --source flag with =", () => {
      const result = parseArgs(["import", "--source=cursor"]);
      expect(result.import.source).toBe("cursor");
    });

    test("parses --source flag without =", () => {
      const result = parseArgs(["import", "--source", "cursor"]);
      expect(result.import.source).toBe("cursor");
    });

    test("parses --path flag", () => {
      const result = parseArgs(["import", "--path=/custom/path"]);
      expect(result.import.path).toBe("/custom/path");
    });

    test("parses --scope flag", () => {
      const result = parseArgs(["import", "--scope=user"]);
      expect(result.import.scope).toBe("user");
    });

    test("parses --scope=project", () => {
      const result = parseArgs(["import", "--scope=project"]);
      expect(result.import.scope).toBe("project");
    });

    test("parses --strategy flag", () => {
      const result = parseArgs(["import", "--strategy=replace"]);
      expect(result.import.strategy).toBe("replace");
    });

    test("parses --strategy=rename", () => {
      const result = parseArgs(["import", "--strategy=rename"]);
      expect(result.import.strategy).toBe("rename");
    });

    test("parses --list flag", () => {
      const result = parseArgs(["import", "--list"]);
      expect(result.import.list).toBe(true);
    });

    test("parses --dry-run flag", () => {
      const result = parseArgs(["--dry-run"]);
      expect(result.import.dryRun).toBe(true);
      expect(result.install.dryRun).toBe(true);
    });

    test("parses --no-interactive flag", () => {
      const result = parseArgs(["--no-interactive"]);
      expect(result.import.interactive).toBe(false);
      expect(result.install.interactive).toBe(false);
    });

    test("parses --verbose flag for import", () => {
      const result = parseArgs(["import", "--verbose"]);
      expect(result.import.verbose).toBe(true);
    });

    test("ignores invalid --source value", () => {
      const result = parseArgs(["import", "--source=invalid"]);
      expect(result.import.source).toBeUndefined();
    });

    test("ignores invalid --scope value", () => {
      const result = parseArgs(["import", "--scope=invalid"]);
      expect(result.import.scope).toBe("both"); // default
    });

    test("ignores invalid --strategy value", () => {
      const result = parseArgs(["import", "--strategy=invalid"]);
      expect(result.import.strategy).toBe("skip"); // default
    });

    test("handles combined import flags", () => {
      const result = parseArgs([
        "import",
        "--source=cursor",
        "--scope=user",
        "--strategy=replace",
        "--dry-run",
        "--no-interactive",
      ]);
      expect(result.import.source).toBe("cursor");
      expect(result.import.scope).toBe("user");
      expect(result.import.strategy).toBe("replace");
      expect(result.import.dryRun).toBe(true);
      expect(result.import.interactive).toBe(false);
    });
  });

  describe("install command", () => {
    test("parses 'install' command", () => {
      const result = parseArgs(["install"]);
      expect(result.mode).toBe("install");
    });

    test("has default install options", () => {
      const result = parseArgs(["install"]);
      expect(result.install.interactive).toBe(true);
      expect(result.install.dryRun).toBe(false);
      expect(result.install.serverName).toBe("mcp-squared");
      expect(result.install.command).toBe("mcp-squared");
    });

    test("parses --tool flag", () => {
      const result = parseArgs(["install", "--tool=cursor"]);
      expect(result.install.tool).toBe("cursor");
    });

    test("parses --tool without =", () => {
      const result = parseArgs(["install", "--tool", "cursor"]);
      expect(result.install.tool).toBe("cursor");
    });

    test("parses --mode=replace", () => {
      const result = parseArgs(["install", "--mode=replace"]);
      expect(result.install.mode).toBe("replace");
    });

    test("parses --mode=add", () => {
      const result = parseArgs(["install", "--mode=add"]);
      expect(result.install.mode).toBe("add");
    });

    test("parses --name flag", () => {
      const result = parseArgs(["install", "--name=my-server"]);
      expect(result.install.serverName).toBe("my-server");
    });

    test("parses --command flag", () => {
      const result = parseArgs(["install", "--command=my-cmd"]);
      expect(result.install.command).toBe("my-cmd");
    });

    test("parses --scope for install (user only)", () => {
      const result = parseArgs(["install", "--scope=user"]);
      expect(result.install.scope).toBe("user");
    });

    test("parses --scope=project for install", () => {
      const result = parseArgs(["install", "--scope=project"]);
      expect(result.install.scope).toBe("project");
    });

    test("ignores invalid --tool value", () => {
      const result = parseArgs(["install", "--tool=invalid"]);
      expect(result.install.tool).toBeUndefined();
    });

    test("ignores invalid --mode value", () => {
      const result = parseArgs(["install", "--mode=invalid"]);
      expect(result.install.mode).toBeUndefined();
    });

    test("handles combined install flags", () => {
      const result = parseArgs([
        "install",
        "--tool=cursor",
        "--scope=user",
        "--mode=add",
        "--name=custom-name",
        "--command=custom-cmd",
        "--dry-run",
        "--no-interactive",
      ]);
      expect(result.install.tool).toBe("cursor");
      expect(result.install.scope).toBe("user");
      expect(result.install.mode).toBe("add");
      expect(result.install.serverName).toBe("custom-name");
      expect(result.install.command).toBe("custom-cmd");
      expect(result.install.dryRun).toBe(true);
      expect(result.install.interactive).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("handles empty --source value", () => {
      const result = parseArgs(["import", "--source="]);
      expect(result.import.source).toBeUndefined();
    });

    test("test command consumes next arg as target", () => {
      // "import" is treated as target, not as a command
      const result = parseArgs(["test", "import"]);
      expect(result.mode).toBe("test");
      expect(result.testTarget).toBe("import");
    });

    test("handles unknown flags gracefully", () => {
      const result = parseArgs(["--unknown-flag", "--another"]);
      expect(result.mode).toBe("server"); // defaults preserved
    });
  });
});
