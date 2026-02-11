import { z } from "zod";

export const PolicyRuleSchema = z.object({
  agent: z.string().min(1).default("*"),
  tool: z.string().min(1).default("*"),
  action: z.string().min(1).default("*"),
  paths_allow: z.array(z.string().min(1)).optional(),
  domains_allow: z.array(z.string().min(1)).optional(),
  allowlist_cmd_prefix: z.array(z.string().min(1)).optional(),
  denylist_cmd_regex: z.array(z.string().min(1)).optional(),
  rate_limit_per_min: z.number().int().positive().optional(),
  max_patch_size_bytes: z.number().int().positive().optional(),
});

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicyPlaybookSchema = z.object({
  defaults: z
    .object({
      deny_by_default: z.boolean().default(true),
      report_only: z.boolean().optional(),
    })
    .default({ deny_by_default: true }),
  rules: z.array(PolicyRuleSchema).default([]),
});

export type PolicyPlaybook = z.infer<typeof PolicyPlaybookSchema>;

export const AgentPolicySchema = z.object({
  version: z.number().int().positive().default(1),
  playbooks: z.record(z.string(), PolicyPlaybookSchema),
});

export type AgentPolicy = z.infer<typeof AgentPolicySchema>;
