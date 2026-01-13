/**
 * Base parser class for MCP configurations.
 *
 * Each tool's config format gets its own parser class that extends
 * this base class. The parser handles reading the tool-specific
 * JSON format and extracting server configurations.
 *
 * @module import/parsers/base
 */

import type { ExternalServer, ParseResult, ToolId } from "../types.js";

/**
 * Abstract base class for configuration parsers.
 * Each supported tool has a parser that extends this class.
 */
export abstract class BaseConfigParser {
  /** Tool identifier this parser handles */
  abstract readonly toolId: ToolId;

  /** Human-readable tool name */
  abstract readonly displayName: string;

  /**
   * JSON key containing server configurations.
   * Common values: "mcpServers", "servers", "context_servers"
   */
  abstract readonly configKey: string;

  /**
   * Checks if this parser can handle the given content.
   * Used for auto-detection when the tool is unknown.
   *
   * @param content - Parsed JSON content
   * @returns true if this parser can handle the content
   */
  abstract canParse(content: unknown): boolean;

  /**
   * Parses configuration content into external servers.
   *
   * @param content - Parsed JSON content
   * @param filePath - Path to the source file (for error messages)
   * @returns ParseResult with servers and any warnings
   */
  abstract parse(content: unknown, filePath: string): ParseResult;

  /**
   * Gets the servers section from the config content.
   * Handles the common case of a nested object key.
   *
   * @param content - Parsed JSON content
   * @returns Server configurations object or undefined
   */
  protected getServersSection(
    content: unknown,
  ): Record<string, unknown> | undefined {
    if (typeof content !== "object" || content === null) {
      return undefined;
    }

    const obj = content as Record<string, unknown>;
    const servers = obj[this.configKey];

    if (typeof servers !== "object" || servers === null) {
      return undefined;
    }

    return servers as Record<string, unknown>;
  }

  /**
   * Parses a single server entry from the config.
   * Handles the common JSON format used by most tools.
   *
   * @param name - Server name (key in the servers object)
   * @param config - Server configuration object
   * @returns ExternalServer or undefined if invalid
   */
  protected parseServerEntry(
    name: string,
    config: unknown,
  ): ExternalServer | undefined {
    if (typeof config !== "object" || config === null) {
      return undefined;
    }

    const c = config as Record<string, unknown>;

    // Must have either command (stdio) or url/httpUrl (SSE)
    const hasCommand = typeof c["command"] === "string";
    const hasUrl =
      typeof c["url"] === "string" || typeof c["httpUrl"] === "string";

    if (!hasCommand && !hasUrl) {
      return undefined;
    }

    const server: ExternalServer = {
      name,
    };

    // Stdio transport fields
    if (typeof c["command"] === "string") {
      server.command = c["command"];
    }

    if (Array.isArray(c["args"])) {
      server.args = (c["args"] as unknown[]).filter(
        (a): a is string => typeof a === "string",
      );
    }

    if (typeof c["cwd"] === "string") {
      server.cwd = c["cwd"];
    }

    // SSE transport fields
    if (typeof c["url"] === "string") {
      server.url = c["url"];
    }

    if (typeof c["httpUrl"] === "string") {
      server.httpUrl = c["httpUrl"];
    }

    if (typeof c["headers"] === "object" && c["headers"] !== null) {
      server.headers = this.parseStringRecord(c["headers"]);
    }

    // Environment variables
    if (typeof c["env"] === "object" && c["env"] !== null) {
      server.env = this.parseStringRecord(c["env"]);
    }

    // Disabled flag (various representations)
    if (typeof c["disabled"] === "boolean") {
      server.disabled = c["disabled"];
    } else if (typeof c["enabled"] === "boolean") {
      server.disabled = !c["enabled"];
    }

    // Cline/Roo-specific: alwaysAllow
    if (Array.isArray(c["alwaysAllow"])) {
      server.alwaysAllow = (c["alwaysAllow"] as unknown[]).filter(
        (a): a is string => typeof a === "string",
      );
    }

    return server;
  }

  /**
   * Parses an object into a string record.
   * Filters out non-string values.
   *
   * @param obj - Object to parse
   * @returns Record with only string values
   */
  protected parseStringRecord(obj: unknown): Record<string, string> {
    if (typeof obj !== "object" || obj === null) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Creates an empty parse result.
   */
  protected emptyResult(): ParseResult {
    return { servers: [], warnings: [] };
  }
}

/**
 * Standard parser for tools using the common "mcpServers" format.
 * Most tools (Claude Code, Cursor, Windsurf, Cline, etc.) use this format.
 */
export abstract class StandardMcpServersParser extends BaseConfigParser {
  readonly configKey = "mcpServers";

  canParse(content: unknown): boolean {
    if (typeof content !== "object" || content === null) {
      return false;
    }
    return this.configKey in content;
  }

  parse(content: unknown, filePath: string): ParseResult {
    const servers = this.getServersSection(content);
    if (!servers) {
      return this.emptyResult();
    }

    const result: ParseResult = { servers: [], warnings: [] };

    for (const [name, config] of Object.entries(servers)) {
      const server = this.parseServerEntry(name, config);
      if (server) {
        result.servers.push(server);
      } else {
        result.warnings.push(`Skipped invalid server "${name}" in ${filePath}`);
      }
    }

    return result;
  }
}
