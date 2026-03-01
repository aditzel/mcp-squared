import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  ConfigSchema,
  DEFAULT_CONFIG,
  type McpSquaredConfig,
  PERMISSIVE_SECURITY,
} from "@/config";
import { logSecurityProfile } from "@/index.js";
import {
  clearPendingConfirmations,
  compilePolicy,
  evaluatePolicy,
  getToolVisibility,
  getToolVisibilityCompiled,
} from "@/security/policy.js";

function permissiveConfig(): McpSquaredConfig {
  return {
    ...DEFAULT_CONFIG,
    security: PERMISSIVE_SECURITY,
  };
}

describe("hardened security defaults", () => {
  describe("ConfigSchema.parse({}) produces hardened posture", () => {
    test("empty config has allow=[], confirm=[*:*], block=[]", () => {
      const config = ConfigSchema.parse({});
      expect(config.security.tools.allow).toEqual([]);
      expect(config.security.tools.confirm).toEqual(["*:*"]);
      expect(config.security.tools.block).toEqual([]);
    });

    test("DEFAULT_CONFIG matches hardened defaults", () => {
      expect(DEFAULT_CONFIG.security.tools.allow).toEqual([]);
      expect(DEFAULT_CONFIG.security.tools.confirm).toEqual(["*:*"]);
      expect(DEFAULT_CONFIG.security.tools.block).toEqual([]);
    });

    test("DEFAULT_CONFIG equals ConfigSchema.parse({})", () => {
      const parsed = ConfigSchema.parse({});
      expect(parsed.security).toEqual(DEFAULT_CONFIG.security);
    });
  });

  describe("explicit permissive config parsing", () => {
    test("parse with allow=[*:*] preserves it, confirm defaults to [*:*]", () => {
      const config = ConfigSchema.parse({
        security: { tools: { allow: ["*:*"] } },
      });
      expect(config.security.tools.allow).toEqual(["*:*"]);
      expect(config.security.tools.confirm).toEqual(["*:*"]);
      expect(config.security.tools.block).toEqual([]);
    });

    test("parse with allow=[*:*] and confirm=[] preserves both", () => {
      const config = ConfigSchema.parse({
        security: { tools: { allow: ["*:*"], confirm: [] } },
      });
      expect(config.security.tools.allow).toEqual(["*:*"]);
      expect(config.security.tools.confirm).toEqual([]);
      expect(config.security.tools.block).toEqual([]);
    });

    test("parse with specific allow pattern preserves it", () => {
      const config = ConfigSchema.parse({
        security: { tools: { allow: ["myserver:*"] } },
      });
      expect(config.security.tools.allow).toEqual(["myserver:*"]);
      expect(config.security.tools.confirm).toEqual(["*:*"]);
    });

    test("parse with all three lists explicitly set preserves all", () => {
      const config = ConfigSchema.parse({
        security: {
          tools: {
            allow: ["a:*", "b:tool"],
            block: ["c:danger"],
            confirm: ["d:write"],
          },
        },
      });
      expect(config.security.tools.allow).toEqual(["a:*", "b:tool"]);
      expect(config.security.tools.block).toEqual(["c:danger"]);
      expect(config.security.tools.confirm).toEqual(["d:write"]);
    });
  });

  describe("allow-only config backward compat (P1 regression fix)", () => {
    test("config with allow=[*:*] and defaulted confirm=[*:*] allows without confirmation", () => {
      const config = ConfigSchema.parse({
        security: { tools: { allow: ["*:*"] } },
      });
      // confirm defaults to ["*:*"], but allow takes precedence
      const result = evaluatePolicy(
        { serverKey: "fs", toolName: "read_file" },
        config,
      );
      expect(result.decision).toBe("allow");
      expect(result.confirmationToken).toBeUndefined();
    });

    test("config with specific allow pattern bypasses confirm for matched tools", () => {
      const config = ConfigSchema.parse({
        security: { tools: { allow: ["github:*"] } },
      });
      // github tools → allowed (bypass confirm), others → confirm
      const ghResult = evaluatePolicy(
        { serverKey: "github", toolName: "create_issue" },
        config,
      );
      expect(ghResult.decision).toBe("allow");

      const fsResult = evaluatePolicy(
        { serverKey: "fs", toolName: "write_file" },
        config,
      );
      expect(fsResult.decision).toBe("confirm");
    });
  });

  describe("partial security section defaults", () => {
    test("config with only allow set still defaults confirm to [*:*]", () => {
      const config = ConfigSchema.parse({
        security: { tools: { allow: ["myserver:*"] } },
      });
      expect(config.security.tools.allow).toEqual(["myserver:*"]);
      expect(config.security.tools.confirm).toEqual(["*:*"]);
      expect(config.security.tools.block).toEqual([]);
    });

    test("config with only confirm=[] still defaults allow to []", () => {
      const config = ConfigSchema.parse({
        security: { tools: { confirm: [] } },
      });
      expect(config.security.tools.allow).toEqual([]);
      expect(config.security.tools.confirm).toEqual([]);
      expect(config.security.tools.block).toEqual([]);
    });

    test("config with only block set still defaults allow=[] and confirm=[*:*]", () => {
      const config = ConfigSchema.parse({
        security: { tools: { block: ["bad:*"] } },
      });
      expect(config.security.tools.allow).toEqual([]);
      expect(config.security.tools.confirm).toEqual(["*:*"]);
      expect(config.security.tools.block).toEqual(["bad:*"]);
    });

    test("empty security.tools section gets all defaults", () => {
      const config = ConfigSchema.parse({
        security: { tools: {} },
      });
      expect(config.security.tools.allow).toEqual([]);
      expect(config.security.tools.confirm).toEqual(["*:*"]);
      expect(config.security.tools.block).toEqual([]);
    });

    test("empty security section gets all defaults", () => {
      const config = ConfigSchema.parse({
        security: {},
      });
      expect(config.security.tools.allow).toEqual([]);
      expect(config.security.tools.confirm).toEqual(["*:*"]);
      expect(config.security.tools.block).toEqual([]);
    });
  });
});

