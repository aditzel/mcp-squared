import { afterEach, describe, expect, test } from "bun:test";
import { McpSquaredServer } from "@/server/index";

describe("McpSquaredServer", () => {
  let server: McpSquaredServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("can be instantiated with default options", () => {
    server = new McpSquaredServer();
    expect(server).toBeDefined();
    expect(server.isConnected()).toBe(false);
  });

  test("can be instantiated with custom options", () => {
    server = new McpSquaredServer({
      name: "test-server",
      version: "1.0.0",
    });
    expect(server).toBeDefined();
  });

  test("isConnected returns false before start", () => {
    server = new McpSquaredServer();
    expect(server.isConnected()).toBe(false);
  });

  test("exposes cataloger and retriever", () => {
    server = new McpSquaredServer();
    expect(server.getCataloger()).toBeDefined();
    expect(server.getRetriever()).toBeDefined();
  });
});
