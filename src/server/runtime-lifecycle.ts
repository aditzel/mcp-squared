import type { IndexRefreshManager } from "../background/index.js";
import type { CapabilityId } from "../capabilities/inference.js";
import type { McpSquaredConfig } from "../config/schema.js";
import type { Retriever } from "../retriever/index.js";
import type { Cataloger } from "../upstream/index.js";
import type { MonitorServer } from "./monitor-server.js";
import type { StatsCollector } from "./stats.js";

type Logger = (message: string) => void;

const defaultLogError: Logger = (message) => {
  console.error(message);
};

export interface RegisterRuntimeRefreshHooksOptions {
  indexRefreshManager: Pick<IndexRefreshManager, "on">;
  statsCollector: Pick<StatsCollector, "updateIndexRefreshTime">;
  retriever: Pick<Retriever, "generateToolEmbeddings">;
  embeddingsEnabled: boolean;
  logError?: Logger;
}

export function registerRuntimeRefreshHooks({
  indexRefreshManager,
  statsCollector,
  retriever,
  embeddingsEnabled,
  logError = defaultLogError,
}: RegisterRuntimeRefreshHooksOptions): void {
  indexRefreshManager.on("refresh:complete", () => {
    statsCollector.updateIndexRefreshTime(Date.now());

    if (embeddingsEnabled) {
      retriever.generateToolEmbeddings().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logError(`[mcp²] Background embedding generation failed — ${message}`);
      });
    }
  });
}

export interface StartServerRuntimeCoreOptions {
  config: McpSquaredConfig;
  cataloger: Pick<Cataloger, "connect">;
  retriever: Pick<
    Retriever,
    | "initializeEmbeddings"
    | "generateToolEmbeddings"
    | "getIndexedToolCount"
    | "hasEmbeddings"
  >;
  statsCollector: Pick<StatsCollector, "updateIndexRefreshTime">;
  indexRefreshManager: Pick<IndexRefreshManager, "start">;
  monitorServer: Pick<MonitorServer, "start">;
  ensureSocketDir: () => void;
  syncIndex: () => void;
  classifyNamespacesSemantic: () => Promise<void>;
  logError?: Logger;
}

export async function startServerRuntimeCore({
  config,
  cataloger,
  retriever,
  statsCollector,
  indexRefreshManager,
  monitorServer,
  ensureSocketDir,
  syncIndex,
  classifyNamespacesSemantic,
  logError = defaultLogError,
}: StartServerRuntimeCoreOptions): Promise<void> {
  ensureSocketDir();

  const upstreamEntries = Object.entries(config.upstreams);
  const enabledUpstreams = upstreamEntries.filter(
    ([, upstream]) => upstream.enabled,
  );

  const connectionPromises = enabledUpstreams.map(async ([key, upstream]) => {
    try {
      await cataloger.connect(key, upstream);
      return { key, success: true as const };
    } catch {
      return { key, success: false as const };
    }
  });

  await Promise.all(connectionPromises);

  syncIndex();

  if (config.operations.embeddings.enabled) {
    try {
      await retriever.initializeEmbeddings();
      const embeddingCount = await retriever.generateToolEmbeddings();
      const toolCount = retriever.getIndexedToolCount();
      if (retriever.hasEmbeddings()) {
        logError(
          `[mcp²] Embeddings: initialized (${embeddingCount}/${toolCount} tools embedded). Search modes: semantic, hybrid available.`,
        );
      } else {
        logError(
          "[mcp²] Embeddings: enabled but runtime unavailable (onnxruntime not found). Falling back to fast (FTS5) search.",
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(
        `[mcp²] Embeddings: initialization failed — ${message}. Falling back to fast (FTS5) search.`,
      );
    }
  }

  if (config.operations.dynamicToolSurface.inference === "hybrid") {
    await classifyNamespacesSemantic();
  }

  statsCollector.updateIndexRefreshTime(Date.now());
  indexRefreshManager.start();
  await monitorServer.start();
}

export interface ClassifyNamespacesSemanticOptions {
  config: Pick<McpSquaredConfig, "operations">;
  retriever: Pick<Retriever, "getEmbeddingGenerator">;
  cataloger: Pick<Cataloger, "getStatus" | "getToolsForServer">;
  setComputedCapabilityOverrides: (
    overrides: Partial<Record<string, CapabilityId>>,
  ) => void;
  logError?: Logger;
}

export async function classifyNamespacesSemantic({
  config,
  retriever,
  cataloger,
  setComputedCapabilityOverrides,
  logError = defaultLogError,
}: ClassifyNamespacesSemanticOptions): Promise<void> {
  const generator = retriever.getEmbeddingGenerator();
  if (!generator) {
    logError(
      "[mcp²] Hybrid inference: embeddings not available, falling back to heuristic.",
    );
    return;
  }

  try {
    const { SemanticCapabilityClassifier } = await import(
      "../capabilities/semantic-classifier.js"
    );
    const threshold =
      config.operations.dynamicToolSurface.semanticConfidenceThreshold;
    const classifier = new SemanticCapabilityClassifier(generator, {
      confidenceThreshold: threshold,
    });
    await classifier.initializeReferences();

    const status = cataloger.getStatus();
    const inventories = [...status.entries()]
      .filter(([, info]) => info.status === "connected")
      .map(([namespace]) => ({
        namespace,
        tools: cataloger.getToolsForServer(namespace),
      }));

    const result = await classifier.classifyBatch(inventories);
    setComputedCapabilityOverrides(result.overrides);

    const count = Object.keys(result.overrides).length;
    logError(
      `[mcp²] Hybrid inference: classified ${count}/${inventories.length} namespaces semantically (${Math.round(result.inferenceMs)}ms).`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(
      `[mcp²] Hybrid inference: classification failed — ${message}. Falling back to heuristic.`,
    );
  }
}

export interface StopServerRuntimeCoreOptions {
  indexRefreshManager: Pick<IndexRefreshManager, "stop">;
  monitorServer: Pick<MonitorServer, "stop">;
  retriever: Pick<Retriever, "close">;
  ownsCataloger: boolean;
  cataloger: Pick<Cataloger, "disconnectAll">;
}

export async function stopServerRuntimeCore({
  indexRefreshManager,
  monitorServer,
  retriever,
  ownsCataloger,
  cataloger,
}: StopServerRuntimeCoreOptions): Promise<void> {
  indexRefreshManager.stop();
  await monitorServer.stop();
  retriever.close();

  if (ownsCataloger) {
    await cataloger.disconnectAll();
  }
}
