/**
 * Stdio runtime adapter for local MCP server processes.
 *
 * Handles spawning child processes via StdioClientTransport and
 * validating that the process started successfully.
 *
 * @module upstream/adapters/stdio
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { UpstreamStdioServerConfig } from "../../config/schema.js";
import type {
  AdapterContext,
  PostConnectResult,
  TransportCreationResult,
  UpstreamAdapter,
} from "../adapter.js";
import { resolveEnvVars } from "../adapter.js";

/**
 * Creates a stdio transport for a local MCP server process.
 */
async function createStdioTransport(
  context: AdapterContext,
): Promise<TransportCreationResult> {
  const config = context.config as UpstreamStdioServerConfig;
  const resolvedEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(config.env ?? {})) {
    resolvedEnv[key] = resolveEnvVars(value, config.env ?? {});
  }

  const params: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd?: string;
  } = {
    command: config.stdio.command,
    args: config.stdio.args,
    env: { ...process.env, ...resolvedEnv } as Record<string, string>,
  };

  if (config.stdio.cwd) {
    params.cwd = config.stdio.cwd;
  }

  const transport = new StdioClientTransport(params);

  return { transport };
}

/**
 * Post-connect validation for stdio transports.
 * Checks that the child process didn't exit immediately.
 */
async function postStdioConnect(
  _context: AdapterContext,
  client: Client,
): Promise<PostConnectResult> {
  // Give the process a moment to fail if it's going to
  await Bun.sleep(100);

  // The MCP SDK doesn't expose exit code directly, but we can check
  // if the client is still usable by attempting a simple operation
  try {
    // If we can list tools, the connection is alive
    await client.listTools();
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "stdio process exited unexpectedly",
    };
  }
}

/** Stdio runtime adapter. */
export const stdioAdapter: UpstreamAdapter = {
  transportType: "stdio",
  createTransport: createStdioTransport,
  postConnect: postStdioConnect,
};
