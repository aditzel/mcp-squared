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

export interface CoverageSummary extends LineCoverageSummary {
  /** Total instrumented branches (BRF) */
  branchesFound: number;
  /** Total covered branches (BRH) */
  branchesHit: number;
  /** Branch coverage percentage in range [0, 100] */
  branchCoveragePct: number;
  /** Whether the LCOV report actually included branch coverage totals */
  hasBranchCoverage: boolean;
}

interface FileCoverageState {
  lines: Map<number, boolean>;
  branches: Map<string, boolean>;
  fallbackLinesFound: number;
  fallbackLinesHit: number;
  fallbackBranchesFound: number;
  fallbackBranchesHit: number;
}

function getFileState(
  files: Map<string, FileCoverageState>,
  path: string,
): FileCoverageState {
  let state = files.get(path);
  if (!state) {
    state = {
      lines: new Map(),
      branches: new Map(),
      fallbackLinesFound: 0,
      fallbackLinesHit: 0,
      fallbackBranchesFound: 0,
      fallbackBranchesHit: 0,
    };
    files.set(path, state);
  }
  return state;
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
  const summary = parseLcovCoverage(lcovContent);
  return {
    linesFound: summary.linesFound,
    linesHit: summary.linesHit,
    lineCoveragePct: summary.lineCoveragePct,
  };
}

/**
 * Parses LCOV line and branch totals across all files.
 *
 * @param lcovContent - Raw LCOV file contents
 * @returns Aggregated line/branch coverage summary
 * @throws Error when LCOV has invalid numeric fields or no instrumented lines
 */
export function parseLcovCoverage(lcovContent: string): CoverageSummary {
  const files = new Map<string, FileCoverageState>();
  let currentFile: FileCoverageState | null = null;
  let hasBranchCoverage = false;

  for (const rawLine of lcovContent.split(/\r?\n/)) {
    if (rawLine.startsWith("SF:")) {
      currentFile = getFileState(files, rawLine.slice(3));
    } else if (rawLine === "end_of_record") {
      currentFile = null;
    } else if (rawLine.startsWith("DA:")) {
      if (!currentFile) {
        continue;
      }
      const [lineNoRaw, hitsRaw] = rawLine.slice(3).split(",", 2);
      const lineNo = Number(lineNoRaw);
      const hits = Number(hitsRaw);
      if (
        !Number.isInteger(lineNo) ||
        lineNo < 0 ||
        !Number.isFinite(hits) ||
        hits < 0
      ) {
        throw new Error(`Invalid DA value in LCOV: ${rawLine}`);
      }
      currentFile.lines.set(
        lineNo,
        (currentFile.lines.get(lineNo) ?? false) || hits > 0,
      );
    } else if (rawLine.startsWith("BRDA:")) {
      if (!currentFile) {
        continue;
      }
      hasBranchCoverage = true;
      const [lineNoRaw, blockRaw, branchRaw, hitsRaw] = rawLine
        .slice(5)
        .split(",", 4);
      const lineNo = Number(lineNoRaw);
      const block = Number(blockRaw);
      const branch = Number(branchRaw);
      if (
        !Number.isInteger(lineNo) ||
        lineNo < 0 ||
        !Number.isInteger(block) ||
        block < 0 ||
        !Number.isInteger(branch) ||
        branch < 0
      ) {
        throw new Error(`Invalid BRDA value in LCOV: ${rawLine}`);
      }
      const taken = (hitsRaw ?? "").trim();
      if (taken !== "-" && !/^\d+$/.test(taken)) {
        throw new Error(`Invalid BRDA value in LCOV: ${rawLine}`);
      }
      const hit = taken !== "-" && Number(taken) > 0;
      const key = `${lineNo}:${block}:${branch}`;
      currentFile.branches.set(
        key,
        (currentFile.branches.get(key) ?? false) || hit,
      );
    } else if (rawLine.startsWith("LF:")) {
      const value = Number(rawLine.slice(3));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid LF value in LCOV: ${rawLine}`);
      }
      if (currentFile) {
        currentFile.fallbackLinesFound = Math.max(
          currentFile.fallbackLinesFound,
          value,
        );
      }
    } else if (rawLine.startsWith("LH:")) {
      const value = Number(rawLine.slice(3));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid LH value in LCOV: ${rawLine}`);
      }
      if (currentFile) {
        currentFile.fallbackLinesHit = Math.max(
          currentFile.fallbackLinesHit,
          value,
        );
      }
    } else if (rawLine.startsWith("BRF:")) {
      hasBranchCoverage = true;
      const value = Number(rawLine.slice(4));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid BRF value in LCOV: ${rawLine}`);
      }
      if (currentFile) {
        currentFile.fallbackBranchesFound = Math.max(
          currentFile.fallbackBranchesFound,
          value,
        );
      }
    } else if (rawLine.startsWith("BRH:")) {
      hasBranchCoverage = true;
      const value = Number(rawLine.slice(4));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid BRH value in LCOV: ${rawLine}`);
      }
      if (currentFile) {
        currentFile.fallbackBranchesHit = Math.max(
          currentFile.fallbackBranchesHit,
          value,
        );
      }
    }
  }

  let linesFound = 0;
  let linesHit = 0;
  let branchesFound = 0;
  let branchesHit = 0;

  for (const state of files.values()) {
    if (state.lines.size > 0) {
      linesFound += state.lines.size;
      linesHit += [...state.lines.values()].filter(Boolean).length;
    } else {
      linesFound += state.fallbackLinesFound;
      linesHit += state.fallbackLinesHit;
    }

    if (state.branches.size > 0) {
      branchesFound += state.branches.size;
      branchesHit += [...state.branches.values()].filter(Boolean).length;
    } else {
      branchesFound += state.fallbackBranchesFound;
      branchesHit += state.fallbackBranchesHit;
    }
  }

  if (linesFound === 0) {
    throw new Error("LCOV report contains no instrumented lines (LF=0)");
  }

  return {
    linesFound,
    linesHit,
    lineCoveragePct: (linesHit / linesFound) * 100,
    branchesFound,
    branchesHit,
    hasBranchCoverage,
    branchCoveragePct:
      branchesFound > 0 ? (branchesHit / branchesFound) * 100 : 100,
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

/**
 * Returns whether both line and branch coverage meet the provided threshold.
 *
 * @param summary - Aggregated line/branch coverage summary
 * @param thresholdPercent - Required minimum coverage percentage
 */
export function meetsCoverageThresholds(
  summary: CoverageSummary,
  thresholdPercent: number,
): boolean {
  return (
    summary.lineCoveragePct >= thresholdPercent &&
    (!summary.hasBranchCoverage ||
      summary.branchCoveragePct >= thresholdPercent)
  );
}
