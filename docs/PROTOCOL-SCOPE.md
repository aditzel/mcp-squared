# MCP² Protocol Scope Decision (AD-91)

## Status
Accepted

## Date
2026-03-02

## Decision
MCP² currently supports a **tools-only** mediation surface for MCP clients.

The supported contract is:
- `find_tools`
- `describe_tools`
- `execute`
- `list_namespaces`
- `clear_selection_cache`

MCP² does **not** currently mediate broader MCP surfaces such as:
- Resources (`listResources`, `readResource`)
- Prompts (`listPrompts`, `getPrompt`)
- Sampling / model-completion relay surfaces

## Scope Implications
- MCP² is ready for tool-centric workflows that need discovery, schema retrieval, and governed tool execution across upstreams.
- Workflows that depend on resources/prompts/sampling must continue to use direct upstream MCP client-server paths for those surfaces.
- This decision documents current product contract only; it does not commit implementation timelines for broader surfaces.

## Adoption Guidance
1. Treat MCP² as the tool orchestration layer in mixed environments.
2. Keep existing direct upstream access where non-tool MCP surfaces are required.
3. Gate daily-driver cutovers on whether your workflows are fully tool-surface compatible.
