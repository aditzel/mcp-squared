import { spawnSync } from "node:child_process";
import {
  type InstanceRegistryEntry,
  loadConfig,
  type McpSquaredConfig,
} from "../config/index.js";
import { getSocketFilePath } from "../config/paths.js";
import { computeConfigHash } from "../daemon/config-hash.js";
import { loadLiveDaemonRegistry } from "../daemon/registry.js";
import type { MonitorArgs } from "./index.js";
import {
  isTuiModuleNotFoundError,
  printTuiUnavailableError,
} from "./tui-runtime.js";

interface LoadConfigResult {
  config: McpSquaredConfig;
  path: string;
}

export interface RunMonitorDependencies {
  augmentProcessInfo: (entries: InstanceRegistryEntry[]) => void;
  computeConfigHash: typeof computeConfigHash;
  getSocketFilePath: typeof getSocketFilePath;
  isTuiModuleNotFoundError: typeof isTuiModuleNotFoundError;
  loadConfig: () => Promise<LoadConfigResult>;
  loadLiveDaemonRegistry: typeof loadLiveDaemonRegistry;
  loadMonitorTui: () => Promise<{
    runMonitorTui: (options: {
      socketPath: string;
      instances: InstanceRegistryEntry[];
      refreshInterval: number;
    }) => Promise<void>;
  }>;
  printTuiUnavailableError: typeof printTuiUnavailableError;
  processRef: Pick<typeof process, "exit" | "platform">;
}

export function augmentProcessInfo(entries: InstanceRegistryEntry[]): void {
  if (entries.length === 0 || process.platform === "win32") {
    return;
  }

  const pids = entries.map((entry) => entry.pid).filter((pid) => pid > 0);
  if (pids.length === 0) {
    return;
  }

  const result = spawnSync(
    "ps",
    ["-p", pids.join(","), "-o", "pid=,ppid=,user=,comm=,command="],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout) {
    return;
  }

  for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const pid = Number.parseInt(match[1] ?? "", 10);
    const ppid = Number.parseInt(match[2] ?? "", 10);
    const user = match[3];
    const comm = match[4];
    const command = match[5];
    const entry = entries.find((item) => item.pid === pid);
    if (!entry) {
      continue;
    }
    if (!Number.isNaN(ppid)) {
      entry.ppid = ppid;
    }
    if (user !== undefined) {
      entry.user = user;
    }
    if (comm !== undefined) {
      entry.processName = comm;
    }
    if (command !== undefined) {
      entry.command = command;
    }
  }

  const parentPids = Array.from(
    new Set(
      entries
        .map((entry) => entry.ppid)
        .filter((ppid): ppid is number => typeof ppid === "number" && ppid > 0),
    ),
  );
  if (parentPids.length === 0) {
    return;
  }

  const parentResult = spawnSync(
    "ps",
    ["-p", parentPids.join(","), "-o", "pid=,comm=,command="],
    { encoding: "utf8" },
  );
  if (parentResult.status !== 0 || !parentResult.stdout) {
    return;
  }

  const parentMap = new Map<number, { command: string; name: string }>();
  for (const line of parentResult.stdout.trim().split("\n").filter(Boolean)) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const pid = Number.parseInt(match[1] ?? "", 10);
    if (Number.isNaN(pid)) {
      continue;
    }
    parentMap.set(pid, { command: match[3] ?? "", name: match[2] ?? "" });
  }

  for (const entry of entries) {
    if (!entry.ppid) {
      continue;
    }
    const parent = parentMap.get(entry.ppid);
    if (!parent) {
      continue;
    }
    entry.parentProcessName = parent.name;
    entry.parentCommand = parent.command;
    if (!entry.launcher && parent.name) {
      entry.launcher = parent.name;
    }
  }
}

export function createRunMonitorDependencies(): RunMonitorDependencies {
  return {
    augmentProcessInfo,
    computeConfigHash,
    getSocketFilePath,
    isTuiModuleNotFoundError,
    loadConfig,
    loadLiveDaemonRegistry,
    loadMonitorTui: () => import("../tui/monitor-loader.js"),
    printTuiUnavailableError,
    processRef: process,
  };
}

export async function runMonitorCommand(
  options: MonitorArgs,
  dependencies: RunMonitorDependencies,
): Promise<void> {
  const {
    augmentProcessInfo,
    computeConfigHash,
    getSocketFilePath,
    isTuiModuleNotFoundError,
    loadConfig,
    loadLiveDaemonRegistry,
    loadMonitorTui,
    printTuiUnavailableError,
    processRef,
  } = dependencies;

  let socketPath = options.socketPath;
  const instances: InstanceRegistryEntry[] = [];

  if (!socketPath) {
    const { config, path: configPath } = await loadConfig();
    const configHash = computeConfigHash(config);
    const daemonRegistry = await loadLiveDaemonRegistry(configHash);
    if (!daemonRegistry) {
      console.error(
        "Error: No running shared MCP² daemon found for the active configuration.",
      );
      console.error("Start the daemon first:");
      console.error("  mcp-squared daemon");
      console.error("");
      console.error(
        "Or connect directly with: mcp-squared monitor --socket=<path|tcp://host:port>",
      );
      processRef.exit(1);
      return;
    }

    const daemonEntry: InstanceRegistryEntry = {
      command: "mcp-squared daemon",
      configPath,
      id: `daemon-${configHash}`,
      pid: daemonRegistry.pid,
      role: "daemon",
      socketPath: getSocketFilePath(configHash),
      startedAt: daemonRegistry.startedAt,
      ...(daemonRegistry.version ? { version: daemonRegistry.version } : {}),
    };
    instances.push(daemonEntry);

    augmentProcessInfo(instances);

    const instanceId = options.instanceId;
    if (
      instanceId &&
      daemonEntry.id !== instanceId &&
      !daemonEntry.id.startsWith(instanceId)
    ) {
      console.error(
        `Error: Monitor is daemon-only. No daemon instance matches '${instanceId}'.`,
      );
      console.error(`Running daemon instance: ${daemonEntry.id}`);
      processRef.exit(1);
      return;
    }

    socketPath = daemonEntry.socketPath;
  }

  try {
    const { runMonitorTui } = await loadMonitorTui();
    await runMonitorTui({
      instances,
      refreshInterval: options.noAutoRefresh ? 0 : options.refreshInterval,
      socketPath,
    });
  } catch (error) {
    if (isTuiModuleNotFoundError(error)) {
      printTuiUnavailableError("monitor");
      processRef.exit(1);
      return;
    }

    const err = error as Error;
    console.error(`Error launching monitor: ${err.message}`);
    console.error("");
    console.error("Possible causes:");
    console.error("  - Server is not responding to monitor requests");
    console.error("  - Socket file is not accessible (permission issues)");
    console.error("  - Server was started without monitor support");
    console.error("");
    console.error("Try restarting the server:");
    console.error("  mcp-squared");
    processRef.exit(1);
  }
}
