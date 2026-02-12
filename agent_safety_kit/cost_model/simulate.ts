import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

interface CliOptions {
  tasksPath: string;
  pricingPath: string;
  outPath: string;
  csvOutPath: string;
}

interface TaskRecord {
  taskId: string;
  model: string;
  inputText: string;
  outputText: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface PricingRecord {
  model: string;
  inputPer1k: number;
  outputPer1k: number;
  currency: string;
}

interface SimulatedTask {
  taskId: string;
  model: string;
  pricingModel: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

interface TokenCounter {
  name: string;
  count: (text: string, model: string) => number;
}

const require = createRequire(import.meta.url);

function parseArgs(argv: string[]): CliOptions {
  const options = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    options.set(key, value);
    i += 1;
  }

  const tasksPath = options.get("tasks");
  const pricingPath = options.get("pricing");
  const outPath = options.get("out");

  if (!tasksPath || !pricingPath || !outPath) {
    throw new Error(
      "Usage: bun run agent_safety_kit/cost_model/simulate.ts --tasks <tasks.csv> --pricing <pricing.csv> --out <report.md> [--csv <details.csv>]",
    );
  }

  const csvOutPath =
    options.get("csv") ?? `${outPath.replace(/\.md$/i, "")}.csv`;

  return {
    tasksPath,
    pricingPath,
    outPath,
    csvOutPath,
  };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function readCsvRows(path: string): Array<Record<string, string>> {
  const raw = readFileSync(resolve(process.cwd(), path), "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0] ?? "");
  const rows: Array<Record<string, string>> = [];

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};

    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index];
      if (!header) {
        continue;
      }
      row[header] = cols[index] ?? "";
    }

    rows.push(row);
  }

  return rows;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

function heuristicTokenCount(text: string): number {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4) + 8);
}

function loadTokenizer(): TokenCounter {
  try {
    const tokenizerModule = require("js-tiktoken") as {
      encodingForModel?: (model: string) => {
        encode: (text: string) => number[];
        free?: () => void;
      };
      getEncoding?: (encoding: string) => {
        encode: (text: string) => number[];
        free?: () => void;
      };
    };

    if (
      typeof tokenizerModule.encodingForModel === "function" ||
      typeof tokenizerModule.getEncoding === "function"
    ) {
      return {
        name: "js-tiktoken",
        count: (text: string, model: string): number => {
          if (text.trim().length === 0) {
            return 0;
          }

          const fromModel = tokenizerModule.encodingForModel;
          if (fromModel) {
            try {
              const encoding = fromModel(model);
              const tokens = encoding.encode(text).length;
              encoding.free?.();
              return tokens;
            } catch {
              // fall back to cl100k_base
            }
          }

          const fromEncoding = tokenizerModule.getEncoding;
          if (fromEncoding) {
            try {
              const encoding = fromEncoding("cl100k_base");
              const tokens = encoding.encode(text).length;
              encoding.free?.();
              return tokens;
            } catch {
              // fall through to heuristic
            }
          }

          return heuristicTokenCount(text);
        },
      };
    }
  } catch {
    // tokenizer is optional
  }

  return {
    name: "heuristic",
    count: (text: string) => heuristicTokenCount(text),
  };
}

function toTaskRecords(rows: Array<Record<string, string>>): TaskRecord[] {
  return rows.map((row, index) => ({
    taskId: row["task_id"] || row["id"] || `task-${index + 1}`,
    model: row["model"] || "unknown",
    inputText:
      row["input"] || row["prompt"] || row["messages"] || row["request"] || "",
    outputText:
      row["output"] ||
      row["response"] ||
      row["completion"] ||
      row["result"] ||
      "",
    inputTokens: parseNumber(row["tokens_in"] || row["input_tokens"]),
    outputTokens: parseNumber(row["tokens_out"] || row["output_tokens"]),
  }));
}

function toPricingRecords(
  rows: Array<Record<string, string>>,
): PricingRecord[] {
  const parsed = rows
    .map((row) => ({
      model: row["model"] || "",
      inputPer1k: parseNumber(row["input_per_1k"]),
      outputPer1k: parseNumber(row["output_per_1k"]),
      currency: row["currency"] || "USD",
    }))
    .filter((row) => row.model.length > 0);

  const invalid = parsed.find(
    (row) => row.inputPer1k === undefined || row.outputPer1k === undefined,
  );

  if (invalid) {
    throw new Error(
      `Invalid pricing row for model \"${invalid.model}\". Required columns: model,input_per_1k,output_per_1k`,
    );
  }

  return parsed.map((row) => ({
    model: row.model,
    inputPer1k: row.inputPer1k as number,
    outputPer1k: row.outputPer1k as number,
    currency: row.currency,
  }));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)] ?? 0;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function ensureDirectory(path: string): void {
  const dir = dirname(path);
  if (!dir || dir === ".") {
    return;
  }
  mkdirSync(dir, { recursive: true });
}

