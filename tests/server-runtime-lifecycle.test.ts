import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_CONFIG, type McpSquaredConfig } from "@/config/schema";
import {
  classifyNamespacesSemantic,
  registerRuntimeRefreshHooks,
  startServerRuntimeCore,
  stopServerRuntimeCore,
} from "@/server/runtime-lifecycle";

describe("server runtime lifecycle", () => {
  test("registers refresh hooks that update stats and log embedding failures", async () => {
    const listeners = new Map<string, () => void>();
    const updateIndexRefreshTime = mock(() => {});
    const generateToolEmbeddings = mock(() =>
      Promise.reject(new Error("boom")),
    );
    const logError = mock(() => {});

    registerRuntimeRefreshHooks({
      indexRefreshManager: {
        on: (event, handler) => {
          listeners.set(String(event), handler);
          return undefined as never;
        },
      },
      statsCollector: { updateIndexRefreshTime },
      retriever: { generateToolEmbeddings },
      embeddingsEnabled: true,
      logError,
    });

    listeners.get("refresh:complete")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateIndexRefreshTime).toHaveBeenCalledTimes(1);
    expect(generateToolEmbeddings).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("Background embedding generation failed"),
    );
  });

  test("starts runtime core with enabled upstreams, embeddings, and hybrid classification", async () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      upstreams: {
        alpha: {
          env: {},
          transport: "stdio",
          stdio: { command: "alpha", args: [] },
          enabled: true,
        },
        beta: {
          env: {},
          transport: "stdio",
          stdio: { command: "beta", args: [] },
          enabled: false,
        },
      },
      operations: {
        ...DEFAULT_CONFIG.operations,
        embeddings: { enabled: true },
        dynamicToolSurface: {
          ...DEFAULT_CONFIG.operations.dynamicToolSurface,
          inference: "hybrid",
        },
      },
    };

    const connect = mock(async () => {});
    const syncIndex = mock(() => {});
    const initializeEmbeddings = mock(async () => {});
    const generateToolEmbeddings = mock(async () => 3);
    const getIndexedToolCount = mock(() => 5);
    const hasEmbeddings = mock(() => true);
    const classifyNamespacesSemantic = mock(async () => {});
    const updateIndexRefreshTime = mock(() => {});
    const refreshStart = mock(() => {});
    const monitorStart = mock(async () => {});
    const ensureSocketDirFn = mock(() => {});
    const logError = mock(() => {});

    await startServerRuntimeCore({
      config,
      cataloger: { connect },
      retriever: {
        initializeEmbeddings,
        generateToolEmbeddings,
        getIndexedToolCount,
        hasEmbeddings,
      },
      statsCollector: { updateIndexRefreshTime },
      indexRefreshManager: { start: refreshStart },
      monitorServer: { start: monitorStart },
      ensureSocketDir: ensureSocketDirFn,
      syncIndex,
      classifyNamespacesSemantic,
      logError,
    });

    expect(ensureSocketDirFn).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({
        enabled: true,
        stdio: expect.objectContaining({ command: "alpha" }),
      }),
    );
    expect(syncIndex).toHaveBeenCalledTimes(1);
    expect(initializeEmbeddings).toHaveBeenCalledTimes(1);
    expect(generateToolEmbeddings).toHaveBeenCalledTimes(1);
    expect(classifyNamespacesSemantic).toHaveBeenCalledTimes(1);
    expect(updateIndexRefreshTime).toHaveBeenCalledTimes(1);
    expect(refreshStart).toHaveBeenCalledTimes(1);
    expect(monitorStart).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("Embeddings: initialized (3/5 tools embedded)"),
    );
  });

  test("stops runtime core and disconnects owned catalogers only", async () => {
    const order: string[] = [];
    const refreshStop = mock(() => {
      order.push("refresh");
    });
    const monitorStop = mock(async () => {
      order.push("monitor");
    });
    const close = mock(() => {
      order.push("retriever");
    });
    const disconnectAll = mock(async () => {
      order.push("cataloger");
    });

    await stopServerRuntimeCore({
      indexRefreshManager: { stop: refreshStop },
      monitorServer: { stop: monitorStop },
      retriever: { close },
      ownsCataloger: true,
      cataloger: { disconnectAll },
    });

    expect(order).toEqual(["refresh", "monitor", "retriever", "cataloger"]);

    order.length = 0;
    refreshStop.mockClear();
    monitorStop.mockClear();
    close.mockClear();
    disconnectAll.mockClear();

    await stopServerRuntimeCore({
      indexRefreshManager: { stop: refreshStop },
      monitorServer: { stop: monitorStop },
      retriever: { close },
      ownsCataloger: false,
      cataloger: { disconnectAll },
    });

    expect(refreshStop).toHaveBeenCalledTimes(1);
    expect(monitorStop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(disconnectAll).not.toHaveBeenCalled();
  });

  test("falls back cleanly when hybrid classification has no embeddings generator", async () => {
    const logError = mock(() => {});
    const setComputedCapabilityOverrides = mock(() => {});

    await classifyNamespacesSemantic({
      config: DEFAULT_CONFIG,
      retriever: {
        getEmbeddingGenerator: () => null,
      },
      cataloger: {
        getStatus: () => new Map(),
        getToolsForServer: () => [],
      },
      setComputedCapabilityOverrides,
      logError,
    });

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(
        "Hybrid inference: embeddings not available, falling back to heuristic",
      ),
    );
    expect(setComputedCapabilityOverrides).not.toHaveBeenCalled();
  });
});
