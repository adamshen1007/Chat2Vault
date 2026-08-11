// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import Chat2VaultPlugin from "../src/main.js";
import { Chat2VaultView, VIEW_TYPE } from "../src/view.js";

beforeAll(() => {
  HTMLElement.prototype.empty = function (): void {
    this.replaceChildren();
  };
  HTMLElement.prototype.addClass = function (...classes: string[]): void {
    this.classList.add(...classes);
  };
  HTMLElement.prototype.setAttr = function (name: string, value: string): void {
    this.setAttribute(name, value);
  };
  HTMLElement.prototype.createEl = function <
    K extends keyof HTMLElementTagNameMap,
  >(
    tag: K,
    options: {
      cls?: string;
      text?: string;
      type?: string;
      placeholder?: string;
      value?: string;
    } = {},
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (options.cls !== undefined) element.className = options.cls;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type !== undefined && element instanceof HTMLInputElement)
      element.type = options.type;
    if (
      options.placeholder !== undefined &&
      element instanceof HTMLInputElement
    )
      element.placeholder = options.placeholder;
    if (options.value !== undefined && element instanceof HTMLInputElement)
      element.value = options.value;
    this.append(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function (
    options: { cls?: string } = {},
  ): HTMLDivElement {
    return this.createEl("div", options);
  };
});

describe("plugin command lifecycle", () => {
  it("registers without auto-opening, reuses one leaf, and validates only after reveal", async () => {
    const manifest = {
      id: "chat-to-vault",
      name: "Chat2Vault",
      version: "0.2.0",
      minAppVersion: "1.7.4",
      description: "test",
      author: "test",
      isDesktopOnly: true,
    };
    const plugin = new Chat2VaultPlugin({} as App, manifest);
    (plugin as Chat2VaultPlugin & { manifest: typeof manifest }).manifest =
      manifest;
    interface Harness {
      registeredViews: Map<string, (leaf: unknown) => unknown>;
      commands: { id: string; name: string; callback: () => void }[];
      savedData: unknown;
    }
    const harness = plugin as Chat2VaultPlugin & Harness;
    interface TestLeaf {
      view: unknown;
      realView?: Chat2VaultView;
      setViewState(state: { type: string }): Promise<void>;
    }
    const leaves: TestLeaf[] = [];
    let getLeafCalls = 0;
    let revealCalls = 0;
    const workspace = {
      getLeavesOfType: (type: string) => (type === VIEW_TYPE ? leaves : []),
      getLeaf: () => {
        getLeafCalls += 1;
        const leaf: TestLeaf = {
          view: { deferred: true },
          setViewState(state: { type: string }): Promise<void> {
            const factory = harness.registeredViews.get(state.type);
            if (factory === undefined) throw new Error("missing view factory");
            this.realView = factory(this) as Chat2VaultView;
            document.body.append(this.realView.contentEl);
            return Promise.resolve();
          },
        };
        leaves.push(leaf);
        return leaf;
      },
      revealLeaf: async (leaf: (typeof leaves)[number]) => {
        revealCalls += 1;
        if (leaf.realView !== undefined) {
          leaf.view = leaf.realView;
          await leaf.realView.onOpen();
        }
      },
    };
    plugin.app = { workspace } as never;
    await plugin.onload();
    expect(getLeafCalls).toBe(0);
    expect(harness.commands).toHaveLength(1);
    expect(harness.commands[0]).toMatchObject({
      id: "import-chatgpt-export",
      name: "Import ChatGPT export",
    });
    plugin.settings = { schemaVersion: 1, previewMessagesPerPage: 50 };
    await plugin.saveSettings();
    expect(harness.savedData).toEqual({
      schemaVersion: 1,
      previewMessagesPerPage: 50,
    });
    expect(Object.keys(harness.savedData as object)).toEqual([
      "schemaVersion",
      "previewMessagesPerPage",
    ]);
    harness.commands[0]?.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getLeafCalls).toBe(1);
    expect(revealCalls).toBe(1);
    expect(leaves[0]?.view).toBeInstanceOf(Chat2VaultView);
    expect(document.activeElement?.classList.contains("c2v-choose")).toBe(true);
    harness.commands[0]?.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getLeafCalls).toBe(1);
    expect(revealCalls).toBe(2);
    plugin.onunload();
  });
});
