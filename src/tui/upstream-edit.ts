import type { UpstreamServerConfig } from "../config/index.js";

export type UpstreamMap = Record<string, UpstreamServerConfig>;

export type SaveUpstreamErrorReason =
  | "name_required"
  | "command_required"
  | "url_required"
  | "invalid_url"
  | "name_conflict";

export type SaveUpstreamResult =
  | { ok: true; savedName: string }
  | { ok: false; reason: SaveUpstreamErrorReason };

export interface SaveStdioUpstreamInput {
  upstreams: UpstreamMap;
  name: string;
  commandLine: string;
  envInput: string;
  existingName?: string | undefined;
  existingUpstream?:
    | Extract<UpstreamServerConfig, { transport: "stdio" }>
    | undefined;
}

export interface SaveSseUpstreamInput {
  upstreams: UpstreamMap;
  name: string;
  url: string;
  headersInput: string;
  envInput: string;
  authEnabled: boolean;
  existingName?: string | undefined;
  existingUpstream?:
    | Extract<UpstreamServerConfig, { transport: "sse" }>
    | undefined;
}

export type UpstreamEditMenuAction =
  | "edit"
  | "test"
  | "toggle"
  | "delete"
  | "back";

export interface UpstreamEditMenuOption {
  name: string;
  description: string;
  value: UpstreamEditMenuAction;
}

function hasNameConflict(
  upstreams: UpstreamMap,
  nextName: string,
  existingName?: string,
): boolean {
  return Boolean(
    existingName &&
      nextName !== existingName &&
      typeof upstreams[nextName] !== "undefined",
  );
}

export function parseKeyValuePairsInput(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!input.trim()) return result;

  const pairs = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex > 0) {
      const key = pair.substring(0, eqIndex).trim();
      const value = pair.substring(eqIndex + 1).trim();
      if (key) {
        result[key] = value;
      }
    }
  }
  return result;
}

export function stringifyKeyValuePairsInput(
  pairs: Record<string, string> | undefined,
): string {
  const entries = Object.entries(pairs || {});
  if (entries.length === 0) {
    return "";
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

export function saveStdioUpstreamFromForm(
  input: SaveStdioUpstreamInput,
): SaveUpstreamResult {
  const trimmedName = input.name.trim();
  const trimmedCommand = input.commandLine.trim();

  if (!trimmedName) {
    return { ok: false, reason: "name_required" };
  }
  if (!trimmedCommand) {
    return { ok: false, reason: "command_required" };
  }
  if (hasNameConflict(input.upstreams, trimmedName, input.existingName)) {
    return { ok: false, reason: "name_conflict" };
  }

  const parts = trimmedCommand.split(/\s+/);
  const command = parts[0] || "";
  const args = parts.slice(1);
  const env = parseKeyValuePairsInput(input.envInput);

  if (input.existingName && input.existingName !== trimmedName) {
    delete input.upstreams[input.existingName];
  }

  input.upstreams[trimmedName] = {
    transport: "stdio",
    enabled: input.existingUpstream?.enabled ?? true,
    env,
    stdio: { command, args },
  };

  return { ok: true, savedName: trimmedName };
}

export function saveSseUpstreamFromForm(
  input: SaveSseUpstreamInput,
): SaveUpstreamResult {
  const trimmedName = input.name.trim();
  const trimmedUrl = input.url.trim();

  if (!trimmedName) {
    return { ok: false, reason: "name_required" };
  }
  if (!trimmedUrl) {
    return { ok: false, reason: "url_required" };
  }
  try {
    new URL(trimmedUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (hasNameConflict(input.upstreams, trimmedName, input.existingName)) {
    return { ok: false, reason: "name_conflict" };
  }

  const headers = parseKeyValuePairsInput(input.headersInput);
  const env = parseKeyValuePairsInput(input.envInput);

  if (input.existingName && input.existingName !== trimmedName) {
    delete input.upstreams[input.existingName];
  }

  input.upstreams[trimmedName] = {
    transport: "sse",
    enabled: input.existingUpstream?.enabled ?? true,
    env,
    sse: {
      url: trimmedUrl,
      headers,
      auth: input.authEnabled ? true : undefined,
    },
  };

  return { ok: true, savedName: trimmedName };
}

export function deleteUpstreamByName(
  upstreams: UpstreamMap,
  name: string,
): boolean {
  if (typeof upstreams[name] === "undefined") {
    return false;
  }
  delete upstreams[name];
  return true;
}

export function getUpstreamEditMenuOptions(
  upstream: UpstreamServerConfig,
): UpstreamEditMenuOption[] {
  return [
    {
      name: "Edit Configuration",
      description: "Update connection details and environment",
      value: "edit",
    },
    {
      name: "Test Connection",
      description: "Connect and list available tools",
      value: "test",
    },
    {
      name: upstream.enabled ? "Disable" : "Enable",
      description: upstream.enabled
        ? "Stop using this upstream"
        : "Start using this upstream",
      value: "toggle",
    },
    {
      name: "Delete",
      description: "Remove this upstream configuration",
      value: "delete",
    },
    {
      name: "← Back",
      description: "",
      value: "back",
    },
  ];
}
