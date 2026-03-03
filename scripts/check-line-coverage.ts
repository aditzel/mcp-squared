#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import {
  meetsLineCoverageThreshold,
  parseBunTextLineCoveragePercent,
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
  const coveragePath = process.argv[2] ?? "coverage/coverage-summary.txt";
  const threshold = parseThreshold(process.argv[3]);

  const coverageText = readFileSync(coveragePath, "utf-8");
  const pct = parseBunTextLineCoveragePercent(coverageText);
  const summary = {
    linesFound: 1,
    linesHit: pct,
    lineCoveragePct: pct,
  };

  if (!meetsLineCoverageThreshold(summary, threshold)) {
    console.error(
      `[coverage] Line coverage ${pct}% is below required ${threshold}%.`,
    );
    process.exit(1);
  }

  console.log(`[coverage] Line coverage ${pct}% meets required ${threshold}%.`);
}

main();
