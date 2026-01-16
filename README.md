# MCP²: Mercury Control Plane for MCP

MCP² (Mercury Control Plane) is a local-first meta-server and proxy for the Model Context Protocol (MCP). It addresses the problem of tool context bloat and schema token overhead by enabling dynamic, progressive disclosure of tools to LLMs. Instead of flooding the model context with every available tool schema, MCP² exposes a stable, minimal surface area for tool discovery and execution.

## Status
**Alpha** - The project is actively developed with core functionality implemented and tested.

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
```

## High-Level Approach
MCP² acts as an intelligent middleware between your MCP clients (IDEs, agents) and upstream MCP servers. It provides:
- `find_tools`: A semantic search interface to locate relevant capabilities using embeddings.
- `describe_tools`: On-demand retrieval of full schemas for selected tools.
- `execute`: A passthrough execution layer with optional result caching and summarization.
- Tool cataloging and indexing from multiple MCP providers
- Embeddings-based semantic search for tool discovery
- Configuration management and persistence
- Real-time monitoring and statistics

## Key Features
- **Multi-provider support**: Works with various MCP server implementations
- **Semantic search**: Find tools using natural language queries
- **Dynamic tool disclosure**: Expose only relevant tool schemas to LLMs
- **Caching**: Optional result caching and tool selection tracking
- **Local-first architecture**: No cloud dependency, runs entirely on your machine
- **TUI interface**: Interactive terminal interface for monitoring and configuration
- **Monitoring**: Real-time statistics and health monitoring

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

## Contributing
We welcome contributions! Please see [CONTRIBUTING.md](.github/CONTRIBUTING.md) for details on how to get started.

## License
Apache-2.0
