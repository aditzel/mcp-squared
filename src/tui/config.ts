import {
  ASCIIFontRenderable,
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  type KeyEvent,
  type PasteEvent,
  RGBA,
  type SelectOption,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core";
import {
  DEFAULT_CONFIG,
  type McpSquaredConfig,
  type UpstreamServerConfig,
  getDefaultConfigPath,
  loadConfig,
  saveConfig,
} from "../config/index.js";
import { VERSION } from "../index.js";

const PROJECT_DESCRIPTION = "Mercury Control Plane";

type Screen =
  | "main"
  | "upstreams"
  | "add-upstream"
  | "edit-upstream"
  | "security"
  | "operations";

interface ConfigTuiState {
  config: McpSquaredConfig;
  configPath: string;
  isDirty: boolean;
  currentScreen: Screen;
  selectedUpstream: string | null;
}

export async function runConfigTui(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
  });

  const { config, path } = await loadConfig().catch(() => ({
    config: DEFAULT_CONFIG,
    path: getDefaultConfigPath().path,
  }));

  const state: ConfigTuiState = {
    config: structuredClone(config),
    configPath: path,
    isDirty: false,
    currentScreen: "main",
    selectedUpstream: null,
  };

  renderer.setBackgroundColor("#0f172a");

  const app = new ConfigTuiApp(renderer, state);
  app.showMainMenu();

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.name === "c" && key.ctrl) {
      app.handleExit();
    }
  });
}

class ConfigTuiApp {
  private renderer: CliRenderer;
  private state: ConfigTuiState;
  private container: BoxRenderable | null = null;

  constructor(renderer: CliRenderer, state: ConfigTuiState) {
    this.renderer = renderer;
    this.state = state;
  }

  private clearScreen(): void {
    if (this.container) {
      this.renderer.root.remove(this.container.id);
    }
    this.container = new BoxRenderable(this.renderer, {
      id: "config-container",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
      padding: 2,
    });
    this.renderer.root.add(this.container);
  }

  private addHeader(): void {
    if (!this.container) return;

    const titleRow = new BoxRenderable(this.renderer, {
      id: "config-title-row",
      flexDirection: "row",
      alignItems: "flex-start",
      marginBottom: 1,
    });
    this.container.add(titleRow);

    const titleMcp = new ASCIIFontRenderable(this.renderer, {
      id: "config-title-mcp",
      text: "MCP",
      font: "tiny",
      color: RGBA.fromHex("#38bdf8"),
    });
    titleRow.add(titleMcp);

    const titleSquared = new TextRenderable(this.renderer, {
      id: "config-title-squared",
      content: "²",
      fg: "#38bdf8",
    });
    titleRow.add(titleSquared);

    const subtitle = new TextRenderable(this.renderer, {
      id: "config-subtitle",
      content: PROJECT_DESCRIPTION,
      fg: "#94a3b8",
      marginBottom: 1,
    });
    this.container.add(subtitle);

    const versionText = new TextRenderable(this.renderer, {
      id: "config-version",
      content: `v${VERSION}${this.state.isDirty ? " (unsaved changes)" : ""}`,
      fg: this.state.isDirty ? "#fbbf24" : "#64748b",
      marginBottom: 2,
    });
    this.container.add(versionText);
  }

  showMainMenu(): void {
    this.state.currentScreen = "main";
    this.clearScreen();
    this.addHeader();
    if (!this.container) return;

    const upstreamCount = Object.keys(this.state.config.upstreams).length;

    const menuBox = new BoxRenderable(this.renderer, {
      id: "config-menu-box",
      width: 50,
      height: 12,
      border: true,
      borderStyle: "single",
      borderColor: "#475569",
      title: "Configuration",
      titleAlignment: "center",
      backgroundColor: "#1e293b",
    });
    this.container.add(menuBox);

    const options: SelectOption[] = [
      {
        name: `Upstream Servers (${upstreamCount})`,
        description: "Manage MCP server connections",
        value: "upstreams",
      },
      {
        name: "Security Settings",
        description: "Configure tool access controls",
        value: "security",
      },
      {
        name: "Operations",
        description: "Limits, logging, and performance",
        value: "operations",
      },
      {
        name: this.state.isDirty ? "Save Changes" : "Save",
        description: this.state.isDirty
          ? "Write changes to config file"
          : "No changes to save",
        value: "save",
      },
      {
        name: "Exit",
        description: this.state.isDirty
          ? "Exit (will prompt to save)"
          : "Exit configuration",
        value: "exit",
      },
    ];

    const menu = new SelectRenderable(this.renderer, {
      id: "config-menu",
      width: "100%",
      height: "100%",
      options,
      backgroundColor: "transparent",
      selectedBackgroundColor: "#334155",
      textColor: "#e2e8f0",
      selectedTextColor: "#38bdf8",
      showDescription: true,
      descriptionColor: "#64748b",
      selectedDescriptionColor: "#94a3b8",
      wrapSelection: true,
    });
    menuBox.add(menu);

    menu.on(
      SelectRenderableEvents.ITEM_SELECTED,
      (_index: number, option: SelectOption) => {
        this.handleMainMenuSelection(option.value as string);
      },
    );

    menu.focus();
    this.addInstructions("↑↓ Navigate | Enter Select | Ctrl+C Quit");
  }

