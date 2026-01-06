# MCP²: Project Inception Requirements

## 1. Summary
MCP² (Mercury Control Plane) is a local-first middleware designed to optimize the interaction between Model Context Protocol (MCP) clients (agents, IDEs) and servers. It introduces a "meta-server" layer that indexes tools and progressively discloses them to the LLM, reducing context window usage and improving tool selection accuracy.

## 2. Problem Statement
*   **Context Bloat**: As the number of MCP tools grows, sending all schemas to the LLM consumes excessive tokens, increasing cost and latency.
*   **Context Rot**: Static tool definitions can become outdated if upstream servers change.
*   **Schema Overhead**: Detailed JSON schemas are verbose; often, a model only needs a high-level summary to decide *if* a tool is relevant.

## 3. Goals
1.  **Reduce Token Usage**: Enable progressive disclosure where full schemas are only retrieved when needed.
2.  **Local-First Indexing**: Fast, offline-capable tool cataloging and retrieval.
3.  **Deterministic Selection**: Provide inspectable mechanisms for how tools are surfaced.
4.  **Safety**: Treat external tool descriptions as untrusted; implement allowlists and user confirmations.

## 4. Non-Goals
*   Building a hosted SaaS platform.
*   Replacing existing MCP clients (we enhance them).
*   Creating language-specific SDKs (at this stage).

## 5. Personas
*   **The Power User**: Has dozens of MCP servers connected (local and remote) and needs efficient tool management.
*   **The Agent Developer**: Wants to build agents that can access hundreds of tools without blowing the context window.
*   **The Security Conscious User**: Wants to inspect and control which tools are exposed to an LLM.

## 6. Functional Requirements
*   **Catalog Ingestion**: Connect to multiple upstream MCP servers (stdio, SSE) and aggregate their capabilities.
*   **Hybrid Retrieval**: Support both lexical (keyword) and semantic (embedding-based) search for tools.
*   **Detail Levels**:
    *   *L0 (Name Only)*
    *   *L1 (Summary)*: Description + simplified signature.
    *   *L2 (Full Schema)*: The complete JSON schema for execution.
*   **Selection Caching**: Remember which tools are frequently used together (co-occurrence bundles).
*   **Execution Passthrough**: Proxy execute requests to the appropriate upstream server.
*   **Change Detection**: Poll or listen for changes in upstream tools and update the index.

## 7. Non-Functional Requirements
*   **Latency**: Tool discovery (`find_tools`) should take < 50ms.
*   **Index Rebuild**: Should happen in background without blocking requests.
*   **Memory Footprint**: Target < 100MB RAM for the meta-server process.
*   **Cross-Platform**: Priority on macOS and Linux; Windows support to follow.

## 8. Proposed Architecture

### Components
1.  **Cataloger**: Manages connections to upstream MCP servers.
2.  **Index**: Local vector/keyword store for tool definitions (e.g., SQLite + FTS + local embedding model).
3.  **Retriever**: Implements the search logic (`find_tools`).
4.  **Composer**: Constructs the appropriate detail level (L0-L2) for the response.
5.  **Executor**: Handles `call_tool` requests, routing them to the correct upstream connection.

### Data Model Sketch
*   `servers`: { id, name, transport_config, status }
*   `tools`: { id, server_id, name, description, schema_hash, last_updated }
*   `embeddings`: { tool_id, vector }

### Trust & Threat Model
*   **Prompt Injection**: Tool descriptions are sanitized to prevent injection attacks during indexing.
*   **Execution Gates**: Sensitive tools require explicit user confirmation before execution.

## 9. Public MCP-Facing Tool API
The meta-server exposes these tools to the client:

*   `find_tools(query: string, limit: number = 5) -> List[ToolSummary]`
*   `describe_tools(tool_names: List[string]) -> List[ToolSchema]`
*   `execute(tool_name: string, arguments: dict) -> Result`
*   *(Optional)* `list_namespaces() -> List[string]`

## 10. Milestones
*   **MVP**: Connect to 1 upstream server, index it, and expose `find_tools`.
*   **v0.2**: Support multiple upstream servers and hybrid search.
*   **v0.3**: Implement selection caching and "detail levels".

## 11. Open Questions / Risks
*   How to handle tools with identical names from different servers? (Namespacing strategy needed).
*   Optimal strategy for local embedding generation (performance vs. quality).
*   Handling of "session" state in upstream servers.
