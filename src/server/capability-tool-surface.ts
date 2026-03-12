import { z } from "zod";
import type { CapabilityId } from "../capabilities/inference.js";
import type { CapabilityRouter } from "../capabilities/routing.js";
import {
  type CompiledPolicy,
  getToolVisibilityCompiled,
} from "../security/index.js";
import type { ToolInputSchema } from "../upstream/index.js";

export const DESCRIBE_ACTION = "__describe_actions";

export type CapabilityToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

export type CapabilityToolRequest = {
  action: string;
  arguments: Record<string, unknown>;
  confirmationToken?: string;
};

export type VisibleCapabilityRoute = {
  route: CapabilityRouter["actions"][number];
  requiresConfirmation: boolean;
};

export type CapabilityActionDescription = {
  action: string;
  summary: string;
  inputSchema: ToolInputSchema;
  requiresConfirmation: boolean;
  baseAction?: string;
  instance?: string;
  instanceTitle?: string;
};

type RegisterCapabilityToolsArgs = {
  server: {
    registerTool: (
      name: string,
      config: Record<string, unknown>,
      handler: (args: unknown) => Promise<CapabilityToolResult>,
    ) => void;
  };
  routers: CapabilityRouter[];
  getCapabilityTitle: (capability: CapabilityId) => string;
  getCapabilitySummary: (capability: CapabilityId) => string;
  getLiveRouter: (capability: CapabilityId) => CapabilityRouter;
  compiledPolicy: CompiledPolicy;
  runCapabilityTask: (
    capability: CapabilityId,
    run: () => Promise<CapabilityToolResult>,
  ) => Promise<CapabilityToolResult>;
  onCapabilityRequestStarted: () => {
    requestId: string | number;
    startTime: number;
  };
  onCapabilityRequestFinished: (args: {
    requestId: string | number;
    capability: CapabilityId;
    success: boolean;
    startTime: number;
  }) => void;
  executeRoute: (args: {
    capability: CapabilityId;
    action: string;
    policyAction?: string;
    routeId?: string;
    qualifiedToolName: string;
    toolNameForCall: string;
    args: Record<string, unknown>;
    confirmationToken?: string;
  }) => Promise<CapabilityToolResult>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCapabilityToolRequest(
  rawArgs: unknown,
): CapabilityToolRequest {
  const parsedArgs: Record<string, unknown> = isRecord(rawArgs)
    ? { ...rawArgs }
    : {};

  return {
    action:
      typeof parsedArgs["action"] === "string" ? parsedArgs["action"] : "",
    arguments: isRecord(parsedArgs["arguments"])
      ? (parsedArgs["arguments"] as Record<string, unknown>)
      : {},
    ...(typeof parsedArgs["confirmation_token"] === "string"
      ? { confirmationToken: parsedArgs["confirmation_token"] }
      : {}),
  };
}

export function getVisibleCapabilityRoutes(args: {
  capability: CapabilityId;
  router: CapabilityRouter;
  compiledPolicy: CompiledPolicy;
}): VisibleCapabilityRoute[] {
  return args.router.actions
    .map((route) => {
      const visibility = getToolVisibilityCompiled(
        args.capability,
        route.action,
        args.compiledPolicy,
      );
      if (!visibility.visible) {
        return null;
      }
      return {
        route,
        requiresConfirmation: visibility.requiresConfirmation,
      };
    })
    .filter((entry): entry is VisibleCapabilityRoute => entry !== null);
}

export function describeVisibleCapabilityActions(
  visibleRoutes: VisibleCapabilityRoute[],
): CapabilityActionDescription[] {
  return visibleRoutes
    .map(({ route, requiresConfirmation }) => {
      const actionInfo: CapabilityActionDescription = {
        action: route.action,
        summary: route.summary,
        inputSchema: route.inputSchema,
        requiresConfirmation,
      };

      if ((route.collisionGroupSize ?? 1) > 1) {
        actionInfo.baseAction = route.baseAction;
        actionInfo.instance = route.instanceKey ?? route.serverKey;
        actionInfo.instanceTitle =
          route.instanceTitle ?? route.instanceKey ?? route.serverKey;
      }

      return actionInfo;
    })
    .sort((a, b) => a.action.localeCompare(b.action));
}

export function buildCapabilityToolResponse(
  payload: Record<string, unknown>,
  isError?: boolean,
): CapabilityToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
    ...(isError != null ? { isError } : {}),
  };
}