  private handleMainMenuSelection(value: string): void {
    switch (value) {
      case "upstreams":
        this.showUpstreamsScreen();
        break;
      case "security":
        this.showSecurityScreen();
        break;
      case "operations":
        this.showOperationsScreen();
        break;
      case "save":
        this.handleSave();
        break;
      case "exit":
        this.handleExit();
        break;
    }
  }

  showUpstreamsScreen(): void {
    this.state.currentScreen = "upstreams";
    this.clearScreen();
    this.addHeader();
    if (!this.container) return;

    const menuBox = new BoxRenderable(this.renderer, {
      id: "upstreams-box",
      width: 60,
      height: 14,
      border: true,
      borderStyle: "single",
      borderColor: "#475569",
      title: "Upstream Servers",
      titleAlignment: "center",
      backgroundColor: "#1e293b",
    });
    this.container.add(menuBox);

    const upstreamEntries = Object.entries(this.state.config.upstreams);
    const options: SelectOption[] = [
      {
        name: "+ Add New Upstream",
        description: "Configure a new MCP server connection",
        value: { action: "add" },
      },
    ];

    for (const [name, upstream] of upstreamEntries) {
      const status = upstream.enabled ? "✓" : "✗";
      const transport = upstream.transport.toUpperCase();
      options.push({
        name: `${status} ${name} [${transport}]`,
        description: this.getUpstreamDescription(upstream),
        value: { action: "edit", name },
      });
    }

    options.push({
      name: "← Back to Main Menu",
      description: "",
      value: { action: "back" },
    });

    const menu = new SelectRenderable(this.renderer, {
      id: "upstreams-menu",
      width: "100%",
      height: "100%",
      options,
      backgroundColor: "transparent",
      selectedBackgroundColor: "#334155",
      textColor: "#e2e8f0",
      selectedTextColor: "#38bdf8",
      showDescription: true,
      descriptionColor: "#64748b",
      selectedDescriptionColor: "#94a3b8",
      wrapSelection: true,
    });
    menuBox.add(menu);

    menu.on(
      SelectRenderableEvents.ITEM_SELECTED,
      (_index: number, option: SelectOption) => {
        const val = option.value as { action: string; name?: string };
        if (val.action === "add") {
          this.showAddUpstreamScreen();
        } else if (val.action === "edit" && val.name) {
          this.state.selectedUpstream = val.name;
          this.showEditUpstreamScreen(val.name);
        } else if (val.action === "back") {
          this.showMainMenu();
        }
      },
    );

    menu.focus();
    this.addInstructions("↑↓ Navigate | Enter Select | Esc Back");

    this.renderer.keyInput.once("keypress", (key: KeyEvent) => {
      if (key.name === "escape") {
        this.showMainMenu();
      }
    });
  }

  private getUpstreamDescription(upstream: UpstreamServerConfig): string {
    const envCount = Object.keys(upstream.env || {}).length;
    const envSuffix =
      envCount > 0 ? ` (${envCount} env var${envCount > 1 ? "s" : ""})` : "";

    if (upstream.transport === "stdio") {
      return `${upstream.stdio.command} ${upstream.stdio.args.join(" ")}${envSuffix}`;
    }
    return `${upstream.sse.url}${envSuffix}`;
  }

