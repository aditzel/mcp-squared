import { afterEach } from "bun:test";
import {
  type Renderable,
  SelectRenderable,
  TextRenderable,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const destroy of cleanup.splice(0)) destroy();
});

export async function createTuiHarness() {
  const testRenderer = await createTestRenderer({
    width: 200,
    height: 80,
    exitOnCtrlC: false,
    kittyKeyboard: true,
  });
  cleanup.push(() => testRenderer.renderer.destroy());
  const find = (id: string): Renderable | undefined => {
    const visit = (node: Renderable): Renderable | undefined => {
      if (node.id === id) return node;
      for (const child of node.getChildren()) {
        const found = visit(child);
        if (found) return found;
      }
      return undefined;
    };
    return visit(testRenderer.renderer.root);
  };
  return {
    ...testRenderer,
    find,
    node<T extends Renderable>(id: string): T {
      const node = find(id);
      if (!node) throw new Error(`Missing rendered node: ${id}`);
      return node as T;
    },
    text(id: string): string {
      const node = find(id);
      if (!(node instanceof TextRenderable)) {
        throw new Error(`Missing rendered text: ${id}`);
      }
      return node.content.chunks.map((chunk) => chunk.text).join("");
    },
    choose(id: string, value: string, name?: string): void {
      const node = find(id);
      if (!(node instanceof SelectRenderable))
        throw new Error(`Missing rendered menu: ${id}`);
      const index = node.options.findIndex((option) =>
        typeof option.value === "string"
          ? option.value === value
          : option.value.action === value &&
            (name === undefined || option.value.name === name),
      );
      if (index < 0) throw new Error(`Missing menu choice: ${value}`);
      node.setSelectedIndex(index);
      node.focus();
      testRenderer.mockInput.pressEnter();
    },
    async frame(): Promise<string> {
      await testRenderer.renderOnce();
      return testRenderer.captureCharFrame();
    },
  };
}

export async function settleTui(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
