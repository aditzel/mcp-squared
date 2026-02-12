# Cost Model Simulator

Run an offline replay against a task corpus and pricing sheet:

```bash
bun run agent_safety_kit/cost_model/simulate.ts \
  --tasks agent_safety_kit/cost_model/tasks.csv \
  --pricing agent_safety_kit/cost_model/pricing.csv \
  --out agent_safety_kit/cost_model/report.md
```

## `pricing.csv` format

Required columns:

- `model`
- `input_per_1k`
- `output_per_1k`

Optional columns:

- `currency` (default `USD`)

A wildcard model (`*`) can be used as fallback pricing.

## `tasks.csv` format

Supported columns (the simulator picks what is available):

- `task_id` or `id`
- `model`
- `prompt` or `input`
- `response` or `output` or `completion`
- `tokens_in` or `input_tokens` (optional override)
- `tokens_out` or `output_tokens` (optional override)

If token columns are absent, the simulator tries a tokenizer library if available.
If not available, it falls back to a heuristic (`~4 chars/token + overhead`).

## Outputs

- Markdown summary report (`--out`)
- CSV details (`--csv`, defaults to `<out_basename>.csv`)

The markdown report includes per-model totals and `P50`/`P95` cost estimates.
