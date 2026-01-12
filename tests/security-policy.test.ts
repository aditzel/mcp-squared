import { afterEach, describe, expect, test } from "bun:test";
import type { McpSquaredConfig } from "../src/config/schema.js";
import {
  clearPendingConfirmations,
  compilePolicy,
  createConfirmationToken,
  evaluatePolicy,
  getPendingConfirmationCount,
  getToolVisibility,
  getToolVisibilityCompiled,
  matchesPattern,
  validateConfirmationToken,
} from "../src/security/policy.js";

// Helper to create a minimal config with custom security settings
function createConfig(security: {
  allow?: string[];
  block?: string[];
  confirm?: string[];
}): McpSquaredConfig {
  return {
    schemaVersion: 1,
    upstreams: {},
    security: {
      tools: {
        allow: security.allow ?? ["*:*"],
        block: security.block ?? [],
        confirm: security.confirm ?? [],
      },
    },
    operations: {
      findTools: { defaultLimit: 5, maxLimit: 50, defaultMode: "fast", defaultDetailLevel: "L1" },
      index: { refreshIntervalMs: 30000 },
      logging: { level: "info" },
      selectionCache: { enabled: true, minCooccurrenceThreshold: 2, maxBundleSuggestions: 3 },
    },
  };
}

describe("matchesPattern", () => {
  describe("exact matches", () => {
    test("matches exact server:tool pattern", () => {
      expect(matchesPattern("fs:read_file", "fs", "read_file")).toBe(true);
    });

    test("does not match different server", () => {
      expect(matchesPattern("fs:read_file", "db", "read_file")).toBe(false);
    });

    test("does not match different tool", () => {
      expect(matchesPattern("fs:read_file", "fs", "write_file")).toBe(false);
    });
  });

  describe("wildcard server", () => {
    test("matches any server with *:tool", () => {
      expect(matchesPattern("*:read_file", "fs", "read_file")).toBe(true);
      expect(matchesPattern("*:read_file", "db", "read_file")).toBe(true);
      expect(matchesPattern("*:read_file", "any", "read_file")).toBe(true);
    });

    test("does not match different tool with *:tool", () => {
      expect(matchesPattern("*:read_file", "fs", "write_file")).toBe(false);
    });
  });

  describe("wildcard tool", () => {
    test("matches any tool with server:*", () => {
      expect(matchesPattern("fs:*", "fs", "read_file")).toBe(true);
      expect(matchesPattern("fs:*", "fs", "write_file")).toBe(true);
      expect(matchesPattern("fs:*", "fs", "delete_file")).toBe(true);
    });

    test("does not match different server with server:*", () => {
      expect(matchesPattern("fs:*", "db", "read_file")).toBe(false);
    });
  });

  describe("full wildcard", () => {
    test("matches everything with *:*", () => {
      expect(matchesPattern("*:*", "fs", "read_file")).toBe(true);
      expect(matchesPattern("*:*", "db", "query")).toBe(true);
      expect(matchesPattern("*:*", "any", "tool")).toBe(true);
    });
  });

  describe("invalid patterns", () => {
    test("does not match pattern without colon", () => {
      expect(matchesPattern("invalid", "fs", "read_file")).toBe(false);
    });

    test("does not match empty pattern parts", () => {
      expect(matchesPattern(":tool", "fs", "read_file")).toBe(false);
      expect(matchesPattern("server:", "fs", "read_file")).toBe(false);
    });
  });
});