  showAddUpstreamScreen(): void {
    this.state.currentScreen = "add-upstream";
    this.clearScreen();
    this.addHeader();
    if (!this.container) return;

    const formBox = new BoxRenderable(this.renderer, {
      id: "add-upstream-box",
      width: 60,
      height: 22,
      border: true,
      borderStyle: "single",
      borderColor: "#475569",
      title: "Add Upstream Server",
      titleAlignment: "center",
      backgroundColor: "#1e293b",
      flexDirection: "column",
      padding: 1,
    });
    this.container.add(formBox);

    const nameLabel = new TextRenderable(this.renderer, {
      id: "name-label",
      content: "Name (unique identifier):",
      fg: "#94a3b8",
      marginBottom: 0,
    });
    formBox.add(nameLabel);

    const nameInput = new InputRenderable(this.renderer, {
      id: "name-input",
      width: "100%",
      placeholder: "e.g., github, filesystem",
      backgroundColor: "#0f172a",
      focusedBackgroundColor: "#1e293b",
      textColor: "#e2e8f0",
      marginBottom: 1,
      onPaste: (event: PasteEvent) => {
        nameInput.value = (nameInput.value || "") + event.text;
      },
    });
    formBox.add(nameInput);

    const commandLabel = new TextRenderable(this.renderer, {
      id: "command-label",
      content: "Command (stdio transport):",
      fg: "#94a3b8",
    });
    formBox.add(commandLabel);

    const commandInput = new InputRenderable(this.renderer, {
      id: "command-input",
      width: "100%",
      placeholder: "e.g., npx -y @modelcontextprotocol/server-github",
      backgroundColor: "#0f172a",
      focusedBackgroundColor: "#1e293b",
      textColor: "#e2e8f0",
      marginBottom: 1,
      onPaste: (event: PasteEvent) => {
        commandInput.value = (commandInput.value || "") + event.text;
      },
    });
    formBox.add(commandInput);

    const envLabel = new TextRenderable(this.renderer, {
      id: "env-label",
      content: "Environment variables (optional, comma-separated):",
      fg: "#94a3b8",
      marginBottom: 0,
    });
    formBox.add(envLabel);

    const envInput = new InputRenderable(this.renderer, {
      id: "env-input",
      width: "100%",
      placeholder: "e.g., GITHUB_TOKEN=$GITHUB_TOKEN, API_KEY=xxx",
      backgroundColor: "#0f172a",
      focusedBackgroundColor: "#1e293b",
      textColor: "#e2e8f0",
      marginBottom: 1,
      onPaste: (event: PasteEvent) => {
        envInput.value = (envInput.value || "") + event.text;
      },
    });
    formBox.add(envInput);

    const submitOptions: SelectOption[] = [
      { name: "[ Save Upstream ]", description: "", value: "save" },
      { name: "[ Cancel ]", description: "", value: "cancel" },
    ];

    const submitSelect = new SelectRenderable(this.renderer, {
      id: "submit-select",
      width: "100%",
      height: 3,
      options: submitOptions,
      backgroundColor: "transparent",
      selectedBackgroundColor: "#334155",
      textColor: "#e2e8f0",
      selectedTextColor: "#38bdf8",
      wrapSelection: true,
    });
    formBox.add(submitSelect);

    const fields = [nameInput, commandInput, envInput, submitSelect] as const;
    let focusIndex = 0;

    const focusField = (index: number) => {
      focusIndex = index;
      const field = fields[index];
      if (field) field.focus();
    };

    const parseEnvVars = (input: string): Record<string, string> => {
      const env: Record<string, string> = {};
      if (!input.trim()) return env;

      const pairs = input
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const pair of pairs) {
        const eqIndex = pair.indexOf("=");
        if (eqIndex > 0) {
          const key = pair.substring(0, eqIndex).trim();
          const value = pair.substring(eqIndex + 1).trim();
          if (key) {
            env[key] = value;
          }
        }
      }
      return env;
    };

    const saveUpstream = () => {
      const trimmedName = nameInput.value?.trim() || "";
      const trimmedCommand = commandInput.value?.trim() || "";

      if (!trimmedName) {
        nameInput.focus();
        return;
      }
      if (!trimmedCommand) {
        commandInput.focus();
        return;
      }

      const envVars = parseEnvVars(envInput.value || "");
      const parts = trimmedCommand.split(/\s+/);
      const command = parts[0] || "";
      const args = parts.slice(1);

      this.state.config.upstreams[trimmedName] = {
        transport: "stdio",
        enabled: true,
        env: envVars,
        stdio: { command, args },
      };
      this.state.isDirty = true;
      cleanup();
      this.showUpstreamsScreen();
    };

