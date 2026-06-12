/**
 * SSE/HTTP runtime adapter for remote MCP servers.
 *
 * Handles creating StreamableHTTPClientTransport with optional OAuth
 * authentication for remote SSE/HTTP upstreams.
 *
 * @module upstream/adapters/sse
 */

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { UpstreamSseServerConfig } from "../../config/schema.js";
import type {
  AdapterContext,
  TransportCreationResult,
  UpstreamAdapter,
} from "../adapter.js";
import { resolveHeaders } from "../adapter.js";

/**
 * Creates an SSE/HTTP transport for a remote MCP server.
 */
async function createSseTransport(
  context: AdapterContext,
): Promise<TransportCreationResult> {
  const config = context.config as UpstreamSseServerConfig;
  const resolvedHeaders = resolveHeaders(
    config.sse.headers ?? {},
    config.env ?? {},
  );

  const transport = new StreamableHTTPClientTransport(new URL(config.sse.url), {
    requestInit: {
      headers: resolvedHeaders,
    },
  });

  return { transport: transport as Transport };
}

/** SSE/HTTP runtime adapter. */
export const sseAdapter: UpstreamAdapter = {
  transportType: "sse",
  createTransport: createSseTransport,
};