describe("evaluatePolicy", () => {
  afterEach(() => {
    clearPendingConfirmations();
  });

  describe("allow list", () => {
    test("allows tool when in allow list", () => {
      const config = createConfig({ allow: ["fs:read_file"] });
      const result = evaluatePolicy(
        { serverKey: "fs", toolName: "read_file" },
        config,
      );
      expect(result.decision).toBe("allow");
    });

    test("blocks tool when not in allow list", () => {
      const config = createConfig({ allow: ["fs:read_file"] });
      const result = evaluatePolicy(
        { serverKey: "fs", toolName: "write_file" },
        config,
      );
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("not in the allow list");
    });

    test("allows all tools with *:* in allow list", () => {
      const config = createConfig({ allow: ["*:*"] });
      const result = evaluatePolicy(
        { serverKey: "any", toolName: "tool" },
        config,
      );
      expect(result.decision).toBe("allow");
    });
  });

  describe("block list", () => {
    test("blocks tool when in block list", () => {
      const config = createConfig({
        allow: ["*:*"],
        block: ["fs:delete_file"],
      });
      const result = evaluatePolicy(
        { serverKey: "fs", toolName: "delete_file" },
        config,
      );
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("blocked by security policy");
    });

    test("block takes precedence over allow", () => {
      const config = createConfig({
        allow: ["*:*"],
        block: ["fs:*"],
      });
      const result = evaluatePolicy(
        { serverKey: "fs", toolName: "read_file" },
        config,
      );
      expect(result.decision).toBe("block");
    });
  });

  describe("confirm list", () => {
    test("returns confirm decision when in confirm list", () => {
      const config = createConfig({
        allow: ["*:*"],
        confirm: ["fs:write_file"],
      });
      const result = evaluatePolicy(
        { serverKey: "fs", toolName: "write_file" },
        config,
      );
      expect(result.decision).toBe("confirm");
      expect(result.confirmationToken).toBeDefined();
      expect(result.confirmationToken?.length).toBeGreaterThan(0);
    });

    test("block takes precedence over confirm", () => {
      const config = createConfig({
        allow: ["*:*"],
        block: ["fs:write_file"],
        confirm: ["fs:write_file"],
      });
      const result = evaluatePolicy(
        { serverKey: "fs", toolName: "write_file" },
        config,
      );
      expect(result.decision).toBe("block");
    });

    test("confirm takes precedence over allow", () => {
      const config = createConfig({
        allow: ["*:*"],
        confirm: ["fs:*"],
      });
      const result = evaluatePolicy(
        { serverKey: "fs", toolName: "read_file" },
        config,
      );
      expect(result.decision).toBe("confirm");
    });
  });

  describe("confirmation flow", () => {
    test("allows execution with valid confirmation token", () => {
      const config = createConfig({
        allow: ["*:*"],
        confirm: ["fs:write_file"],
      });

      // First call returns confirm with token
      const firstResult = evaluatePolicy(
        { serverKey: "fs", toolName: "write_file" },
        config,
      );
      expect(firstResult.decision).toBe("confirm");
      const token = firstResult.confirmationToken;
      expect(token).toBeDefined();

      // Second call with token allows execution
      const secondResult = evaluatePolicy(
        {
          serverKey: "fs",
          toolName: "write_file",
          confirmationToken: token,
        },
        config,
      );
      expect(secondResult.decision).toBe("allow");
      expect(secondResult.reason).toContain("confirmed with valid token");
    });

    test("token is single-use", () => {
      const config = createConfig({
        allow: ["*:*"],
        confirm: ["fs:write_file"],
      });

      // Get token
      const firstResult = evaluatePolicy(
        { serverKey: "fs", toolName: "write_file" },
        config,
      );
      const token = firstResult.confirmationToken;

      // Use token once
      evaluatePolicy(
        {
          serverKey: "fs",
          toolName: "write_file",
          confirmationToken: token,
        },
        config,
      );

      // Second use should request new confirmation
      const thirdResult = evaluatePolicy(
        {
          serverKey: "fs",
          toolName: "write_file",
          confirmationToken: token,
        },
        config,
      );
      expect(thirdResult.decision).toBe("confirm");
      expect(thirdResult.confirmationToken).not.toBe(token);
    });

    test("token cannot be used for different tool", () => {
      const config = createConfig({
        allow: ["*:*"],
        confirm: ["fs:*"],
      });

      // Get token for write_file
      const firstResult = evaluatePolicy(
        { serverKey: "fs", toolName: "write_file" },
        config,
      );
      const token = firstResult.confirmationToken;

      // Try to use for delete_file
      const secondResult = evaluatePolicy(
        {
          serverKey: "fs",
          toolName: "delete_file",
          confirmationToken: token,
        },
        config,
      );
      expect(secondResult.decision).toBe("confirm");
      expect(secondResult.confirmationToken).not.toBe(token);
    });

    test("token cannot be used for different server", () => {
      const config = createConfig({
        allow: ["*:*"],
        confirm: ["*:write_file"],
      });

      // Get token for fs server
      const firstResult = evaluatePolicy(
        { serverKey: "fs", toolName: "write_file" },
        config,
      );
      const token = firstResult.confirmationToken;

      // Try to use for db server
      const secondResult = evaluatePolicy(
        {
          serverKey: "db",
          toolName: "write_file",
          confirmationToken: token,
        },
        config,
      );
      expect(secondResult.decision).toBe("confirm");
    });

    test("invalid token is rejected", () => {
      const config = createConfig({
        allow: ["*:*"],
        confirm: ["fs:write_file"],
      });

      const result = evaluatePolicy(
        {
          serverKey: "fs",
          toolName: "write_file",
          confirmationToken: "invalid-token",
        },
        config,
      );
      expect(result.decision).toBe("confirm");
    });
  });
});

