import {
  deleteInstanceEntry,
  ensureInstanceRegistryDir,
  ensureSocketDir,
  type InstanceRegistryEntry,
  writeInstanceEntry,
} from "../config/index.js";

export interface CliProcessLike {
  argv: string[];
  cwd(): string;
  env: NodeJS.ProcessEnv;
  exit(code?: number): never;
  on(event: "SIGINT" | "SIGTERM" | "exit", listener: () => void): unknown;
  pid: number;
  stdin: {
    on(event: "close" | "end", listener: () => void): unknown;
  };
}

export interface InstanceRegistration {
  registerInstance: () => void;
  unregisterInstance: () => void;
}

export interface BuildCliInstanceEntryOptions {
  configPath: string;
  id: string;
  launcher: string | undefined;
  processRef?: Pick<CliProcessLike, "argv" | "cwd" | "pid">;
  role: NonNullable<InstanceRegistryEntry["role"]>;
  socketPath: string;
  startedAt?: number;
  version: string;
}

export interface RegisterShutdownHooksOptions {
  includeStdin: boolean;
  onExit?: () => void;
  processRef?: CliProcessLike;
  shutdown: (exitCode: number) => Promise<void>;
}

export function prepareCliRuntimeFilesystem(): void {
  ensureInstanceRegistryDir();
  ensureSocketDir();
}

export function buildCliInstanceEntry({
  configPath,
  id,
  launcher,
  processRef = process,
  role,
  socketPath,
  startedAt = Date.now(),
  version,
}: BuildCliInstanceEntryOptions): InstanceRegistryEntry {
  return {
    id,
    pid: processRef.pid,
    socketPath,
    startedAt,
    cwd: processRef.cwd(),
    configPath,
    version,
    command: processRef.argv.join(" "),
    role,
    ...(launcher ? { launcher } : {}),
  };
}

export function createInstanceRegistration(
  instanceEntry: InstanceRegistryEntry,
): InstanceRegistration {
  let instanceEntryPath: string | null = null;

  return {
    registerInstance(): void {
      if (!instanceEntryPath) {
        instanceEntryPath = writeInstanceEntry(instanceEntry);
      }
    },
    unregisterInstance(): void {
      if (instanceEntryPath) {
        deleteInstanceEntry(instanceEntryPath);
        instanceEntryPath = null;
      }
    },
  };
}

export function registerShutdownHooks({
  includeStdin,
  onExit,
  processRef = process,
  shutdown,
}: RegisterShutdownHooksOptions): void {
  processRef.on("SIGINT", () => {
    void shutdown(0);
  });
  processRef.on("SIGTERM", () => {
    void shutdown(0);
  });

  if (includeStdin) {
    processRef.stdin.on("close", () => {
      void shutdown(0);
    });
    processRef.stdin.on("end", () => {
      void shutdown(0);
    });
  }

  if (onExit) {
    processRef.on("exit", onExit);
  }
}

export function resolveLauncherHint(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    env["MCP_SQUARED_LAUNCHER"] ??
    env["MCP_CLIENT_NAME"] ??
    env["MCP_SQUARED_AGENT"] ??
    undefined
  );
}

export function resolveDaemonSharedSecret(
  cliValue?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = cliValue ?? env["MCP_SQUARED_DAEMON_SECRET"];
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}
