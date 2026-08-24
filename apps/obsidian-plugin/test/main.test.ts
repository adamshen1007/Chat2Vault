// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import Chat2VaultPlugin, {
  resolveNativePluginDirectory,
  sourceWriterPlatformEligible,
} from "../src/main.js";
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
  it.each([
    ["darwin", "x64", true],
    ["darwin", "arm64", false],
    ["win32", "x64", false],
    ["linux", "x64", false],
  ] as const)("gates source writing for %s/%s", (platform, arch, expected) => {
    expect(sourceWriterPlatformEligible(platform, arch)).toBe(expected);
  });

  it("validates every external plugin-directory input before fallback concatenation", () => {
    expect(
      resolveNativePluginDirectory(undefined, "bad\ud800config", "plugin"),
    ).toBeUndefined();
    expect(
      resolveNativePluginDirectory(undefined, ".obsidian", "bad\ud800id"),
    ).toBeUndefined();
    expect(
      resolveNativePluginDirectory("bad\ud800dir", ".obsidian", "plugin"),
    ).toBeUndefined();
    expect(resolveNativePluginDirectory(undefined, ".obsidian", "plugin")).toBe(
      ".obsidian/plugins/plugin",
    );
  });

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
    await plugin.savePreviewMessagesPerPage(50);
    await plugin.saveSourceRoot("Sources");
    expect(harness.savedData).toEqual({
      schemaVersion: 2,
      previewMessagesPerPage: 50,
      sourceRoot: "Sources",
    });
    expect(Object.keys(harness.savedData as object)).toEqual([
      "schemaVersion",
      "previewMessagesPerPage",
      "sourceRoot",
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
    const realView = leaves[0]?.realView as unknown as
      { loaded: boolean; sourceGeneration: number } | undefined;
    expect(realView?.loaded).toBe(true);
    const generationBeforeUnload = realView?.sourceGeneration;
    plugin.onunload();
    expect(realView?.loaded).toBe(false);
    expect(realView?.sourceGeneration).toBe((generationBeforeUnload ?? 0) + 1);
  });

  it.each([
    [
      '{"schemaVersion":1,"previewMessagesPerPage":10}\n',
      { schemaVersion: 1, previewMessagesPerPage: 10 },
    ],
    [
      '{"schemaVersion":2,"previewMessagesPerPage":25,"sourceRoot":"Sources/Café"}\n',
      {
        schemaVersion: 2,
        previewMessagesPerPage: 25,
        sourceRoot: "Sources/Cafe\u0301",
      },
    ],
    [
      '{"schemaVersion":2,"previewMessagesPerPage":25,"sourceRoot":"../escape"}\n',
      { schemaVersion: 2, previewMessagesPerPage: 25, sourceRoot: "../escape" },
    ],
    ['{"schemaVersion":', undefined],
    [
      '{"schemaVersion":99,"future":{"kept":true}}\n',
      { schemaVersion: 99, future: { kept: true } },
    ],
  ] as const)(
    "leaves pre-existing load-only data.json bytes identical for fixture %#",
    async (rawBytes, parsed) => {
      const plugin = new Chat2VaultPlugin({} as App, {
        id: "chat-to-vault",
        name: "Chat2Vault",
        version: "0.3.0",
        minAppVersion: "1.7.4",
        description: "test",
        author: "test",
        isDesktopOnly: true,
      });
      let persistedBytes: string = rawBytes;
      let saves = 0;
      plugin.loadData = () => Promise.resolve(parsed);
      plugin.saveData = (value: unknown) => {
        saves += 1;
        persistedBytes = `${JSON.stringify(value)}\n`;
        return Promise.resolve();
      };
      await plugin.onload();
      expect(persistedBytes).toBe(rawBytes);
      expect(saves).toBe(0);
      plugin.onunload();
    },
  );

  it.each(["fulfill", "reject"] as const)(
    "replaces unsupported future-schema bytes only after an explicit v2 save that will %s",
    async (settlement) => {
      const original = '{"schemaVersion":99,"future":{"kept":true}}\n';
      let persistedBytes = original;
      const plugin = new Chat2VaultPlugin({} as App, {
        id: "chat-to-vault",
        name: "Chat2Vault",
        version: "0.3.0",
        minAppVersion: "1.7.4",
        description: "test",
        author: "test",
        isDesktopOnly: true,
      });
      plugin.loadData = () =>
        Promise.resolve({ schemaVersion: 99, future: { kept: true } });
      plugin.saveData = (value: unknown) => {
        if (settlement === "reject")
          return Promise.reject(new Error("synthetic persistence failure"));
        persistedBytes = `${JSON.stringify(value)}\n`;
        return Promise.resolve();
      };
      await plugin.onload();
      expect(persistedBytes).toBe(original);
      await expect(
        plugin.savePreviewMessagesPerPage(50),
      ).resolves.toMatchObject({
        status: settlement === "fulfill" ? "saved" : "failed",
      });
      expect(persistedBytes).toBe(
        settlement === "fulfill"
          ? '{"schemaVersion":2,"previewMessagesPerPage":50,"sourceRoot":""}\n'
          : original,
      );
      plugin.onunload();
    },
  );
});
