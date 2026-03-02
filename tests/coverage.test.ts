import { describe, expect, test } from "bun:test";
import {
  meetsLineCoverageThreshold,
  parseBunTextLineCoveragePercent,
  parseLcovLineCoverage,
} from "../src/utils/coverage.js";

describe("parseLcovLineCoverage", () => {
  test("aggregates LF and LH totals across multiple files", () => {
    const lcov = [
      "TN:",
      "SF:src/a.ts",
      "LF:10",
      "LH:8",
      "end_of_record",
      "SF:src/b.ts",
      "LF:5",
      "LH:5",
      "end_of_record",
    ].join("\n");

    const summary = parseLcovLineCoverage(lcov);

    expect(summary.linesFound).toBe(15);
    expect(summary.linesHit).toBe(13);
    expect(summary.lineCoveragePct).toBeCloseTo(86.666, 2);
  });

  test("ignores unrelated LCOV keys", () => {
    const lcov = [
      "SF:src/a.ts",
      "DA:1,1",
      "DA:2,0",
      "BRF:10",
      "BRH:9",
      "LF:2",
      "LH:1",
      "end_of_record",
    ].join("\n");

    const summary = parseLcovLineCoverage(lcov);
    expect(summary).toEqual({
      linesFound: 2,
      linesHit: 1,
      lineCoveragePct: 50,
    });
  });

  test("throws when LCOV has invalid LF/LH values", () => {
    expect(() => parseLcovLineCoverage("LF:not-a-number\nLH:1")).toThrow(
      "Invalid LF value",
    );
    expect(() => parseLcovLineCoverage("LF:10\nLH:not-a-number")).toThrow(
      "Invalid LH value",
    );
  });

  test("throws when LCOV has no instrumented lines", () => {
    expect(() =>
      parseLcovLineCoverage("TN:\nSF:src/a.ts\nend_of_record"),
    ).toThrow("LF=0");
  });
});

describe("meetsLineCoverageThreshold", () => {
  test("returns true when percentage is equal to threshold", () => {
    expect(
      meetsLineCoverageThreshold(
        {
          linesFound: 100,
          linesHit: 80,
          lineCoveragePct: 80,
        },
        80,
      ),
    ).toBe(true);
  });

  test("returns false when percentage is below threshold", () => {
    expect(
      meetsLineCoverageThreshold(
        {
          linesFound: 100,
          linesHit: 79,
          lineCoveragePct: 79,
        },
        80,
      ),
    ).toBe(false);
  });
});

describe("parseBunTextLineCoveragePercent", () => {
  test("parses line coverage from Bun 'All files' summary row", () => {
    const text = [
      "------------------------------------------------|---------|---------|-------------------",
      "File                                            | % Funcs | % Lines | Uncovered Line #s",
      "------------------------------------------------|---------|---------|-------------------",
      "All files                                       |   64.43 |   81.18 |",
    ].join("\n");

    expect(parseBunTextLineCoveragePercent(text)).toBe(81.18);
  });

  test("throws when summary row is missing", () => {
    expect(() => parseBunTextLineCoveragePercent("no coverage table")).toThrow(
      "All files",
    );
  });

  test("throws when line percentage is not numeric", () => {
    const text = "All files | 64.00 | not-a-number |";
    expect(() => parseBunTextLineCoveragePercent(text)).toThrow(
      "Invalid line coverage percentage",
    );
  });
});
