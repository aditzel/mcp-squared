import {
  ASCIIFontRenderable,
  BoxRenderable,
  type KeyEvent,
  RGBA,
  type SelectOption,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core";
import { VERSION } from "../index.js";

const PROJECT_DESCRIPTION = "Mercury Control Plane";

interface ConfigOption {
  name: string;
  description: string;
  action: () => void;
}

export async function runConfigTui(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
  });

  renderer.setBackgroundColor("#0f172a");

  const container = new BoxRenderable(renderer, {
    id: "config-container",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  });
  renderer.root.add(container);

  const titleRow = new BoxRenderable(renderer, {
    id: "config-title-row",
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 1,
  });
  container.add(titleRow);

  const titleMcp = new ASCIIFontRenderable(renderer, {
    id: "config-title-mcp",
    text: "MCP",
    font: "tiny",
    color: RGBA.fromHex("#38bdf8"),
  });
  titleRow.add(titleMcp);

  const titleSquared = new TextRenderable(renderer, {
    id: "config-title-squared",
    content: "²",
    fg: "#38bdf8",
  });
  titleRow.add(titleSquared);

  const subtitle = new TextRenderable(renderer, {
    id: "config-subtitle",
    content: PROJECT_DESCRIPTION,
    fg: "#94a3b8",
    marginBottom: 1,
  });
  container.add(subtitle);

  const versionText = new TextRenderable(renderer, {
    id: "config-version",
    content: `v${VERSION}`,
    fg: "#64748b",
    marginBottom: 2,
  });
  container.add(versionText);

  const menuBox = new BoxRenderable(renderer, {
    id: "config-menu-box",
    width: 40,
    height: 8,
    border: true,
    borderStyle: "single",
    borderColor: "#475569",
    focusedBorderColor: "#38bdf8",
    title: "Configuration",
    titleAlignment: "center",
    backgroundColor: "#1e293b",
  });
  container.add(menuBox);

  const options: ConfigOption[] = [
    {
      name: "Exit",
      description: "Exit the configuration interface",
      action: () => {
        renderer.destroy();
        process.exit(0);
      },
    },
  ];

  const selectOptions: SelectOption[] = options.map((opt) => ({
    name: opt.name,
    description: opt.description,
    value: opt,
  }));

  const menu = new SelectRenderable(renderer, {
    id: "config-menu",
    width: "100%",
    height: "100%",
    options: selectOptions,
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    selectedBackgroundColor: "#334155",
    textColor: "#e2e8f0",
    selectedTextColor: "#38bdf8",
    showDescription: false,
    wrapSelection: true,
  });
  menuBox.add(menu);

  menu.on(
    SelectRenderableEvents.ITEM_SELECTED,
    (_index: number, option: SelectOption) => {
      const configOption = option.value as ConfigOption;
      configOption.action();
    },
  );

  menu.focus();

  const instructions = new TextRenderable(renderer, {
    id: "config-instructions",
    content: "Use arrow keys to navigate | Enter to select | Ctrl+C to quit",
    fg: "#64748b",
    marginTop: 2,
  });
  container.add(instructions);

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      renderer.destroy();
      process.exit(0);
    }
  });
}
