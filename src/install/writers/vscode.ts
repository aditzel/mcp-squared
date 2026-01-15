/**
 * VS Code config writer.
 *
 * VS Code uses "servers" instead of "mcpServers" for its MCP configuration.
 *
 * @module install/writers/vscode
 */

import type { ToolId } from "../../import/types.js";
import { BaseConfigWriter } from "./base.js";

/**
 * Config writer for VS Code (uses "servers" key).
 */
export class VSCodeWriter extends BaseConfigWriter {
  readonly toolId: ToolId = "vscode";
  readonly configKey = "servers";
}
