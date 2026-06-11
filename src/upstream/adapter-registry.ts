/**
 * Adapter registry for upstream runtime adapters.
 *
 * Provides a registry of transport adapters and selects the appropriate
 * one based on the upstream configuration.
 *
 * @module upstream/adapter-registry
 */

import type { UpstreamServerConfig } from "../config/schema.js";
import type { UpstreamAdapter } from "./adapter.js";
import { sseAdapter } from "./adapters/sse.js";
import { stdioAdapter } from "./adapters/stdio.js";

/** Default adapter registry with built-in adapters. */
const defaultAdapters = new Map<string, UpstreamAdapter>([
  ["stdio", stdioAdapter],
  ["sse", sseAdapter],
]);

const customAdapters = new Map<string, UpstreamAdapter>();

/**
 * Registers a custom adapter for a transport type.
 * Overrides any existing adapter for the same transport type.
 */
export function registerAdapter(adapter: UpstreamAdapter): void {
  customAdapters.set(adapter.transportType, adapter);
}

/**
 * Unregisters a custom adapter for a transport type.
 */
export function unregisterAdapter(transportType: string): void {
  customAdapters.delete(transportType);
}

/**
 * Gets the adapter for a given upstream configuration.
 * Custom adapters take precedence over built-in ones.
 */
export function getAdapter(
  config: UpstreamServerConfig,
): UpstreamAdapter | undefined {
  return (
    customAdapters.get(config.transport) ??
    defaultAdapters.get(config.transport)
  );
}

/**
 * Gets all registered adapters (custom + built-in).
 */
export function getRegisteredAdapters(): UpstreamAdapter[] {
  const adapters: UpstreamAdapter[] = [];
  const seen = new Set<string>();

  for (const adapter of customAdapters.values()) {
    if (!seen.has(adapter.transportType)) {
      adapters.push(adapter);
      seen.add(adapter.transportType);
    }
  }

  for (const adapter of defaultAdapters.values()) {
    if (!seen.has(adapter.transportType)) {
      adapters.push(adapter);
      seen.add(adapter.transportType);
    }
  }

  return adapters;
}

/**
 * Clears all custom adapters (useful for testing).
 */
export function clearCustomAdapters(): void {
  customAdapters.clear();
}
