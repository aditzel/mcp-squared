import { expect, mock, test } from "bun:test";
import type {
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
} from "@opentui/core";
import {
  DEFAULT_CONFIG,
  getDefaultConfigPath,
  type McpSquaredConfig,
  type UpstreamServerConfig,
} from "../../src/config/index.js";
import { createConfigTuiRunner } from "../../src/tui/config.js";
import type { TestResult } from "../../src/upstream/index.js";
import { createTuiHarness, settleTui } from "../helpers/tui-renderer.js";

function stdio(): UpstreamServerConfig {
  return {
    transport: "stdio",
    enabled: true,
    env: {},
    stdio: { command: "bun", args: ["server.ts"] },
  };
}

function sse(): UpstreamServerConfig {
  return {
    transport: "sse",
    enabled: true,
    env: {},
    sse: { url: "https://example.test/mcp", headers: {} },
  };
}

async function configTui(upstreams: Record<string, UpstreamServerConfig> = {}) {
  const tui = await createTuiHarness();
  const config = structuredClone(DEFAULT_CONFIG);
  config.upstreams = upstreams;
  const exit = mock((_code: number) => {});
  const saved: Array<{ path: string; config: McpSquaredConfig }> = [];
  const saveConfig = mock(
    async (path: string, nextConfig: McpSquaredConfig) => {
      saved.push({ path, config: structuredClone(nextConfig) });
    },
  );
  const loadConfig = mock(async () => ({
    config,
    path: "/test/config.toml",
    source: "user" as const,
  }));
  const result: TestResult = {
    success: true,
    serverName: "Example",
    serverVersion: "1.2",
    tools: [],
    durationMs: 17,
    error: undefined,
    stderr: undefined,
  };
  const testUpstreamConnection = mock(
    async (_name: string, _upstream: UpstreamServerConfig) => result,
  );
  const run = createConfigTuiRunner({
    createRenderer: async () => tui.renderer,
    loadConfig,
    saveConfig,
    testUpstreamConnection,
    exit,
  });
  return {
    ...tui,
    config,
    exit,
    saved,
    saveConfig,
    loadConfig,
    testUpstreamConnection,
    result,
    start: run,
    fill(id: string, value: string) {
      tui.node<InputRenderable>(id).value = value;
    },
    add(transport: "stdio" | "sse") {
      tui.choose("config-menu", "upstreams");
      tui.choose("upstreams-menu", "add");
      tui.choose("transport-menu", transport);
    },
    edit(name: string) {
      tui.choose("config-menu", "upstreams");
      tui.choose("upstreams-menu", "edit", name);
    },
    async save() {
      tui.choose("upstreams-menu", "back");
      tui.choose("config-menu", "save");
      await settleTui();
    },
  };
}

test("configuration loads into the actual menu and clean Ctrl-C exits", async () => {
  const tui = await configTui();
  await tui.start();
  expect(await tui.frame()).toContain("Upstream Servers (0)");
  tui.mockInput.pressKey("c");
  expect(tui.exit).not.toHaveBeenCalled();
  tui.mockInput.pressCtrlC();
  expect(tui.exit).toHaveBeenCalledWith(0);
});

test("missing configuration falls back to defaults and saves at the default path", async () => {
  const tui = await configTui();
  tui.loadConfig.mockRejectedValueOnce(new Error("unreadable configuration"));
  await tui.start();
  expect(await tui.frame()).toContain("Upstream Servers (0)");
  tui.add("stdio");
  tui.fill("name-input", "local");
  tui.fill("command-input", "bun server.ts");
  tui.choose("submit-select", "save");
  await tui.save();
  expect(tui.saved[0]?.path).toBe(getDefaultConfigPath().path);
  expect(tui.saved[0]?.config.upstreams["local"]).toMatchObject({
    stdio: { command: "bun", args: ["server.ts"] },
  });
  expect(DEFAULT_CONFIG.upstreams).toEqual({});
});

test("clean save does not write and ordinary Exit destroys the renderer", async () => {
  const tui = await configTui();
  await tui.start();
  tui.choose("config-menu", "save");
  await settleTui();
  expect(tui.saveConfig).not.toHaveBeenCalled();
  expect(tui.text("config-version")).not.toContain("unsaved changes");
  tui.choose("config-menu", "exit");
  expect(tui.exit).toHaveBeenCalledWith(0);
});

