import { describe, expect, mock, test } from "bun:test";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { safelyCloseTransport } from "../src/utils/transport.js";

describe("safelyCloseTransport", () => {
  test("kills subprocess on close for StdioClientTransport", async () => {
    // Mock child process
    const mockKill = mock(() => true);
    const mockProcess = {
      killed: false,
      kill: mockKill,
      on: mock(() => {}),
    };

    // Create a mock transport that mimics StdioClientTransport
    const transport = new StdioClientTransport({
      command: "echo",
    });

    // Inject our mock process
    Object.defineProperty(transport, "_process", {
      value: mockProcess,
      configurable: true,
    });

    // Mock close to simulate SDK behavior (returns promise)
    transport.close = mock(async () => {
      // SDK close implementation usually doesn't throw but might fail to kill
    });

    await safelyCloseTransport(transport);

    expect(transport.close).toHaveBeenCalled();
    expect(mockKill).toHaveBeenCalledWith("SIGTERM");
  });

  test("handles already killed process", async () => {
    const mockKill = mock(() => true);
    const mockProcess = {
      killed: true, // Already killed
      kill: mockKill,
      on: mock(() => {}),
    };

    const transport = new StdioClientTransport({
      command: "echo",
    });

    Object.defineProperty(transport, "_process", {
      value: mockProcess,
      configurable: true,
    });

    transport.close = mock(async () => {});

    await safelyCloseTransport(transport);

    expect(transport.close).toHaveBeenCalled();
    // Should NOT try to kill again
    expect(mockKill).not.toHaveBeenCalled();
  });

  test("does not crash if close throws", async () => {
    const mockKill = mock(() => true);
    const mockProcess = {
      killed: false,
      kill: mockKill,
      on: mock(() => {}),
    };

    const transport = new StdioClientTransport({
      command: "echo",
    });

    Object.defineProperty(transport, "_process", {
      value: mockProcess,
      configurable: true,
    });

    // Mock close to throw
    transport.close = mock(async () => {
      throw new Error("Close failed");
    });

    // Should not throw
    await safelyCloseTransport(transport);

    expect(transport.close).toHaveBeenCalled();
    expect(mockKill).toHaveBeenCalledWith("SIGTERM");
  });
});
