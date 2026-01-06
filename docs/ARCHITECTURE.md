# MCP²: Architecture Overview

## High-Level Diagram

```mermaid
graph TD
    Client[MCP Client (IDE/Agent)]
    
    subgraph "MCP² Meta-Server"
        API[Public Tool API]
        Retriever
        Executor
        Cataloger
        Index[(Local Index)]
    end
    
    subgraph "Upstream Servers"
        S1[Server A (Files)]
        S2[Server B (Git)]
        S3[Server C (Stripe)]
    end

    Client -- "1. find_tools()" --> API
    API --> Retriever
    Retriever -- "Query" --> Index
    Index -- "Matches" --> Retriever
    Retriever -- "Tool Summaries" --> API
    
    Client -- "2. describe_tools()" --> API
    API -- "Fetch Schema" --> Index
    
    Client -- "3. execute()" --> API
    API --> Executor
    Executor -- "Route Request" --> Cataloger
    Cataloger -- "Call" --> S1
    Cataloger -- "Call" --> S2
    Cataloger -- "Call" --> S3
```

## Request Flow

1.  **Tool Discovery**:
    *   The user (or agent) sends a natural language query via `find_tools`.
    *   The **Retriever** queries the **Local Index** using a hybrid approach (FTS + Embeddings).
    *   Returns a list of `ToolSummary` objects (name + brief description).

2.  **Schema Retrieval**:
    *   The agent selects relevant tools and calls `describe_tools`.
    *   The system returns the full JSON schema required to construct a valid call.

3.  **Execution**:
    *   The agent calls `execute` with the tool name and arguments.
    *   The **Executor** validates the request and checks for any required user confirmations.
    *   The **Cataloger** routes the request to the active upstream server connection.
    *   Results are returned to the client (optionally summarized).

## Storage & Indexing

*   **Technology**: SQLite is the primary candidate for storing tool metadata and FTS indices.
*   **Embeddings**: A small, local embedding model (e.g., ONNX runtime) will generate vectors for semantic search.
*   **Schema Storage**: Full schemas are stored but not indexed for search; only names and descriptions are indexed.

## Safety Model

*   **Untrusted Metadata**: Tool descriptions from upstream servers are treated as untrusted input. They are sanitized before being indexed to prevent prompt injection attacks against the indexing system.
*   **Confirmation Gates**: High-risk tools (e.g., file system writes, shell execution) can be configured to require explicit user confirmation via the MCP client UI (if supported) or a companion app.