test("security and operations display loaded values and return using menu or Escape", async () => {
  const tui = await configTui();
  tui.config.security.tools = {
    allow: ["docs/*"],
    block: ["shell/*"],
    confirm: ["write/*"],
  };
  tui.config.operations.findTools.defaultLimit = 7;
  tui.config.operations.findTools.maxLimit = 30;
  tui.config.operations.logging.level = "warn";
  await tui.start();
  tui.mockInput.pressArrow("down");
  tui.mockInput.pressEnter();
  expect(tui.text("allow-label")).toBe("Allow patterns: docs/*");
  expect(tui.text("block-label")).toBe("Block patterns: shell/*");
  expect(tui.text("confirm-label")).toBe("Confirm patterns: write/*");
  tui.mockInput.pressKey("x");
  expect(tui.find("security-back")).toBeDefined();
  tui.mockInput.pressEscape();
  tui.choose("config-menu", "operations");
  expect(tui.text("limit-label")).toBe("Default find_tools limit: 7");
  expect(tui.text("max-limit-label")).toBe("Max find_tools limit: 30");
  expect(tui.text("log-label")).toBe("Log level: warn");
  tui.mockInput.pressKey("x");
  tui.mockInput.pressEscape();
  tui.choose("config-menu", "security");
  tui.choose("security-back", "back");
  tui.choose("config-menu", "operations");
  tui.choose("ops-back", "back");
  expect(tui.find("config-menu")).toBeDefined();
  expect(tui.saveConfig).not.toHaveBeenCalled();
});

test("empty security policies render none and upstream menu Escape returns immediately", async () => {
  const tui = await configTui();
  tui.config.security.tools = { allow: [], block: [], confirm: [] };
  await tui.start();
  tui.choose("config-menu", "security");
  for (const id of ["allow-label", "block-label", "confirm-label"])
    expect(tui.text(id)).toEndWith("(none)");
  tui.mockInput.pressEscape();
  tui.choose("config-menu", "upstreams");
  tui.mockInput.pressEscape();
  expect(tui.find("config-menu")).toBeDefined();
  tui.choose("config-menu", "upstreams");
  tui.choose("upstreams-menu", "add");
  tui.choose("transport-menu", "back");
  expect(tui.find("upstreams-menu")).toBeDefined();
});

test("stdio validation focuses required fields and a valid form persists parsed arguments and environment", async () => {
  const tui = await configTui();
  await tui.start();
  tui.add("stdio");
  tui.choose("submit-select", "save");
  expect(tui.node<InputRenderable>("name-input").focused).toBe(true);
  tui.fill("name-input", " local ");
  tui.choose("submit-select", "save");
  expect(tui.node<InputRenderable>("command-input").focused).toBe(true);
  tui.fill("command-input", "bun server.ts --verbose");
  tui.fill("env-input", "MODE=test, TOKEN=$TEST_TOKEN");
  tui.choose("submit-select", "save");
  expect(tui.text("config-version")).toContain("unsaved changes");
  const option = tui
    .node<SelectRenderable>("upstreams-menu")
    .options.find((option) => option.name.includes("local"));
  expect(option?.description).toBe("bun server.ts --verbose (2 env vars)");
  await tui.save();
  expect(tui.saved).toHaveLength(1);
  expect(tui.saved[0]?.config.upstreams["local"]).toEqual({
    transport: "stdio",
    enabled: true,
    stdio: { command: "bun", args: ["server.ts", "--verbose"] },
    env: { MODE: "test", TOKEN: "$TEST_TOKEN" },
  });
  expect(tui.text("config-version")).not.toContain("unsaved changes");
  expect(tui.config.upstreams).toEqual({});
});

