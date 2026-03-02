import { describe, expect, test } from "bun:test";
import type { UpstreamServerConfig } from "@/config";
import {
  deleteUpstreamByName,
  getUpstreamEditMenuOptions,
  parseKeyValuePairsInput,
  saveSseUpstreamFromForm,
  saveStdioUpstreamFromForm,
  stringifyKeyValuePairsInput,
  type UpstreamMap,
} from "@/tui/upstream-edit";

function makeStdioUpstream(
  enabled = true,
): Extract<UpstreamServerConfig, { transport: "stdio" }> {
  return {
    transport: "stdio",
    enabled,
    env: { TOKEN: "$TOKEN" },
    stdio: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    },
  };
}

function makeSseUpstream(
  enabled = true,
): Extract<UpstreamServerConfig, { transport: "sse" }> {
  return {
    transport: "sse",
    enabled,
    env: { API_KEY: "$API_KEY" },
    sse: {
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer $API_KEY" },
    },
  };
}

describe("tui upstream edit helpers", () => {
  test("parse/stringify key-value helpers handle common input", () => {
    const parsed = parseKeyValuePairsInput(
      "FOO=bar, BAD, X=y=z, EMPTY=,  , =missing_key",
    );
    expect(parsed).toEqual({
      FOO: "bar",
      X: "y=z",
      EMPTY: "",
    });

    expect(stringifyKeyValuePairsInput(parsed)).toBe("FOO=bar, X=y=z, EMPTY=");
    expect(stringifyKeyValuePairsInput(undefined)).toBe("");
  });

  test("edit menu options include edit and delete actions", () => {
    const enabledOptions = getUpstreamEditMenuOptions(makeStdioUpstream(true));
    const enabledValues = enabledOptions.map((opt) => opt.value);
    expect(enabledValues).toEqual(["edit", "test", "toggle", "delete", "back"]);
    expect(enabledOptions[2]?.name).toBe("Disable");

    const disabledOptions = getUpstreamEditMenuOptions(makeSseUpstream(false));
    expect(disabledOptions[2]?.name).toBe("Enable");
  });

  test("saveStdioUpstreamFromForm updates existing upstream and preserves enabled state", () => {
    const upstreams: UpstreamMap = { github: makeStdioUpstream(false) };
    const existing = upstreams["github"];
    if (!existing || existing.transport !== "stdio") {
      expect.unreachable("Expected stdio upstream");
    }

    const result = saveStdioUpstreamFromForm({
      upstreams,
      name: "github",
      commandLine: "bunx -y @modelcontextprotocol/server-github",
      envInput: "GITHUB_TOKEN=$GITHUB_TOKEN",
      existingName: "github",
      existingUpstream: existing,
    });

    expect(result).toEqual({ ok: true, savedName: "github" });
    const updated = upstreams["github"];
    if (!updated || updated.transport !== "stdio") {
      expect.unreachable("Expected updated stdio upstream");
    }
    expect(updated.enabled).toBe(false);
    expect(updated.env).toEqual({ GITHUB_TOKEN: "$GITHUB_TOKEN" });
    expect(updated.stdio.command).toBe("bunx");
    expect(updated.stdio.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-github",
    ]);
  });

  test("saveStdioUpstreamFromForm rejects rename conflicts", () => {
    const upstreams: UpstreamMap = {
      github: makeStdioUpstream(),
      radar: makeStdioUpstream(),
    };
    const before = structuredClone(upstreams);
    const existing = upstreams["github"];
    if (!existing || existing.transport !== "stdio") {
      expect.unreachable("Expected stdio upstream");
    }

    const result = saveStdioUpstreamFromForm({
      upstreams,
      name: "radar",
      commandLine: "bunx -y @modelcontextprotocol/server-github",
      envInput: "",
      existingName: "github",
      existingUpstream: existing,
    });

    expect(result).toEqual({ ok: false, reason: "name_conflict" });
    expect(upstreams).toEqual(before);
  });

  test("saveSseUpstreamFromForm supports rename/edit and preserves enabled state", () => {
    const upstreams: UpstreamMap = { remote: makeSseUpstream(false) };
    const existing = upstreams["remote"];
    if (!existing || existing.transport !== "sse") {
      expect.unreachable("Expected SSE upstream");
    }

    const result = saveSseUpstreamFromForm({
      upstreams,
      name: "remote-prod",
      url: "https://api.example.com/prod/mcp",
      headersInput: "Authorization=Bearer $API_KEY, X-Env=prod",
      envInput: "API_KEY=$PROD_API_KEY",
      authEnabled: true,
      existingName: "remote",
      existingUpstream: existing,
    });

    expect(result).toEqual({ ok: true, savedName: "remote-prod" });
    expect(upstreams["remote"]).toBeUndefined();

    const updated = upstreams["remote-prod"];
    if (!updated || updated.transport !== "sse") {
      expect.unreachable("Expected updated SSE upstream");
    }
    expect(updated.enabled).toBe(false);
    expect(updated.env).toEqual({ API_KEY: "$PROD_API_KEY" });
    expect(updated.sse.url).toBe("https://api.example.com/prod/mcp");
    expect(updated.sse.headers).toEqual({
      Authorization: "Bearer $API_KEY",
      "X-Env": "prod",
    });
    expect(updated.sse.auth).toBe(true);
  });

  test("saveSseUpstreamFromForm rejects invalid URL input", () => {
    const upstreams: UpstreamMap = { remote: makeSseUpstream() };
    const before = structuredClone(upstreams);
    const existing = upstreams["remote"];
    if (!existing || existing.transport !== "sse") {
      expect.unreachable("Expected SSE upstream");
    }

    const result = saveSseUpstreamFromForm({
      upstreams,
      name: "remote",
      url: "not-a-valid-url",
      headersInput: "",
      envInput: "",
      authEnabled: false,
      existingName: "remote",
      existingUpstream: existing,
    });

    expect(result).toEqual({ ok: false, reason: "invalid_url" });
    expect(upstreams).toEqual(before);
  });

  test("deleteUpstreamByName removes upstreams deterministically", () => {
    const upstreams: UpstreamMap = { github: makeStdioUpstream() };

    expect(deleteUpstreamByName(upstreams, "github")).toBe(true);
    expect(upstreams["github"]).toBeUndefined();
    expect(deleteUpstreamByName(upstreams, "github")).toBe(false);
  });
});