export function buildCapabilityToolConfig(args: {
  capability: CapabilityId;
  title: string;
  description: string;
}): Record<string, unknown> {
  return {
    title: args.title,
    description: args.description,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      action: z
        .string()
        .describe(
          `Action ID for ${args.capability}. Use "${DESCRIBE_ACTION}" to inspect available actions and schemas.`,
        ),
      arguments: z
        .record(z.string(), z.unknown())
        .default({})
        .describe("Arguments for the selected capability action"),
      confirmation_token: z
        .string()
        .optional()
        .describe(
          "Optional confirmation token for actions that require explicit confirmation",
        ),
    },
  };
}

export function registerCapabilityTools({
  server,
  routers,
  getCapabilityTitle,
  getCapabilitySummary,
  getLiveRouter,
  compiledPolicy,
  runCapabilityTask,
  onCapabilityRequestStarted,
  onCapabilityRequestFinished,
  executeRoute,
}: RegisterCapabilityToolsArgs): void {
  for (const router of routers) {
    if (router.actions.length === 0) {
      continue;
    }

    const capability = router.capability;
    server.registerTool(
      capability,
      buildCapabilityToolConfig({
        capability,
        title: getCapabilityTitle(capability),
        description: getCapabilitySummary(capability),
      }),
      async (rawArgs) =>
        runCapabilityTask(capability, async () => {
          const { requestId, startTime } = onCapabilityRequestStarted();
          let success = false;

          try {
            const liveRouter = getLiveRouter(capability);
            const parsedRequest = parseCapabilityToolRequest(rawArgs);

            if (parsedRequest.action.length === 0) {
              return buildCapabilityToolResponse(
                {
                  error: "Missing required action",
                  capability,
                },
                true,
              );
            }

            const visibleRoutes = getVisibleCapabilityRoutes({
              capability,
              router: liveRouter,
              compiledPolicy,
            });
            const visibleActions =
              describeVisibleCapabilityActions(visibleRoutes);

            if (parsedRequest.action === DESCRIBE_ACTION) {
              success = true;
              return buildCapabilityToolResponse({
                capability,
                actions: visibleActions,
                totalActions: visibleActions.length,
              });
            }

            const exactRoute = liveRouter.actions.find(
              (entry) =>
                entry.action === parsedRequest.action ||
                (entry.legacyActions ?? []).includes(parsedRequest.action),
            );

            const ambiguousCandidates = visibleRoutes
              .filter(({ route }) => route.baseAction === parsedRequest.action)
              .map(({ route }) => route.action)
              .sort((a, b) => a.localeCompare(b));

            if (ambiguousCandidates.length > 1) {
              return buildCapabilityToolResponse(
                {
                  requires_disambiguation: true,
                  capability,
                  action: parsedRequest.action,
                  candidates: ambiguousCandidates,
                },
                true,
              );
            }

            const selectedRoute =
              exactRoute ??
              (ambiguousCandidates.length === 1
                ? visibleRoutes.find(
                    ({ route }) => route.baseAction === parsedRequest.action,
                  )?.route
                : undefined);

            if (selectedRoute == null) {
              return buildCapabilityToolResponse(
                {
                  error: "Unknown action",
                  capability,
                  action: parsedRequest.action,
                  availableActions: visibleActions.map(
                    (action) => action.action,
                  ),
                },
                true,
              );
            }

            const callResult = await executeRoute({
              capability,
              action: selectedRoute.action,
              policyAction:
                exactRoute != null
                  ? parsedRequest.action
                  : selectedRoute.action,
              routeId:
                selectedRoute.canonicalRouteId ??
                `${capability}:${selectedRoute.action}`,
              qualifiedToolName: selectedRoute.qualifiedName,
              toolNameForCall: selectedRoute.qualifiedName,
              args: parsedRequest.arguments,
              ...(parsedRequest.confirmationToken != null
                ? { confirmationToken: parsedRequest.confirmationToken }
                : {}),
            });
            success = !callResult.isError;
            return callResult;
          } catch {
            return buildCapabilityToolResponse(
              {
                error: "Action execution failed",
              },
              true,
            );
          } finally {
            onCapabilityRequestFinished({
              requestId,
              capability,
              success,
              startTime,
            });
          }
        }),
    );
  }
}