test("stdio keyboard focus wraps, typing reaches each focused input, and cancel removes form handlers", async () => {
  const tui = await configTui();
  await tui.start();
  tui.add("stdio");
  tui.mockInput.pressTab({ shift: true });
  expect(tui.node<SelectRenderable>("submit-select").focused).toBe(true);
  tui.mockInput.pressTab();
  await tui.mockInput.typeText("local");
  expect(tui.node<InputRenderable>("name-input").value).toBe("local");
  tui.mockInput.pressTab();
  await tui.mockInput.typeText("bun server.ts");
  expect(tui.node<InputRenderable>("command-input").value).toBe(
    "bun server.ts",
  );
  tui.mockInput.pressTab();
  await tui.mockInput.typeText("MODE=test");
  expect(tui.node<InputRenderable>("env-input").value).toBe("MODE=test");
  tui.choose("submit-select", "cancel");
  expect(tui.find("transport-menu")).toBeDefined();
  tui.mockInput.pressTab();
  expect(tui.node<SelectRenderable>("transport-menu").focused).toBe(true);
  tui.choose("transport-menu", "stdio");
  tui.mockInput.pressEscape();
  expect(tui.find("transport-menu")).toBeDefined();
  expect(tui.saveConfig).not.toHaveBeenCalled();
});

test("SSE validates empty and invalid URL, then saves headers, OAuth, and environment", async () => {
  const tui = await configTui();
  await tui.start();
  tui.add("sse");
  tui.choose("submit-select", "save");
  expect(tui.node<InputRenderable>("name-input").focused).toBe(true);
  tui.fill("name-input", "remote");
  tui.choose("submit-select", "save");
  expect(tui.node<InputRenderable>("url-input").focused).toBe(true);
  tui.fill("url-input", "not a url");
  tui.choose("submit-select", "save");
  expect(tui.node<InputRenderable>("url-input").focused).toBe(true);
  expect(tui.find("upstreams-menu")).toBeUndefined();
  tui.fill("url-input", "https://example.test/mcp");
  tui.fill("headers-input", "Authorization=Bearer $TEST_TOKEN");
  tui.fill("env-input", "TEST_TOKEN=$TOKEN");
  tui.choose("auth-select", "enabled");
  tui.choose("submit-select", "save");
  await tui.save();
  expect(tui.saved[0]?.config.upstreams["remote"]).toMatchObject({
    enabled: true,
    transport: "sse",
    env: { TEST_TOKEN: "$TOKEN" },
    sse: {
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer $TEST_TOKEN" },
      auth: true,
    },
  });
});

test("SSE keyboard and typing honor six-field focus order; cancel and Escape discard new input", async () => {
  const tui = await configTui();
  await tui.start();
  tui.add("sse");
  tui.mockInput.pressTab({ shift: true });
  expect(tui.node<SelectRenderable>("submit-select").focused).toBe(true);
  tui.mockInput.pressTab();
  await tui.mockInput.typeText("remote");
  expect(tui.node<InputRenderable>("name-input").value).toBe("remote");
  tui.mockInput.pressTab();
  await tui.mockInput.typeText("https://example.test/mcp");
  expect(tui.node<InputRenderable>("url-input").value).toBe(
    "https://example.test/mcp",
  );
  tui.mockInput.pressTab();
  await tui.mockInput.typeText("X-Test=1");
  expect(tui.node<InputRenderable>("headers-input").value).toBe("X-Test=1");
  tui.mockInput.pressTab();
  expect(tui.node<SelectRenderable>("auth-select").focused).toBe(true);
  tui.mockInput.pressTab();
  await tui.mockInput.typeText("MODE=test");
  expect(tui.node<InputRenderable>("env-input").value).toBe("MODE=test");
  tui.choose("submit-select", "cancel");
  tui.choose("transport-menu", "sse");
  tui.mockInput.pressEscape();
  expect(tui.find("transport-menu")).toBeDefined();
  tui.choose("transport-menu", "back");
  await tui.save();
  expect(tui.saveConfig).not.toHaveBeenCalled();
});

