import { expect, mock, test } from "bun:test";
import { type BoxRenderable, RGBA, TextRenderable } from "@opentui/core";
import type { InstanceRegistryEntry } from "../../src/config/index.js";
import type { ServerStats, ToolStats } from "../../src/server/stats.js";
import {
  createMonitorTuiRunner,
  type MonitorTuiOptions,
} from "../../src/tui/monitor.js";
import type { ClientInfo, UpstreamInfo } from "../../src/tui/monitor-client.js";
import { createTuiHarness, settleTui } from "../helpers/tui-renderer.js";

function stats(): ServerStats {
  return {
    uptime: 65_000,
    timestamp: Date.now(),
    activeConnections: 2,
    requests: {
      total: 100,
      successful: 98,
      failed: 2,
      totalResponseTime: 1234,
      minResponseTime: 1,
      maxResponseTime: 90,
    },
    memory: {
      heapUsed: 768,
      heapTotal: 1024,
      rss: 1024 ** 2,
      external: 1024 ** 3,
      arrayBuffers: 32,
    },
    index: {
      toolCount: 10,
      embeddingCount: 8,
      cooccurrenceCount: 12,
      lastRefreshTime: Date.now() - 120_000,
    },
    cache: { hits: 75, misses: 25, size: 20 },
  };
}

function tool(overrides: Partial<ToolStats> = {}): ToolStats {
  return {
    name: "search",
    serverKey: "docs",
    callCount: 10,
    successCount: 9,
    failureCount: 1,
    avgResponseTime: 12.3,
    lastCallTime: Date.now() - 5_000,
    ...overrides,
  };
}

function instance(
  id: string,
  extra: Partial<InstanceRegistryEntry> = {},
): InstanceRegistryEntry {
  return {
    id,
    pid: 123,
    socketPath: `/tmp/${id}.sock`,
    startedAt: Date.now(),
    ...extra,
  };
}

async function monitor(
  options: MonitorTuiOptions = {
    socketPath: "/test/monitor.sock",
    refreshInterval: 0,
  },
) {
  const tui = await createTuiHarness();
  const data = {
    stats: stats(),
    tools: [] as ToolStats[],
    upstreams: [] as UpstreamInfo[],
    clients: [] as ClientInfo[],
    connected: false,
  };
  const client = {
    connect: mock(async () => {
      data.connected = true;
    }),
    disconnect: mock(() => {
      data.connected = false;
    }),
    isClientConnected: mock(() => data.connected),
    getStats: mock(async () => data.stats),
    getTools: mock(async (_limit: number) => data.tools),
    getUpstreams: mock(async () => data.upstreams),
    getClients: mock(async () => data.clients),
  };
  let tick: (() => void) | undefined;
  const timer = 42 as unknown as ReturnType<typeof setInterval>;
  const schedule = mock((callback: () => void, _interval?: number) => {
    tick = callback;
    return timer;
  });
  const cancel = mock((_timer: ReturnType<typeof setInterval>) => {});
  const exit = mock((_code: number) => {});
  const createClient = mock((_socketPath: string) => client);
  const run = createMonitorTuiRunner({
    createRenderer: async () => tui.renderer,
    createClient,
    setInterval: schedule,
    clearInterval: cancel,
    exit,
  });
  return {
    ...tui,
    data,
    client,
    createClient,
    exit,
    schedule,
    cancel,
    timer,
    start: () => run(options),
    async refresh() {
      tui.mockInput.pressKey("r");
      await settleTui();
    },
    async tick() {
      if (!tick) throw new Error("Refresh timer was not scheduled");
      tick();
      await settleTui();
    },
    detail() {
      const panel = tui.node<BoxRenderable>("monitor-detail-panel");
      return panel
        .getChildren()
        .filter(
          (node): node is TextRenderable => node instanceof TextRenderable,
        )
        .map((node) => node.content.chunks.map((chunk) => chunk.text).join(""))
        .join("\n");
    },
  };
}

