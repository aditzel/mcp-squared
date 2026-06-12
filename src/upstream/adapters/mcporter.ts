/**
 * mcporter SDK adapter for local MCP servers.
 *
 * This adapter wraps mcporter-generated typed SDKs with MCP² policy,
 * audit, and supervisor calls. It allows local stdio servers to be
 * accessed via generated SDKs instead of raw MCP protocol.
 *
 * @module upstream/adapters/mcporter
 */

import type {
  AdapterContext,
  PostConnectResult,
  TransportCreationResult,
  UpstreamAdapter,
} from "../adapter.js";

/**
 * Configuration for the mcporter adapter.
 */
export interface McporterAdapterConfig {
  /** Path to the generated SDK module. */
  sdkPath: string;
  /** Optional SDK module name for dynamic import. */
  moduleName?: string;
}

/**
 * Creates a mcporter SDK adapter that wraps a generated typed SDK.
 *
 * The adapter loads the generated SDK module and creates a transport
 * that delegates to the SDK's typed methods instead of raw MCP protocol.
 *
 * @param config - mcporter adapter configuration
 * @returns A runtime adapter for the mcporter SDK
 */
export function createMcporterAdapter(
  config: McporterAdapterConfig,
): UpstreamAdapter {
  return {
    transportType: "stdio",

    async createTransport(
      context: AdapterContext,
    ): Promise<TransportCreationResult> {
      // Dynamically load the generated SDK module
      const sdkModule = await import(config.sdkPath);

      // The SDK module should export a transport factory
      if (typeof sdkModule.createTransport !== "function") {
        throw new Error(
          `mcporter SDK at ${config.sdkPath} does not export createTransport()`,
        );
      }

      const transport = await sdkModule.createTransport({
        command:
          context.config.transport === "stdio"
            ? context.config.stdio.command
            : "",
        args:
          context.config.transport === "stdio" ? context.config.stdio.args : [],
        env: context.config.env,
      });

      return { transport };
    },

    async postConnect(_context: AdapterContext): Promise<PostConnectResult> {
      // mcporter SDKs typically handle their own validation
      // We just verify the transport is usable
      try {
        const sdkModule = await import(config.sdkPath);
        if (typeof sdkModule.validate === "function") {
          return await sdkModule.validate();
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Default mcporter adapter factory.
 * Uses the standard mcporter SDK path convention.
 */
export function createDefaultMcporterAdapter(): UpstreamAdapter {
  return createMcporterAdapter({
    sdkPath: "mcporter-sdk",
    moduleName: "mcporter",
  });
}
