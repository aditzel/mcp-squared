import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "@/config/schema";
import {
  type MergeInput,
  detectConflicts,
  mergeWithResolutions,
  mergeWithStrategy,
} from "@/import/merge";
import type { ExternalServer } from "@/import/types";

/**
 * Creates a minimal valid MCP² config for testing.
 */
function createEmptyConfig(): McpSquaredConfig {
  return {
    ...DEFAULT_CONFIG,
    upstreams: {},
  };
}

/**
 * Creates a config with an existing upstream.
 */
function createConfigWithUpstream(name: string): McpSquaredConfig {
  return {
    ...createEmptyConfig(),
    upstreams: {
      [name]: {
        transport: "stdio",
        enabled: true,
        label: name,
        env: {},
        stdio: {
          command: "existing-command",
          args: ["--existing"],
        },
      },
    },
  };
}

describe("import merge - field preservation", () => {
  test("mergeWithStrategy preserves args for non-conflicting servers", () => {
    const config = createEmptyConfig();
    const server: ExternalServer = {
      name: "test-server",
      command: "npx",
      args: ["-y", "some-package", "--flag"],
      env: { API_KEY: "secret" },
    };

    const input: MergeInput = {
      incoming: [
        {
          tool: "claude-code",
          path: "/test/path",
          servers: [server],
        },
      ],
      existingConfig: config,
    };

    const result = mergeWithStrategy(input, "skip");

    // Verify the server was added
    expect(result.config.upstreams["test-server"]).toBeDefined();
    const upstream = result.config.upstreams["test-server"];

    // Verify all fields are preserved
    expect(upstream?.transport).toBe("stdio");
    if (upstream?.transport === "stdio") {
      expect(upstream.stdio.command).toBe("npx");
      expect(upstream.stdio.args).toEqual(["-y", "some-package", "--flag"]);
    }
    expect(upstream?.env).toEqual({ API_KEY: "secret" });
  });

  test("mergeWithStrategy preserves cwd for non-conflicting servers", () => {
    const config = createEmptyConfig();
    const server: ExternalServer = {
      name: "test-server",
      command: "node",
      args: ["server.js"],
      cwd: "/custom/working/directory",
    };

    const input: MergeInput = {
      incoming: [
        {
          tool: "claude-code",
          path: "/test/path",
          servers: [server],
        },
      ],
      existingConfig: config,
    };

    const result = mergeWithStrategy(input, "skip");

    const upstream = result.config.upstreams["test-server"];
    expect(upstream?.transport).toBe("stdio");
    if (upstream?.transport === "stdio") {
      expect(upstream.stdio.cwd).toBe("/custom/working/directory");
    }
  });

  test("mergeWithStrategy preserves SSE headers for non-conflicting servers", () => {
    const config = createEmptyConfig();
    const server: ExternalServer = {
      name: "sse-server",
      url: "https://api.example.com/mcp",
      headers: {
        Authorization: "Bearer token123",
        "X-Custom-Header": "value",
      },
    };

    const input: MergeInput = {
      incoming: [
        {
          tool: "claude-code",
          path: "/test/path",
          servers: [server],
        },
      ],
      existingConfig: config,
    };

    const result = mergeWithStrategy(input, "skip");

    const upstream = result.config.upstreams["sse-server"];
    expect(upstream?.transport).toBe("sse");
    if (upstream?.transport === "sse") {
      expect(upstream.sse.url).toBe("https://api.example.com/mcp");
      expect(upstream.sse.headers).toEqual({
        Authorization: "Bearer token123",
        "X-Custom-Header": "value",
      });
    }
  });

  test("mergeWithResolutions preserves args for non-conflicting servers", () => {
    const config = createEmptyConfig();
    const server: ExternalServer = {
      name: "test-server",
      command: "auggie",
      args: ["--mcp", "--verbose"],
    };

    const input: MergeInput = {
      incoming: [
        {
          tool: "claude-code",
          path: "/test/path",
          servers: [server],
        },
      ],
      existingConfig: config,
    };

    const result = mergeWithResolutions(input, new Map());

    const upstream = result.config.upstreams["test-server"];
    expect(upstream?.transport).toBe("stdio");
    if (upstream?.transport === "stdio") {
      expect(upstream.stdio.command).toBe("auggie");
      expect(upstream.stdio.args).toEqual(["--mcp", "--verbose"]);
    }
  });

  test("conflict replace preserves all incoming fields", () => {
    const config = createConfigWithUpstream("test-server");
    const server: ExternalServer = {
      name: "test-server",
      command: "new-command",
      args: ["--new", "--args"],
      env: { NEW_VAR: "value" },
    };

    const input: MergeInput = {
      incoming: [
        {
          tool: "claude-code",
          path: "/test/path",
          servers: [server],
        },
      ],
      existingConfig: config,
    };

    const result = mergeWithStrategy(input, "replace");

    const upstream = result.config.upstreams["test-server"];
    expect(upstream?.transport).toBe("stdio");
    if (upstream?.transport === "stdio") {
      expect(upstream.stdio.command).toBe("new-command");
      expect(upstream.stdio.args).toEqual(["--new", "--args"]);
    }
    expect(upstream?.env).toEqual({ NEW_VAR: "value" });
  });
});

