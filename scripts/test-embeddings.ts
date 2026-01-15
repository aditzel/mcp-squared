#!/usr/bin/env bun
/**
 * Test script for validating embedding generation in Bun.
 *
 * Run with: bun scripts/test-embeddings.ts
 */

import { EmbeddingGenerator } from "../src/embeddings/generator.js";

async function main() {
  console.log("=== MCP² Embedding Prototype Test ===\n");

  // Create generator with progress output for first load
  const generator = new EmbeddingGenerator({
    showProgress: true,
  });

  console.log(`Model: ${generator.getModelId()}`);
  console.log("Initializing (first run downloads model ~33MB)...\n");

  // Test 1: Model loading
  const initStart = performance.now();
  await generator.initialize();
  const initTime = performance.now() - initStart;

  console.log(`\n✓ Model loaded in ${initTime.toFixed(0)}ms`);
  console.log(
    `  (Cached load time: ${generator.getModelLoadTimeMs().toFixed(0)}ms)\n`,
  );

  // Test 2: Single embedding
  console.log("--- Single Embedding Test ---");
  const testQueries = [
    "Find tools for reading files",
    "Search for authentication utilities",
    "Database connection tools",
    "How to send HTTP requests",
  ];

  const results: number[] = [];
  for (const query of testQueries) {
    const result = await generator.embed(query);
    results.push(result.inferenceMs);
    console.log(
      `  "${query.substring(0, 30)}..." → ${result.dimensions}d in ${result.inferenceMs.toFixed(1)}ms`,
    );
  }

  const avgLatency = results.reduce((a, b) => a + b, 0) / results.length;
  console.log(`\n  Average latency: ${avgLatency.toFixed(1)}ms`);
  console.log(`  Target: <50ms → ${avgLatency < 50 ? "✓ PASS" : "✗ FAIL"}\n`);

  // Test 3: Batch embedding
  console.log("--- Batch Embedding Test ---");
  const batchResult = await generator.embedBatch(testQueries);
  console.log(`  Batch of ${testQueries.length} queries:`);
  console.log(`  Total time: ${batchResult.inferenceMs.toFixed(1)}ms`);
  console.log(`  Avg per query: ${batchResult.avgPerEmbeddingMs.toFixed(1)}ms`);
  console.log(`  Dimensions: ${batchResult.dimensions}\n`);

  // Test 4: Similarity calculation
  console.log("--- Similarity Test ---");
  const queryEmbed = await generator.embed("file reading tools");
  const doc1Embed = await generator.embed("Read files from disk", false);
  const doc2Embed = await generator.embed("Send email notifications", false);

  const sim1 = EmbeddingGenerator.cosineSimilarity(
    queryEmbed.embedding,
    doc1Embed.embedding,
  );
  const sim2 = EmbeddingGenerator.cosineSimilarity(
    queryEmbed.embedding,
    doc2Embed.embedding,
  );

  console.log(`  Query: "file reading tools"`);
  console.log(`  vs "Read files from disk": ${sim1.toFixed(3)}`);
  console.log(`  vs "Send email notifications": ${sim2.toFixed(3)}`);
  console.log(
    `  Correct ranking: ${sim1 > sim2 ? "✓ PASS" : "✗ FAIL"} (${sim1.toFixed(3)} > ${sim2.toFixed(3)})\n`,
  );

  // Test 5: Memory usage estimate
  console.log("--- Resource Usage ---");
  const memUsage = process.memoryUsage();
  console.log(`  Heap used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
  console.log(
    `  Heap total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)}MB`,
  );
  console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB\n`);

  // Summary
  console.log("=== Summary ===");
  console.log(`  Model: ${generator.getModelId()}`);
  console.log(`  Dimensions: ${batchResult.dimensions}`);
  console.log(`  Avg latency: ${avgLatency.toFixed(1)}ms`);
  console.log(
    `  Batch efficiency: ${batchResult.avgPerEmbeddingMs.toFixed(1)}ms/query`,
  );
  console.log(`  Memory (RSS): ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);

  const allPassed = avgLatency < 50 && sim1 > sim2;
  console.log(`\n${allPassed ? "✓ All tests passed!" : "✗ Some tests failed"}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
