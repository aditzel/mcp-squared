import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "@/config/schema";
import {
  detectConflicts,
  type MergeInput,
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

  test("mergeWithStrategy preserves SSE auth settings for non-conflicting servers", () => {
    const config = createEmptyConfig();
    const server: ExternalServer = {
      name: "sse-server",
      url: "https://api.example.com/mcp",
      headers: {
        Authorization: "Bearer token123",
      },
      auth: {
        callbackPort: 9321,
        clientName: "Acme Agent",
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
      expect(upstream.sse.auth).toEqual({
        callbackPort: 9321,
        clientName: "Acme Agent",
      });
    }
  });

  test("mergeWithStrategy normalizes callbackPort-only SSE auth objects with default clientName", () => {
    const config = createEmptyConfig();
    const server: ExternalServer = {
      name: "sse-callback-only-server",
      url: "https://api.example.com/mcp",
      auth: {
        callbackPort: 9321,
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

    const upstream = result.config.upstreams["sse-callback-only-server"];
    expect(upstream?.transport).toBe("sse");
    if (upstream?.transport === "sse") {
      expect(upstream.sse.auth).toEqual({
        callbackPort: 9321,
        clientName: "MCP²",
      });
    }
  });

  test("mergeWithStrategy normalizes clientName-only SSE auth objects with default callbackPort", () => {
    const config = createEmptyConfig();
    const server: ExternalServer = {
      name: "sse-client-only-server",
      url: "https://api.example.com/mcp",
      auth: {
        clientName: "Acme Agent",
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

    const upstream = result.config.upstreams["sse-client-only-server"];
    expect(upstream?.transport).toBe("sse");
    if (upstream?.transport === "sse") {
      expect(upstream.sse.auth).toEqual({
        callbackPort: 8089,
        clientName: "Acme Agent",
      });
    }
  });

  test("mergeWithStrategy keeps SSE auth undefined when not provided", () => {
    const config = createEmptyConfig();
    const server: ExternalServer = {
      name: "sse-server",
      url: "https://api.example.com/mcp",
      headers: {
        Authorization: "Bearer token123",
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
      expect(upstream.sse.auth).toBeUndefined();
    }
  });

  test("mergeWithStrategy preserves SSE auth in mixed upstream sets", () => {
    const config = createEmptyConfig();
    const servers: ExternalServer[] = [
      {
        name: "sse-auth-server",
        url: "https://api.example.com/auth",
        headers: { Authorization: "Bearer token123" },
        auth: true,
      },
      {
        name: "sse-no-auth-server",
        url: "https://api.example.com/no-auth",
        headers: { "X-Request-ID": "123" },
      },
      {
        name: "stdio-server",
        command: "npx",
        args: ["-y", "some-package"],
      },
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

    const result = mergeWithStrategy(input, "skip");

    const sseWithAuth = result.config.upstreams["sse-auth-server"];
    expect(sseWithAuth?.transport).toBe("sse");
    if (sseWithAuth?.transport === "sse") {
      expect(sseWithAuth.sse.auth).toBe(true);
      expect(sseWithAuth.sse.headers).toEqual({
        Authorization: "Bearer token123",
      });
    }

    const sseWithoutAuth = result.config.upstreams["sse-no-auth-server"];
    expect(sseWithoutAuth?.transport).toBe("sse");
    if (sseWithoutAuth?.transport === "sse") {
      expect(sseWithoutAuth.sse.auth).toBeUndefined();
      expect(sseWithoutAuth.sse.headers).toEqual({
        "X-Request-ID": "123",
      });
    }

    const stdio = result.config.upstreams["stdio-server"];
    expect(stdio?.transport).toBe("stdio");
    if (stdio?.transport === "stdio") {
      expect(stdio.stdio.command).toBe("npx");
      expect(stdio.stdio.args).toEqual(["-y", "some-package"]);
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

describe("import merge - in-sync detection", () => {
  test("detects identical configs as in-sync", () => {
    // Create a config with existing server that matches incoming
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        "test-server": {
          transport: "stdio",
          enabled: true,
          label: "test-server",
          env: { API_KEY: "secret" },
          stdio: {
            command: "npx",
            args: ["-y", "some-package"],
          },
        },
      },
    };

    // Incoming server with identical configuration
    const server: ExternalServer = {
      name: "test-server",
      command: "npx",
      args: ["-y", "some-package"],
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

    const detection = detectConflicts(input);

    expect(detection.inSync).toHaveLength(1);
    expect(detection.inSync[0]?.serverName).toBe("test-server");
    expect(detection.conflicts).toHaveLength(0);
    expect(detection.noConflict).toHaveLength(0);
  });

  test("detects different configs as conflicts, not in-sync", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        "test-server": {
          transport: "stdio",
          enabled: true,
          label: "test-server",
          env: {},
          stdio: {
            command: "npx",
            args: ["-y", "old-package"],
          },
        },
      },
    };

    // Incoming server with different args
    const server: ExternalServer = {
      name: "test-server",
      command: "npx",
      args: ["-y", "new-package"],
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
    expect(detection.inSync).toHaveLength(0);
  });

  test("detects SSE configs as in-sync when identical", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        "sse-server": {
          transport: "sse",
          enabled: true,
          label: "sse-server",
          env: {},
          sse: {
            url: "https://api.example.com/mcp",
            headers: { Authorization: "Bearer token123" },
          },
        },
      },
    };

    const server: ExternalServer = {
      name: "sse-server",
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer token123" },
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

    expect(detection.inSync).toHaveLength(1);
    expect(detection.inSync[0]?.serverName).toBe("sse-server");
    expect(detection.conflicts).toHaveLength(0);
  });

  test("detects SSE configs with auth settings as in-sync when identical", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        "sse-auth-server": {
          transport: "sse",
          enabled: true,
          label: "sse-auth-server",
          env: {},
          sse: {
            url: "https://api.example.com/mcp",
            headers: { Authorization: "Bearer token123" },
            auth: {
              callbackPort: 9321,
              clientName: "Acme Agent",
            },
          },
        },
      },
    };

    const server: ExternalServer = {
      name: "sse-auth-server",
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer token123" },
      auth: {
        callbackPort: 9321,
        clientName: "Acme Agent",
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

    const detection = detectConflicts(input);

    expect(detection.inSync).toHaveLength(1);
    expect(detection.inSync[0]?.serverName).toBe("sse-auth-server");
    expect(detection.conflicts).toHaveLength(0);
  });

  test("mergeWithStrategy includes in-sync in result", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        "synced-server": {
          transport: "stdio",
          enabled: true,
          label: "synced-server",
          env: {},
          stdio: {
            command: "npx",
            args: ["some-cmd"],
          },
        },
      },
    };

    const server: ExternalServer = {
      name: "synced-server",
      command: "npx",
      args: ["some-cmd"],
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

    expect(result.inSync).toHaveLength(1);
    expect(result.inSync[0]?.serverName).toBe("synced-server");
    // In-sync servers should not appear in changes
    expect(result.changes).toHaveLength(0);
  });

  test("handles mix of new, conflict, and in-sync servers", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        "synced-server": {
          transport: "stdio",
          enabled: true,
          label: "synced-server",
          env: {},
          stdio: {
            command: "npx",
            args: ["same-cmd"],
          },
        },
        "conflict-server": {
          transport: "stdio",
          enabled: true,
          label: "conflict-server",
          env: {},
          stdio: {
            command: "old-cmd",
            args: [],
          },
        },
      },
    };

    const servers: ExternalServer[] = [
      { name: "synced-server", command: "npx", args: ["same-cmd"] }, // in-sync
      { name: "conflict-server", command: "new-cmd", args: [] }, // conflict
      { name: "new-server", command: "brand-new", args: ["--flag"] }, // new
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

    expect(detection.inSync).toHaveLength(1);
    expect(detection.conflicts).toHaveLength(1);
    expect(detection.noConflict).toHaveLength(1);

    expect(detection.inSync[0]?.serverName).toBe("synced-server");
    expect(detection.conflicts[0]?.serverName).toBe("conflict-server");
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
