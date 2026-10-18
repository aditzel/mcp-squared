import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { AdapterContext } from "@/upstream/adapter";
import {
  createDefaultMcporterAdapter,
  createMcporterAdapter,
} from "@/upstream/adapters/mcporter";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function adapter(code: string) {
  const directory = mkdtempSync(join(tmpdir(), "mcp-adapter-"));
  directories.push(directory);
  const sdkPath = join(directory, "sdk.mjs");
  writeFileSync(sdkPath, code);
  return createMcporterAdapter({ sdkPath });
}
const context: AdapterContext = {
  key: "fixture",
  config: {
    transport: "stdio",
    enabled: true,
    env: { FIXTURE: "value" },
    stdio: { command: "worker", args: ["arg"] },
  },
};
const client = new Client({ name: "fixture", version: "1" });

describe("generated SDK adapter contract", () => {
  test("passes command arguments and environment to the SDK factory", async () => {
    const instance = adapter(
      "export const createTransport = async options => ({fixtureOptions: options});",
    );
    expect(instance.transportType).toBe("stdio");
    expect(await instance.createTransport(context)).toMatchObject({
      transport: {
        fixtureOptions: {
          command: "worker",
          args: ["arg"],
          env: { FIXTURE: "value" },
        },
      },
    });
    const remote: AdapterContext = {
      key: "remote",
      config: {
        transport: "sse",
        enabled: true,
        env: {},
        sse: { url: "https://example.test", headers: {} },
      },
    };
    expect(await instance.createTransport(remote)).toMatchObject({
      transport: { fixtureOptions: { command: "", args: [], env: {} } },
    });
    expect(await instance.postConnect?.(context, client)).toEqual({ ok: true });
    expect(createDefaultMcporterAdapter().transportType).toBe("stdio");
  });
  test("rejects absent factory and returns validation failures without throwing", async () => {
    await expect(
      adapter("export const other = true;").createTransport(context),
    ).rejects.toThrow("does not export createTransport()");
    expect(
      await adapter(
        "export const validate = async () => ({ok:false,error:'unhealthy'});",
      ).postConnect?.(context, client),
    ).toEqual({ ok: false, error: "unhealthy" });
    for (const thrown of ["new Error('failure')", "'opaque failure'"]) {
      const result = await adapter(
        `export const validate = async () => {throw ${thrown};};`,
      ).postConnect?.(context, client);
      expect(result).toEqual({
        ok: false,
        error: thrown.startsWith("new") ? "failure" : "opaque failure",
      });
    }
  });
});
