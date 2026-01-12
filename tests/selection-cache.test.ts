import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SelectionTracker } from "../src/caching/selection-tracker.js";
import { SelectionCacheSchema } from "../src/config/schema.js";
import { IndexStore } from "../src/index/store.js";

describe("SelectionCacheSchema", () => {
  test("has correct defaults", () => {
    const defaults = SelectionCacheSchema.parse({});
    expect(defaults.enabled).toBe(true);
    expect(defaults.minCooccurrenceThreshold).toBe(2);
    expect(defaults.maxBundleSuggestions).toBe(3);
  });

  test("validates custom values", () => {
    const config = SelectionCacheSchema.parse({
      enabled: false,
      minCooccurrenceThreshold: 5,
      maxBundleSuggestions: 10,
    });
    expect(config.enabled).toBe(false);
    expect(config.minCooccurrenceThreshold).toBe(5);
    expect(config.maxBundleSuggestions).toBe(10);
  });

  test("rejects invalid minCooccurrenceThreshold", () => {
    expect(() =>
      SelectionCacheSchema.parse({ minCooccurrenceThreshold: 0 }),
    ).toThrow();
  });

  test("allows zero maxBundleSuggestions (disabled)", () => {
    const config = SelectionCacheSchema.parse({ maxBundleSuggestions: 0 });
    expect(config.maxBundleSuggestions).toBe(0);
  });
});

describe("SelectionTracker", () => {
  let tracker: SelectionTracker;

  beforeEach(() => {
    tracker = new SelectionTracker();
  });

  describe("trackToolUsage", () => {
    test("tracks single tool", () => {
      tracker.trackToolUsage("fs:read_file");
      expect(tracker.getSessionTools()).toEqual(["fs:read_file"]);
      expect(tracker.getSessionToolCount()).toBe(1);
    });

    test("tracks multiple tools", () => {
      tracker.trackToolUsage("fs:read_file");
      tracker.trackToolUsage("fs:write_file");
      tracker.trackToolUsage("db:query");

      expect(tracker.getSessionToolCount()).toBe(3);
      expect(tracker.getSessionTools()).toContain("fs:read_file");
      expect(tracker.getSessionTools()).toContain("fs:write_file");
      expect(tracker.getSessionTools()).toContain("db:query");
    });

    test("deduplicates repeated tool usage", () => {
      tracker.trackToolUsage("fs:read_file");
      tracker.trackToolUsage("fs:read_file");
      tracker.trackToolUsage("fs:read_file");

      expect(tracker.getSessionToolCount()).toBe(1);
    });
  });

  describe("hasToolUsage", () => {
    test("returns true for tracked tool", () => {
      tracker.trackToolUsage("fs:read_file");
      expect(tracker.hasToolUsage("fs:read_file")).toBe(true);
    });

    test("returns false for untracked tool", () => {
      expect(tracker.hasToolUsage("fs:read_file")).toBe(false);
    });
  });

  describe("reset", () => {
    test("clears all tracked tools", () => {
      tracker.trackToolUsage("fs:read_file");
      tracker.trackToolUsage("fs:write_file");
      tracker.reset();

      expect(tracker.getSessionToolCount()).toBe(0);
      expect(tracker.getSessionTools()).toEqual([]);
    });
  });

  describe("flushToStore", () => {
    let store: IndexStore;

    beforeEach(() => {
      store = new IndexStore();
    });

    afterEach(() => {
      store.close();
    });

    test("records co-occurrences for multiple tools", () => {
      tracker.trackToolUsage("fs:read_file");
      tracker.trackToolUsage("fs:write_file");
      tracker.flushToStore(store);

      // Check co-occurrence was recorded
      const related = store.getRelatedTools("fs:read_file", 1);
      expect(related.length).toBe(1);
      expect(related[0]?.toolKey).toBe("fs:write_file");
      expect(related[0]?.count).toBe(1);
    });

    test("does not record with single tool", () => {
      tracker.trackToolUsage("fs:read_file");
      tracker.flushToStore(store);

      expect(store.getCooccurrenceCount()).toBe(0);
    });

    test("records all pairs for three tools", () => {
      tracker.trackToolUsage("a:tool1");
      tracker.trackToolUsage("b:tool2");
      tracker.trackToolUsage("c:tool3");
      tracker.flushToStore(store);

      // Should have 3 pairs: (1,2), (1,3), (2,3)
      expect(store.getCooccurrenceCount()).toBe(3);
    });
  });
});

