/**
 * Config hash helper for daemon selection.
 *
 * @module daemon/config-hash
 */

import { createHash } from "node:crypto";
import type { McpSquaredConfig } from "../config/schema.js";

export function computeConfigHash(config: McpSquaredConfig): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(config));
  return hash.digest("hex").slice(0, 12);
}
