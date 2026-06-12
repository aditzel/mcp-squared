import { beforeEach, describe, expect, test } from "bun:test";
import type { UpstreamServerConfig } from "@/config/schema";
import type { AdapterContext, UpstreamAdapter } from "@/upstream/adapter";
import { resolveEnvVars, resolveHeaders } from "@/upstream/adapter";
import {
  clearCustomAdapters,
  getAdapter,
  getRegisteredAdapters,
  registerAdapter,
  unregisterAdapter,
} from "@/upstream/adapter-registry";

function makeStdioConfig(): UpstreamServerConfig {
  return {
    transport: "stdio",
    enabled: true,
    env: {},
    stdio: {
      command: "mcp-server-local",
      args: [],
    },
  };
}

function makeSseConfig(): UpstreamServerConfig {
  return {
    transport: "sse",
    enabled: true,
    env: {},
    sse: {
      url: "https://example.com/mcp",
      headers: {},
    },
  };
}

describe("resolveEnvVars", () => {
  test("resolves $VAR syntax", () => {
    expect(resolveEnvVars("$HOME/test", { HOME: "/users/test" })).toBe(
      "/users/test/test",
    );
  });

  test("resolves ${VAR} syntax", () => {
    expect(resolveEnvVars("${API_KEY}/api", { API_KEY: "secret" })).toBe(
      "secret/api",
    );
  });

  test("falls back to process.env", () => {
    const result = resolveEnvVars("$PATH/test", {});
    expect(result).toContain("/test");
  });

  test("returns empty string for unknown vars", () => {
    expect(resolveEnvVars("$UNKNOWN_VAR", {})).toBe("");
  });
});

describe("resolveHeaders", () => {
  test("resolves env vars in header values", () => {
    const headers = { Authorization: "Bearer $TOKEN" };
    const result = resolveHeaders(headers, { TOKEN: "abc123" });
    expect(result).toEqual({ Authorization: "Bearer abc123" });
  });

  test("preserves headers without env vars", () => {
    const headers = { "Content-Type": "application/json" };
    const result = resolveHeaders(headers, {});
    expect(result).toEqual({ "Content-Type": "application/json" });
  });
});

describe("Adapter Registry", () => {
  beforeEach(() => {
    clearCustomAdapters();
  });

  test("returns stdio adapter for stdio config", () => {
    const adapter = getAdapter(makeStdioConfig());
    expect(adapter).toBeDefined();
    expect(adapter?.transportType).toBe("stdio");
  });

  test("returns sse adapter for sse config", () => {
    const adapter = getAdapter(makeSseConfig());
    expect(adapter).toBeDefined();
    expect(adapter?.transportType).toBe("sse");
  });

  test("returns undefined for unknown transport", () => {
    const config = { transport: "unknown" } as unknown as UpstreamServerConfig;
    const adapter = getAdapter(config);
    expect(adapter).toBeUndefined();
  });

  test("custom adapter overrides built-in", () => {
    const customAdapter: UpstreamAdapter = {
      transportType: "stdio",
      createTransport: async () => ({ transport: {} as never }),
    };

    registerAdapter(customAdapter);
    const adapter = getAdapter(makeStdioConfig());
    expect(adapter).toBe(customAdapter);
  });

  test("unregister removes custom adapter", () => {
    const customAdapter: UpstreamAdapter = {
      transportType: "stdio",
      createTransport: async () => ({ transport: {} as never }),
    };

    registerAdapter(customAdapter);
    unregisterAdapter("stdio");

    const adapter = getAdapter(makeStdioConfig());
    expect(adapter?.transportType).toBe("stdio"); // falls back to built-in
  });

  test("getRegisteredAdapters returns all adapters", () => {
    const adapters = getRegisteredAdapters();
    expect(adapters.length).toBeGreaterThanOrEqual(2);

    const types = adapters.map((a) => a.transportType);
    expect(types).toContain("stdio");
    expect(types).toContain("sse");
  });

  test("clearCustomAdapters removes only custom adapters", () => {
    const customAdapter: UpstreamAdapter = {
      transportType: "sse",
      createTransport: async () => ({ transport: {} as never }),
    };

    registerAdapter(customAdapter);
    clearCustomAdapters();

    const adapters = getRegisteredAdapters();
    const types = adapters.map((a) => a.transportType);
    expect(types).toContain("sse"); // built-in still there
  });
});

describe("Stdio Adapter", () => {
  test("has correct transport type", async () => {
    const { stdioAdapter } = await import("@/upstream/adapters/stdio");
    expect(stdioAdapter.transportType).toBe("stdio");
  });

  test("creates transport", async () => {
    const { stdioAdapter } = await import("@/upstream/adapters/stdio");
    const context: AdapterContext = {
      key: "local",
      config: makeStdioConfig(),
    };

    const result = await stdioAdapter.createTransport(context);
    expect(result.transport).toBeDefined();
  });
});

describe("SSE Adapter", () => {
  test("has correct transport type", async () => {
    const { sseAdapter } = await import("@/upstream/adapters/sse");
    expect(sseAdapter.transportType).toBe("sse");
  });

  test("creates transport", async () => {
    const { sseAdapter } = await import("@/upstream/adapters/sse");
    const context: AdapterContext = {
      key: "remote",
      config: makeSseConfig(),
    };

    const result = await sseAdapter.createTransport(context);
    expect(result.transport).toBeDefined();
  });
});
