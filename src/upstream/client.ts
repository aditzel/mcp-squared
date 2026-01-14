import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  UpstreamServerConfig,
  UpstreamStdioServerConfig,
} from "../config/schema.js";

export interface ToolInfo {
  name: string;
  description: string | undefined;
}

export interface TestResult {
  success: boolean;
  serverName: string | undefined;
  serverVersion: string | undefined;
  tools: ToolInfo[];
  error: string | undefined;
  durationMs: number;
}

function resolveEnvVars(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value.startsWith("$")) {
      const envKey = value.slice(1);
      resolved[key] = process.env[envKey] || "";
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

export async function testUpstreamConnection(
  _name: string,
  config: UpstreamServerConfig,
  timeoutMs = 30_000,
): Promise<TestResult> {
  const startTime = Date.now();

  if (config.transport !== "stdio") {
    return {
      success: false,
      serverName: undefined,
      serverVersion: undefined,
      tools: [],
      error: "SSE transport not yet supported for testing",
      durationMs: Date.now() - startTime,
    };
  }

  const stdioConfig = config as UpstreamStdioServerConfig;
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  try {
    client = new Client({
      name: "mcp-squared-test",
      version: "1.0.0",
    });

    const resolvedEnv = resolveEnvVars(config.env || {});
    const envWithDefaults = { ...process.env, ...resolvedEnv } as Record<
      string,
      string
    >;

    transport = new StdioClientTransport({
      command: stdioConfig.stdio.command,
      args: stdioConfig.stdio.args,
      env: envWithDefaults,
      ...(stdioConfig.stdio.cwd ? { cwd: stdioConfig.stdio.cwd } : {}),
      stderr: "pipe",
    });

    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Connection timeout")), timeoutMs);
    });

    await Promise.race([connectPromise, timeoutPromise]);

    const serverInfo = client.getServerVersion();

    const { tools } = await client.listTools();

    const toolInfos: ToolInfo[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));

    return {
      success: true,
      serverName: serverInfo?.name,
      serverVersion: serverInfo?.version,
      tools: toolInfos,
      error: undefined,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      serverName: undefined,
      serverVersion: undefined,
      tools: [],
      error: errorMessage,
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {}
    }
    if (transport) {
      try {
        await transport.close();
      } catch {}
    }
  }
}
