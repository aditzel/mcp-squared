import { readFileSync } from "node:fs";

interface PackageManifest {
  version?: unknown;
}

interface ResolveVersionOptions {
  env?: NodeJS.ProcessEnv;
  fallbackVersion?: string;
  manifestUrl?: URL;
  readManifest?: (manifestUrl: URL) => PackageManifest;
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

const BUNDLED_PACKAGE_VERSION = "0.2.0";

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

  return normalizeVersion(options.fallbackVersion) ?? BUNDLED_PACKAGE_VERSION;
}

/** Current version of MCP², resolved from package metadata. */
export const VERSION = resolveVersion();
