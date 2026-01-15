import { describe, expect, test, mock, afterEach } from "bun:test";
import { testUpstreamConnection } from "../src/upstream/client.js";

// Global variable to capture the mock process kill function
let lastMockKill: any;

// Mock the SDK classes
mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => {
  return {
    StdioClientTransport: class MockStdioClientTransport {
      _process: any;
      stderr: any;

      constructor(config: any) {
        // Create a new mock kill function for this instance
        const killFn = mock((signal) => {
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
            on: mock(() => {})
        };
      }

      async start() {}

      async close() {
        // CRITICAL: Replicate the real SDK behavior
        this._process = undefined;
      }
    }
  };
});

mock.module("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: class MockClient {
      transport: any;

      constructor(info: any) {}

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
    }
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
    } as any;

    await testUpstreamConnection("test-upstream", config);

    expect(lastMockKill).toBeDefined();
    // This assertion passes ONLY if safelyCloseTransport ran before client.close()
    // If client.close() ran first, _process would be undefined, and safelyCloseTransport 
    // would skip the kill call.
    expect(lastMockKill).toHaveBeenCalledWith("SIGTERM");
  });
});