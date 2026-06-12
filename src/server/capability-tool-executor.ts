import type { McpSquaredConfig } from "../config/schema.js";
import { evaluatePolicy } from "../security/index.js";
import type { ResponseResourceManager } from "./response-resource.js";

export type CapabilityToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

export type ExecuteCapabilityToolArgs = {
  capability: string;
  action: string;
  policyAction?: string;
  routeId?: string;
  toolNameForCall: string;
  args: Record<string, unknown>;
  confirmationToken?: string;
  config: McpSquaredConfig;
  responseResourceManager: ResponseResourceManager;
  enforceGuard: (args: {
    tool: string;
    action: string;
    params: Record<string, unknown>;
  }) => void;
  callTool: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<{
    content: unknown[];
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  }>;
  onSuccessfulSelection?: (toolKey: string) => void;
};

export function normalizeToolResultContent(content: unknown[]): Array<{
  type: "text";
  text: string;
}> {
  return content.map((entry) => {
    if (typeof entry === "object" && entry !== null && "type" in entry) {
      return entry as { type: "text"; text: string };
    }
    return {
      type: "text" as const,
      text: JSON.stringify(entry),
    };
  });
}

export async function executeCapabilityTool({
  capability,
  action,
  policyAction,
  routeId,
  toolNameForCall,
  args,
  confirmationToken,
  config,
  responseResourceManager,
  enforceGuard,
  callTool,
  onSuccessfulSelection,
}: ExecuteCapabilityToolArgs): Promise<CapabilityToolResult> {
  const policyResult = evaluatePolicy(
    {
      capability,
      action: policyAction ?? action,
      confirmationToken,
    },
    config,
  );

  if (policyResult.decision === "block") {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "Action blocked by security policy",
            blocked: true,
          }),
        },
      ],
      isError: true,
    };
  }

  if (policyResult.decision === "confirm") {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            requires_confirmation: true,
            confirmation_token: policyResult.confirmationToken,
            message: "Action requires confirmation by security policy",
          }),
        },
      ],
      isError: false,
    };
  }

  const toolKey = routeId ?? `${capability}:${action}`;
  enforceGuard({
    tool: toolKey,
    action: "call",
    params: args,
  });

  const result = await callTool(toolNameForCall, args);

  if (!result.isError) {
    onSuccessfulSelection?.(toolKey);
  }

  const normalizedContent = normalizeToolResultContent(result.content);
  const structuredContent = result.structuredContent;

  if (
    !result.isError &&
    responseResourceManager.isEnabled() &&
    responseResourceManager.shouldOffload(normalizedContent)
  ) {
    try {
      const offloaded = responseResourceManager.offload(normalizedContent, {
        capability,
        action,
      });
      return {
        content: offloaded.inlineContent,
        isError: false,
        ...(structuredContent != null ? { structuredContent } : {}),
      };
    } catch {
      // Fall through to inline response on offload failure.
    }
  }

  return {
    content: normalizedContent,
    isError: result.isError ?? false,
    ...(structuredContent != null ? { structuredContent } : {}),
  };
}
