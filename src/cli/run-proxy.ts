import { loadConfig, type McpSquaredConfig } from "../config/index.js";
import { getSocketFilePath } from "../config/paths.js";
import { computeConfigHash } from "../daemon/config-hash.js";
import { type ProxyBridge, runProxy } from "../daemon/proxy.js";
import { VERSION } from "../version.js";
import type { ProxyArgs } from "./index.js";
import {
  buildCliInstanceEntry,
  type CliProcessLike,
  createInstanceRegistration,
  prepareCliRuntimeFilesystem,
  registerShutdownHooks,
  resolveDaemonSharedSecret,
  resolveLauncherHint,
} from "./runtime-bootstrap.js";

interface LoadConfigResult {
  config: McpSquaredConfig;
  path: string;
}

export interface RunProxyDependencies {
  computeConfigHash: typeof computeConfigHash;
  getSocketFilePath: typeof getSocketFilePath;
  loadConfig: () => Promise<LoadConfigResult>;
  processRef: CliProcessLike;
  runProxy: typeof runProxy;
}

export function createRunProxyDependencies(): RunProxyDependencies {
  return {
    computeConfigHash,
    getSocketFilePath,
    loadConfig,
    processRef: process,
    runProxy,
  };
}

export async function runProxyCommand(
  options: ProxyArgs,
  dependencies: RunProxyDependencies,
): Promise<void> {
  const {
    computeConfigHash,
    getSocketFilePath,
    loadConfig,
    processRef,
    runProxy,
  } = dependencies;
  const { config, path: configPath } = await loadConfig();
  const configHash = computeConfigHash(config);
  const monitorSocketPath = getSocketFilePath(configHash);

  prepareCliRuntimeFilesystem();

  const registration = createInstanceRegistration(
    buildCliInstanceEntry({
      configPath,
      id: `proxy-${processRef.pid}`,
      launcher: resolveLauncherHint(processRef.env),
      processRef,
      role: "proxy",
      socketPath: monitorSocketPath,
      version: VERSION,
    }),
  );

  let proxyHandle: ProxyBridge | null = null;
  let isShuttingDown = false;
  const shutdown = async (exitCode: number): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    try {
      if (proxyHandle) {
        await proxyHandle.stop();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error shutting down proxy: ${message}`);
    } finally {
      registration.unregisterInstance();
      processRef.exit(exitCode);
    }
  };

  registerShutdownHooks({
    includeStdin: true,
    onExit: registration.unregisterInstance,
    processRef,
    shutdown,
  });

  const proxyOptions: {
    configHash: string;
    endpoint?: string;
    noSpawn: boolean;
    sharedSecret?: string;
  } = {
    noSpawn: options.noSpawn,
    configHash,
  };
  if (options.socketPath) {
    proxyOptions.endpoint = options.socketPath;
  }
  const sharedSecret = resolveDaemonSharedSecret(
    options.sharedSecret,
    processRef.env,
  );
  if (sharedSecret) {
    proxyOptions.sharedSecret = sharedSecret;
  }

  try {
    proxyHandle = await runProxy(proxyOptions);
  } catch (error) {
    registration.unregisterInstance();
    throw error;
  }
  registration.registerInstance();
}
