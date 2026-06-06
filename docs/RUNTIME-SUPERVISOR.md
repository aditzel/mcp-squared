# MCP² 0.9 Runtime Supervisor

This document captures the 0.9 refactor direction for using MCP² as a dark-factory control plane shared by multiple agents.

## Goals

- Keep one daemon-side MCP² runtime capable of serving multiple agents.
- Allow local `stdio` MCP servers to run as singleton supervised instances by default.
- Keep remote `sse`/HTTP upstreams as proxy-style connections with policy, auth, monitoring, and future session affinity layered by MCP².
- Preserve the public capability-router contract. Upstream identity stays internal unless explicitly surfaced by introspection or status commands.
- Keep mcporter as an adapter/codegen layer for local servers, not as the core runtime.

## Implemented Foundation

The 0.9 foundation adds a per-upstream runtime policy:

```toml
[upstreams.local.runtime]
lifecycle = "singleton"
concurrency = "exclusive"
maxPoolSize = 1
restart = "on_failure"
```

Transport-aware defaults apply when the runtime block is omitted:

| Transport | Lifecycle | Concurrency | Restart |
| --- | --- | --- | --- |
| `stdio` | `singleton` | `exclusive` | `on_failure` |
| `sse`/HTTP | `proxy` | `session_affine` | `never` |

The implementation is intentionally split:

- `src/config/schema.ts` owns runtime policy validation and effective default resolution.
- `src/runtime/supervisor.ts` owns retained runtime handles and call scheduling.
- `src/upstream/cataloger.ts` still owns MCP SDK clients/transports, but upstream tool calls now execute through the supervisor.
- `mcp-squared status --verbose` shows the effective lifecycle/concurrency policy for each upstream.

## Lifecycle Modes

- `singleton`: one retained runtime handle per upstream key.
- `pooled`: up to `maxPoolSize` retained handles with round-robin selection.
- `ephemeral`: a fresh runtime handle for each acquisition.
- `proxy`: one retained proxy-style runtime handle per upstream key.

## Concurrency Modes

- `exclusive`: serialize all calls for the upstream.
- `shared_read`: allow read-intent calls in parallel; serialize write/unknown calls.
- `session_affine`: serialize calls only when a session or agent identity is provided; otherwise run in parallel.
- `parallel`: do not serialize calls.

MCP² now threads session-aware identity into `RuntimeCallContext` for shared daemon/proxy sessions:

- direct stdio mode still runs without session identity, so the default stdio `exclusive` policy remains globally serialized;
- daemon/proxy sessions forward the MCP session ID plus stable proxy `clientId` as `agentId` when available;
- remote `session_affine` upstreams now serialize only within the same session/agent while different sessions (or no-context calls) remain parallel.

## mcporter Direction

mcporter should be used at the local-adapter boundary:

- Generate typed SDKs for selected local MCP servers.
- Wrap generated SDKs with MCP² policy, audit, and supervisor calls.
- Keep MCP² in charge of process lifecycle, leases, restart, and multi-agent arbitration.

mcporter should not become the central runtime. That would make remote proxying, daemon ownership, auth, and capability routing depend on generated code that only applies to part of the upstream surface.

## Remaining 0.9 Work

- Introduce leases for agents that need temporary exclusive access to a singleton stdio server.
- Persist runtime health, restart counts, and audit events for dark-factory operations.
- Split Cataloger transport connection code into concrete runtime adapters.
- Add mcporter-generated SDK adapter support for local stdio servers.
- Add richer remote proxy middleware for auth/session affinity beyond the current session/client identity threading.
