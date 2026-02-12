import {
  Guard,
  build_sink,
  load_policy,
  readSafetyEnv,
  task_span,
  tool_span,
} from "../agent_safety_kit/index.js";

export async function runToolWithSafety(
  taskName: string,
  tool: string,
  action: string,
  params: Record<string, unknown>,
  execute: () => Promise<unknown>,
): Promise<unknown> {
  const env = readSafetyEnv();
  const sink = build_sink({ enabled: env.enabled, sinkName: env.obsSink });
  const policy = env.enabled
    ? load_policy({
        path: env.policyPath,
        playbook: env.playbook,
        agentEnv: env.agentEnv,
        reportOnly: env.reportOnly,
      })
    : null;

  const guard = new Guard({
    enabled: env.enabled,
    policy,
    sink,
  });

  return task_span(
    sink,
    {
      agent: "example-agent",
      taskName,
      playbook: guard.playbook,
      env: guard.agentEnv,
    },
    async () => {
      guard.enforce({
        agent: "example-agent",
        tool,
        action,
        params,
      });

      return tool_span(
        sink,
        {
          agent: "example-agent",
          tool,
          action,
          playbook: guard.playbook,
          env: guard.agentEnv,
        },
        execute,
      );
    },
  );
}
