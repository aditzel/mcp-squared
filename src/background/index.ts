/**
 * Background task management for MCP².
 *
 * This module provides background processing capabilities including
 * automatic tool index refreshing and change detection.
 *
 * @module background
 */

export {
  captureServerSnapshot,
  captureSnapshot,
  detectChanges,
  hasChanges,
} from "./change-detection.js";
export type { ToolChanges, ToolSnapshot } from "./change-detection.js";

export { IndexRefreshManager } from "./index-refresh.js";
export type {
  IndexRefreshManagerEvents,
  IndexRefreshManagerOptions,
} from "./index-refresh.js";
