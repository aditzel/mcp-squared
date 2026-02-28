import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

interface PackageManifest {
  version?: unknown;
}

interface ResolveVersionOptions {
  env?: NodeJS.ProcessEnv;
  fallbackVersion?: string;
  manifestUrl?: URL;
  readManifest?: (manifestUrl: URL) => PackageManifest;
  readBundledManifest?: () => PackageManifest;
}

function normalizeVersion(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readManifestFile(manifestUrl: URL): PackageManifest {
  const raw = readFileSync(manifestUrl, "utf8");
  return JSON.parse(raw) as PackageManifest;
}

function readBundledManifestFile(): PackageManifest {
  const require = createRequire(import.meta.url);
  return require("../package.json") as PackageManifest;
}

export function resolveVersion(options: ResolveVersionOptions = {}): string {
  const readManifest = options.readManifest ?? readManifestFile;
  const manifestUrl =
    options.manifestUrl ?? new URL("../package.json", import.meta.url);

  try {
    const manifest = readManifest(manifestUrl);
    const manifestVersion = normalizeVersion(manifest.version);
    if (manifestVersion) {
      return manifestVersion;
    }
  } catch {
    // Fall back for constrained/runtime-compiled environments.
  }

  const envVersion = normalizeVersion(
    (options.env ?? process.env)["npm_package_version"],
  );
  if (envVersion) {
    return envVersion;
  }

  const readBundledManifest =
    options.readBundledManifest ?? readBundledManifestFile;
  try {
    const bundledVersion = normalizeVersion(readBundledManifest().version);
    if (bundledVersion) {
      return bundledVersion;
    }
  } catch {
    // Fall back when bundled manifests are unavailable.
  }

  return normalizeVersion(options.fallbackVersion) ?? "0.0.0";
}

/** Current version of MCP², resolved from package metadata. */
export const VERSION = resolveVersion();
