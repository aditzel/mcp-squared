import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  UpstreamSseServerConfig,
  UpstreamStdioServerConfig,
} from "@/config/schema.js";
import { type ClientLike, testUpstreamConnection } from "@/upstream/client.js";
import { withTempConfigHome } from "./helpers/config-home";

function createClient(overrides: Partial<ClientLike> = {}): ClientLike {
  return {
    connect: mock(async (_transport: Transport) => {}),
    close: mock(async () => {}),
    listTools: mock(async () => ({
      tools: [{ name: "time_util", description: "Time helper" }],
    })),
    getServerVersion: () => ({ name: "mock-server", version: "1.0.0" }),
    ...overrides,
  };
}

function createTransport(): Transport {
  return {
    start: mock(async () => {}),
    send: mock(async () => {}),
    close: mock(async () => {}),
  };
}

function createStdioConfig(): UpstreamStdioServerConfig {
  return {
    transport: "stdio",
    enabled: true,
    env: {},
    stdio: {
      command: "mock-server",
      args: [],
    },
  };
}

function createSseConfig(auth = false): UpstreamSseServerConfig {
  return {
    transport: "sse",
    enabled: true,
    env: {},
    sse: {
      url: "https://example.com/mcp",
      headers: {},
      auth,
    },
  };
}

describe("testUpstreamConnection failure cleanup", () => {
  let restoreConfigHome: (() => void) | undefined;

  beforeEach(async () => {
    const ctx = await withTempConfigHome();
    restoreConfigHome = ctx.restore;
  });

  afterEach(() => {
    restoreConfigHome?.();
    restoreConfigHome = undefined;
  });

  test("returns failure and closes stdio transport when connect rejects", async () => {
    const transport = createTransport();
    const client = createClient({
      connect: mock(async () => {
        throw new Error("connect failed");
      }),
    });

    const result = await testUpstreamConnection(
      "stdio-connect-failure",
      createStdioConfig(),
      {
        clientFactory: () => client,
        stdioTransportFactory: () => transport,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("connect failed");
    expect(client.listTools).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test("returns failure and closes stdio transport when listTools rejects", async () => {
    const transport = createTransport();
    const client = createClient({
      listTools: mock(async () => {
        throw new Error("listTools failed");
      }),
    });

    const result = await testUpstreamConnection(
      "stdio-list-tools-failure",
      createStdioConfig(),
      {
        clientFactory: () => client,
        stdioTransportFactory: () => transport,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("listTools failed");
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test("returns connection timeout and still cleans up", async () => {
    const transport = createTransport();
    let resolveConnect: (() => void) | undefined;
    const connectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    const client = createClient({
      connect: mock(() => connectPromise),
    });

    try {
      const result = await testUpstreamConnection(
        "stdio-timeout",
        createStdioConfig(),
        {
          timeoutMs: 10,
          clientFactory: () => client,
          stdioTransportFactory: () => transport,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection timeout");
      expect(client.listTools).not.toHaveBeenCalled();
      expect(transport.close).toHaveBeenCalledTimes(1);
      expect(client.close).toHaveBeenCalledTimes(1);
    } finally {
      resolveConnect?.();
      await connectPromise;
    }
  });

  test("returns failure and closes HTTP transport when SSE connect is unauthorized without auth", async () => {
    const transport = createTransport();
    const client = createClient({
      connect: mock(async () => {
        throw new UnauthorizedError("Unauthorized");
      }),
    });

    const result = await testUpstreamConnection(
      "sse-unauthorized",
      createSseConfig(false),
      {
        clientFactory: () => client,
        httpTransportFactory: () =>
          transport as unknown as StreamableHTTPClientTransport,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
    expect(client.listTools).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test("swallows client close errors after a successful test", async () => {
    const transport = createTransport();
    const client = createClient({
      close: mock(async () => {
        throw new Error("close failed");
      }),
    });

    const result = await testUpstreamConnection(
      "stdio-close-failure",
      createStdioConfig(),
      {
        clientFactory: () => client,
        stdioTransportFactory: () => transport,
      },
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.tools).toEqual([
      { name: "time_util", description: "Time helper" },
    ]);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test("returns unknown transport error and closes the constructed client", async () => {
    const client = createClient();
    let clientFactoryCalls = 0;
    let stdioFactoryCalls = 0;
    let httpFactoryCalls = 0;
    const invalidConfig = {
      transport: "websocket",
      enabled: true,
      env: {},
    } as unknown as Parameters<typeof testUpstreamConnection>[1];

    const result = await testUpstreamConnection(
      "unknown-transport",
      invalidConfig,
      {
        clientFactory: () => {
          clientFactoryCalls += 1;
          return client;
        },
        stdioTransportFactory: () => {
          stdioFactoryCalls += 1;
          return createTransport();
        },
        httpTransportFactory: () => {
          httpFactoryCalls += 1;
          return createTransport() as unknown as StreamableHTTPClientTransport;
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unknown transport type: websocket");
    expect(clientFactoryCalls).toBe(1);
    expect(stdioFactoryCalls).toBe(0);
    expect(httpFactoryCalls).toBe(0);
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
