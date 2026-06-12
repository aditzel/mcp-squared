import { randomUUID } from "node:crypto";
import {
  listActiveInstanceEntries,
  loadConfig,
  type McpSquaredConfig,
} from "../config/index.js";
import { getSocketFilePath } from "../config/paths.js";
import { performPreflightAuth } from "../oauth/index.js";
import { McpSquaredServer } from "../server/index.js";
import { VERSION } from "../version.js";
import {
  buildCliInstanceEntry,
  type CliProcessLike,
  createInstanceRegistration,
  prepareCliRuntimeFilesystem,
  registerShutdownHooks,
  resolveLauncherHint,
} from "./runtime-bootstrap.js";
import {
  logSearchModeProfile,
  logSecurityProfile,
} from "./runtime-profiles.js";

interface LoadConfigResult {
  config: McpSquaredConfig;
  path: string;
}

interface ServerRuntimeLike {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RunStdioServerDependencies {
  buildCliInstanceEntry: typeof buildCliInstanceEntry;
  createInstanceRegistration: typeof createInstanceRegistration;
  createServer: (options: {
    config: McpSquaredConfig;
    monitorSocketPath: string;
  }) => ServerRuntimeLike;
  getSocketFilePath: typeof getSocketFilePath;
  listActiveInstanceEntries: typeof listActiveInstanceEntries;
  loadConfig: () => Promise<LoadConfigResult>;
  logSearchModeProfile: (config: McpSquaredConfig) => void;
  logSecurityProfile: (config: McpSquaredConfig) => void;
  performPreflightAuth: typeof performPreflightAuth;
  prepareCliRuntimeFilesystem: typeof prepareCliRuntimeFilesystem;
  processRef: CliProcessLike;
  randomUUID: () => string;
  registerShutdownHooks: typeof registerShutdownHooks;
  resolveLauncherHint: typeof resolveLauncherHint;
  version: string;
}

export function createRunStdioServerDependencies(): RunStdioServerDependencies {
  return {
    buildCliInstanceEntry,
    createInstanceRegistration,
    createServer: (options) => new McpSquaredServer(options),
    getSocketFilePath,
    listActiveInstanceEntries,
    loadConfig,
    logSearchModeProfile,
    logSecurityProfile,
    performPreflightAuth,
    prepareCliRuntimeFilesystem,
    processRef: process,
    randomUUID,
    registerShutdownHooks,
    resolveLauncherHint,
    version: VERSION,
  };
}

export async function startStdioServer(
  dependencies: RunStdioServerDependencies,
): Promise<void> {
  const {
    buildCliInstanceEntry,
    createInstanceRegistration,
    createServer,
    getSocketFilePath,
    listActiveInstanceEntries,
    loadConfig,
    logSearchModeProfile,
    logSecurityProfile,
    performPreflightAuth,
    prepareCliRuntimeFilesystem,
    processRef,
    randomUUID,
    registerShutdownHooks,
    resolveLauncherHint,
    version,
  } = dependencies;
  const { config, path: configPath } = await loadConfig();

  logSecurityProfile(config);
  logSearchModeProfile(config);

  await listActiveInstanceEntries({ prune: true });

  const preflightResult = await performPreflightAuth(config);

  if (preflightResult.authenticated.length > 0) {
    console.error(
      `[preflight] Authenticated ${preflightResult.authenticated.length} upstream(s): ${preflightResult.authenticated.join(", ")}`,
    );
  }

  if (preflightResult.failed.length > 0) {
    console.error(
      `[preflight] Warning: ${preflightResult.failed.length} upstream(s) failed authentication:`,
    );
    for (const { name, error } of preflightResult.failed) {
      console.error(`[preflight]   - ${name}: ${error}`);
    }
  }

  const instanceId = randomUUID();
  const socketPath = getSocketFilePath(instanceId);

  prepareCliRuntimeFilesystem();

  const server = createServer({
    config,
    monitorSocketPath: socketPath,
  });

  const launcher = resolveLauncherHint(processRef.env);

  const registration = createInstanceRegistration(
    buildCliInstanceEntry({
      configPath,
      id: instanceId,
      launcher,
      processRef,
      role: "server",
      socketPath,
      version,
    }),
  );

  let isShuttingDown = false;

  const gracefulShutdown = async (exitCode: number): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      const forceExitTimer = setTimeout(() => {
        console.error("Forcing shutdown after timeout");
        processRef.exit(1);
      }, 2000);
      forceExitTimer.unref();

      await server.stop();
      registration.unregisterInstance();
      processRef.exit(exitCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error during shutdown: ${message}`);
      registration.unregisterInstance();
      processRef.exit(1);
    }
  };

  registerShutdownHooks({
    includeStdin: true,
    onExit: registration.unregisterInstance,
    processRef,
    shutdown: gracefulShutdown,
  });

  await server.start();
  registration.registerInstance();
}
