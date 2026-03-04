# MCP²: Mercury Control Plane for MCP

MCP² (Mercury Control Plane) is a local-first meta-server and proxy for the Model Context Protocol (MCP). It addresses tool context bloat by enabling dynamic, progressive disclosure of tools to LLMs. Instead of flooding the model context with every available tool schema, MCP² exposes a stable, minimal surface area for tool discovery and execution.

## Status
**Alpha (v0.6.x)** - Core functionality is implemented and tested; CLI and config details may evolve.

## Install & Run

MCP² is published on npm as `mcp-squared`. The CLI runs on Bun (even when installed via npm), so you'll need Bun installed on your machine.

### Prerequisite: Bun

Install Bun (>= 1.0.0): https://bun.sh

### Run without installing (recommended)

```bash
bunx mcp-squared --help
bunx mcp-squared
```

### Run via npm / npx

```bash
npx mcp-squared --help
npm exec --yes mcp-squared -- --help
```

If you see `Cannot find module '@/version.js'`, check for a stale global install:

```bash
which mcp-squared
npm ls -g --depth=0 mcp-squared
```

`mcp-squared@0.3.0` shipped unresolved `@/...` aliases in `dist/index.js`. Remove the old global package and re-run:

```bash
npm uninstall -g mcp-squared
hash -r
npx --yes mcp-squared@latest --help
```

### Install globally

```bash
npm i -g mcp-squared
mcp-squared --help

# or
bun add -g mcp-squared
mcp-squared --help
```

### Run from source

```bash
# Clone the repository
git clone https://github.com/aditzel/mcp-squared
cd mcp-squared

# Install dependencies
bun install

# Run in development mode
bun run dev

# Build for production
bun run build

# Run tests
bun test

# Evaluate tool-routing behavior (discovery-first quality check)
bun run eval:routing

# Dependency audit
bun run audit
```

### Standalone Executable (Experimental)

Build a single-file executable with Bun:

```bash
bun run build:compile
```

Run the compile validation matrix (darwin/linux/windows target support, size checks, standalone smoke test, embeddings probe):

```bash
bun run build:compile:matrix
```

Current findings and known blockers are tracked in `docs/STANDALONE-COMPILE.md`.

## CLI Commands (Common)

```bash
mcp-squared                 # Auto: daemon (TTY) or proxy (piped stdio)
mcp-squared --stdio         # Start MCP server (stdio mode)
mcp-squared daemon          # Start shared daemon (multi-client backend)
mcp-squared proxy           # Start stdio proxy to the shared daemon
mcp-squared config          # Launch configuration TUI
mcp-squared test [upstream] # Test upstream server connections
mcp-squared auth <upstream> # OAuth auth for SSE/HTTP upstreams
mcp-squared import          # Import MCP configs from other tools
mcp-squared migrate         # Apply one-time config migrations
mcp-squared install         # Install MCP² into other MCP clients
mcp-squared monitor         # Launch server monitor TUI
mcp-squared --help          # Full command reference
```

## Shared Daemon Mode (Optional)

Shared daemon mode keeps a single MCP² backend alive and lets multiple stdio clients connect through lightweight proxies. This reduces duplicated upstream connections and indexing work when many tools run in parallel.

Auto mode chooses `daemon` when running in a TTY and `proxy` when stdin/stdout are piped (as MCP clients do).

```bash
mcp-squared daemon          # Start the shared backend
mcp-squared proxy           # Run a stdio proxy that connects to the daemon
mcp-squared daemon --daemon-socket=tcp://127.0.0.1:45000
mcp-squared proxy --daemon-socket=tcp://127.0.0.1:45000
```

Security notes for TCP daemon endpoints:
- TCP daemon bind host is restricted to loopback (`localhost`, `127.0.0.1`, `::1`).
- Optional shared-secret handshake is available with `--daemon-secret=<secret>` (or `MCP_SQUARED_DAEMON_SECRET`).

When installing into supported clients, you can register the proxy automatically:

```bash
mcp-squared install --proxy
mcp-squared install --stdio
```

## Configuration

Config discovery order:
1. `MCP_SQUARED_CONFIG` environment variable
2. Project-local `mcp-squared.toml` or `.mcp-squared/config.toml`
3. User-level `~/.config/mcp-squared/config.toml` (or `%APPDATA%/mcp-squared/config.toml` on Windows)

Minimal example:

```toml
schemaVersion = 1

[upstreams.local]
transport = "stdio"
[upstreams.local.stdio]
command = "mcp-server-local"
args = []

[upstreams.remote]
transport = "sse"
[upstreams.remote.sse]
url = "https://example.com/mcp"
auth = true
```

