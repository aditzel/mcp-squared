#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import {
  meetsCoverageThresholds,
  parseBunTextLineCoveragePercent,
  parseLcovCoverage,
} from "@/utils/coverage.js";

function parseThreshold(raw: string | undefined): number {
  const threshold = raw === undefined ? 80 : Number(raw);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error(
      `Invalid threshold "${raw ?? "(default)"}". Expected a number between 0 and 100.`,
    );
  }
  return threshold;
}

function main(): void {
  const summaryPath = process.argv[2] ?? "coverage/coverage-summary.txt";
  const lcovPath = process.argv[3] ?? "coverage/lcov.info";
  const threshold = parseThreshold(process.argv[4]);

  const coverageText = readFileSync(summaryPath, "utf-8");
  const lineCoveragePct = parseBunTextLineCoveragePercent(coverageText);
  const lcovText = readFileSync(lcovPath, "utf-8");
  const lcovSummary = parseLcovCoverage(lcovText);
  const summary = {
    ...lcovSummary,
    linesFound: 1,
    linesHit: lineCoveragePct,
    lineCoveragePct,
  };

  if (!meetsCoverageThresholds(summary, threshold)) {
    console.error(
      `[coverage] Coverage below required ${threshold}%: lines=${summary.lineCoveragePct.toFixed(2)}%, branches=${summary.branchCoveragePct.toFixed(2)}%.`,
    );
    process.exit(1);
  }

  if (!summary.hasBranchCoverage) {
    console.warn(
      "[coverage] Branch coverage totals were not present in LCOV output; treating branch coverage as fully covered for this run.",
    );
  }

  console.log(
    `[coverage] Coverage meets required ${threshold}%: lines=${summary.lineCoveragePct.toFixed(2)}%, branches=${summary.branchCoveragePct.toFixed(2)}%.`,
  );
}

main();
