import { describe, expect, mock, test } from "bun:test";
import {
  registerConfiguredSessionSurface,
  registerResponseResources,
} from "@/server/session-surface";

describe("server session surface helpers", () => {
  test("registerConfiguredSessionSurface registers capability tools before optional response resources", () => {
    const calls: string[] = [];
    const registerCapabilityTools = mock(() => {
      calls.push("tools");
    });
    const registerResource = mock(() => {
      calls.push("resource");
    });

    registerConfiguredSessionSurface({
      server: { registerResource },
      registerCapabilityTools,
      responseResourceManager: {
        isEnabled: () => true,
        readResource: () => null,
      },
    });

    expect(registerCapabilityTools).toHaveBeenCalledTimes(1);
    expect(registerResource).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["tools", "resource"]);
  });

  test("registerConfiguredSessionSurface skips response resources when disabled", () => {
    const registerCapabilityTools = mock(() => {});
    const registerResource = mock(() => {});

    registerConfiguredSessionSurface({
      server: { registerResource },
      registerCapabilityTools,
      responseResourceManager: {
        isEnabled: () => false,
        readResource: () => null,
      },
    });

    expect(registerCapabilityTools).toHaveBeenCalledTimes(1);
    expect(registerResource).not.toHaveBeenCalled();
  });

  test("registerResponseResources returns stored resources when present", async () => {
    let readHandler:
      | ((uri: URL) =>
          | Promise<{
              contents: Array<{
                mimeType: string;
                text: string;
                uri: string;
              }>;
            }>
          | {
              contents: Array<{
                mimeType: string;
                text: string;
                uri: string;
              }>;
            })
      | undefined;

    registerResponseResources({
      server: {
        registerResource: (_name, _template, _metadata, handler) => {
          readHandler = handler;
        },
      },
      responseResourceManager: {
        isEnabled: () => true,
        readResource: (uri) => ({
          contents: [{ uri, mimeType: "text/plain", text: "stored payload" }],
        }),
      },
    });

    expect(readHandler).toBeDefined();

    const result = await readHandler?.(
      new URL("mcp2://response/code_search/abc"),
    );

    expect(result).toEqual({
      contents: [
        {
          uri: "mcp2://response/code_search/abc",
          mimeType: "text/plain",
          text: "stored payload",
        },
      ],
    });
  });

  test("registerResponseResources returns a not found payload for expired resources", async () => {
    let readHandler:
      | ((uri: URL) =>
          | Promise<{
              contents: Array<{
                mimeType: string;
                text: string;
                uri: string;
              }>;
            }>
          | {
              contents: Array<{
                mimeType: string;
                text: string;
                uri: string;
              }>;
            })
      | undefined;

    registerResponseResources({
      server: {
        registerResource: (_name, _template, _metadata, handler) => {
          readHandler = handler;
        },
      },
      responseResourceManager: {
        isEnabled: () => true,
        readResource: () => null,
      },
    });

    const result = await readHandler?.(
      new URL("mcp2://response/code_search/missing"),
    );

    expect(result).toEqual({
      contents: [
        {
          uri: "mcp2://response/code_search/missing",
          mimeType: "text/plain",
          text: JSON.stringify({ error: "Resource not found or expired" }),
        },
      ],
    });
  });
});
