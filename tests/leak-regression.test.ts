import { afterEach, describe, expect, mock, test } from "bun:test";
import { testUpstreamConnection } from "../src/upstream/client.js";

// Global variable to capture the mock process kill function
// biome-ignore lint/suspicious/noExplicitAny: mock requires flexible typing
let lastMockKill: any;

class MockStdioClientTransport {
  // biome-ignore lint/suspicious/noExplicitAny: mock requires flexible typing
  _process: any;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  // biome-ignore lint/suspicious/noExplicitAny: test transport hook
  onmessage?: (message: any) => void;

  constructor() {
    const killFn = mock((_signal) => true);
    lastMockKill = killFn;
    this._process = {
      killed: false,
      kill: killFn,
      on: mock(() => {}),
      stdin: { end: mock(() => {}) },
      stdout: { on: mock(() => {}) },
      stderr: { on: mock(() => {}) },
    };
  }

  async start() {}

  // biome-ignore lint/suspicious/noExplicitAny: test transport mock
  async send(_message: any) {}

  async close() {
    // CRITICAL: Replicate the real SDK behavior
    this._process = undefined;
  }
}

class MockClient {
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
}

describe.serial("Regression Test: Process Leak", () => {
  afterEach(() => {
    lastMockKill = undefined;
    mock.restore();
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

    await testUpstreamConnection("test-upstream", config, {
      clientFactory: () => new MockClient(),
      stdioTransportFactory: () => new MockStdioClientTransport(),
    });

    expect(lastMockKill).toBeDefined();
    // This assertion passes ONLY if safelyCloseTransport ran before client.close()
    // If client.close() ran first, _process would be undefined, and safelyCloseTransport
    // would skip the kill call.
    expect(lastMockKill).toHaveBeenCalledWith("SIGTERM");
  });
});