const cardTitles = [
  "Server Status",
  "Index Statistics",
  "Request Statistics",
  "Cache Statistics",
  "Upstream Health",
  "Active Clients",
  "Memory Usage",
  "Top Tools by Usage",
];

test("empty instance selection is rendered and quits without opening a client", async () => {
  const tui = await monitor({ instances: [] });
  await tui.start();
  expect(tui.text("monitor-selection-title")).toBe(
    "No running MCP² instances found.",
  );
  expect(await tui.frame()).toContain("Press q to quit.");
  tui.mockInput.pressArrow("down");
  tui.mockInput.pressEnter();
  expect(tui.createClient).not.toHaveBeenCalled();
  tui.mockInput.pressKey("q");
  expect(tui.exit).toHaveBeenCalledWith(0);
  expect(tui.cancel).not.toHaveBeenCalled();
});

test("instance navigation clamps at either end and connects the chosen endpoint", async () => {
  const tui = await monitor({
    instances: [
      instance("first"),
      instance("second", {
        command: "/usr/bin/bun server.ts",
        processName: "bun",
        user: "tester",
        role: "daemon",
        ppid: 42,
        launcher: "terminal",
        parentProcessName: "zsh",
        parentCommand: "zsh -l",
        cwd: "/workspace",
        configPath: "/workspace/mcp.toml",
      }),
    ],
    refreshInterval: 0,
  });
  await tui.start();
  expect(tui.text("monitor-selection-detail-command")).toBe("Command: unknown");
  expect(tui.text("monitor-selection-detail-launcher")).toBe(
    "Launcher: unknown",
  );
  tui.mockInput.pressArrow("up");
  tui.mockInput.pressKey("k");
  expect(tui.text("monitor-selection-item-first")).toStartWith("› ");
  tui.mockInput.pressArrow("down");
  tui.mockInput.pressKey("j");
  expect(tui.text("monitor-selection-item-second")).toStartWith(
    "› daemon second",
  );
  expect(tui.text("monitor-selection-detail-pid")).toContain(
    "ppid: 42, user: tester, exe: bun",
  );
  expect(tui.text("monitor-selection-detail-config")).toBe(
    "Config: /workspace/mcp.toml",
  );
  tui.mockInput.pressEnter();
  await settleTui();
  expect(tui.createClient).toHaveBeenCalledWith("/tmp/second.sock");
  expect(tui.find("monitor-selection-title")).toBeUndefined();
  expect(tui.text("server-status-health")).toBe("Health: Healthy");
});

test("one discovered instance connects automatically; scheduled refresh and Ctrl-C clean up", async () => {
  const tui = await monitor({
    instances: [instance("only")],
    refreshInterval: 15,
  });
  await tui.start();
  expect(tui.createClient).toHaveBeenCalledWith("/tmp/only.sock");
  expect(tui.client.connect).toHaveBeenCalledTimes(1);
  expect(tui.schedule).toHaveBeenCalledWith(expect.any(Function), 15);
  tui.data.stats.requests.total = 150;
  await tui.tick();
  expect(tui.text("request-stats-total")).toBe("Total: 150");
  expect(tui.client.connect).toHaveBeenCalledTimes(1);
  expect(tui.client.getTools).toHaveBeenCalledWith(10);
  tui.mockInput.pressCtrlC();
  expect(tui.client.disconnect).toHaveBeenCalledTimes(1);
  expect(tui.cancel).toHaveBeenCalledWith(tui.timer);
  expect(tui.exit).toHaveBeenCalledWith(0);
});

test("default endpoint and interval are used when no selection or options are supplied", async () => {
  const tui = await monitor({});
  await tui.start();
  expect(tui.createClient.mock.calls[0]?.[0]).toEndWith(".sock");
  expect(tui.schedule).toHaveBeenCalledWith(expect.any(Function), 2000);
  tui.mockInput.pressKey("q");
});

