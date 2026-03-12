import { loadConfig, type McpSquaredConfig } from "../config/index.js";
import { getSocketFilePath } from "../config/paths.js";
import { computeConfigHash } from "../daemon/config-hash.js";
import { DaemonServer } from "../daemon/server.js";
import { McpSquaredServer } from "../server/index.js";
import { VERSION } from "../version.js";
import type { DaemonArgs } from "./index.js";
import {
  buildCliInstanceEntry,
  type CliProcessLike,
  createInstanceRegistration,
  prepareCliRuntimeFilesystem,
  registerShutdownHooks,
  resolveDaemonSharedSecret,
  resolveLauncherHint,
} from "./runtime-bootstrap.js";

interface DaemonRuntimeLike {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface LoadConfigResult {
  config: McpSquaredConfig;
  path: string;
}

export interface RunDaemonDependencies {
  computeConfigHash: typeof computeConfigHash;
  createDaemon: (options: {
    configHash: string;
    onIdleShutdown?: () => void;
    runtime: McpSquaredServer;
    sharedSecret?: string;
    socketPath?: string;
  }) => DaemonRuntimeLike;
  createRuntime: (options: {
    config: McpSquaredConfig;
    monitorSocketPath: string;
  }) => McpSquaredServer;
  getSocketFilePath: typeof getSocketFilePath;
  loadConfig: () => Promise<LoadConfigResult>;
  logSearchModeProfile: (config: McpSquaredConfig) => void;
  logSecurityProfile: (config: McpSquaredConfig) => void;
  processRef: CliProcessLike;
}

export function createRunDaemonDependencies({
  logSearchModeProfile,
  logSecurityProfile,
}: Pick<
  RunDaemonDependencies,
  "logSearchModeProfile" | "logSecurityProfile"
>): RunDaemonDependencies {
  return {
    computeConfigHash,
    createDaemon: (options) => new DaemonServer(options),
    createRuntime: (options) => new McpSquaredServer(options),
    getSocketFilePath,
    loadConfig,
    logSearchModeProfile,
    logSecurityProfile,
    processRef: process,
  };
}

export async function runDaemonCommand(
  options: DaemonArgs,
  dependencies: RunDaemonDependencies,
): Promise<void> {
  const {
    computeConfigHash,
    createDaemon,
    createRuntime,
    getSocketFilePath,
    loadConfig,
    logSearchModeProfile,
    logSecurityProfile,
    processRef,
  } = dependencies;
  const { config, path: configPath } = await loadConfig();

  logSecurityProfile(config);
  logSearchModeProfile(config);

  const configHash = computeConfigHash(config);
  const monitorSocketPath = getSocketFilePath(configHash);
  const runtime = createRuntime({
    config,
    monitorSocketPath,
  });
  const daemonOptions: {
    configHash: string;
    onIdleShutdown?: () => void;
    runtime: McpSquaredServer;
    sharedSecret?: string;
    socketPath?: string;
  } = {
    runtime,
    configHash,
    onIdleShutdown: () => {
      processRef.exit(0);
    },
  };
  if (options.socketPath) {
    daemonOptions.socketPath = options.socketPath;
  }
  const sharedSecret = resolveDaemonSharedSecret(
    options.sharedSecret,
    processRef.env,
  );
  if (sharedSecret) {
    daemonOptions.sharedSecret = sharedSecret;
  }
  const daemon = createDaemon(daemonOptions);

  prepareCliRuntimeFilesystem();

  const launcher = resolveLauncherHint(processRef.env);

  const registration = createInstanceRegistration(
    buildCliInstanceEntry({
      configPath,
      id: `daemon-${configHash}`,
      launcher,
      processRef,
      role: "daemon",
      socketPath: monitorSocketPath,
      version: VERSION,
    }),
  );

  const shutdown = async (exitCode: number): Promise<void> => {
    try {
      await daemon.stop();
    } finally {
      registration.unregisterInstance();
      processRef.exit(exitCode);
    }
  };

  registerShutdownHooks({
    includeStdin: false,
    onExit: () => {
      try {
        registration.unregisterInstance();
      } catch {
        // best-effort cleanup
      }
    },
    processRef,
    shutdown,
  });

  await daemon.start();
  registration.registerInstance();
}
