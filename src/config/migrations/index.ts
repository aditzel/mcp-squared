import { LATEST_SCHEMA_VERSION } from "../schema.js";

export type RawConfig = { [key: string]: unknown };

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

  while (version < LATEST_SCHEMA_VERSION) {
    switch (version) {
      case 0:
        config = migrateV0ToV1(config);
        version = 1;
        break;
      default:
        // Unknown version, jump to latest to exit loop
        version = LATEST_SCHEMA_VERSION;
        break;
    }
  }

  config["schemaVersion"] = LATEST_SCHEMA_VERSION;
  return config;
}

function migrateV0ToV1(config: RawConfig): RawConfig {
  return { ...config, schemaVersion: 1 };
}
