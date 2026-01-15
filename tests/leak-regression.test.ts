import { afterEach, describe, expect, mock, test } from "bun:test";
import { testUpstreamConnection } from "../src/upstream/client.js";

// Global variable to capture the mock process kill function
// biome-ignore lint/suspicious/noExplicitAny: mock requires flexible typing
let lastMockKill: any;

// Mock the SDK classes
mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => {
  return {
    StdioClientTransport: class MockStdioClientTransport {
      // biome-ignore lint/suspicious/noExplicitAny: mock requires flexible typing
      _process: any;
      // biome-ignore lint/suspicious/noExplicitAny: mock requires flexible typing
      stderr: any;

      // biome-ignore lint/suspicious/noExplicitAny: mock requires flexible typing
      constructor(_config: any) {
        // Create a new mock kill function for this instance
        const killFn = mock((_signal) => {
          return true;
        });

        lastMockKill = killFn;

        this._process = {
          killed: false,
          kill: killFn,
          on: mock(() => {}),
          stdin: { end: mock(() => {}) },
          stdout: { on: mock(() => {}) },
          stderr: { on: mock(() => {}) },
        };

        this.stderr = {
          on: mock(() => {}),
        };
      }

      async start() {}

      async close() {
        // CRITICAL: Replicate the real SDK behavior
        this._process = undefined;
      }
    },
  };
});

mock.module("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: class MockClient {
      // biome-ignore lint/suspicious/noExplicitAny: mock requires flexible typing
      transport: any;

      // biome-ignore lint/suspicious/noExplicitAny: mock requires flexible typing
      async connect(transport: any) {
        this.transport = transport;
        await transport.start();
      }

      getServerVersion() {
        return { name: "test-server", version: "1.0.0" };
      }

      async listTools() {
        return { tools: [] };
      }

      async close() {
        if (this.transport) {
          await this.transport.close();
        }
      }
    },
  };
});

describe("Regression Test: Process Leak", () => {
  afterEach(() => {
    lastMockKill = undefined;
  });

  test("ensures process is killed BEFORE client.close() clears the reference", async () => {
    const config = {
      transport: "stdio",
      enabled: true,
      stdio: {
        command: "echo",
        args: ["hello"],
      },
      // biome-ignore lint/suspicious/noExplicitAny: test config mock
    } as any;

    await testUpstreamConnection("test-upstream", config);

    expect(lastMockKill).toBeDefined();
    // This assertion passes ONLY if safelyCloseTransport ran before client.close()
    // If client.close() ran first, _process would be undefined, and safelyCloseTransport
    // would skip the kill call.
    expect(lastMockKill).toHaveBeenCalledWith("SIGTERM");
  });
});
