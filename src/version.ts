import { readFileSync } from "node:fs";

interface PackageManifest {
  version?: unknown;
}

function resolveVersion(): string {
  try {
    const manifestUrl = new URL("../package.json", import.meta.url);
    const raw = readFileSync(manifestUrl, "utf8");
    const manifest = JSON.parse(raw) as PackageManifest;
    if (typeof manifest.version === "string" && manifest.version.length > 0) {
      return manifest.version;
    }
  } catch {
    // Fall back for constrained/runtime-compiled environments.
  }

  return process.env["npm_package_version"] ?? "0.0.0";
}

/** Current version of MCP², resolved from package metadata. */
export const VERSION = resolveVersion();
