# Dependency Exceptions

Temporary risk acceptances for unresolved advisories.

| Advisory | Package(s) | Severity | Rationale | Controls | Owner | Review By | Linked Issue |
|---|---|---|---|---|---|---|---|
| `file-type` infinite loop in ASF parser (`>=13.0.0 <21.3.1`) | `@opentui/core -> jimp -> @jimp/core -> file-type` | Moderate | Short-term acceptance is limited to MCP²'s local interactive TUI path. `@opentui/core` is only loaded through `src/tui/config-loader.ts` and `src/tui/monitor-loader.ts`, while the main server/proxy/auth/status/test paths do not import it. The reviewed TUI surfaces exchange config text and monitor JSON state, not arbitrary image or binary payloads, so current project-specific reachability is low. A plain Bun override to `file-type@21.x` cleared `bun audit` but proved runtime-incompatible with `@jimp/core@1.6.0`. | Reassess before the review date and on every `@opentui/core`/`jimp` bump; keep TUI imports lazy; do not route untrusted binary/image content through TUI commands without revisiting this exception; prefer upstream remediation over major-version overrides. | Maintainers | 2026-04-12 | Pending maintainer tracking issue |
