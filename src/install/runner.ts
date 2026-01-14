/**
 * Install command runner.
 *
 * Orchestrates the installation of MCP² into other MCP client tools.
 *
 * @module install/runner
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { ALL_TOOL_IDS, getToolPaths } from "../import/discovery/registry.js";
import type { ToolId } from "../import/types.js";
import { createBackup } from "./backup.js";
import type {
  DiscoveredTool,
  InstallArgs,
  InstallMode,
  InstallOptions,
  InstallScope,
  McpServerEntry,
  ToolInstallResult,
} from "./types.js";
import { getToolDisplayName, getWriter } from "./writers/index.js";

/** ANSI color codes */
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

/**
 * Prompts the user for input.
 *
 * @param question - The question to display
 * @returns User's response
 */
async function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Discovers which MCP client tools are available for installation.
 *
 * @returns List of discovered tools with their available scopes
 */
export function discoverAvailableTools(): DiscoveredTool[] {
  const tools: DiscoveredTool[] = [];

  for (const toolId of ALL_TOOL_IDS) {
    const paths = getToolPaths(toolId);
    const scopes: InstallScope[] = [];
    const toolPaths: {
      user?: string | undefined;
      project?: string | undefined;
    } = {};

    // Check user-level paths
    const userPath = paths.user[0];
    if (userPath !== undefined) {
      toolPaths.user = userPath;
      scopes.push("user");
    }

    // Check project-level paths
    const projectPath = paths.project[0];
    if (projectPath !== undefined) {
      toolPaths.project = projectPath;
      scopes.push("project");
    }

    // Only include tools that have at least one scope available
    if (scopes.length > 0) {
      tools.push({
        tool: toolId,
        displayName: getToolDisplayName(toolId),
        scopes,
        paths: toolPaths,
      });
    }
  }

  return tools;
}

/**
 * Prompts user to select a tool from the list.
 *
 * @param tools - Available tools
 * @returns Selected tool
 */
async function promptToolSelection(
  tools: DiscoveredTool[],
): Promise<DiscoveredTool> {
  console.log("\nAvailable MCP client tools:\n");

  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i]!;
    const scopeInfo = tool.scopes.join(", ");
    console.log(
      `  ${colors.cyan}${i + 1}.${colors.reset} ${tool.displayName} (${scopeInfo})`,
    );
  }

  console.log("");

  while (true) {
    const answer = await promptUser(`Select tool [1-${tools.length}]: `);
    const index = Number.parseInt(answer, 10) - 1;

    if (index >= 0 && index < tools.length) {
      return tools[index]!;
    }

    console.log(
      `${colors.red}Invalid selection. Please enter a number between 1 and ${tools.length}.${colors.reset}`,
    );
  }
}

/**
 * Prompts user to select a scope.
 *
 * @param tool - Tool being configured
 * @returns Selected scope
 */
async function promptScopeSelection(
  tool: DiscoveredTool,
): Promise<InstallScope> {
  if (tool.scopes.length === 1) {
    return tool.scopes[0]!;
  }

  console.log(`\n${tool.displayName} supports multiple scopes:\n`);

  if (tool.paths.user) {
    console.log(`  ${colors.cyan}1.${colors.reset} User (${tool.paths.user})`);
  }
  if (tool.paths.project) {
    console.log(
      `  ${colors.cyan}2.${colors.reset} Project (${tool.paths.project})`,
    );
  }

  console.log("");

  while (true) {
    const answer = await promptUser(`Select scope [1-${tool.scopes.length}]: `);
    const index = Number.parseInt(answer, 10) - 1;

    if (index >= 0 && index < tool.scopes.length) {
      return tool.scopes[index]!;
    }

    console.log(`${colors.red}Invalid selection.${colors.reset}`);
  }
}

/**
 * Prompts user to select installation mode.
 *
 * @returns Selected mode
 */
