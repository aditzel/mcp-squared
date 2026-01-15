/**
 * Tests for IndexStore vector embedding functionality.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { IndexStore } from "../src/index/index.js";
import type { CatalogedTool } from "../src/upstream/cataloger.js";

describe("IndexStore Embeddings", () => {
  let store: IndexStore;

  // Sample tools for testing
  const tools: CatalogedTool[] = [
    {
      name: "read_file",
      description: "Read contents of a file from the filesystem",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      serverKey: "filesystem",
    },
    {
      name: "write_file",
      description: "Write content to a file on the filesystem",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
      serverKey: "filesystem",
    },
    {
      name: "send_email",
      description: "Send an email message to a recipient",
      inputSchema: {
        type: "object",
        properties: { to: { type: "string" }, subject: { type: "string" } },
      },
      serverKey: "email",
    },
  ];

  // Sample embeddings (384 dimensions, normalized)
  function createMockEmbedding(seed: number): Float32Array {
    const embedding = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      embedding[i] = Math.sin(seed * i * 0.01) * 0.1;
    }
    // Normalize
    let norm = 0;
    for (let i = 0; i < 384; i++) {
      norm += embedding[i]! * embedding[i]!;
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < 384; i++) {
      embedding[i] = embedding[i]! / norm;
    }
    return embedding;
  }

  beforeEach(() => {
    store = new IndexStore(); // In-memory
    store.indexTools(tools);
  });

  test("tools initially have no embeddings", () => {
    expect(store.getEmbeddingCount()).toBe(0);
    const tool = store.getTool("read_file", "filesystem");
    expect(tool?.embedding).toBeNull();
  });

  test("getToolsWithoutEmbeddings returns all tools initially", () => {
    const missing = store.getToolsWithoutEmbeddings();
    expect(missing.length).toBe(3);
    expect(missing.map((t) => t.name).sort()).toEqual([
      "read_file",
      "send_email",
      "write_file",
    ]);
  });

  test("updateEmbedding stores and retrieves embedding", () => {
    const embedding = createMockEmbedding(1);
    const updated = store.updateEmbedding("read_file", "filesystem", embedding);

    expect(updated).toBe(true);
    expect(store.getEmbeddingCount()).toBe(1);

    const tool = store.getTool("read_file", "filesystem");
    expect(tool?.embedding).not.toBeNull();
    expect(tool?.embedding?.length).toBe(384);

    // Check values are preserved (with some floating point tolerance)
    for (let i = 0; i < 10; i++) {
      expect(tool?.embedding?.[i]).toBeCloseTo(embedding[i]!, 5);
    }
  });

  test("updateEmbedding returns false for non-existent tool", () => {
    const embedding = createMockEmbedding(1);
    const updated = store.updateEmbedding("nonexistent", "server", embedding);
    expect(updated).toBe(false);
  });

  test("updateEmbeddings batch updates multiple tools", () => {
    const embeddings = [
      {
        name: "read_file",
        serverKey: "filesystem",
        embedding: createMockEmbedding(1),
      },
      {
        name: "write_file",
        serverKey: "filesystem",
        embedding: createMockEmbedding(2),
      },
      {
        name: "send_email",
        serverKey: "email",
        embedding: createMockEmbedding(3),
      },
    ];

    const count = store.updateEmbeddings(embeddings);
    expect(count).toBe(3);
    expect(store.getEmbeddingCount()).toBe(3);
    expect(store.getToolsWithoutEmbeddings().length).toBe(0);
  });

  test("searchSemantic returns tools ranked by similarity", () => {
    // Create embeddings where read_file and write_file are similar
    const fileEmbedding1 = createMockEmbedding(1);
    const fileEmbedding2 = createMockEmbedding(1.1); // Very similar to fileEmbedding1
    const emailEmbedding = createMockEmbedding(100); // Very different

    store.updateEmbedding("read_file", "filesystem", fileEmbedding1);
    store.updateEmbedding("write_file", "filesystem", fileEmbedding2);
    store.updateEmbedding("send_email", "email", emailEmbedding);

    // Search with query similar to file operations
    const queryEmbedding = createMockEmbedding(1.05);
    const results = store.searchSemantic(queryEmbedding, 10);

    expect(results.length).toBe(3);

    // File operations should rank higher than email
    const fileResults = results.filter((r) => r.serverKey === "filesystem");
    const emailResult = results.find((r) => r.name === "send_email");

    expect(fileResults[0]!.similarity).toBeGreaterThan(emailResult!.similarity);
  });

  test("searchSemantic respects limit", () => {
    store.updateEmbedding("read_file", "filesystem", createMockEmbedding(1));
    store.updateEmbedding("write_file", "filesystem", createMockEmbedding(2));
    store.updateEmbedding("send_email", "email", createMockEmbedding(3));

    const results = store.searchSemantic(createMockEmbedding(1), 2);
    expect(results.length).toBe(2);
  });

  test("searchSemantic skips tools without embeddings", () => {
    // Only add embedding to one tool
    store.updateEmbedding("read_file", "filesystem", createMockEmbedding(1));

    const results = store.searchSemantic(createMockEmbedding(1), 10);
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("read_file");
  });

  test("clearEmbeddings removes all embeddings", () => {
    store.updateEmbedding("read_file", "filesystem", createMockEmbedding(1));
    store.updateEmbedding("write_file", "filesystem", createMockEmbedding(2));
    expect(store.getEmbeddingCount()).toBe(2);

    store.clearEmbeddings();
    expect(store.getEmbeddingCount()).toBe(0);
    expect(store.getToolsWithoutEmbeddings().length).toBe(3);
  });

  test("getAllTools includes embeddings", () => {
    store.updateEmbedding("read_file", "filesystem", createMockEmbedding(1));

    const allTools = store.getAllTools();
    const readFile = allTools.find((t) => t.name === "read_file");
    const writeFile = allTools.find((t) => t.name === "write_file");

    expect(readFile?.embedding).not.toBeNull();
    expect(writeFile?.embedding).toBeNull();
  });

  test("getToolsForServer includes embeddings", () => {
    store.updateEmbedding("read_file", "filesystem", createMockEmbedding(1));

    const fsTools = store.getToolsForServer("filesystem");
    const readFile = fsTools.find((t) => t.name === "read_file");
    const writeFile = fsTools.find((t) => t.name === "write_file");

    expect(readFile?.embedding).not.toBeNull();
    expect(writeFile?.embedding).toBeNull();
  });
});