describe("PERMISSIVE_SECURITY constant", () => {
  test("has allow=[*:*], block=[], confirm=[]", () => {
    expect(PERMISSIVE_SECURITY.tools.allow).toEqual(["*:*"]);
    expect(PERMISSIVE_SECURITY.tools.block).toEqual([]);
    expect(PERMISSIVE_SECURITY.tools.confirm).toEqual([]);
  });

  test("using PERMISSIVE_SECURITY in config parse produces permissive behavior", () => {
    const config = ConfigSchema.parse({
      security: PERMISSIVE_SECURITY,
    });
    expect(config.security.tools.allow).toEqual(["*:*"]);
    expect(config.security.tools.block).toEqual([]);
    expect(config.security.tools.confirm).toEqual([]);
  });

  test("is structurally different from DEFAULT_CONFIG security", () => {
    expect(PERMISSIVE_SECURITY).not.toEqual(DEFAULT_CONFIG.security);
    expect(PERMISSIVE_SECURITY.tools.allow).not.toEqual(
      DEFAULT_CONFIG.security.tools.allow,
    );
    expect(PERMISSIVE_SECURITY.tools.confirm).not.toEqual(
      DEFAULT_CONFIG.security.tools.confirm,
    );
  });
});

describe("policy evaluation with hardened defaults", () => {
  afterEach(() => {
    clearPendingConfirmations();
  });

  test("any tool gets confirm decision with default config", () => {
    const result = evaluatePolicy(
      { serverKey: "myserver", toolName: "my_tool" },
      DEFAULT_CONFIG,
    );
    expect(result.decision).toBe("confirm");
    expect(result.confirmationToken).toBeDefined();
    expect(result.reason).toContain("requires confirmation");
  });

  test("multiple different tools all get confirm with default config", () => {
    const tools = [
      { serverKey: "fs", toolName: "read_file" },
      { serverKey: "db", toolName: "query" },
      { serverKey: "github", toolName: "create_issue" },
      { serverKey: "shell", toolName: "exec" },
    ];
    for (const ctx of tools) {
      const result = evaluatePolicy(ctx, DEFAULT_CONFIG);
      expect(result.decision).toBe("confirm");
      expect(result.confirmationToken).toBeDefined();
    }
  });

  test("valid confirmation token allows execution with default config", () => {
    const firstResult = evaluatePolicy(
      { serverKey: "fs", toolName: "read_file" },
      DEFAULT_CONFIG,
    );
    expect(firstResult.decision).toBe("confirm");
    const token = firstResult.confirmationToken;
    expect(token).toBeDefined();

    const secondResult = evaluatePolicy(
      {
        serverKey: "fs",
        toolName: "read_file",
        confirmationToken: token,
      },
      DEFAULT_CONFIG,
    );
    expect(secondResult.decision).toBe("allow");
    expect(secondResult.reason).toContain("confirmed with valid token");
  });

  test("explicit block added to default config takes precedence", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          ...DEFAULT_CONFIG.security.tools,
          block: ["dangerous:*"],
        },
      },
    };
    const result = evaluatePolicy(
      { serverKey: "dangerous", toolName: "rm_rf" },
      config,
    );
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("blocked by security policy");
  });

  test("block overrides confirm even with hardened defaults", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          allow: [],
          block: ["fs:delete_file"],
          confirm: ["*:*"],
        },
      },
    };
    const result = evaluatePolicy(
      { serverKey: "fs", toolName: "delete_file" },
      config,
    );
    expect(result.decision).toBe("block");
  });
});

