import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { EmbeddingGenerator } from "@/embeddings";
import { Retriever } from "@/retriever/retriever";
import { Cataloger } from "@/upstream/cataloger";

const retrievers: Retriever[] = [];
afterEach(() => {
  for (const retriever of retrievers.splice(0)) retriever.close();
  mock.restore();
});
function fixture() {
  const cataloger = new Cataloger();
  const retriever = new Retriever(cataloger);
  retrievers.push(retriever);
  const store = retriever.getIndexStore();
  for (const name of ["read_file", "write_file", "list_file"])
    store.indexTool({
      name,
      serverKey: "local",
      description: `${name} file content`,
      inputSchema: { type: "object" },
    });
  return { retriever, store, cataloger };
}

describe("semantic retrieval behavior", () => {
  test("ranks semantic and hybrid results while retaining FTS-only candidates and total counts", async () => {
    const { retriever, store } = fixture();
    const initialize = spyOn(
      EmbeddingGenerator.prototype,
      "initialize",
    ).mockResolvedValue();
    spyOn(EmbeddingGenerator.prototype, "embed").mockResolvedValue({
      embedding: new Float32Array([1, 0]),
      dimensions: 2,
      inferenceMs: 0,
    });
    await retriever.initializeEmbeddings();
    await retriever.initializeEmbeddings();
    expect(initialize).toHaveBeenCalledTimes(1);
    store.updateEmbedding("read_file", "local", new Float32Array([1, 0]));
    store.updateEmbedding("write_file", "local", new Float32Array([0, 1]));
    expect(retriever.hasEmbeddings()).toBe(true);
    const semantic = await retriever.search("file", {
      mode: "semantic",
      limit: 1,
    });
    expect(semantic.searchMode).toBe("semantic");
    expect(semantic.tools[0]?.name).toBe("read_file");
    const hybrid = await retriever.search("file", { mode: "hybrid", limit: 2 });
    expect(hybrid.searchMode).toBe("hybrid");
    expect(hybrid.tools[0]?.name).toBe("read_file");
    expect(hybrid.tools).toHaveLength(2);
    expect(hybrid.totalMatches).toBe(3);
    expect(
      await retriever.search("nonexistentword", { mode: "hybrid" }),
    ).toMatchObject({ tools: [], totalMatches: 0, searchMode: "hybrid" });
    store.updateEmbedding("read_file", "local", new Float32Array([1, 0, 0]));
    await expect(retriever.search("read", { mode: "hybrid" })).rejects.toThrow(
      "Embedding dimensions must match",
    );
  });

  test.each([
    "onnxruntime requires external shared libs",
    "libonnxruntime.so: cannot open shared object file",
    "libonnxruntime.dylib: image not found",
    "onnxruntime.dll: No such file or directory",
    "dlopen libonnxruntime.so",
  ])("falls back after runtime dependency failure %s without repeatedly initializing", async (message) => {
    const { retriever } = fixture();
    const initialize = spyOn(
      EmbeddingGenerator.prototype,
      "initialize",
    ).mockRejectedValue(new Error(message));
    spyOn(console, "warn").mockImplementation(() => {});
    spyOn(console, "error").mockImplementation(() => {});
    await retriever.initializeEmbeddings();
    await retriever.initializeEmbeddings();
    expect(await retriever.generateToolEmbeddings()).toBe(0);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(
      (await retriever.search("file", { mode: "semantic" })).searchMode,
    ).toBe("fast");
  });

  test("propagates ordinary initialization errors and permits a successful retry", async () => {
    const { retriever } = fixture();
    const initialize = spyOn(
      EmbeddingGenerator.prototype,
      "initialize",
    ).mockRejectedValue("model request failed");
    await expect(retriever.initializeEmbeddings()).rejects.toBe(
      "model request failed",
    );
    initialize.mockResolvedValue();
    await retriever.initializeEmbeddings();
    expect(retriever.getEmbeddingGenerator()).not.toBeNull();
  });
});