describe("token management", () => {
  afterEach(() => {
    clearPendingConfirmations();
  });

  test("createConfirmationToken creates unique tokens", () => {
    const token1 = createConfirmationToken("fs", "tool1");
    const token2 = createConfirmationToken("fs", "tool2");
    expect(token1).not.toBe(token2);
  });

  test("validateConfirmationToken validates matching context", () => {
    const token = createConfirmationToken("fs", "read_file");
    expect(validateConfirmationToken(token, "fs", "read_file")).toBe(true);
  });

  test("validateConfirmationToken rejects mismatched server", () => {
    const token = createConfirmationToken("fs", "read_file");
    expect(validateConfirmationToken(token, "db", "read_file")).toBe(false);
  });

  test("validateConfirmationToken rejects mismatched tool", () => {
    const token = createConfirmationToken("fs", "read_file");
    expect(validateConfirmationToken(token, "fs", "write_file")).toBe(false);
  });

  test("validateConfirmationToken removes token after use", () => {
    const token = createConfirmationToken("fs", "read_file");
    expect(validateConfirmationToken(token, "fs", "read_file")).toBe(true);
    expect(validateConfirmationToken(token, "fs", "read_file")).toBe(false);
  });

  test("getPendingConfirmationCount tracks pending confirmations", () => {
    expect(getPendingConfirmationCount()).toBe(0);
    createConfirmationToken("fs", "tool1");
    expect(getPendingConfirmationCount()).toBe(1);
    createConfirmationToken("fs", "tool2");
    expect(getPendingConfirmationCount()).toBe(2);
  });

  test("clearPendingConfirmations removes all pending confirmations", () => {
    createConfirmationToken("fs", "tool1");
    createConfirmationToken("fs", "tool2");
    clearPendingConfirmations();
    expect(getPendingConfirmationCount()).toBe(0);
  });
});

describe("getToolVisibility", () => {
  test("returns visible: false for blocked tools", () => {
    const config = createConfig({ allow: ["*:*"], block: ["fs:delete_file"] });
    const result = getToolVisibility("fs", "delete_file", config);
    expect(result.visible).toBe(false);
    expect(result.requiresConfirmation).toBe(false);
  });

  test("returns visible: true, requiresConfirmation: true for confirm-list tools", () => {
    const config = createConfig({ allow: ["*:*"], confirm: ["fs:write_file"] });
    const result = getToolVisibility("fs", "write_file", config);
    expect(result.visible).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });

  test("returns visible: true for allowed tools", () => {
    const config = createConfig({ allow: ["fs:read_file"] });
    const result = getToolVisibility("fs", "read_file", config);
    expect(result.visible).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  test("returns visible: false for tools not in allow list (implicit deny)", () => {
    const config = createConfig({ allow: ["fs:read_file"] });
    const result = getToolVisibility("fs", "write_file", config);
    expect(result.visible).toBe(false);
    expect(result.requiresConfirmation).toBe(false);
  });

  test("block takes precedence over confirm", () => {
    const config = createConfig({
      allow: ["*:*"],
      block: ["fs:dangerous"],
      confirm: ["fs:*"],
    });
    const result = getToolVisibility("fs", "dangerous", config);
    expect(result.visible).toBe(false);
    expect(result.requiresConfirmation).toBe(false);
  });

  test("confirm takes precedence over allow", () => {
    const config = createConfig({
      allow: ["*:*"],
      confirm: ["fs:*"],
    });
    const result = getToolVisibility("fs", "read_file", config);
    expect(result.visible).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });

  test("wildcard patterns work correctly", () => {
    const config = createConfig({
      allow: ["*:*"],
      block: ["dangerous:*"],
      confirm: ["*:write_file"],
    });

    // All dangerous server tools are blocked
    expect(getToolVisibility("dangerous", "any_tool", config).visible).toBe(false);

    // All write_file tools require confirmation
    const writeResult = getToolVisibility("fs", "write_file", config);
    expect(writeResult.visible).toBe(true);
    expect(writeResult.requiresConfirmation).toBe(true);

    // Other tools are allowed
    const readResult = getToolVisibility("fs", "read_file", config);
    expect(readResult.visible).toBe(true);
    expect(readResult.requiresConfirmation).toBe(false);
  });
});

describe("compilePolicy and getToolVisibilityCompiled", () => {
  test("compiled version matches non-compiled version", () => {
    const config = createConfig({
      allow: ["*:*"],
      block: ["fs:delete_file"],
      confirm: ["fs:write_file"],
    });
    const compiled = compilePolicy(config);

    // Test various tools
    const tools = [
      { server: "fs", tool: "read_file" },
      { server: "fs", tool: "write_file" },
      { server: "fs", tool: "delete_file" },
      { server: "db", tool: "query" },
    ];

    for (const { server, tool } of tools) {
      const normal = getToolVisibility(server, tool, config);
      const compiledResult = getToolVisibilityCompiled(server, tool, compiled);
      expect(compiledResult).toEqual(normal);
    }
  });

  test("compilePolicy extracts correct patterns", () => {
    const config = createConfig({
      allow: ["a:*", "b:*"],
      block: ["c:*"],
      confirm: ["d:*"],
    });
    const compiled = compilePolicy(config);

    expect(compiled.allowPatterns).toEqual(["a:*", "b:*"]);
    expect(compiled.blockPatterns).toEqual(["c:*"]);
    expect(compiled.confirmPatterns).toEqual(["d:*"]);
  });
});
