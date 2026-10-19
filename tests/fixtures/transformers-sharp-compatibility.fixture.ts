import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RawImage } from "@huggingface/transformers";
import { EmbeddingGenerator } from "../../src/embeddings/generator";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("imports the real embedding runtime without changing its default model", () => {
  const generator = new EmbeddingGenerator();
  expect(generator.getModelId()).toBe("Xenova/bge-small-en-v1.5");
  expect(generator.isInitialized()).toBe(false);
});

test("preserves the Transformers image calls used with the pinned Sharp runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mcp-sharp-compatibility-"));
  directories.push(directory);
  const pixels = Uint8Array.from([
    255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
  ]);
  const image = new RawImage(pixels, 2, 2, 3);
  const filename = join(directory, "roundtrip.png");
  await image.save(filename);
  const decoded = await RawImage.fromBlob(
    new Blob([await Bun.file(filename).arrayBuffer()], { type: "image/png" }),
  );
  expect([decoded.width, decoded.height, decoded.channels]).toEqual([2, 2, 3]);
  expect(Array.from(decoded.data)).toEqual(Array.from(pixels));

  for (const resample of ["nearest", "bilinear", "bicubic", "lanczos"]) {
    const resized = await decoded.resize(4, 4, { resample });
    expect([resized.width, resized.height, resized.channels]).toEqual([
      4, 4, 3,
    ]);
    expect(resized.data).toHaveLength(48);
  }
  const padded = await decoded.pad([1, 1, 1, 1]);
  expect([padded.width, padded.height]).toEqual([4, 4]);
  const cropped = await padded.crop([1, 1, 2, 2]);
  expect(Array.from(cropped.data)).toEqual(Array.from(pixels));
  const centered = await decoded.center_crop(1, 1);
  expect(Array.from(centered.data)).toEqual([255, 0, 0]);
  const expanded = await decoded.center_crop(4, 4);
  expect([expanded.width, expanded.height]).toEqual([4, 4]);
  await expect(
    RawImage.fromBlob(new Blob(["invalid image"])),
  ).rejects.toThrow();
});