test.each([
  "stdio",
  "sse",
] as const)("%s edits preserve disabled state, reject rename collisions, and rename atomically on save", async (transport) => {
  const upstream = transport === "stdio" ? stdio() : sse();
  upstream.enabled = false;
  upstream.env = {
    TOKEN: "$TOKEN",
    INLINE: "private-value",
    THIRD: "third",
    FOURTH: "fourth",
  };
  if (upstream.transport === "sse")
    upstream.sse.auth = { callbackPort: 9099, clientName: "Test client" };
  const tui = await configTui({ original: upstream, existing: stdio() });
  await tui.start();
  tui.edit("original");
  expect(tui.text("edit-env-TOKEN")).toContain("$TOKEN");
  expect(tui.text("edit-env-INLINE")).toContain("***");
  expect(tui.text("edit-env-more")).toContain("1 more");
  if (transport === "sse") expect(tui.text("edit-auth")).toBe("OAuth: Enabled");
  tui.choose("edit-menu", "edit");
  expect(tui.node<InputRenderable>("name-input").value).toBe("original");
  tui.fill("name-input", "existing");
  tui.choose("submit-select", "save");
  expect(tui.node<InputRenderable>("name-input").focused).toBe(true);
  expect(tui.find("submit-select")).toBeDefined();
  tui.fill("name-input", "renamed");
  if (transport === "sse") tui.choose("auth-select", "disabled");
  tui.choose("submit-select", "save");
  await tui.save();
  expect(tui.saved[0]?.config.upstreams["original"]).toBeUndefined();
  expect(tui.saved[0]?.config.upstreams["existing"]).toEqual(stdio());
  expect(tui.saved[0]?.config.upstreams["renamed"]?.enabled).toBe(false);
  if (transport === "sse")
    expect(tui.saved[0]?.config.upstreams["renamed"]).toMatchObject({
      sse: { url: "https://example.test/mcp" },
    });
  expect(tui.config.upstreams["original"]?.enabled).toBe(false);
});

test.each([
  "stdio",
  "sse",
] as const)("%s edit cancel and Escape return to unchanged details; toggle and delete persist", async (transport) => {
  const upstream = transport === "stdio" ? stdio() : sse();
  const tui = await configTui({ original: upstream });
  await tui.start();
  tui.edit("original");
  expect(tui.text("edit-env-none")).toBe("  (none)");
  if (transport === "sse") {
    expect(tui.text("edit-headers")).toBe("Headers: (none)");
    expect(tui.text("edit-auth")).toBe("OAuth: Disabled");
  }
  tui.choose("edit-menu", "edit");
  tui.fill("name-input", "discard-me");
  tui.choose("submit-select", "cancel");
  expect(tui.node<BoxRenderable>("edit-upstream-box").title).toBe(
    "Edit: original",
  );
  tui.choose("edit-menu", "edit");
  tui.mockInput.pressEscape();
  expect(tui.node<BoxRenderable>("edit-upstream-box").title).toBe(
    "Edit: original",
  );
  tui.choose("edit-menu", "toggle");
  expect(
    tui
      .node<SelectRenderable>("edit-menu")
      .options.find((option) => option.value === "toggle")?.name,
  ).toContain("Enable");
  tui.choose("edit-menu", "toggle");
  expect(
    tui
      .node<SelectRenderable>("edit-menu")
      .options.find((option) => option.value === "toggle")?.name,
  ).toContain("Disable");
  tui.choose("edit-menu", "back");
  tui.choose("upstreams-menu", "edit", "original");
  tui.choose("edit-menu", "delete");
  expect(tui.node<SelectRenderable>("upstreams-menu").options).toHaveLength(2);
  await tui.save();
  expect(tui.saved[0]?.config.upstreams).toEqual({});
  expect(tui.config.upstreams["original"]).toEqual(upstream);
});

test.each([
  { success: true, serverName: "Example", serverVersion: "2.0", count: 10 },
  { success: true, serverName: "Example", serverVersion: undefined, count: 0 },
  { success: true, serverName: undefined, serverVersion: undefined, count: 1 },
  { success: false, serverName: undefined, serverVersion: undefined, count: 0 },
])("connection test renders response and returns to editing: $success/$count", async (row) => {
  const tui = await configTui({ remote: sse() });
  Object.assign(tui.result, row, {
    tools: Array.from({ length: row.count }, (_, i) => ({ name: `tool-${i}` })),
    error: "Connection refused",
  });
  await tui.start();
  tui.edit("remote");
  tui.choose("edit-menu", "test");
  expect(tui.text("test-status")).toBe("Connecting...");
  await settleTui();
  expect(tui.testUpstreamConnection).toHaveBeenCalledWith("remote", sse());
  expect(tui.text("test-time")).toBe("Time: 17ms");
  if (row.success) {
    expect(tui.text("test-tools-header")).toBe(`Tools available: ${row.count}`);
    if (row.serverName)
      expect(tui.text("test-server")).toBe(
        `Server: Example${row.serverVersion ? " v2.0" : ""}`,
      );
    else expect(tui.find("test-server")).toBeUndefined();
    if (row.count > 8) {
      expect(tui.text("test-tools-more")).toContain("2 more");
      expect(tui.find("test-tool-8")).toBeUndefined();
    }
  } else expect(tui.text("test-error")).toBe("Error: Connection refused");
  tui.choose("test-back", "back");
  expect(tui.node<BoxRenderable>("edit-upstream-box").title).toBe(
    "Edit: remote",
  );
  expect(tui.saveConfig).not.toHaveBeenCalled();
});