Security policies (allow/block/confirm) live under `security.tools` and are matched against `capability:action` patterns. Confirmation flows return a short-lived token that must be provided to the same capability/action call to proceed. OAuth tokens for SSE upstreams are stored under `~/.config/mcp-squared/tokens/<upstream>.json`.

`mcp-squared init` seeds code-search routing preferences so internal retrieval/routing heuristics prioritize common code indexers by default:

```toml
[operations.findTools.preferredNamespacesByIntent]
codeSearch = ["auggie", "ctxdb"]
```

Tune this list (or set it to `[]`) if your environment uses different namespaces.

Capability-first connect-time tool surfacing is configurable via inference/override settings:

```toml
[operations.dynamicToolSurface]
inference = "heuristic_with_overrides"
refresh = "on_connect"

[operations.dynamicToolSurface.capabilityOverrides]
# Optional explicit namespace -> capability pinning.
# auggie = "code_search"
```

For existing configs created before this default, run:

```bash
mcp-squared migrate
```

Use `mcp-squared migrate --dry-run` to preview without writing.

Migration note: capability-router mode is now the only public surface. `mcp-squared migrate` cleans legacy config keys and rewrites security patterns to capability/action form.

Legacy keys `operations.dynamicToolSurface.mode` and `operations.dynamicToolSurface.naming` are accepted for compatibility, ignored at runtime, and warned on load. `mcp-squared migrate` removes them.

## Tool API (Capability Routers)

MCP² exposes one public tool per non-empty capability at connect time:
- `code_search`
- `docs`
- `browser_automation`
- `issue_tracking`
- `cms_content`
- `design`
- `hosting_deploy`
- `time_util`
- `research`
- `general`

Each capability tool uses a thin router contract:

```json
{
  "action": "string",
  "arguments": {},
  "confirmation_token": "optional string"
}
```

Every capability tool supports `action = "__describe_actions"` for introspection. This returns capability-local action IDs, summaries, and input schemas without exposing upstream namespace/tool identifiers.

Recommended workflow for LLM clients:
1. Call the relevant capability (for example `code_search`) with `action = "__describe_actions"`.
2. Select an action ID and call the same capability with `arguments`.
3. If `requires_disambiguation` is returned, retry with one of the returned candidate action IDs.
4. If `requires_confirmation` is returned, retry with `confirmation_token`.

## Internal Retrieval Modes

`operations.findTools.defaultMode` supports three retrieval modes used by MCP² internals and evaluation tooling:
- `fast` (default): SQLite FTS5 full-text search
- `semantic`: Embedding similarity search (falls back to `fast` if embeddings are missing)
- `hybrid`: FTS5 + embedding rerank (falls back to `fast` if embeddings are missing)

> **Note:** Semantic and hybrid modes load a local embedding model (BGE-small via Transformers.js/WASM). First load downloads ~33MB and adds ~294MB RSS. These modes are optional - `fast` mode (default) has no such overhead.

Embeddings are generated locally using Transformers.js (BGE-small). They are optional and can be generated programmatically via the retriever API.

## Supported MCP Clients (Import/Install)

MCP² can import or install MCP server configs for:
`claude-code`, `claude-desktop`, `cursor`, `windsurf`, `vscode`, `cline`, `roo-code`, `kilo-code`, `gemini-cli`, `zed`, `jetbrains`, `factory`, `opencode`, `qwen-code`, `trae`, `antigravity`, `warp` (import via explicit path), and `codex`.

## Key Features
- Multi-upstream support (stdio + SSE/HTTP)
- OAuth 2.0 dynamic client registration for SSE upstreams
- Capability-first public API (one router tool per capability)
- Action-level introspection via `__describe_actions`
- Hybrid retrieval with optional local embeddings (FTS5 + Transformers.js)
- Selection caching with co-occurrence suggestions
- Background index refresh with change detection
- Security policies (allow/block/confirm) on `capability:action` patterns
- Local-first architecture (SQLite index)
- TUI interfaces for configuration and monitoring

## Non-Goals
- Not a hosted SaaS platform (local-first).
- Not a replacement for MCP clients (it serves them).
- Not shipping language runtimes or SDKs at this stage.

## Architecture

MCP² is built with Bun and TypeScript, leveraging:
- @modelcontextprotocol/sdk for MCP communication
- @huggingface/transformers for embeddings generation
- @opentui/core for the terminal user interface
- Zod for validation

See `docs/ARCHITECTURE.md` for a full architecture breakdown.

## Contributing

We welcome contributions! Please see `.github/CONTRIBUTING.md` for details on how to get started.

## Releasing

Maintainers can follow `docs/RELEASING.md` for the npm release checklist and `docs/DEPENDENCY_MAINTENANCE.md` for dependency cadence and exception handling.

## License

Apache-2.0
