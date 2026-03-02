/**
 * Utilities for parsing LCOV line coverage and evaluating thresholds.
 *
 * @module utils/coverage
 */

export interface LineCoverageSummary {
  /** Total instrumented lines (LF) */
  linesFound: number;
  /** Total covered lines (LH) */
  linesHit: number;
  /** Line coverage percentage in range [0, 100] */
  lineCoveragePct: number;
}

/**
 * Parses line coverage totals from LCOV content.
 *
 * This parser aggregates all `LF:` and `LH:` entries across files and computes
 * a single global line coverage percentage.
 *
 * @param lcovContent - Raw LCOV file contents
 * @returns Aggregated line coverage summary
 * @throws Error when LCOV has invalid numeric fields or no instrumented lines
 */
export function parseLcovLineCoverage(
  lcovContent: string,
): LineCoverageSummary {
  let linesFound = 0;
  let linesHit = 0;

  for (const rawLine of lcovContent.split(/\r?\n/)) {
    if (rawLine.startsWith("LF:")) {
      const value = Number(rawLine.slice(3));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid LF value in LCOV: ${rawLine}`);
      }
      linesFound += value;
    } else if (rawLine.startsWith("LH:")) {
      const value = Number(rawLine.slice(3));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid LH value in LCOV: ${rawLine}`);
      }
      linesHit += value;
    }
  }

  if (linesFound === 0) {
    throw new Error("LCOV report contains no instrumented lines (LF=0)");
  }

  return {
    linesFound,
    linesHit,
    lineCoveragePct: (linesHit / linesFound) * 100,
  };
}

/**
 * Parses Bun text coverage output and returns the global `% Lines` value from
 * the `All files` summary row.
 *
 * Example row:
 * `All files                                       |   64.43 |   81.18 |`
 *
 * @param coverageText - Bun text coverage output
 * @returns Global line coverage percentage
 * @throws Error when the summary row is not found or malformed
 */
export function parseBunTextLineCoveragePercent(coverageText: string): number {
  const match = coverageText.match(/^All files\s+\|\s+([^|]+)\|\s+([^|]+)\|/m);
  if (!match) {
    throw new Error("Could not find 'All files' coverage summary row");
  }
  const linesPercent = Number(match[2]?.trim());
  if (!Number.isFinite(linesPercent)) {
    throw new Error("Invalid line coverage percentage in Bun coverage summary");
  }
  return linesPercent;
}

/**
 * Returns whether a line coverage summary meets the provided threshold.
 *
 * @param summary - Aggregated line coverage summary
 * @param thresholdPercent - Required minimum line coverage percentage
 */
export function meetsLineCoverageThreshold(
  summary: LineCoverageSummary,
  thresholdPercent: number,
): boolean {
  return summary.lineCoveragePct >= thresholdPercent;
}
