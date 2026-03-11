import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "@/config/schema";
import {
  buildCapabilityRouters,
  buildServerInstructions,
} from "@/server/capability-surface";

describe("server capability surface helpers", () => {
  test("buildServerInstructions describes capability-first action flow", () => {
    const instructions = buildServerInstructions();

    expect(instructions).toContain("__describe_actions");
    expect(instructions).toContain("action");
    expect(instructions).not.toContain("find_tools");
  });

  test("buildCapabilityRouters sorts inventories and prefers config overrides", () => {
    const routers = buildCapabilityRouters({
      statusEntries: [
        ["time", { status: "connected", error: undefined }],
        ["fetch", { status: "connected", error: undefined }],
        ["notes", { status: "disconnected", error: new Error("offline") }],
      ],
      getToolsForServer(namespace) {
        if (namespace === "time") {
          return [
            {
              name: "convert_time",
              description: "Convert timestamps\nSupports timezones",
              serverKey: "time",
              inputSchema: { type: "object" as const },
            },
          ];
        }

        if (namespace === "fetch") {
          return [
            {
              name: "fetch_url",
              description: "",
              serverKey: "fetch",
              inputSchema: { type: "object" as const },
            },
          ];
        }

        return [];
      },
      upstreams: {
        ...DEFAULT_CONFIG.upstreams,
        fetch: {
          transport: "stdio",
          enabled: true,
          env: {},
          label: "Docs Fetcher",
          stdio: {
            command: "fetch-server",
            args: [],
          },
        },
        time: {
          transport: "stdio",
          enabled: true,
          env: {},
          label: "Time Utils",
          stdio: {
            command: "time-server",
            args: [],
          },
        },
      },
      computedCapabilityOverrides: {
        fetch: "general",
      },
      configuredCapabilityOverrides: {
        fetch: "docs",
      },
    });

    expect(routers.map((router) => router.capability)).toEqual([
      "docs",
      "time_util",
    ]);

    const docsRouter = routers[0];
    expect(docsRouter?.actions).toHaveLength(1);
    expect(docsRouter?.actions[0]?.summary).toBe("Execute Docs action");

    const timeRouter = routers[1];
    expect(timeRouter?.actions[0]?.summary).toBe("Convert timestamps");
  });
});