test("dashboard exposes real metrics, keyboard focus, all detail cards, and help overlays", async () => {
  const tui = await monitor();
  tui.data.tools = [
    tool(),
    tool({ name: "perfect", successCount: 10, failureCount: 0 }),
    tool({
      name: "unused",
      callCount: 0,
      successCount: 0,
      failureCount: 0,
      lastCallTime: 0,
    }),
  ];
  tui.data.upstreams = [
    {
      key: "working",
      status: "connected",
      transport: "stdio",
      toolCount: 4,
      serverName: "Local",
      serverVersion: "1.0",
      toolNames: ["read", "write"],
    },
    { key: "signin", status: "connected", authPending: true, transport: "sse" },
    { key: "broken", status: "error", error: "connection refused" },
    {
      key: "offline",
      status: "disconnected",
      serverName: "Offline",
      toolNames: [],
    },
  ];
  tui.data.clients = [
    {
      sessionId: "visitor",
      connectedAt: Date.now() - 3600_000,
      lastSeen: Date.now() - 120_000,
      isOwner: false,
    },
    {
      sessionId: "owner",
      clientId: "dashboard",
      connectedAt: Date.now() - 86400_000,
      lastSeen: Date.now() - 5_000,
      isOwner: true,
    },
    {
      sessionId: "recent",
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      isOwner: false,
    },
  ];
  await tui.start();
  expect(tui.text("request-stats-rate")).toBe("Success Rate: 98.0%");
  expect(tui.text("request-stats-avg-time")).toBe("Avg Response: 12.34ms");
  expect(tui.text("memory-stats-rss")).toBe("RSS: 1.00 MB");
  expect(tui.text("upstream-status-line-0")).toBe(
    "Connected 1/4 | Auth 1 | Errors 1",
  );
  expect(tui.text("upstream-status-line-2")).toContain("ER broken");
  expect(tui.text("client-status-line-1")).toContain("* dashboard");
  expect(await tui.frame()).toContain("[>] Server Status");
  tui.mockInput.pressTab({ shift: true });
  tui.mockInput.pressEnter();
  expect(tui.node<BoxRenderable>("monitor-detail-panel").title).toBe(
    "Top Tools by Usage Detail",
  );
  expect(tui.detail()).toContain("never");
  expect(tui.detail()).toContain("failures: 1");
  tui.mockInput.pressTab();
  for (const title of cardTitles) {
    expect(tui.node<BoxRenderable>("monitor-detail-panel").title).toBe(
      `${title} Detail`,
    );
    expect(tui.text("monitor-instructions")).toContain(
      "Esc/Enter: Close detail",
    );
    tui.mockInput.pressTab();
  }
  tui.mockInput.pressTab({ shift: true });
  expect(tui.node<BoxRenderable>("monitor-detail-panel").title).toBe(
    "Top Tools by Usage Detail",
  );
  tui.mockInput.pressKey("?");
  expect(tui.find("monitor-help-overlay")).toBeDefined();
  tui.mockInput.pressTab();
  expect(tui.node<BoxRenderable>("monitor-detail-panel").title).toBe(
    "Top Tools by Usage Detail",
  );
  tui.mockInput.pressEscape();
  expect(tui.find("monitor-help-overlay")).toBeUndefined();
  tui.mockInput.pressKey("?");
  tui.mockInput.pressKey("?");
  expect(tui.find("monitor-help-overlay")).toBeUndefined();
  tui.mockInput.pressBackspace();
  expect(tui.find("monitor-detail-overlay")).toBeUndefined();
  tui.mockInput.pressEnter();
  tui.mockInput.pressEnter();
  expect(tui.find("monitor-detail-overlay")).toBeUndefined();
  tui.mockInput.pressEnter();
  tui.mockInput.pressEscape();
  expect(tui.text("monitor-instructions")).toContain("Enter: Details");
});

