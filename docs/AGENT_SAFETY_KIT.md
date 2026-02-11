# Agent Safety Kit

The Agent Safety Kit adds policy gates, observability, and offline cost simulation to MCP² with opt-in activation.

## Design Goals

- Single guard enforcement point for tool execution.
- Deny-by-default policy model with report-only mode.
- Pluggable observability sink (`null`, `stdout`, `otel`).
- Offline cost replay from task corpus + pricing table.
- No behavior change unless explicitly enabled.

## Environment Variables

- `AGENT_SAFETY_ENABLED`: `0|1` (default `0`)
- `AGENT_POLICY_PATH`: path to policy YAML (default `agent_safety_kit/policy/policy.yaml`)
- `AGENT_POLICY_PLAYBOOK`: playbook in policy file (default `dev`)
- `AGENT_ENV`: runtime env label (default `DEV`)
- `AGENT_POLICY_REPORT_ONLY`: `0|1` (default `1` in `DEV`, `0` in `PROD`)
- `AGENT_OBS_SINK`: `null|stdout|otel` (default `stdout` when enabled)
- `OTEL_SERVICE_NAME`: optional OTel service name

## What Was Integrated

`/Users/allan/projects/personal/mcp-squared/src/server/index.ts` now:

- builds sink with `build_sink()`
- loads policy with `load_policy()` when enabled
- creates `Guard`
- wraps handlers in `task_span(...)`
- wraps upstream tool calls in `tool_span(...)`
- runs `guard.enforce(...)` before upstream execution

When `AGENT_SAFETY_ENABLED=0`, guard and tracing become no-op and behavior remains unchanged.

## Policy File

Default policy:

- `/Users/allan/projects/personal/mcp-squared/agent_safety_kit/policy/policy.yaml`

Policy supports matching by `agent`, `tool`, `action`, with optional constraints:

- `paths_allow`
- `domains_allow`
- `allowlist_cmd_prefix`
- `denylist_cmd_regex`
- `rate_limit_per_min`
- `max_patch_size_bytes`

## Observability

Sinks:

- `null`: no-op (tests/default when disabled)
- `stdout`: JSONL structured logs/spans
- `otel`: OpenTelemetry API sink (optional dependency)

Span names and attributes:

- `agent.task`: `agent`, `task.name`, `model`, `playbook`, `env`
- `agent.tool`: `agent`, `tool`, `action`, `cache_hit`, `playbook`, `env`

Metrics emitted:

- `tool_calls_total`
- `tool_latency_ms`
- `llm_tokens_in_total`
- `llm_tokens_out_total`

## Cost Model Simulator

Input files:

- pricing: `/Users/allan/projects/personal/mcp-squared/agent_safety_kit/cost_model/pricing.csv`
- tasks sample: `/Users/allan/projects/personal/mcp-squared/agent_safety_kit/cost_model/tasks.csv`

Run:

```bash
bun run agent_safety_kit/cost_model/simulate.ts \
  --tasks agent_safety_kit/cost_model/tasks.csv \
  --pricing agent_safety_kit/cost_model/pricing.csv \
  --out agent_safety_kit/cost_model/report.md
```

Also available via npm script:

```bash
npm run safety:sim
```

The simulator writes:

- Markdown summary report
- CSV details by task/model with estimated token and cost breakdown

## Tests

Added tests:

- `/Users/allan/projects/personal/mcp-squared/tests/agent_safety_kit/policy-matching.test.ts`
- `/Users/allan/projects/personal/mcp-squared/tests/agent_safety_kit/ratelimit.test.ts`
- `/Users/allan/projects/personal/mcp-squared/tests/agent_safety_kit/guard.test.ts`

These cover matcher behavior, secret redaction, and sliding-window rate limiting.