describe("IndexStore co-occurrence methods", () => {
  let store: IndexStore;

  beforeEach(() => {
    store = new IndexStore();
  });

  afterEach(() => {
    store.close();
  });

  describe("recordCooccurrence", () => {
    test("records new co-occurrence", () => {
      store.recordCooccurrence("fs:read_file", "fs:write_file");
      expect(store.getCooccurrenceCount()).toBe(1);
    });

    test("increments count on repeated co-occurrence", () => {
      store.recordCooccurrence("fs:read_file", "fs:write_file");
      store.recordCooccurrence("fs:read_file", "fs:write_file");
      store.recordCooccurrence("fs:read_file", "fs:write_file");

      const related = store.getRelatedTools("fs:read_file", 1);
      expect(related.length).toBe(1);
      expect(related[0]?.count).toBe(3);
    });

    test("normalizes order (a,b) and (b,a) are same pair", () => {
      store.recordCooccurrence("fs:write_file", "fs:read_file");
      store.recordCooccurrence("fs:read_file", "fs:write_file");

      // Should still be 1 pair with count 2
      expect(store.getCooccurrenceCount()).toBe(1);
      const related = store.getRelatedTools("fs:read_file", 1);
      expect(related[0]?.count).toBe(2);
    });
  });

  describe("recordCooccurrences", () => {
    test("records all pairs from array", () => {
      store.recordCooccurrences(["a:t1", "b:t2", "c:t3"]);

      // 3 pairs: (t1,t2), (t1,t3), (t2,t3)
      expect(store.getCooccurrenceCount()).toBe(3);
    });

    test("handles empty array", () => {
      store.recordCooccurrences([]);
      expect(store.getCooccurrenceCount()).toBe(0);
    });

    test("handles single element array", () => {
      store.recordCooccurrences(["a:t1"]);
      expect(store.getCooccurrenceCount()).toBe(0);
    });
  });

  describe("getRelatedTools", () => {
    beforeEach(() => {
      // Set up some co-occurrences
      store.recordCooccurrence("fs:read", "fs:write");
      store.recordCooccurrence("fs:read", "fs:write");
      store.recordCooccurrence("fs:read", "db:query");
      store.recordCooccurrence("fs:read", "net:fetch");
    });

    test("returns related tools sorted by count", () => {
      const related = store.getRelatedTools("fs:read", 1);

      expect(related.length).toBe(3);
      expect(related[0]?.toolKey).toBe("fs:write");
      expect(related[0]?.count).toBe(2);
    });

    test("respects limit", () => {
      const related = store.getRelatedTools("fs:read", 1, 2);
      expect(related.length).toBe(2);
    });

    test("filters by minCount", () => {
      const related = store.getRelatedTools("fs:read", 2);
      expect(related.length).toBe(1);
      expect(related[0]?.toolKey).toBe("fs:write");
    });

    test("returns empty for unknown tool", () => {
      const related = store.getRelatedTools("unknown:tool", 1);
      expect(related.length).toBe(0);
    });
  });

  describe("getSuggestedBundles", () => {
    beforeEach(() => {
      // fs:read often used with fs:write and db:query
      store.recordCooccurrence("fs:read", "fs:write");
      store.recordCooccurrence("fs:read", "fs:write");
      store.recordCooccurrence("fs:read", "db:query");
      store.recordCooccurrence("fs:read", "db:query");
      // fs:write also used with net:fetch
      store.recordCooccurrence("fs:write", "net:fetch");
    });

    test("suggests related tools not in input set", () => {
      const bundles = store.getSuggestedBundles(["fs:read"], 1, 5);

      // Should suggest fs:write and db:query (both have count 2)
      expect(bundles.length).toBeGreaterThan(0);
      const toolKeys = bundles.map((b) => b.toolKey);
      expect(toolKeys).toContain("fs:write");
      expect(toolKeys).toContain("db:query");
    });

    test("excludes tools already in input", () => {
      const bundles = store.getSuggestedBundles(["fs:read", "fs:write"], 1, 5);

      // Should not suggest fs:read or fs:write
      const toolKeys = bundles.map((b) => b.toolKey);
      expect(toolKeys).not.toContain("fs:read");
      expect(toolKeys).not.toContain("fs:write");
    });

    test("aggregates counts from multiple input tools", () => {
      const bundles = store.getSuggestedBundles(["fs:read", "fs:write"], 1, 5);

      // net:fetch is related to fs:write (count 1)
      // db:query is related to fs:read (count 2)
      expect(bundles.length).toBeGreaterThan(0);
    });

    test("returns empty for empty input", () => {
      const bundles = store.getSuggestedBundles([], 1, 5);
      expect(bundles.length).toBe(0);
    });

    test("respects limit", () => {
      const bundles = store.getSuggestedBundles(["fs:read"], 1, 1);
      expect(bundles.length).toBe(1);
    });
  });

  describe("clearCooccurrences", () => {
    test("removes all co-occurrence data", () => {
      store.recordCooccurrence("a:t1", "b:t2");
      store.recordCooccurrence("c:t3", "d:t4");

      expect(store.getCooccurrenceCount()).toBe(2);

      store.clearCooccurrences();

      expect(store.getCooccurrenceCount()).toBe(0);
    });
  });
});