test("initial failure shows waiting details, then manual refresh reconnects and recovers", async () => {
  const tui = await monitor();
  tui.client.connect.mockRejectedValueOnce(new Error("daemon unavailable"));
  await tui.start();
  expect(tui.text("monitor-status-text")).toBe("Error: daemon unavailable");
  tui.mockInput.pressEnter();
  const waiting = [
    "Waiting for server",
    "Waiting for index",
    "Waiting for request",
    "Waiting for cache",
    "No upstream connections",
    "No active clients",
    "Waiting for memory",
    "No tool invocation",
  ];
  for (const text of waiting) {
    expect(tui.detail()).toContain(text);
    tui.mockInput.pressTab();
  }
  expect(tui.detail()).toContain("Last error: daemon unavailable");
  await tui.refresh();
  expect(tui.client.connect).toHaveBeenCalledTimes(2);
  expect(tui.text("monitor-status-text")).toStartWith("Last update:");
  expect(tui.detail()).toContain("Health: Healthy");
  tui.client.getStats.mockRejectedValueOnce(new Error("statistics timeout"));
  await tui.refresh();
  expect(tui.detail()).toContain("Last error: statistics timeout");
  expect(tui.text("server-status-health")).toBe("Health: Healthy");
});

test("partial endpoint failures retain primary stats, show warnings in details, and clear on recovery", async () => {
  const tui = await monitor();
  tui.client.getUpstreams.mockRejectedValueOnce(
    new Error("upstream endpoint missing"),
  );
  tui.client.getClients.mockRejectedValueOnce(
    new Error("clients endpoint missing"),
  );
  await tui.start();
  expect(tui.text("request-stats-total")).toBe("Total: 100");
  expect(tui.text("monitor-status-text")).toContain(
    "Warning: Upstream data unavailable",
  );
  expect(tui.text("monitor-status-text")).toContain("Client data unavailable");
  tui.mockInput.pressEnter();
  expect(tui.detail()).toContain("Upstream warning:");
  expect(tui.detail()).toContain("Client warning:");
  for (let i = 0; i < 4; i++) tui.mockInput.pressTab();
  expect(tui.detail()).toContain("upstream endpoint missing");
  tui.mockInput.pressTab();
  expect(tui.detail()).toContain("clients endpoint missing");
  await tui.refresh();
  expect(tui.text("upstream-status-line-0")).toBe("No upstream data reported.");
  expect(tui.text("client-status-line-0")).toBe("No active clients.");
  expect(tui.detail()).toContain("No active clients connected to daemon.");
  expect(tui.text("monitor-status-text")).toStartWith("Last update:");
  tui.mockInput.pressEscape();
  tui.data.connected = false;
  tui.client.getTools.mockRejectedValueOnce(new Error("tools endpoint failed"));
  await tui.refresh();
  expect(tui.text("monitor-status-text")).toBe("Error: tools endpoint failed");
});

test.each([
  {
    uptime: 0,
    expected: "0s",
    success: 0,
    heap: 0,
    totalHeap: 0,
    hits: 0,
    misses: 0,
    color: "#f87171",
  },
  {
    uptime: 3_661_000,
    expected: "1h 1m 1s",
    success: 95,
    heap: 75,
    totalHeap: 100,
    hits: 75,
    misses: 25,
    color: "#fbbf24",
  },
  {
    uptime: 90_061_000,
    expected: "1d 1h 1m",
    success: 100,
    heap: 90,
    totalHeap: 100,
    hits: 100,
    misses: 0,
    color: "#4ade80",
  },
])("metrics handle zero denominators and display thresholds: $expected", async (row) => {
  const tui = await monitor();
  tui.data.stats.uptime = row.uptime;
  tui.data.stats.activeConnections = 0;
  tui.data.stats.requests = {
    total: row.success ? 100 : 0,
    successful: row.success,
    failed: row.success ? 100 - row.success : 0,
    totalResponseTime: 1000,
    minResponseTime: 1,
    maxResponseTime: 20,
  };
  tui.data.stats.memory.heapUsed = row.heap;
  tui.data.stats.memory.heapTotal = row.totalHeap;
  tui.data.stats.index = {
    toolCount: 0,
    embeddingCount: 0,
    cooccurrenceCount: 0,
    lastRefreshTime: 0,
  };
  tui.data.stats.cache = { hits: row.hits, misses: row.misses, size: 0 };
  await tui.start();
  expect(tui.text("server-status-uptime")).toBe(`Uptime: ${row.expected}`);
  expect(tui.text("server-status-health")).toBe("Health: Idle");
  tui.mockInput.pressTab();
  tui.mockInput.pressTab();
  tui.mockInput.pressEnter();
  expect(tui.detail()).toContain(
    `Successful: ${row.success} (${row.success.toFixed(1)}%)`,
  );
  expect(
    tui
      .node<TextRenderable>("monitor-detail-line-1")
      .fg.equals(RGBA.fromHex(row.color)),
  ).toBe(true);
  if (!row.success) {
    expect(tui.detail()).toContain("Min response time: --");
    expect(tui.detail()).toContain("Throughput: 0.00 req/s");
  }
  for (let i = 0; i < 4; i++) tui.mockInput.pressTab();
  expect(tui.detail()).toContain(`(${row.heap.toFixed(1)}%)`);
  for (let i = 0; i < 3; i++) tui.mockInput.pressTab();
  expect(tui.detail()).toContain("Last refresh: Never");
  expect(tui.detail()).toContain("Age: n/a");
  tui.mockInput.pressTab();
  tui.mockInput.pressTab();
  expect(tui.detail()).toContain(`Hit rate: ${row.hits.toFixed(1)}%`);
  expect(tui.detail()).not.toContain("NaN");
});

