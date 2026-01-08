import { LATEST_SCHEMA_VERSION } from "../schema.js";

export type RawConfig = { [key: string]: unknown };

/**
 * Error thrown when encountering an unrecognized schema version.
 */
export class UnknownSchemaVersionError extends Error {
  constructor(
    public readonly version: number,
    public readonly latestVersion: number,
  ) {
    super(
      `Unknown schema version ${version} (latest supported: ${latestVersion}). ` +
        `This config may have been created by a newer version of MCP².`,
    );
    this.name = "UnknownSchemaVersionError";
  }
}

function getSchemaVersion(config: RawConfig): number {
  const version = config["schemaVersion"];
  if (typeof version === "number" && Number.isInteger(version)) {
    return version;
  }
  return 0;
}

export function migrateConfig(input: RawConfig): RawConfig {
  let config: RawConfig = { ...input };
  let version = getSchemaVersion(config);

  // Fail fast if version is higher than what we support
  if (version > LATEST_SCHEMA_VERSION) {
    throw new UnknownSchemaVersionError(version, LATEST_SCHEMA_VERSION);
  }

  while (version < LATEST_SCHEMA_VERSION) {
    switch (version) {
      case 0:
        config = migrateV0ToV1(config);
        version = 1;
        break;
      default:
        // This should never happen if migrations are properly chained,
        // but fail loudly if we somehow reach an unhandled version
        throw new UnknownSchemaVersionError(version, LATEST_SCHEMA_VERSION);
    }
  }

  config["schemaVersion"] = LATEST_SCHEMA_VERSION;
  return config;
}

function migrateV0ToV1(config: RawConfig): RawConfig {
  return { ...config, schemaVersion: 1 };
}
