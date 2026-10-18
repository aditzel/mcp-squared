#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import {
  meetsCoverageThresholds,
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
  const lcovPath = process.argv[3] ?? "coverage/lcov.info";
  const threshold = parseThreshold(process.argv[4]);

  const lcovText = readFileSync(lcovPath, "utf-8");
  const summary = parseLcovCoverage(lcovText);

  if (!summary.hasBranchCoverage || summary.branchesFound === 0) {
    throw new Error(
      "LCOV contains no measured branches; run bun run test:coverage.",
    );
  }

  if (!meetsCoverageThresholds(summary, threshold)) {
    console.error(
      `[coverage] Coverage below required ${threshold}%: lines=${summary.lineCoveragePct.toFixed(2)}%, branches=${summary.branchCoveragePct.toFixed(2)}%.`,
    );
    process.exit(1);
  }

  console.log(
    `[coverage] Coverage meets required ${threshold}%: lines=${summary.lineCoveragePct.toFixed(2)}%, branches=${summary.branchCoveragePct.toFixed(2)}%.`,
  );
}

main();