describe("import merge - conflict detection", () => {
  test("detects conflicts correctly", () => {
    const config = createConfigWithUpstream("existing-server");
    const server: ExternalServer = {
      name: "existing-server",
      command: "new-command",
      args: ["--new"],
    };

    const input: MergeInput = {
      incoming: [
        {
          tool: "claude-code",
          path: "/test/path",
          servers: [server],
        },
      ],
      existingConfig: config,
    };

    const detection = detectConflicts(input);

    expect(detection.conflicts).toHaveLength(1);
    expect(detection.conflicts[0]?.serverName).toBe("existing-server");
    expect(detection.noConflict).toHaveLength(0);
  });

  test("separates conflicts from non-conflicts", () => {
    const config = createConfigWithUpstream("existing-server");
    const servers: ExternalServer[] = [
      { name: "existing-server", command: "cmd1", args: ["--arg1"] },
      { name: "new-server", command: "cmd2", args: ["--arg2"] },
    ];

    const input: MergeInput = {
      incoming: [
        {
          tool: "claude-code",
          path: "/test/path",
          servers,
        },
      ],
      existingConfig: config,
    };

    const detection = detectConflicts(input);

    expect(detection.conflicts).toHaveLength(1);
    expect(detection.noConflict).toHaveLength(1);
    expect(detection.noConflict[0]?.originalName).toBe("new-server");
  });
});

describe("import merge - strategies", () => {
  test("skip strategy keeps existing config unchanged", () => {
    const config = createConfigWithUpstream("test-server");
    const server: ExternalServer = {
      name: "test-server",
      command: "new-command",
      args: ["--new"],
    };

    const input: MergeInput = {
      incoming: [
        {
          tool: "claude-code",
          path: "/test/path",
          servers: [server],
        },
      ],
      existingConfig: config,
    };

    const result = mergeWithStrategy(input, "skip");

    const upstream = result.config.upstreams["test-server"];
    if (upstream?.transport === "stdio") {
      expect(upstream.stdio.command).toBe("existing-command");
      expect(upstream.stdio.args).toEqual(["--existing"]);
    }
  });

  test("rename strategy creates new entry with unique name", () => {
    const config = createConfigWithUpstream("test-server");
    const server: ExternalServer = {
      name: "test-server",
      command: "new-command",
      args: ["--new"],
    };

    const input: MergeInput = {
      incoming: [
        {
          tool: "claude-code",
          path: "/test/path",
          servers: [server],
        },
      ],
      existingConfig: config,
    };

    const result = mergeWithStrategy(input, "rename");

    // Original should be unchanged
    const original = result.config.upstreams["test-server"];
    if (original?.transport === "stdio") {
      expect(original.stdio.command).toBe("existing-command");
    }

    // New entry should exist with renamed name (suffix starts at 2)
    const renamed = result.config.upstreams["test-server-2"];
    expect(renamed).toBeDefined();
    if (renamed?.transport === "stdio") {
      expect(renamed.stdio.command).toBe("new-command");
      expect(renamed.stdio.args).toEqual(["--new"]);
    }
  });
});
