import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { parse as parseToml } from "smol-toml";
import { logSearchModeProfile } from "@/index.js";
import { generateConfigToml } from "@/init/runner.js";
import {
  ConfigSchema,
  DEFAULT_CONFIG,
  type McpSquaredConfig,
} from "../src/config/schema.js";
import { Retriever } from "../src/retriever/retriever.js";
import { Cataloger } from "../src/upstream/cataloger.js";

describe("embeddings config schema", () => {
  test("defaults embeddings.enabled to false", () => {
    const config = ConfigSchema.parse({});
    expect(config.operations.embeddings.enabled).toBe(false);
  });

  test("accepts embeddings.enabled = true", () => {
    const config = ConfigSchema.parse({
      operations: { embeddings: { enabled: true } },
    });
    expect(config.operations.embeddings.enabled).toBe(true);
  });

  test("rejects non-boolean embeddings.enabled", () => {
    expect(() =>
      ConfigSchema.parse({
        operations: { embeddings: { enabled: "yes" } },
      }),
    ).toThrow();
  });

  test("DEFAULT_CONFIG has embeddings disabled", () => {
    expect(DEFAULT_CONFIG.operations.embeddings.enabled).toBe(false);
  });
});

describe("search mode tracking in RetrieveResult", () => {
  let cataloger: Cataloger;
  let retriever: Retriever;

  beforeEach(() => {
    cataloger = new Cataloger();
    retriever = new Retriever(cataloger);
    // Index some tools for searching
    const indexStore = retriever.getIndexStore();
    indexStore.indexTool({
      name: "read_file",
      description: "Read content from a file",
      serverKey: "filesystem",
      inputSchema: { type: "object" },
    });
    indexStore.indexTool({
      name: "write_file",
      description: "Write content to a file",
      serverKey: "filesystem",
      inputSchema: { type: "object" },
    });
  });

  afterEach(() => {
    retriever.close();
  });

  test("fast mode reports searchMode as fast", async () => {
    const result = await retriever.search("file", { mode: "fast" });
    expect(result.searchMode).toBe("fast");
  });

  test("default mode reports searchMode as fast", async () => {
    const result = await retriever.search("file");
    expect(result.searchMode).toBe("fast");
  });

  test("semantic mode falls back and reports searchMode as fast", async () => {
    const result = await retriever.search("file", { mode: "semantic" });
    expect(result.searchMode).toBe("fast");
  });

  test("hybrid mode falls back and reports searchMode as fast", async () => {
    const result = await retriever.search("file", { mode: "hybrid" });
    expect(result.searchMode).toBe("fast");
  });

  test("empty query uses requested mode in result", async () => {
    const result = await retriever.search("", { mode: "semantic" });
    expect(result.searchMode).toBe("semantic");
  });

  test("custom default mode appears in result for empty query", async () => {
    const customRetriever = new Retriever(cataloger, {
      defaultMode: "hybrid",
    });
    const result = await customRetriever.search("");
    expect(result.searchMode).toBe("hybrid");
    customRetriever.close();
  });
});

describe("search mode fallback logging", () => {
  let cataloger: Cataloger;
  let retriever: Retriever;
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    cataloger = new Cataloger();
    retriever = new Retriever(cataloger);
    retriever.getIndexStore().indexTool({
      name: "test_tool",
      description: "A test tool",
      serverKey: "test",
      inputSchema: { type: "object" },
    });
    stderrSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    retriever.close();
  });

  test("logs fallback warning for semantic mode without embeddings", async () => {
    await retriever.search("test", { mode: "semantic" });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Semantic search requested but embeddings not available",
      ),
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("falling back to fast"),
    );
  });

  test("logs fallback warning for hybrid mode without embeddings", async () => {
    await retriever.search("test", { mode: "hybrid" });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Hybrid search requested but embeddings not available",
      ),
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("falling back to fast"),
    );
  });

  test("does not log fallback for fast mode", async () => {
    await retriever.search("test", { mode: "fast" });
    const fallbackCalls = stderrSpy.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("falling back"),
    );
    expect(fallbackCalls.length).toBe(0);
  });
});

describe("logSearchModeProfile", () => {
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  test("warns when defaultMode is semantic but embeddings disabled", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        findTools: {
          ...DEFAULT_CONFIG.operations.findTools,
          defaultMode: "semantic",
        },
        embeddings: { enabled: false },
      },
    };
    logSearchModeProfile(config);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'defaultMode is "semantic" but embeddings are disabled',
      ),
    );
  });

  test("warns when defaultMode is hybrid but embeddings disabled", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        findTools: {
          ...DEFAULT_CONFIG.operations.findTools,
          defaultMode: "hybrid",
        },
        embeddings: { enabled: false },
      },
    };
    logSearchModeProfile(config);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'defaultMode is "hybrid" but embeddings are disabled',
      ),
    );
  });

  test("does not warn when defaultMode is fast", () => {
    logSearchModeProfile(DEFAULT_CONFIG);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  test("does not warn when defaultMode is semantic and embeddings enabled", () => {
    const config: McpSquaredConfig = {
      ...DEFAULT_CONFIG,
      operations: {
        ...DEFAULT_CONFIG.operations,
        findTools: {
          ...DEFAULT_CONFIG.operations.findTools,
          defaultMode: "semantic",
        },
        embeddings: { enabled: true },
      },
    };
    logSearchModeProfile(config);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("init runner embeddings section", () => {
  test("generated config includes embeddings section", () => {
    const toml = generateConfigToml("hardened");
    const parsed = parseToml(toml) as Record<string, unknown>;
    const ops = parsed["operations"] as Record<string, Record<string, unknown>>;
    expect(ops["embeddings"]).toBeDefined();
    expect(ops["embeddings"]?.["enabled"]).toBe(false);
  });

  test("generated config has embeddings comment", () => {
    const toml = generateConfigToml("hardened");
    expect(toml).toContain("[operations.embeddings]");
    expect(toml).toContain("semantic or hybrid search");
  });
});
