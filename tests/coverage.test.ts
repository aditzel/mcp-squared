import { describe, expect, test } from "bun:test";
import {
  meetsCoverageThresholds,
  meetsLineCoverageThreshold,
  parseBunTextLineCoveragePercent,
  parseLcovCoverage,
  parseLcovLineCoverage,
} from "@/utils/coverage.js";

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

describe("parseLcovCoverage", () => {
  test("aggregates line and branch totals across multiple files", () => {
    const lcov = [
      "TN:",
      "SF:src/a.ts",
      "LF:10",
      "LH:8",
      "BRF:6",
      "BRH:5",
      "end_of_record",
      "SF:src/b.ts",
      "LF:5",
      "LH:5",
      "BRF:4",
      "BRH:2",
      "end_of_record",
    ].join("\n");

    const summary = parseLcovCoverage(lcov);

    expect(summary.linesFound).toBe(15);
    expect(summary.linesHit).toBe(13);
    expect(summary.lineCoveragePct).toBeCloseTo(86.666, 2);
    expect(summary.branchesFound).toBe(10);
    expect(summary.branchesHit).toBe(7);
    expect(summary.hasBranchCoverage).toBe(true);
    expect(summary.branchCoveragePct).toBe(70);
  });

  test("treats missing branch totals as 100% when no branches are instrumented", () => {
    const lcov = ["SF:src/a.ts", "LF:2", "LH:2", "end_of_record"].join("\n");

    expect(parseLcovCoverage(lcov)).toEqual({
      linesFound: 2,
      linesHit: 2,
      lineCoveragePct: 100,
      branchesFound: 0,
      branchesHit: 0,
      hasBranchCoverage: false,
      branchCoveragePct: 100,
    });
  });

  test("deduplicates repeated file sections using DA line data", () => {
    const lcov = [
      "SF:src/a.ts",
      "DA:1,1",
      "DA:2,0",
      "LF:2",
      "LH:1",
      "end_of_record",
      "SF:src/a.ts",
      "DA:1,0",
      "DA:2,1",
      "LF:2",
      "LH:1",
      "end_of_record",
    ].join("\n");

    expect(parseLcovCoverage(lcov)).toEqual({
      linesFound: 2,
      linesHit: 2,
      lineCoveragePct: 100,
      branchesFound: 0,
      branchesHit: 0,
      hasBranchCoverage: false,
      branchCoveragePct: 100,
    });
  });

  test("throws when LCOV has invalid BRF/BRH values", () => {
    expect(() => parseLcovCoverage("LF:1\nLH:1\nBRF:not-a-number")).toThrow(
      "Invalid BRF value",
    );
    expect(() => parseLcovCoverage("LF:1\nLH:1\nBRH:not-a-number")).toThrow(
      "Invalid BRH value",
    );
  });

  test("throws when BRDA taken token is malformed", () => {
    const lcov = [
      "SF:src/a.ts",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "BRDA:1,0,0,not-a-number",
      "BRF:1",
      "BRH:0",
      "end_of_record",
    ].join("\n");

    expect(() => parseLcovCoverage(lcov)).toThrow("Invalid BRDA value");
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

describe("meetsCoverageThresholds", () => {
  test("returns true when both line and branch coverage meet threshold", () => {
    expect(
      meetsCoverageThresholds(
        {
          linesFound: 100,
          linesHit: 90,
          lineCoveragePct: 90,
          branchesFound: 50,
          branchesHit: 40,
          branchCoveragePct: 80,
          hasBranchCoverage: true,
        },
        80,
      ),
    ).toBe(true);
  });

  test("returns false when branch coverage is below threshold", () => {
    expect(
      meetsCoverageThresholds(
        {
          linesFound: 100,
          linesHit: 90,
          lineCoveragePct: 90,
          branchesFound: 50,
          branchesHit: 39,
          branchCoveragePct: 78,
          hasBranchCoverage: true,
        },
        80,
      ),
    ).toBe(false);
  });

  test("ignores branch threshold when the report has no branch data", () => {
    expect(
      meetsCoverageThresholds(
        {
          linesFound: 100,
          linesHit: 85,
          lineCoveragePct: 85,
          branchesFound: 0,
          branchesHit: 0,
          branchCoveragePct: 100,
          hasBranchCoverage: false,
        },
        80,
      ),
    ).toBe(true);
  });
});
