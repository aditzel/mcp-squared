/**
 * Upstream server management module exports.
 *
 * Provides connectivity, tool discovery, and execution capabilities
 * for upstream MCP servers via stdio and SSE transports.
 *
 * @module upstream
 */

export {
  type CatalogedTool,
  Cataloger,
  type CatalogerOptions,
  type ConnectionStatus,
  type ServerConnection,
  type ToolInputSchema,
} from "./cataloger.js";
export {
  type TestResult,
  type ToolInfo,
  testUpstreamConnection,
} from "./client.js";
