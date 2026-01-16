# MCP²: Mercury Control Plane for MCP

MCP² (Mercury Control Plane) is a local-first meta-server and proxy for the Model Context Protocol (MCP). It addresses the problem of tool context bloat and schema token overhead by enabling dynamic, progressive disclosure of tools to LLMs. Instead of flooding the model context with every available tool schema, MCP² exposes a stable, minimal surface area for tool discovery and execution.

## Status
**Inception / Pre-alpha**

## Install & Run

MCP² is published on npm as `mcp-squared`. The CLI runs on Bun (even when installed via npm), so you’ll need Bun installed on your machine.

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

### Install globally

```bash
npm i -g mcp-squared
mcp-squared --help

# or
bun add -g mcp-squared
mcp-squared --help
```

## High-Level Approach
MCP² acts as an intelligent middleware between your MCP clients (IDEs, agents) and upstream MCP servers. It provides:
- `find_tools`: A semantic search interface to locate relevant capabilities.
- `describe_tools`: On-demand retrieval of full schemas for selected tools.
- `execute`: A passthrough execution layer with optional result caching and summarization.

## Non-Goals
- Not a hosted SaaS platform (local-first).
- Not a replacement for MCP clients (it serves them).
- Not shipping language runtimes or SDKs at this stage.

## Contributing
We welcome contributions! Please see [CONTRIBUTING.md](.github/CONTRIBUTING.md) for details on how to get started.

## License
Apache-2.0
