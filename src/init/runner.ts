/**
 * Init command runner.
 *
 * Generates a starter MCP² configuration file with a chosen security profile
 * and inline comments explaining each setting.
 *
 * @module init/runner
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InitArgs, SecurityProfile } from "../cli/index.js";
import { ensureConfigDir, getDefaultConfigPath } from "../config/paths.js";

const PROJECT_CONFIG_FILENAME = "mcp-squared.toml";

/**
 * Generates a commented TOML config string for the given security profile.
 */
export function generateConfigToml(profile: SecurityProfile): string {
  const securityBlock =
    profile === "permissive"
      ? `[security.tools]
# Permissive: all tools are allowed without confirmation.
# Change to hardened defaults with: allow = [], confirm = ["*:*"]
allow = ["*:*"]
block = []
confirm = []`
      : `[security.tools]
# Hardened: all tools require confirmation before execution.
# To allow specific tools without confirmation, add patterns to 'allow':
#   allow = ["github:*", "fs:read_file"]
# To block tools entirely:
#   block = ["dangerous:*"]
# To revert to permissive mode: allow = ["*:*"], confirm = []
allow = []
block = []
confirm = ["*:*"]`;

  return `# MCP² Configuration
# https://github.com/aditzel/mcp-squared
schemaVersion = 1

# Upstream MCP servers to aggregate.
# Add servers here or use 'mcp-squared import' to import from other tools.
#
# [upstreams.example]
# transport = "stdio"
# [upstreams.example.stdio]
# command = "npx"
# args = ["-y", "@modelcontextprotocol/server-example"]

${securityBlock}

[operations.findTools]
defaultLimit = 5
maxLimit = 50
defaultMode = "fast"
defaultDetailLevel = "L1"

[operations.logging]
level = "info"
`;
}

/**
 * Runs the init command: generates a starter config file.
 *
 * @param args - Init command options
 */
export async function runInit(args: InitArgs): Promise<void> {
  const targetPath = args.project
    ? join(process.cwd(), PROJECT_CONFIG_FILENAME)
    : getDefaultConfigPath().path;

  if (existsSync(targetPath) && !args.force) {
    console.error(`Config file already exists: ${targetPath}`);
    console.error("Use --force to overwrite.");
    process.exit(1);
  }

  ensureConfigDir(targetPath);

  const content = generateConfigToml(args.security);
  await Bun.write(targetPath, content);

  const profileLabel =
    args.security === "permissive"
      ? "permissive (allow-all)"
      : "hardened (confirm-all)";

  console.log(`Created ${targetPath}`);
  console.log(`Security profile: ${profileLabel}`);
  console.log("");
  console.log("Next steps:");
  console.log(
    "  1. Add upstream servers to [upstreams] or run: mcp-squared import",
  );
  console.log("  2. Test connections: mcp-squared test");
  console.log("  3. Install into MCP clients: mcp-squared install");
}
