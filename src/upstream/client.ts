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
  /** Stderr output from the server process (verbose mode only) */
  stderr: string | undefined;
}

export interface TestOptions {
  /** Connection timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
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
  name: string,
  config: UpstreamServerConfig,
  options: TestOptions = {},
): Promise<TestResult> {
  const { timeoutMs = 30_000, verbose = false } = options;
  const startTime = Date.now();
  const log = (msg: string) => verbose && console.log(`  [${name}] ${msg}`);
  let stderrOutput = "";

  if (config.transport !== "stdio") {
    return {
      success: false,
      serverName: undefined,
      serverVersion: undefined,
      tools: [],
      error: "SSE transport not yet supported for testing",
      durationMs: Date.now() - startTime,
      stderr: undefined,
    };
  }

  const stdioConfig = config as UpstreamStdioServerConfig;
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  try {
    const fullCommand = [stdioConfig.stdio.command, ...stdioConfig.stdio.args].join(" ");
    log(`Command: ${fullCommand}`);
    if (stdioConfig.stdio.cwd) {
      log(`Working dir: ${stdioConfig.stdio.cwd}`);
    }

    client = new Client({
      name: "mcp-squared-test",
      version: "1.0.0",
    });

    const resolvedEnv = resolveEnvVars(config.env || {});
    if (verbose && Object.keys(resolvedEnv).length > 0) {
      log(`Environment: ${Object.keys(resolvedEnv).join(", ")}`);
    }
    const envWithDefaults = { ...process.env, ...resolvedEnv } as Record<
      string,
      string
    >;

    log(`Creating transport...`);
    transport = new StdioClientTransport({
      command: stdioConfig.stdio.command,
      args: stdioConfig.stdio.args,
      env: envWithDefaults,
      ...(stdioConfig.stdio.cwd ? { cwd: stdioConfig.stdio.cwd } : {}),
      stderr: "pipe",
    });

    // Capture stderr output
    if (transport.stderr) {
      transport.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrOutput += text;
        if (verbose) {
          // Print stderr lines in real-time
          for (const line of text.split("\n").filter((l) => l.trim())) {
            console.log(`  [${name}] stderr: ${line}`);
          }
        }
      });
    }

    log(`Connecting (timeout: ${timeoutMs}ms)...`);
    const connectStart = Date.now();
    const connectPromise = client.connect(transport);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Connection timeout")),
        timeoutMs,
      );
    });

    try {
      await Promise.race([connectPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
    log(`Connected in ${Date.now() - connectStart}ms`);

    const serverInfo = client.getServerVersion();
    if (serverInfo) {
      log(`Server: ${serverInfo.name} v${serverInfo.version}`);
    }

    log(`Fetching tools...`);
    const toolsStart = Date.now();
    const { tools } = await client.listTools();
    log(`Got ${tools.length} tools in ${Date.now() - toolsStart}ms`);

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
      stderr: stderrOutput || undefined,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Error: ${errorMessage}`);
    return {
      success: false,
      serverName: undefined,
      serverVersion: undefined,
      tools: [],
      error: errorMessage,
      durationMs: Date.now() - startTime,
      stderr: stderrOutput || undefined,
    };
  } finally {
    log(`Cleaning up...`);
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
    log(`Done`);
  }
}
