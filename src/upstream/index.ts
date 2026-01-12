/**
 * Upstream server management module exports.
 *
 * Provides connectivity, tool discovery, and execution capabilities
 * for upstream MCP servers via stdio and SSE transports.
 *
 * @module upstream
 */

export {
  testUpstreamConnection,
  type TestResult,
  type ToolInfo,
} from "./client.js";

export {
  Cataloger,
  type CatalogedTool,
  type CatalogerOptions,
  type ConnectionStatus,
  type ServerConnection,
  type ToolInputSchema,
} from "./cataloger.js";
