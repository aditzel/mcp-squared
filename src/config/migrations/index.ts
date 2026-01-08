import { LATEST_SCHEMA_VERSION } from "../schema.js";

export type RawConfig = { [key: string]: unknown };

function getSchemaVersion(config: RawConfig): number {
  const version = config["schemaVersion"];
  if (typeof version === "number" && Number.isInteger(version)) {
    return version;
  }
  return 1;
}

export function migrateConfig(input: RawConfig): RawConfig {
  const config: RawConfig = { ...input };
  let version = getSchemaVersion(config);

  while (version < LATEST_SCHEMA_VERSION) {
    switch (version) {
      case 0:
        return migrateV0ToV1(config);
      default:
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
