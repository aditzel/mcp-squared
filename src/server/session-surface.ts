import type { ResponseResourceManager } from "./response-resource.js";

type SessionSurfaceServer = {
  registerResource: (
    name: string,
    uriTemplate: string,
    config: {
      description: string;
      mimeType: string;
    },
    handler: (uri: URL) =>
      | Promise<{
          contents: Array<{
            uri: string;
            mimeType: string;
            text: string;
          }>;
        }>
      | {
          contents: Array<{
            uri: string;
            mimeType: string;
            text: string;
          }>;
        },
  ) => void;
};

type SessionResponseResourceManager = Pick<
  ResponseResourceManager,
  "isEnabled" | "readResource"
>;

export function registerConfiguredSessionSurface(args: {
  server: SessionSurfaceServer;
  registerCapabilityTools: () => void;
  responseResourceManager: SessionResponseResourceManager;
}): void {
  args.registerCapabilityTools();

  if (args.responseResourceManager.isEnabled()) {
    registerResponseResources({
      server: args.server,
      responseResourceManager: args.responseResourceManager,
    });
  }
}

export function registerResponseResources(args: {
  server: SessionSurfaceServer;
  responseResourceManager: SessionResponseResourceManager;
}): void {
  args.server.registerResource(
    "response-resources",
    "mcp2://response/{capability}/{id}",
    {
      description:
        "Temporary resources containing full tool responses that exceeded the inline size threshold.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const result = args.responseResourceManager.readResource(uri.href);
      if (!result) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: JSON.stringify({
                error: "Resource not found or expired",
              }),
            },
          ],
        };
      }

      return result;
    },
  );
}
