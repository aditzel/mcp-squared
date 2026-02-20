import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { AgentPolicySchema, type PolicyRule } from "./schema.js";

const DEFAULT_POLICY_PATH = "agent_safety_kit/policy/policy.yaml";
const DEFAULT_PLAYBOOK = "dev";

function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function defaultReportOnlyForEnv(agentEnv: string): boolean {
  return agentEnv.toUpperCase() !== "PROD";
}

export interface SafetyEnvConfig {
  enabled: boolean;
  policyPath: string;
  playbook: string;
  agentEnv: string;
  reportOnly: boolean;
  obsSink: "null" | "stdout" | "otel";
}

export interface LoadedPolicy {
  version: number;
  sourcePath: string;
  playbook: string;
  agentEnv: string;
  reportOnly: boolean;
  denyByDefault: boolean;
  rules: PolicyRule[];
}

export function readSafetyEnv(
  env: NodeJS.ProcessEnv = process.env,
): SafetyEnvConfig {
  const agentEnv = env["AGENT_ENV"] ?? "DEV";
  const enabled = parseFlag(env["AGENT_SAFETY_ENABLED"], false);
  const defaultReportOnly = defaultReportOnlyForEnv(agentEnv);
  const reportOnly = parseFlag(
    env["AGENT_POLICY_REPORT_ONLY"],
    defaultReportOnly,
  );
  const sinkRaw = (env["AGENT_OBS_SINK"] ?? "stdout").toLowerCase();
  const obsSink: "null" | "stdout" | "otel" =
    sinkRaw === "null" || sinkRaw === "otel" ? sinkRaw : "stdout";

  return {
    enabled,
    policyPath: env["AGENT_POLICY_PATH"] ?? DEFAULT_POLICY_PATH,
    playbook: env["AGENT_POLICY_PLAYBOOK"] ?? DEFAULT_PLAYBOOK,
    agentEnv,
    reportOnly,
    obsSink,
  };
}

export interface LoadPolicyOptions {
  path?: string;
  playbook?: string;
  agentEnv?: string;
  reportOnly?: boolean;
}

export function load_policy(options: LoadPolicyOptions = {}): LoadedPolicy {
  const envConfig = readSafetyEnv();
  const sourcePath = resolve(
    process.cwd(),
    options.path ?? envConfig.policyPath,
  );

  if (!existsSync(sourcePath)) {
    throw new Error(`Agent safety policy file not found at ${sourcePath}`);
  }

  const raw = readFileSync(sourcePath, "utf8");
  const parsed = parseYaml(raw);
  const policy = AgentPolicySchema.parse(parsed);

  const playbookName = options.playbook ?? envConfig.playbook;
  const playbook = policy.playbooks[playbookName];
  if (!playbook) {
    throw new Error(
      `Agent safety playbook "${playbookName}" not found in ${sourcePath}`,
    );
  }

  const agentEnv = options.agentEnv ?? envConfig.agentEnv;
  const reportOnly =
    options.reportOnly ??
    playbook.defaults.report_only ??
    defaultReportOnlyForEnv(agentEnv);

  return {
    version: policy.version,
    sourcePath,
    playbook: playbookName,
    agentEnv,
    reportOnly,
    denyByDefault: playbook.defaults.deny_by_default,
    rules: playbook.rules,
  };
}