    submitSelect.on(
      SelectRenderableEvents.ITEM_SELECTED,
      (_i: number, opt: SelectOption) => {
        if (opt.value === "save") {
          saveUpstream();
        } else {
          cleanup();
          this.showUpstreamsScreen();
        }
      },
    );

    const handleKeypress = (key: KeyEvent) => {
      if (key.name === "escape") {
        cleanup();
        this.showUpstreamsScreen();
        return;
      }

      if (key.name === "tab" && !key.shift) {
        focusField((focusIndex + 1) % fields.length);
        return;
      }

      if (key.name === "tab" && key.shift) {
        focusField((focusIndex - 1 + fields.length) % fields.length);
        return;
      }
    };

    const cleanup = () => {
      this.renderer.keyInput.off("keypress", handleKeypress);
    };

    this.renderer.keyInput.on("keypress", handleKeypress);
    focusField(0);

    this.addInstructions("Tab: next field | Shift+Tab: prev | Esc: cancel");
  }

  showEditUpstreamScreen(name: string): void {
    this.state.currentScreen = "edit-upstream";
    this.clearScreen();
    this.addHeader();
    if (!this.container) return;

    const upstream = this.state.config.upstreams[name];
    if (!upstream) {
      this.showUpstreamsScreen();
      return;
    }

    const menuBox = new BoxRenderable(this.renderer, {
      id: "edit-upstream-box",
      width: 60,
      height: 18,
      border: true,
      borderStyle: "single",
      borderColor: "#475569",
      title: `Edit: ${name}`,
      titleAlignment: "center",
      backgroundColor: "#1e293b",
      flexDirection: "column",
      padding: 1,
    });
    this.container.add(menuBox);

    const transportText = new TextRenderable(this.renderer, {
      id: "edit-transport",
      content: `Transport: ${upstream.transport.toUpperCase()}`,
      fg: "#94a3b8",
      marginBottom: 0,
    });
    menuBox.add(transportText);

    if (upstream.transport === "stdio") {
      const cmdText = new TextRenderable(this.renderer, {
        id: "edit-command",
        content: `Command: ${upstream.stdio.command} ${upstream.stdio.args.join(" ")}`,
        fg: "#94a3b8",
        marginBottom: 0,
      });
      menuBox.add(cmdText);
    } else {
      const urlText = new TextRenderable(this.renderer, {
        id: "edit-url",
        content: `URL: ${upstream.sse.url}`,
        fg: "#94a3b8",
        marginBottom: 0,
      });
      menuBox.add(urlText);
    }

    const envEntries = Object.entries(upstream.env || {});
    const envLabel = new TextRenderable(this.renderer, {
      id: "edit-env-label",
      content: `Environment (${envEntries.length}):`,
      fg: "#94a3b8",
      marginTop: 1,
      marginBottom: 0,
    });
    menuBox.add(envLabel);

    if (envEntries.length > 0) {
      for (const [key, value] of envEntries.slice(0, 3)) {
        const maskedValue = value.startsWith("$") ? value : "***";
        const envText = new TextRenderable(this.renderer, {
          id: `edit-env-${key}`,
          content: `  ${key}=${maskedValue}`,
          fg: "#64748b",
        });
        menuBox.add(envText);
      }
      if (envEntries.length > 3) {
        const moreText = new TextRenderable(this.renderer, {
          id: "edit-env-more",
          content: `  ... and ${envEntries.length - 3} more`,
          fg: "#64748b",
        });
        menuBox.add(moreText);
      }
    } else {
      const noEnvText = new TextRenderable(this.renderer, {
        id: "edit-env-none",
        content: "  (none)",
        fg: "#64748b",
      });
      menuBox.add(noEnvText);
    }

    const options: SelectOption[] = [
      {
        name: upstream.enabled ? "Disable" : "Enable",
        description: upstream.enabled
          ? "Stop using this upstream"
          : "Start using this upstream",
        value: "toggle",
      },
      {
        name: "Delete",
        description: "Remove this upstream configuration",
        value: "delete",
      },
      {
        name: "← Back",
        description: "",
        value: "back",
      },
    ];

    const menu = new SelectRenderable(this.renderer, {
      id: "edit-menu",
      width: "100%",
      height: "100%",
      options,
      backgroundColor: "transparent",
      selectedBackgroundColor: "#334155",
      textColor: "#e2e8f0",
      selectedTextColor: "#38bdf8",
      showDescription: true,
      descriptionColor: "#64748b",
      wrapSelection: true,
    });
    menuBox.add(menu);

    menu.on(
      SelectRenderableEvents.ITEM_SELECTED,
      (_index: number, option: SelectOption) => {
        switch (option.value) {
          case "toggle":
            upstream.enabled = !upstream.enabled;
            this.state.isDirty = true;
            this.showEditUpstreamScreen(name);
            break;
          case "delete":
            delete this.state.config.upstreams[name];
            this.state.isDirty = true;
            this.showUpstreamsScreen();
            break;
          case "back":
            this.showUpstreamsScreen();
            break;
        }
      },
    );

    menu.focus();
    this.addInstructions("↑↓ Navigate | Enter Select | Esc Back");
  }

  showSecurityScreen(): void {
    this.state.currentScreen = "security";
    this.clearScreen();
    this.addHeader();
    if (!this.container) return;

    const security = this.state.config.security;

    const infoBox = new BoxRenderable(this.renderer, {
      id: "security-box",
      width: 60,
      height: 14,
      border: true,
      borderStyle: "single",
      borderColor: "#475569",
      title: "Security Settings",
      titleAlignment: "center",
      backgroundColor: "#1e293b",
      flexDirection: "column",
      padding: 1,
    });
    this.container.add(infoBox);

    const allowText = new TextRenderable(this.renderer, {
      id: "allow-label",
      content: `Allow patterns: ${security.tools.allow.join(", ") || "(none)"}`,
      fg: "#4ade80",
      marginBottom: 1,
    });
    infoBox.add(allowText);

    const blockText = new TextRenderable(this.renderer, {
      id: "block-label",
      content: `Block patterns: ${security.tools.block.join(", ") || "(none)"}`,
      fg: "#f87171",
      marginBottom: 1,
    });
    infoBox.add(blockText);

    const confirmText = new TextRenderable(this.renderer, {
      id: "confirm-label",
      content: `Confirm patterns: ${security.tools.confirm.join(", ") || "(none)"}`,
      fg: "#fbbf24",
      marginBottom: 2,
    });
    infoBox.add(confirmText);

    const hintText = new TextRenderable(this.renderer, {
      id: "hint-text",
      content: "Edit mcp-squared.toml directly for advanced security config",
      fg: "#64748b",
      marginBottom: 1,
    });
    infoBox.add(hintText);

    const backOption: SelectOption[] = [
      { name: "← Back to Main Menu", description: "", value: "back" },
    ];

    const backMenu = new SelectRenderable(this.renderer, {
      id: "security-back",
      width: "100%",
      height: 2,
      options: backOption,
      backgroundColor: "transparent",
      selectedBackgroundColor: "#334155",
      textColor: "#e2e8f0",
      selectedTextColor: "#38bdf8",
    });
    infoBox.add(backMenu);

    backMenu.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      this.showMainMenu();
    });

    backMenu.focus();
    this.addInstructions("Enter to go back | Esc Back");

    const handleEscape = (key: KeyEvent) => {
      if (key.name === "escape") {
        this.renderer.keyInput.off("keypress", handleEscape);
        this.showMainMenu();
      }
    };
    this.renderer.keyInput.on("keypress", handleEscape);
  }

  showOperationsScreen(): void {
    this.state.currentScreen = "operations";
    this.clearScreen();
    this.addHeader();
    if (!this.container) return;

    const ops = this.state.config.operations;

    const infoBox = new BoxRenderable(this.renderer, {
      id: "operations-box",
      width: 60,
      height: 14,
      border: true,
      borderStyle: "single",
      borderColor: "#475569",
      title: "Operations Settings",
      titleAlignment: "center",
      backgroundColor: "#1e293b",
      flexDirection: "column",
      padding: 1,
    });
    this.container.add(infoBox);

    const limitText = new TextRenderable(this.renderer, {
      id: "limit-label",
      content: `Default find_tools limit: ${ops.findTools.defaultLimit}`,
      fg: "#e2e8f0",
      marginBottom: 1,
    });
    infoBox.add(limitText);

    const maxLimitText = new TextRenderable(this.renderer, {
      id: "max-limit-label",
      content: `Max find_tools limit: ${ops.findTools.maxLimit}`,
      fg: "#e2e8f0",
      marginBottom: 1,
    });
    infoBox.add(maxLimitText);

    const refreshText = new TextRenderable(this.renderer, {
      id: "refresh-label",
      content: `Index refresh interval: ${ops.index.refreshIntervalMs}ms`,
      fg: "#e2e8f0",
      marginBottom: 1,
    });
    infoBox.add(refreshText);

    const logText = new TextRenderable(this.renderer, {
      id: "log-label",
      content: `Log level: ${ops.logging.level}`,
      fg: "#e2e8f0",
      marginBottom: 2,
    });
    infoBox.add(logText);

    const hintText = new TextRenderable(this.renderer, {
      id: "hint-text",
      content: "Edit mcp-squared.toml directly for advanced settings",
      fg: "#64748b",
      marginBottom: 1,
    });
    infoBox.add(hintText);

    const backOption: SelectOption[] = [
      { name: "← Back to Main Menu", description: "", value: "back" },
    ];

    const backMenu = new SelectRenderable(this.renderer, {
      id: "ops-back",
      width: "100%",
      height: 2,
      options: backOption,
      backgroundColor: "transparent",
      selectedBackgroundColor: "#334155",
      textColor: "#e2e8f0",
      selectedTextColor: "#38bdf8",
    });
    infoBox.add(backMenu);

    backMenu.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      this.showMainMenu();
    });

    backMenu.focus();
    this.addInstructions("Enter to go back | Esc Back");

    const handleEscape = (key: KeyEvent) => {
      if (key.name === "escape") {
        this.renderer.keyInput.off("keypress", handleEscape);
        this.showMainMenu();
      }
    };
    this.renderer.keyInput.on("keypress", handleEscape);
  }

  private async handleSave(): Promise<void> {
    if (!this.state.isDirty) {
      this.showMainMenu();
      return;
    }

    try {
      await saveConfig(this.state.configPath, this.state.config);
      this.state.isDirty = false;
      this.showMainMenu();
    } catch (err) {
      console.error("Failed to save config:", err);
      this.showMainMenu();
    }
  }

  handleExit(): void {
    if (this.state.isDirty) {
      this.showExitConfirmation();
    } else {
      this.renderer.destroy();
      process.exit(0);
    }
  }

  private showExitConfirmation(): void {
    this.clearScreen();
    this.addHeader();
    if (!this.container) return;

    const confirmBox = new BoxRenderable(this.renderer, {
      id: "confirm-box",
      width: 50,
      height: 8,
      border: true,
      borderStyle: "single",
      borderColor: "#fbbf24",
      title: "Unsaved Changes",
      titleAlignment: "center",
      backgroundColor: "#1e293b",
    });
    this.container.add(confirmBox);

    const options: SelectOption[] = [
      { name: "Save and Exit", description: "", value: "save-exit" },
      { name: "Exit without Saving", description: "", value: "exit" },
      { name: "Cancel", description: "", value: "cancel" },
    ];

    const menu = new SelectRenderable(this.renderer, {
      id: "confirm-menu",
      width: "100%",
      height: "100%",
      options,
      backgroundColor: "transparent",
      selectedBackgroundColor: "#334155",
      textColor: "#e2e8f0",
      selectedTextColor: "#38bdf8",
      wrapSelection: true,
    });
    confirmBox.add(menu);

    menu.on(
      SelectRenderableEvents.ITEM_SELECTED,
      async (_index: number, option: SelectOption) => {
        switch (option.value) {
          case "save-exit":
            await this.handleSave();
            this.renderer.destroy();
            process.exit(0);
            break;
          case "exit":
            this.renderer.destroy();
            process.exit(0);
            break;
          case "cancel":
            this.showMainMenu();
            break;
        }
      },
    );

    menu.focus();
    this.addInstructions("↑↓ Navigate | Enter Select");
  }

  private addInstructions(text: string): void {
    if (!this.container) return;

    const instructions = new TextRenderable(this.renderer, {
      id: "config-instructions",
      content: text,
      fg: "#64748b",
      marginTop: 2,
    });
    this.container.add(instructions);
  }
}