describe("policy evaluation with PERMISSIVE_SECURITY", () => {
  afterEach(() => {
    clearPendingConfirmations();
  });

  test("allows any tool without confirmation", () => {
    const config = permissiveConfig();
    const result = evaluatePolicy(
      { serverKey: "anyserver", toolName: "anytool" },
      config,
    );
    expect(result.decision).toBe("allow");
    expect(result.confirmationToken).toBeUndefined();
  });

  test("allows multiple tools without confirmation", () => {
    const config = permissiveConfig();
    const tools = [
      { serverKey: "fs", toolName: "read_file" },
      { serverKey: "db", toolName: "drop_table" },
      { serverKey: "shell", toolName: "exec" },
    ];
    for (const ctx of tools) {
      const result = evaluatePolicy(ctx, config);
      expect(result.decision).toBe("allow");
      expect(result.confirmationToken).toBeUndefined();
    }
  });
});

describe("tool visibility with hardened defaults", () => {
  test("tools are visible but require confirmation with default config", () => {
    const result = getToolVisibility("fs", "read_file", DEFAULT_CONFIG);
    expect(result.visible).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });

  test("all tools require confirmation with default config", () => {
    const tools = [
      { server: "fs", tool: "read_file" },
      { server: "db", tool: "query" },
      { server: "github", tool: "push" },
    ];
    for (const { server, tool } of tools) {
      const result = getToolVisibility(server, tool, DEFAULT_CONFIG);
      expect(result.visible).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
    }
  });

  test("blocked tools are not visible even with hardened defaults", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: {
          allow: [],
          block: ["evil:*"],
          confirm: ["*:*"],
        },
      },
    };
    const result = getToolVisibility("evil", "hack", config);
    expect(result.visible).toBe(false);
    expect(result.requiresConfirmation).toBe(false);
  });
});

describe("tool visibility with PERMISSIVE_SECURITY", () => {
  test("tools are visible and do not require confirmation", () => {
    const config = permissiveConfig();
    const result = getToolVisibility("fs", "read_file", config);
    expect(result.visible).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  test("all tools visible without confirmation", () => {
    const config = permissiveConfig();
    const tools = [
      { server: "fs", tool: "write_file" },
      { server: "db", tool: "drop_table" },
      { server: "shell", tool: "exec" },
    ];
    for (const { server, tool } of tools) {
      const result = getToolVisibility(server, tool, config);
      expect(result.visible).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    }
  });
});

describe("compiled policy with hardened defaults", () => {
  test("compiled policy from default config matches direct visibility", () => {
    const compiled = compilePolicy(DEFAULT_CONFIG);
    const tools = [
      { server: "fs", tool: "read_file" },
      { server: "db", tool: "query" },
      { server: "github", tool: "create_pr" },
    ];
    for (const { server, tool } of tools) {
      const direct = getToolVisibility(server, tool, DEFAULT_CONFIG);
      const compiledResult = getToolVisibilityCompiled(server, tool, compiled);
      expect(compiledResult).toEqual(direct);
    }
  });

  test("compiled policy has correct hardened patterns", () => {
    const compiled = compilePolicy(DEFAULT_CONFIG);
    expect(compiled.allowPatterns).toEqual([]);
    expect(compiled.confirmPatterns).toEqual(["*:*"]);
    expect(compiled.blockPatterns).toEqual([]);
  });

  test("compiled policy from PERMISSIVE_SECURITY has correct patterns", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: PERMISSIVE_SECURITY,
    };
    const compiled = compilePolicy(config);
    expect(compiled.allowPatterns).toEqual(["*:*"]);
    expect(compiled.confirmPatterns).toEqual([]);
    expect(compiled.blockPatterns).toEqual([]);
  });
});

describe("logSecurityProfile", () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test("logs message when hardened defaults are active", () => {
    logSecurityProfile(DEFAULT_CONFIG);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain("confirm-all mode");
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain(
      "mcp-squared init --security=permissive",
    );
  });

  test("does not log when permissive security is active", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: PERMISSIVE_SECURITY,
    };
    logSecurityProfile(config);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test("does not log when allow list is non-empty", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: { allow: ["github:*"], block: [], confirm: ["*:*"] },
      },
    };
    logSecurityProfile(config);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test("does not log when confirm list does not include *:*", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      security: {
        tools: { allow: [], block: [], confirm: ["fs:write_file"] },
      },
    };
    logSecurityProfile(config);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
