import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

export type ConfigSource = "env" | "project" | "user";

export interface ConfigPathResult {
  path: string;
  source: ConfigSource;
}

const CONFIG_FILENAME = "mcp-squared.toml";
const CONFIG_DIR_NAME = ".mcp-squared";
const APP_NAME = "mcp-squared";

function getEnv(key: string): string | undefined {
  return Bun.env[key];
}

function getXdgConfigHome(): string {
  return getEnv("XDG_CONFIG_HOME") || join(homedir(), ".config");
}

function getUserConfigDir(): string {
  const os = platform();
  if (os === "win32") {
    return join(
      getEnv("APPDATA") || join(homedir(), "AppData", "Roaming"),
      APP_NAME,
    );
  }
  return join(getXdgConfigHome(), APP_NAME);
}

function getUserConfigPath(): string {
  return join(getUserConfigDir(), "config.toml");
}

function findProjectConfig(startDir: string): string | null {
  let currentDir = resolve(startDir);
  const root = dirname(currentDir);

  while (currentDir !== root) {
    const directPath = join(currentDir, CONFIG_FILENAME);
    if (existsSync(directPath)) {
      return directPath;
    }

    const hiddenDirPath = join(currentDir, CONFIG_DIR_NAME, "config.toml");
    if (existsSync(hiddenDirPath)) {
      return hiddenDirPath;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return null;
}

export function discoverConfigPath(
  cwd: string = process.cwd(),
): ConfigPathResult | null {
  const envPath = getEnv("MCP_SQUARED_CONFIG");
  if (envPath) {
    const resolvedEnvPath = resolve(envPath);
    if (existsSync(resolvedEnvPath)) {
      return { path: resolvedEnvPath, source: "env" };
    }
  }

  const projectPath = findProjectConfig(cwd);
  if (projectPath) {
    return { path: projectPath, source: "project" };
  }

  const userPath = getUserConfigPath();
  if (existsSync(userPath)) {
    return { path: userPath, source: "user" };
  }

  return null;
}

export function getDefaultConfigPath(): ConfigPathResult {
  return {
    path: getUserConfigPath(),
    source: "user",
  };
}

export function ensureConfigDir(configPath: string): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    Bun.spawnSync(["mkdir", "-p", dir]);
  }
}
