/**
 * Shared capability metadata helpers.
 *
 * Extracted from McpSquaredServer so both the server and the CLI status
 * command can derive capability titles and summaries without importing the
 * full server module.
 *
 * @module utils/capability-meta
 */

/**
 * Returns a human-readable title for a capability ID.
 *
 * @example capabilityTitle("code_search") // "Code Search"
 */
export function capabilityTitle(capability: string): string {
  return capability
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Returns a one-line description for a known capability, or a generic
 * fallback for unknown ones.
 */
export function capabilitySummary(capability: string): string {
  switch (capability) {
    case "code_search":
      return "Search and retrieve source-code context.";
    case "docs":
      return "Query and read technical documentation.";
    case "browser_automation":
      return "Automate browser interactions and diagnostics.";
    case "issue_tracking":
      return "Work with issues, tickets, and project tracking.";
    case "observability":
      return "Work with monitoring, incidents, logs, and error tracking.";
    case "messaging":
      return "Work with chat, messages, channels, and notifications.";
    case "payments":
      return "Work with payments, subscriptions, invoices, and billing.";
    case "database":
      return "Work with databases, SQL, schemas, and data operations.";
    case "cms_content":
      return "Manage content and CMS resources.";
    case "design":
      return "Create and inspect design artifacts and visuals.";
    case "design_workspace":
      return "Work with structured design workspaces, layout state, tokens, and design-to-code flows.";
    case "ai_media_generation":
      return "Generate and edit images and media using AI models.";
    case "hosting_deploy":
      return "Manage deployments, hosting, and infrastructure operations.";
    case "time_util":
      return "Resolve time, timezone, and date utilities.";
    case "research":
      return "Run web/research collection and synthesis operations.";
    default:
      return "Run general-purpose capability actions.";
  }
}