function simulate(
  tasks: TaskRecord[],
  pricingRows: PricingRecord[],
  counter: TokenCounter,
): {
  details: SimulatedTask[];
  missingPricingModels: string[];
} {
  const pricingByModel = new Map<string, PricingRecord>();
  for (const row of pricingRows) {
    pricingByModel.set(row.model, row);
  }

  const details: SimulatedTask[] = [];
  const missingPricingModels = new Set<string>();

  for (const task of tasks) {
    const pricing = pricingByModel.get(task.model) ?? pricingByModel.get("*");

    const inputTokens =
      task.inputTokens !== undefined
        ? Math.round(task.inputTokens)
        : counter.count(task.inputText, task.model);
    const outputTokens =
      task.outputTokens !== undefined
        ? Math.round(task.outputTokens)
        : counter.count(task.outputText, task.model);

    if (!pricing) {
      missingPricingModels.add(task.model);
      details.push({
        taskId: task.taskId,
        model: task.model,
        pricingModel: "",
        inputTokens,
        outputTokens,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        currency: "USD",
      });
      continue;
    }

    const inputCost = (inputTokens / 1000) * pricing.inputPer1k;
    const outputCost = (outputTokens / 1000) * pricing.outputPer1k;

    details.push({
      taskId: task.taskId,
      model: task.model,
      pricingModel: pricing.model,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: pricing.currency,
    });
  }

  return {
    details,
    missingPricingModels: Array.from(missingPricingModels).sort(),
  };
}

function buildMarkdownReport(
  details: SimulatedTask[],
  missingPricingModels: string[],
  counterName: string,
): string {
  const totalCost = details.reduce((sum, item) => sum + item.totalCost, 0);
  const totalInputTokens = details.reduce(
    (sum, item) => sum + item.inputTokens,
    0,
  );
  const totalOutputTokens = details.reduce(
    (sum, item) => sum + item.outputTokens,
    0,
  );

  const models = new Map<
    string,
    {
      count: number;
      inputTokens: number;
      outputTokens: number;
      costs: number[];
      totalCost: number;
      currency: string;
    }
  >();

  for (const detail of details) {
    const bucket = models.get(detail.model) ?? {
      count: 0,
      inputTokens: 0,
      outputTokens: 0,
      costs: [],
      totalCost: 0,
      currency: detail.currency,
    };

    bucket.count += 1;
    bucket.inputTokens += detail.inputTokens;
    bucket.outputTokens += detail.outputTokens;
    bucket.costs.push(detail.totalCost);
    bucket.totalCost += detail.totalCost;

    models.set(detail.model, bucket);
  }

  const lines: string[] = [];
  lines.push("# Agent Safety Kit Cost Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Tokenizer: ${counterName}`);
  lines.push(`Tasks: ${details.length}`);
  lines.push(`Total input tokens: ${totalInputTokens}`);
  lines.push(`Total output tokens: ${totalOutputTokens}`);
  lines.push(`Total estimated cost: ${formatUsd(totalCost)}`);
  lines.push("");
  lines.push("## By Model");
  lines.push("");
  lines.push(
    "| Model | Tasks | Input Tokens | Output Tokens | Total Cost | P50 | P95 |",
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");

  const sortedModels = Array.from(models.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [model, stats] of sortedModels) {
    lines.push(
      `| ${model} | ${stats.count} | ${stats.inputTokens} | ${stats.outputTokens} | ${formatUsd(stats.totalCost)} | ${formatUsd(percentile(stats.costs, 50))} | ${formatUsd(percentile(stats.costs, 95))} |`,
    );
  }

  if (missingPricingModels.length > 0) {
    lines.push("");
    lines.push("## Missing Pricing");
    lines.push("");
    lines.push(
      `No pricing found for: ${missingPricingModels.join(", ")} (cost set to $0 for those rows).`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function buildDetailsCsv(details: SimulatedTask[]): string {
  const header = [
    "task_id",
    "model",
    "pricing_model",
    "input_tokens",
    "output_tokens",
    "input_cost",
    "output_cost",
    "total_cost",
    "currency",
  ];

  const lines = [header.join(",")];

  for (const detail of details) {
    lines.push(
      [
        detail.taskId,
        detail.model,
        detail.pricingModel,
        String(detail.inputTokens),
        String(detail.outputTokens),
        detail.inputCost.toFixed(6),
        detail.outputCost.toFixed(6),
        detail.totalCost.toFixed(6),
        detail.currency,
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);

  const tasks = toTaskRecords(readCsvRows(options.tasksPath));
  const pricing = toPricingRecords(readCsvRows(options.pricingPath));

  const tokenizer = loadTokenizer();
  const result = simulate(tasks, pricing, tokenizer);

  const markdown = buildMarkdownReport(
    result.details,
    result.missingPricingModels,
    tokenizer.name,
  );
  const detailCsv = buildDetailsCsv(result.details);

  const reportPath = resolve(process.cwd(), options.outPath);
  const detailsPath = resolve(process.cwd(), options.csvOutPath);

  ensureDirectory(reportPath);
  ensureDirectory(detailsPath);

  writeFileSync(reportPath, markdown, "utf8");
  writeFileSync(detailsPath, detailCsv, "utf8");

  const total = result.details.reduce((sum, row) => sum + row.totalCost, 0);
  console.log(
    `[agent-safety-kit] Simulated ${result.details.length} task(s). Total estimated cost: ${formatUsd(total)}.`,
  );
  console.log(`[agent-safety-kit] Markdown report: ${reportPath}`);
  console.log(`[agent-safety-kit] CSV details: ${detailsPath}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[agent-safety-kit] Simulation failed: ${message}`);
    process.exit(1);
  });
}
