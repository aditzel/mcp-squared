import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

type ServerSurfaceFactory = (name: string, version: string) => McpServer;

type SessionSurfaceRegistrar = (server: McpServer) => void;

type SessionStatsCollector = {
  incrementActiveConnections: () => void;
  decrementActiveConnections: () => void;
};

export function createSessionServer(args: {
  name: string;
  version: string;
  createMcpServer: ServerSurfaceFactory;
  registerConfiguredSessionSurface: SessionSurfaceRegistrar;
}): McpServer {
  const server = args.createMcpServer(args.name, args.version);
  args.registerConfiguredSessionSurface(server);
  return server;
}

export async function startPrimaryServerSession(args: {
  startCore: () => Promise<void>;
  baseToolsRegistered: boolean;
  server: McpServer;
  registerConfiguredSessionSurface: SessionSurfaceRegistrar;
  statsCollector: SessionStatsCollector;
}): Promise<{ baseToolsRegistered: boolean }> {
  await args.startCore();

  if (!args.baseToolsRegistered) {
    args.registerConfiguredSessionSurface(args.server);
  }

  const transport = new StdioServerTransport();
  await args.server.connect(transport);
  args.statsCollector.incrementActiveConnections();

  return { baseToolsRegistered: true };
}

export async function stopPrimaryServerSession(args: {
  server: McpServer;
  statsCollector: SessionStatsCollector;
  stopCore: () => Promise<void>;
}): Promise<void> {
  await args.server.close();
  args.statsCollector.decrementActiveConnections();
  await args.stopCore();
}