async function promptModeSelection(): Promise<InstallMode> {
  console.log("\nInstallation mode:\n");
  console.log(
    `  ${colors.cyan}1.${colors.reset} Replace - Remove all existing servers, add only mcp-squared`,
  );
  console.log(
    `  ${colors.cyan}2.${colors.reset} Add - Keep existing servers, add mcp-squared alongside`,
  );
  console.log("");

  while (true) {
    const answer = await promptUser("Select mode [1-2]: ");

    if (answer === "1") {
      return "replace";
    }
    if (answer === "2") {
      return "add";
    }

    console.log(
      `${colors.red}Invalid selection. Please enter 1 or 2.${colors.reset}`,
    );
  }
}

/**
 * Prompts user for confirmation.
 *
 * @param message - Confirmation message
 * @returns True if confirmed
 */
async function confirmAction(message: string): Promise<boolean> {
  const answer = await promptUser(`${message} [Y/n]: `);
  return answer.toLowerCase() !== "n";
}

/**
 * Checks if a tool uses TOML format.
 */
function isTomlTool(toolId: ToolId): boolean {
  return toolId === "codex";
}

/**
 * Performs the actual installation to a config file.
 *
 * @param options - Installation options
 * @returns Installation result
 */
export function performInstallation(
  options: InstallOptions,
): ToolInstallResult {
  const { tool, path, scope, mode, serverName, command, dryRun } = options;
  const writer = getWriter(tool);
  const isToml = isTomlTool(tool);

  // Prepare the server entry
  const entry: McpServerEntry = { command };

  // Read existing config if it exists
  let existingConfig: Record<string, unknown> | null = null;
  let configExists = false;

  if (existsSync(path)) {
    configExists = true;
    try {
      const content = readFileSync(path, "utf-8");
      existingConfig = isToml
        ? (parseToml(content) as Record<string, unknown>)
        : JSON.parse(content);
    } catch (error) {
      return {
        tool,
        path,
        scope,
        success: false,
        created: false,
        error: `Failed to parse existing config: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Check if server already exists
  if (mode === "add" && writer.hasServer(existingConfig, serverName)) {
    const existingEntry = writer.getServer(existingConfig, serverName);
    if (existingEntry?.command === command) {
      return {
        tool,
        path,
        scope,
        success: true,
        created: false,
        error: `Server '${serverName}' already exists with the same configuration`,
      };
    }
  }

  // Write the new config
  const newConfig = writer.write(existingConfig, entry, serverName, mode);

  if (dryRun) {
    return {
      tool,
      path,
      scope,
      success: true,
      created: !configExists,
    };
  }

  // Create backup if file exists
  let backupPath: string | undefined;
  if (configExists) {
    backupPath = createBackup(path);
  }

  // Ensure parent directory exists
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write the config
  try {
    const output = isToml
      ? stringifyToml(newConfig)
      : JSON.stringify(newConfig, null, 2) + "\n";
    writeFileSync(path, output);
  } catch (error) {
    return {
      tool,
      path,
      scope,
      success: false,
      created: false,
      backupPath,
      error: `Failed to write config: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    tool,
    path,
    scope,
    success: true,
    created: !configExists,
    backupPath,
  };
}

/**
 * Runs the install command.
 *
 * @param args - Parsed install arguments
 */
export async function runInstall(args: InstallArgs): Promise<void> {
  console.log(`\n${colors.cyan}MCP² Installation${colors.reset}\n`);

  // Discover available tools
  const availableTools = discoverAvailableTools();

  if (availableTools.length === 0) {
    console.log(
      `${colors.red}No supported MCP client tools found.${colors.reset}`,
    );
    console.log("Install one of the supported tools first:");
    console.log("  Claude Desktop, Cursor, VS Code, Windsurf, Cline, etc.");
    process.exit(1);
  }

  // Select tool
  let selectedTool: DiscoveredTool;

  if (args.tool) {
    const found = availableTools.find((t) => t.tool === args.tool);
    if (!found) {
      console.log(
        `${colors.red}Tool '${args.tool}' not found or not available.${colors.reset}`,
      );
      console.log("Available tools:");
      for (const tool of availableTools) {
        console.log(`  - ${tool.tool} (${tool.displayName})`);
      }
      process.exit(1);
    }
    selectedTool = found;
  } else if (args.interactive) {
    selectedTool = await promptToolSelection(availableTools);
  } else {
    console.log(
      `${colors.red}--tool is required in non-interactive mode.${colors.reset}`,
    );
    process.exit(1);
  }

  // Select scope
  let selectedScope: InstallScope;

  if (args.scope) {
    if (!selectedTool.scopes.includes(args.scope)) {
      console.log(
        `${colors.red}Scope '${args.scope}' not available for ${selectedTool.displayName}.${colors.reset}`,
      );
      console.log(`Available scopes: ${selectedTool.scopes.join(", ")}`);
      process.exit(1);
    }
    selectedScope = args.scope;
  } else if (selectedTool.scopes.length === 1) {
    selectedScope = selectedTool.scopes[0]!;
  } else if (args.interactive) {
    selectedScope = await promptScopeSelection(selectedTool);
  } else {
    console.log(
      `${colors.red}--scope is required for ${selectedTool.displayName} in non-interactive mode.${colors.reset}`,
    );
    process.exit(1);
  }

  // Select mode
  let selectedMode: InstallMode;

  if (args.mode) {
    selectedMode = args.mode;
  } else if (args.interactive) {
    selectedMode = await promptModeSelection();
  } else {
    console.log(
      `${colors.red}--mode is required in non-interactive mode.${colors.reset}`,
    );
    process.exit(1);
  }

  // Determine target path
  const targetPath =
    selectedScope === "user"
      ? selectedTool.paths.user!
      : selectedTool.paths.project!;

  // Show summary
  console.log(`\n${colors.dim}Configuration:${colors.reset}`);
  console.log(`  Tool:    ${selectedTool.displayName}`);
  console.log(`  Path:    ${targetPath}`);
  console.log(`  Scope:   ${selectedScope}`);
  console.log(
    `  Mode:    ${selectedMode === "replace" ? "Replace all servers" : "Add alongside existing"}`,
  );
  console.log(`  Entry:   { "command": "${args.command}" }`);
  console.log(`  Name:    ${args.serverName}`);

  if (args.dryRun) {
    console.log(
      `\n${colors.yellow}Dry run mode - no changes will be made.${colors.reset}`,
    );
  }

  // Confirm if interactive
  if (args.interactive && !args.dryRun) {
    console.log("");
    const confirmed = await confirmAction("Proceed with installation?");
    if (!confirmed) {
      console.log("\nInstallation cancelled.");
      process.exit(0);
    }
  }

  // Perform installation
  const result = performInstallation({
    tool: selectedTool.tool,
    path: targetPath,
    scope: selectedScope,
    mode: selectedMode,
    serverName: args.serverName,
    command: args.command,
    dryRun: args.dryRun,
  });

  // Report result
  console.log("");

  if (result.success) {
    if (args.dryRun) {
      console.log(
        `${colors.green}✓${colors.reset} Would install MCP² to ${selectedTool.displayName} (${selectedScope})`,
      );
      if (result.created) {
        console.log(
          `  ${colors.dim}Would create: ${targetPath}${colors.reset}`,
        );
      } else {
        console.log(
          `  ${colors.dim}Would modify: ${targetPath}${colors.reset}`,
        );
      }
    } else {
      console.log(
        `${colors.green}✓${colors.reset} MCP² installed to ${selectedTool.displayName} (${selectedScope})`,
      );
      if (result.backupPath) {
        console.log(
          `  ${colors.dim}Backup created: ${result.backupPath}${colors.reset}`,
        );
      }
      if (result.created) {
        console.log(`  ${colors.dim}Created: ${targetPath}${colors.reset}`);
      } else {
        console.log(`  ${colors.dim}Modified: ${targetPath}${colors.reset}`);
      }

      if (result.error) {
        // This means server already exists with same config
        console.log(`  ${colors.yellow}Note: ${result.error}${colors.reset}`);
      }
    }
  } else {
    console.log(`${colors.red}✗${colors.reset} Installation failed`);
    console.log(`  Error: ${result.error}`);
    process.exit(1);
  }

  process.exit(0);
}
