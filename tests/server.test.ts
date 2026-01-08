import { describe, expect, test } from "bun:test";
import { McpSquaredServer } from "@/server/index";

describe("McpSquaredServer", () => {
  test("can be instantiated with default options", () => {
    const server = new McpSquaredServer();
    expect(server).toBeDefined();
    expect(server.isConnected()).toBe(false);
  });

  test("can be instantiated with custom options", () => {
    const server = new McpSquaredServer({
      name: "test-server",
      version: "1.0.0",
    });
    expect(server).toBeDefined();
  });

  test("isConnected returns false before start", () => {
    const server = new McpSquaredServer();
    expect(server.isConnected()).toBe(false);
  });
});