test.each([
  "save-exit",
  "exit",
  "cancel",
])("dirty exit offers %s with explicit persistence semantics", async (choice) => {
  const tui = await configTui({ local: stdio() });
  await tui.start();
  tui.edit("local");
  tui.choose("edit-menu", "toggle");
  tui.mockInput.pressCtrlC();
  expect(tui.node<BoxRenderable>("confirm-box").title).toBe("Unsaved Changes");
  tui.choose("confirm-menu", choice);
  await settleTui();
  if (choice === "cancel") {
    expect(tui.exit).not.toHaveBeenCalled();
    expect(tui.find("config-menu")).toBeDefined();
    expect(tui.text("config-version")).toContain("unsaved changes");
  } else expect(tui.exit).toHaveBeenCalledWith(0);
  expect(tui.saved).toHaveLength(choice === "save-exit" ? 1 : 0);
  if (choice === "save-exit")
    expect(tui.saved[0]?.config.upstreams["local"]?.enabled).toBe(false);
});

test("ordinary save rejection preserves dirty state and supports a successful retry", async () => {
  const tui = await configTui({ local: stdio() });
  tui.saveConfig.mockRejectedValueOnce(new Error("write rejected"));
  await tui.start();
  tui.edit("local");
  tui.choose("edit-menu", "toggle");
  tui.choose("edit-menu", "back");
  await tui.save();
  expect(tui.saved).toHaveLength(0);
  expect(tui.text("config-version")).toContain("unsaved changes");
  expect(tui.exit).not.toHaveBeenCalled();
  tui.choose("config-menu", "save");
  await settleTui();
  expect(tui.saved).toHaveLength(1);
  expect(tui.text("config-version")).not.toContain("unsaved changes");
});

test("editing SSE keeps OAuth enabled and exposes header and single environment counts", async () => {
  const upstream = sse();
  if (upstream.transport !== "sse") throw new Error("Expected SSE fixture");
  upstream.env = { TOKEN: "$TOKEN" };
  upstream.sse.headers = { Authorization: "Bearer $TOKEN" };
  upstream.sse.auth = true;
  const tui = await configTui({ remote: upstream });
  await tui.start();
  tui.choose("config-menu", "upstreams");
  expect(
    tui
      .node<SelectRenderable>("upstreams-menu")
      .options.find((option) => option.name.includes("remote"))?.description,
  ).toEndWith("(1 env var)");
  tui.choose("upstreams-menu", "edit", "remote");
  expect(tui.text("edit-headers")).toBe("Headers: 1");
  expect(tui.text("edit-env-TOKEN")).toBe("  TOKEN=$TOKEN");
  expect(tui.find("edit-env-more")).toBeUndefined();
  tui.choose("edit-menu", "edit");
  expect(tui.node<InputRenderable>("headers-input").value).toBe(
    "Authorization=Bearer $TOKEN",
  );
  expect(
    tui.node<SelectRenderable>("auth-select").getSelectedOption()?.value,
  ).toBe("enabled");
  tui.fill("url-input", "https://new.example.test/mcp");
  tui.choose("submit-select", "save");
  await tui.save();
  expect(tui.saved[0]?.config.upstreams["remote"]).toMatchObject({
    sse: {
      auth: true,
      url: "https://new.example.test/mcp",
    },
  });
});

test("configuration runners clone and save independent state without sharing injected dependencies", async () => {
  const first = await configTui({ local: stdio() });
  const second = await configTui({ remote: sse() });
  await first.start();
  await second.start();
  first.edit("local");
  first.choose("edit-menu", "toggle");
  first.choose("edit-menu", "back");
  await first.save();
  expect(first.saved[0]?.config.upstreams["local"]?.enabled).toBe(false);
  expect(second.saved).toHaveLength(0);
  expect(second.text("config-version")).not.toContain("unsaved changes");
  second.choose("config-menu", "exit");
  expect(second.exit).toHaveBeenCalledWith(0);
  expect(first.exit).not.toHaveBeenCalled();
});