test("large collections stay bounded, truncate long labels, and show overflow in details", async () => {
  const tui = await monitor();
  tui.data.upstreams = Array.from({ length: 28 }, (_, i) => ({
    key: `server-${String(i).padStart(2, "0")}-${"x".repeat(30)}`,
    status: "connected",
    transport: "stdio",
    serverName: "S".repeat(80),
    toolNames: ["long-tool-".repeat(30)],
  }));
  tui.data.clients = Array.from({ length: 30 }, (_, i) => ({
    sessionId: `session-${i}-${"x".repeat(150)}`,
    connectedAt: Date.now() - 3 * 86400_000,
    lastSeen: Date.now() - 3 * 3600_000,
    isOwner: i % 2 === 0,
  }));
  tui.data.tools = Array.from({ length: 30 }, (_, i) =>
    tool({
      name: `tool-${i}-${"x".repeat(100)}`,
      callCount: 30 - i,
      successCount: 0,
      failureCount: 1,
    }),
  );
  await tui.start();
  expect(tui.text("upstream-status-line-5")).toContain("more upstreams");
  expect(tui.text("client-status-line-0").length).toBe(120);
  expect(tui.text("client-status-line-0")).toEndWith("…");
  for (let i = 0; i < 4; i++) tui.mockInput.pressTab();
  tui.mockInput.pressEnter();
  expect(tui.detail()).toContain("Connected: 28");
  expect(tui.text("monitor-detail-overflow")).toContain("more lines");
  tui.mockInput.pressTab();
  expect(tui.detail()).toContain("Owners: 15");
  expect(tui.detail()).toContain("3h ago");
  expect(tui.detail()).toContain("3d ago");
  tui.mockInput.pressTab();
  tui.mockInput.pressTab();
  expect(tui.detail()).toContain("Tracked tools: 30");
  expect(tui.text("monitor-detail-overflow")).toContain("more lines");
});

test.each([
  {
    upstreams: [{ key: "auth", status: "connecting", authPending: true }],
    summary: "Connected 0/1 | Auth 1 | Errors 0",
  },
  {
    upstreams: [{ key: "ok", status: "connected" }],
    summary: "Connected 1/1 | Auth 0 | Errors 0",
  },
  {
    upstreams: [{ key: "other", status: "disconnected" }],
    summary: "Connected 0/1 | Auth 0 | Errors 0",
  },
])("upstream states remain visible without errors: $summary", async ({
  upstreams,
  summary,
}) => {
  const tui = await monitor();
  tui.data.upstreams = [...upstreams];
  await tui.start();
  expect(tui.text("upstream-status-line-0")).toBe(summary);
  expect(tui.text("upstream-status-line-5")).toBe("");
  for (let i = 0; i < 4; i++) tui.mockInput.pressTab();
  tui.mockInput.pressEnter();
  expect(tui.detail()).toContain("Transports: UNKNOWN:1");
});

