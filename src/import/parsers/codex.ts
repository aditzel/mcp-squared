/**
 * Parser for OpenAI Codex CLI MCP configurations.
 *
 * Codex stores MCP configs in TOML format:
 * - User: ~/.codex/config.toml
 * - Project: .codex/config.toml
 * - Env var: CODEX_HOME (overrides base directory)
 *
 * Format: TOML with [mcp_servers.<name>] sections
 *
 * @module import/parsers/codex
 */

import type { ExternalServer, ParseResult } from "../types.js";
import { BaseConfigParser } from "./base.js";

/**
 * Parser for OpenAI Codex CLI configuration files.
 * Codex uses TOML format with "mcp_servers" key (underscore, not camelCase).
 */
export class CodexParser extends BaseConfigParser {
  readonly toolId = "codex" as const;
  readonly displayName = "Codex CLI";
  readonly configKey = "mcp_servers";

  canParse(content: unknown): boolean {
    if (typeof content !== "object" || content === null) {
      return false;
    }
    return "mcp_servers" in content;
  }

  parse(content: unknown, filePath: string): ParseResult {
    const servers = this.getServersSection(content);
    if (!servers) {
      return this.emptyResult();
    }

    const result: ParseResult = { servers: [], warnings: [] };

    for (const [name, config] of Object.entries(servers)) {
      const server = this.parseCodexServerEntry(name, config, result.warnings);
      if (server) {
        result.servers.push(server);
      } else {
        result.warnings.push(`Skipped invalid server "${name}" in ${filePath}`);
      }
    }

    return result;
  }

  /**
   * Parses a Codex server entry, handling Codex-specific fields.
   *
   * Codex supports:
   * - STDIO: command, args, env, cwd
   * - HTTP: url, bearer_token_env_var, http_headers, env_http_headers
   * - Common: enabled, enabled_tools, disabled_tools, *_timeout_sec
   */
  private parseCodexServerEntry(
    name: string,
    config: unknown,
    warnings: string[],
  ): ExternalServer | undefined {
    if (typeof config !== "object" || config === null) {
      return undefined;
    }

    const c = config as Record<string, unknown>;

    // Must have either command (stdio) or url (HTTP)
    const hasCommand = typeof c["command"] === "string";
    const hasUrl = typeof c["url"] === "string";

    if (!hasCommand && !hasUrl) {
      return undefined;
    }

    const server: ExternalServer = {
      name,
    };

    // STDIO transport fields
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

    // HTTP/SSE transport fields
    if (typeof c["url"] === "string") {
      server.url = c["url"];
    }

    // Build headers from multiple sources
    const headers: Record<string, string> = {};

    // bearer_token_env_var -> Authorization header with env var reference
    if (typeof c["bearer_token_env_var"] === "string") {
      headers["Authorization"] = `Bearer $${c["bearer_token_env_var"]}`;
    }

    // http_headers -> static headers
    if (typeof c["http_headers"] === "object" && c["http_headers"] !== null) {
      const staticHeaders = this.parseStringRecord(c["http_headers"]);
      Object.assign(headers, staticHeaders);
    }

    // env_http_headers -> headers sourced from env vars
    if (
      typeof c["env_http_headers"] === "object" &&
      c["env_http_headers"] !== null
    ) {
      const envHeaders = c["env_http_headers"] as Record<string, unknown>;
      for (const [headerName, envVarName] of Object.entries(envHeaders)) {
        if (typeof envVarName === "string") {
          headers[headerName] = `$${envVarName}`;
        }
      }
    }

    if (Object.keys(headers).length > 0) {
      server.headers = headers;
    }

    // Environment variables
    if (typeof c["env"] === "object" && c["env"] !== null) {
      server.env = this.parseStringRecord(c["env"]);
    }

    // Disabled flag (Codex uses "enabled" boolean)
    // Only set disabled if explicitly disabled (enabled: false)
    if (c["enabled"] === false) {
      server.disabled = true;
    }

    // Warn about unsupported fields
    if (c["enabled_tools"] || c["disabled_tools"]) {
      warnings.push(
        `Server "${name}": enabled_tools/disabled_tools are not supported in MCP² and will be ignored`,
      );
    }

    return server;
  }
}
