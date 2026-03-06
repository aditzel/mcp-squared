/**
 * Tests for large response offloading via MCP Resources.
 *
 * When an upstream tool response exceeds a configurable byte threshold,
 * MCP² registers a temporary MCP Resource containing the full response and
 * returns a truncated inline response with the resource URI. Clients that
 * support resources can fetch the full data on demand.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RESPONSE_RESOURCE_CONFIG,
  type ResponseResourceConfig,
  ResponseResourceManager,
} from "../src/server/response-resource.js";

function makeConfig(
  overrides: Partial<ResponseResourceConfig> = {},
): ResponseResourceConfig {
  return { ...DEFAULT_RESPONSE_RESOURCE_CONFIG, ...overrides };
}

function makeTextContent(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text" as const, text }];
}

function makeLargeContent(
  byteTarget: number,
): Array<{ type: "text"; text: string }> {
  // Each char is ~1 byte in ASCII. Generate a string slightly over the target.
  const text = "x".repeat(byteTarget);
  return [{ type: "text" as const, text }];
}

function measureStoredBytes(
  content: Array<{ type: "text"; text: string }>,
): number {
  return Buffer.byteLength(
    content.map((block) => block.text).join("\n\n---\n\n"),
    "utf8",
  );
}

describe("ResponseResourceManager", () => {
  describe("config defaults", () => {
    test("disabled by default", () => {
      expect(DEFAULT_RESPONSE_RESOURCE_CONFIG.enabled).toBe(false);
    });

    test("has a reasonable threshold default", () => {
      expect(
        DEFAULT_RESPONSE_RESOURCE_CONFIG.thresholdBytes,
      ).toBeGreaterThanOrEqual(1024);
    });

    test("has a max inline lines default", () => {
      expect(DEFAULT_RESPONSE_RESOURCE_CONFIG.maxInlineLines).toBeGreaterThan(
        0,
      );
    });

    test("has a max resources default", () => {
      expect(DEFAULT_RESPONSE_RESOURCE_CONFIG.maxResources).toBeGreaterThan(0);
    });
  });

  describe("isEnabled", () => {
    test("returns false when disabled", () => {
      const mgr = new ResponseResourceManager(makeConfig({ enabled: false }));
      expect(mgr.isEnabled()).toBe(false);
    });

    test("returns true when enabled", () => {
      const mgr = new ResponseResourceManager(makeConfig({ enabled: true }));
      expect(mgr.isEnabled()).toBe(true);
    });
  });

  describe("shouldOffload", () => {
    test("returns false when disabled", () => {
      const mgr = new ResponseResourceManager(makeConfig({ enabled: false }));
      const content = makeLargeContent(200_000);
      expect(mgr.shouldOffload(content)).toBe(false);
    });

    test("returns false when content is below threshold", () => {
      const mgr = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: 1024 }),
      );
      const content = makeTextContent("small response");
      expect(mgr.shouldOffload(content)).toBe(false);
    });

    test("returns true when content exceeds threshold", () => {
      const mgr = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: 1024 }),
      );
      const content = makeLargeContent(2048);
      expect(mgr.shouldOffload(content)).toBe(true);
    });

    test("returns false for exactly threshold bytes", () => {
      const content = makeTextContent("hello world");
      const exactSize = measureStoredBytes(content);
      // At exact threshold: should NOT offload (uses > not >=)
      const mgrExact = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: exactSize }),
      );
      expect(mgrExact.shouldOffload(content)).toBe(false);
      // One byte below threshold: SHOULD offload
      const mgrBelow = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: exactSize - 1 }),
      );
      expect(mgrBelow.shouldOffload(content)).toBe(true);

      const offloaded = mgrBelow.offload(content, {
        capability: "docs",
        action: "read",
      });
      const inlineText = (
        offloaded.inlineContent[0] as { type: "text"; text: string }
      ).text;
      expect(JSON.parse(inlineText).total_bytes).toBe(exactSize);
    });
  });

  describe("offload", () => {
    test("stores content and returns resource URI + truncated inline", () => {
      const mgr = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: 100, maxInlineLines: 5 }),
      );
      const bigText =
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
      const content = makeTextContent(bigText);

      const result = mgr.offload(content, {
        capability: "code_search",
        action: "grep",
      });

      expect(result.resourceUri).toMatch(/^mcp2:\/\/response\//);
      expect(result.inlineContent).toHaveLength(1);

      // Inline content should be truncated
      const inlineText = (
        result.inlineContent[0] as { type: "text"; text: string }
      ).text;
      const parsed = JSON.parse(inlineText);
      expect(parsed.truncated).toBe(true);
      expect(parsed.resource_uri).toBe(result.resourceUri);
      expect(parsed.total_bytes).toBeGreaterThan(0);
      expect(parsed.preview).toBeDefined();
    });

    test("resource can be read back via readResource", () => {
      const mgr = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: 100 }),
      );
      const content = makeTextContent("the full response data");

      const result = mgr.offload(content, {
        capability: "docs",
        action: "search",
      });

      const readResult = mgr.readResource(result.resourceUri);
      expect(readResult).not.toBeNull();
      expect(
        (readResult as NonNullable<typeof readResult>).contents,
      ).toHaveLength(1);
      expect(
        (readResult as NonNullable<typeof readResult>).contents[0]?.text,
      ).toContain("the full response data");
    });

    test("returns null for unknown resource URI", () => {
      const mgr = new ResponseResourceManager(makeConfig({ enabled: true }));
      const result = mgr.readResource("mcp2://response/nonexistent");
      expect(result).toBeNull();
    });

    test("resource URI includes capability for debuggability", () => {
      const mgr = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: 10 }),
      );
      const content = makeTextContent("a fairly long response text here");

      const result = mgr.offload(content, {
        capability: "issue_tracking",
        action: "list_issues",
      });

      expect(result.resourceUri).toContain("issue_tracking");
    });
  });

  describe("listResources", () => {
    test("returns empty when no resources stored", () => {
      const mgr = new ResponseResourceManager(makeConfig({ enabled: true }));
      expect(mgr.listResources()).toEqual([]);
    });

    test("lists stored resources after offload", () => {
      const mgr = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: 10 }),
      );
      const content = makeTextContent("a response that exceeds threshold");

      mgr.offload(content, { capability: "docs", action: "read" });

      const list = mgr.listResources();
      expect(list).toHaveLength(1);
      expect((list[0] as NonNullable<(typeof list)[0]>).uri).toMatch(
        /^mcp2:\/\/response\//,
      );
      expect((list[0] as NonNullable<(typeof list)[0]>).mimeType).toBe(
        "text/plain",
      );
    });
  });

  describe("eviction", () => {
    test("evicts oldest resource when maxResources exceeded", () => {
      const mgr = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: 10, maxResources: 2 }),
      );

      const r1 = mgr.offload(makeTextContent("first large response"), {
        capability: "a",
        action: "1",
      });
      const r2 = mgr.offload(makeTextContent("second large response"), {
        capability: "b",
        action: "2",
      });
      const r3 = mgr.offload(makeTextContent("third large response"), {
        capability: "c",
        action: "3",
      });

      // r1 should be evicted
      expect(mgr.readResource(r1.resourceUri)).toBeNull();
      // r2 and r3 should still exist
      expect(mgr.readResource(r2.resourceUri)).not.toBeNull();
      expect(mgr.readResource(r3.resourceUri)).not.toBeNull();
      expect(mgr.listResources()).toHaveLength(2);
    });
  });

  describe("TTL expiration", () => {
    test("expired resources return null on read", () => {
      // Use a TTL of 0 ms so it expires immediately
      const mgr = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: 10, ttlMs: 0 }),
      );

      const result = mgr.offload(makeTextContent("ephemeral data"), {
        capability: "x",
        action: "y",
      });

      // Should be expired immediately
      const read = mgr.readResource(result.resourceUri);
      expect(read).toBeNull();
    });
  });

  describe("preview byte cap", () => {
    test("truncates single-line payloads by bytes", () => {
      const mgr = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: 10 }),
      );
      // A very long single-line string (5000 chars)
      const content = makeTextContent("x".repeat(5000));
      const result = mgr.offload(content, {
        capability: "test",
        action: "big_line",
      });

      const inlineText = (
        result.inlineContent[0] as { type: "text"; text: string }
      ).text;
      const parsed = JSON.parse(inlineText);
      // Preview should be much shorter than the full 5000 bytes
      expect(Buffer.byteLength(parsed.preview, "utf8")).toBeLessThanOrEqual(
        2048 + 3,
      ); // +3 for "..."
    });
  });

  describe("multi-content-block responses", () => {
    test("handles multiple text blocks", () => {
      const mgr = new ResponseResourceManager(
        makeConfig({ enabled: true, thresholdBytes: 10 }),
      );
      const content = [
        { type: "text" as const, text: "block one with some content" },
        { type: "text" as const, text: "block two with more content" },
      ];

      const result = mgr.offload(content, {
        capability: "research",
        action: "search",
      });

      const readResult = mgr.readResource(result.resourceUri);
      expect(readResult).not.toBeNull();
      // Both blocks should be in the resource
      const fullText = (readResult as NonNullable<typeof readResult>)
        .contents[0]?.text;
      expect(fullText).toContain("block one");
      expect(fullText).toContain("block two");
    });
  });
});