test("quitting during an in-flight refresh suppresses late UI updates and disconnects once", async () => {
  const tui = await monitor({
    socketPath: "/test/monitor.sock",
    refreshInterval: 10,
  });
  await tui.start();
  let resolveStats!: (value: ServerStats) => void;
  tui.client.getStats.mockImplementationOnce(
    () =>
      new Promise<ServerStats>((resolve) => {
        resolveStats = resolve;
      }),
  );
  tui.mockInput.pressKey("r");
  tui.mockInput.pressKey("q");
  const finalStats = stats();
  finalStats.requests.total = 999;
  resolveStats(finalStats);
  await settleTui();
  expect(tui.client.disconnect).toHaveBeenCalledTimes(1);
  expect(tui.cancel).toHaveBeenCalledWith(tui.timer);
  expect(tui.exit).toHaveBeenCalledWith(0);
  expect(tui.find("monitor-status-text")).toBeUndefined();
});

test("unknown keys leave selection, dashboard, and open detail unchanged", async () => {
  const tui = await monitor({
    instances: [
      instance("first", { parentProcessName: "terminal" }),
      instance("second"),
    ],
    refreshInterval: 0,
  });
  await tui.start();
  expect(tui.text("monitor-selection-detail-launcher")).toBe(
    "Launcher: terminal",
  );
  tui.mockInput.pressKey("x");
  expect(tui.text("monitor-selection-item-first")).toStartWith("› ");
  tui.mockInput.pressEnter();
  await settleTui();
  tui.mockInput.pressKey("x");
  expect(tui.find("monitor-detail-overlay")).toBeUndefined();
  tui.mockInput.pressEnter();
  tui.mockInput.pressKey("x");
  expect(tui.node<BoxRenderable>("monitor-detail-panel").title).toBe(
    "Server Status Detail",
  );
});

test("independent runners keep their client data and cleanup isolated", async () => {
  const first = await monitor({
    socketPath: "/test/first.sock",
    refreshInterval: 0,
  });
  const second = await monitor({
    socketPath: "/test/second.sock",
    refreshInterval: 0,
  });
  first.data.stats.requests.total = 7;
  second.data.stats.requests.total = 88;
  await first.start();
  await second.start();
  first.data.connected = false;
  await first.refresh();
  expect(first.text("request-stats-total")).toBe("Total: 7");
  expect(second.text("request-stats-total")).toBe("Total: 88");
  expect(first.client.connect).toHaveBeenCalledTimes(2);
  expect(second.client.connect).toHaveBeenCalledTimes(1);
  first.mockInput.pressKey("q");
  expect(second.client.disconnect).not.toHaveBeenCalled();
  expect(second.exit).not.toHaveBeenCalled();
  second.mockInput.pressCtrlC();
  expect(second.client.disconnect).toHaveBeenCalledTimes(1);
});

test("long endpoint warnings are bounded and a single hidden client is reported", async () => {
  const tui = await monitor();
  tui.client.getUpstreams.mockRejectedValueOnce(new Error("u".repeat(200)));
  tui.client.getClients.mockRejectedValueOnce(new Error("c".repeat(200)));
  await tui.start();
  expect(tui.text("monitor-status-text")).toHaveLength(180);
  expect(tui.text("upstream-status-line-0")).toHaveLength(120);
  expect(tui.text("client-status-line-0")).toHaveLength(120);
  tui.data.clients = Array.from({ length: 25 }, (_, i) => ({
    sessionId: `client-${i}`,
    connectedAt: Date.now(),
    lastSeen: Date.now(),
    isOwner: false,
  }));
  await tui.refresh();
  for (let i = 0; i < 5; i++) tui.mockInput.pressTab();
  tui.mockInput.pressEnter();
  expect(tui.text("monitor-detail-overflow")).toBe("… 1 more line");
  expect(tui.detail()).toContain("Active sessions: 25");
});
