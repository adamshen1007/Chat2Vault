// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-deprecated -- tests exercise the Obsidian 1.7.4 display contract. */
import { beforeAll, describe, expect, it } from "vitest";
import { PluginSettingTab, Setting, type App } from "obsidian";
import Chat2VaultPlugin, {
  resolveNativePluginDirectory,
  resolveNativeKeychainPath,
  sourceWriterPlatformEligible,
} from "../src/main.js";
import { Chat2VaultView, VIEW_TYPE } from "../src/view.js";
import { Chat2VaultSettingTab } from "../src/settings.js";
import { readSettings, SettingsController } from "../src/settings-model.js";

beforeAll(() => {
  PluginSettingTab.prototype.hide = function (): void {
    this.containerEl.replaceChildren();
  };
  (
    Setting.prototype as unknown as {
      addText(builder: (text: unknown) => void): Setting;
    }
  ).addText = function (builder: (text: unknown) => void): Setting {
    builder({
      setValue() {
        return this;
      },
      setPlaceholder() {
        return this;
      },
      onChange() {
        return this;
      },
      setDisabled() {
        return this;
      },
    });
    return this as unknown as Setting;
  };
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
  it("renders the exact provider disclosure, five draft controls, and Keychain actions without identity or secret leakage", () => {
    const owner = {
      settings: {
        schemaVersion: 3 as const,
        installationId: "11111111-1111-4111-8111-111111111111",
        previewMessagesPerPage: 25 as const,
        sourceRoot: "",
        provider: {
          endpoint: "https://m05.invalid/v1/chat/completions",
          model: "synthetic-m05-model",
          timeoutMs: 60_000 as const,
          maxOutputTokens: 4_096,
          cloudDisclosureAccepted: false,
        },
      },
      identityState: "authoritative" as const,
      credentialState: "missing" as const,
      providerDraft: {
        endpoint: "https://m05.invalid/v1/chat/completions",
        model: "synthetic-m05-model",
        timeoutMs: 60_000 as const,
        maxOutputTokens: 4_096,
        cloudDisclosureAccepted: false,
      },
      savePreviewMessagesPerPage: () =>
        Promise.resolve({ status: "saved" as const }),
      saveSourceRoot: () => Promise.resolve({ status: "saved" as const }),
      setProviderDraft: () => undefined,
      saveProviderSettings: () => Promise.resolve({ status: "saved" as const }),
      retryProviderInitialization: () =>
        Promise.resolve({ status: "saved" as const }),
      setProviderCredential: () => ({
        ok: true as const,
        status: "configured" as const,
      }),
      deleteProviderCredential: () => ({
        ok: true as const,
        status: "missing" as const,
      }),
      refreshProviderCredential: () => ({
        ok: true as const,
        status: "missing" as const,
      }),
    };
    const tab = new Chat2VaultSettingTab({} as App, owner as never);
    expect(tab.getSettingDefinitions()).toEqual([]);
    document.body.append(tab.containerEl);
    tab.display();

    expect(tab.containerEl.textContent).toContain(
      "Cloud distillation sends the complete selected conversation to the configured provider endpoint. The provider may retain, process, or bill for this data under its own terms. Chat2Vault does not verify the provider's identity, privacy policy, prices, or model behavior.",
    );
    expect(tab.containerEl.textContent).toContain(
      "M05 connects only to DNS hostnames that resolve entirely to permitted public IPv4 addresses. IPv6-only, IP-literal, local, and private-network endpoints are unavailable.",
    );
    expect(tab.containerEl.textContent).toContain(
      "Chat2Vault stores one API key as a generic-password item in the current local macOS user's default file-based Keychain, normally the login Keychain. Access is governed by that Keychain and the Obsidian host identity. Copies of the same plugin data on this Mac share the persisted installation identity. Delete the key before clearing the plugin data to avoid leaving an orphaned Keychain item.",
    );
    expect(
      tab.containerEl.querySelectorAll(".c2v-provider-draft-control"),
    ).toHaveLength(5);
    expect(
      tab.containerEl.querySelector<HTMLInputElement>('input[type="password"]')
        ?.autocomplete,
    ).toBe("off");
    for (const label of [
      "Save provider settings",
      "Save API key",
      "Delete API key",
      "Refresh Keychain status",
    ])
      expect(tab.containerEl.textContent).toContain(label);
    expect(
      Array.from(
        tab.containerEl.querySelectorAll<HTMLElement>(
          ".c2v-provider-settings input, .c2v-provider-settings select, .c2v-provider-settings button",
        ),
      ).map(
        (control) =>
          control.getAttribute("aria-label") ?? control.textContent.trim(),
      ),
    ).toEqual([
      "Provider endpoint",
      "Provider model",
      "Provider timeout",
      "Maximum output tokens",
      "Accept cloud data disclosure",
      "Save provider settings",
      "Provider API key",
      "Save API key",
      "Delete API key",
      "Refresh Keychain status",
    ]);
    expect(tab.containerEl.textContent).not.toContain(
      owner.settings.installationId,
    );
    const endpoint = tab.containerEl.querySelector<HTMLInputElement>(
      '[aria-label="Provider endpoint"]',
    );
    const disclosure = tab.containerEl.querySelector<HTMLInputElement>(
      '[aria-label="Accept cloud data disclosure"]',
    );
    if (endpoint === null || disclosure === null)
      throw new Error("missing provider draft controls");
    disclosure.checked = true;
    endpoint.value = "https://changed.invalid/v1/chat/completions";
    endpoint.dispatchEvent(new Event("change"));
    expect(disclosure.checked).toBe(false);
    const key = tab.containerEl.querySelector<HTMLInputElement>(
      '[aria-label="Provider API key"]',
    );
    if (key === null) throw new Error("missing key control");
    key.value = "synthetic-key-never-render";
    Array.from(tab.containerEl.querySelectorAll("button"))
      .find((button) => button.textContent === "Save API key")
      ?.click();
    expect(key.value).toBe("");
    expect(tab.containerEl.textContent).not.toContain(
      "synthetic-key-never-render",
    );
  });

  it("preserves credential diagnostics, focus, and one live node through synchronous observer redraws", () => {
    let observer: (() => void) | undefined;
    let credentialState: "unknown" | "configured" = "configured";
    let mutation: "success" | "no-change-failure" | "indeterminate-failure" =
      "success";
    const notify = (next: "unknown" | "configured"): void => {
      credentialState = next;
      observer?.();
    };
    const owner = {
      settings: {
        schemaVersion: 3 as const,
        installationId: "11111111-1111-4111-8111-111111111111",
        previewMessagesPerPage: 25 as const,
        sourceRoot: "",
        provider: {
          endpoint: "https://m05.invalid/v1/chat/completions",
          model: "synthetic-m05-model",
          timeoutMs: 60_000 as const,
          maxOutputTokens: 4_096,
          cloudDisclosureAccepted: true,
        },
      },
      identityState: "authoritative" as const,
      get credentialState() {
        return credentialState;
      },
      providerDraft: {
        endpoint: "https://m05.invalid/v1/chat/completions",
        model: "synthetic-m05-model",
        timeoutMs: 60_000 as const,
        maxOutputTokens: 4_096,
        cloudDisclosureAccepted: true,
      },
      savePreviewMessagesPerPage: () =>
        Promise.resolve({ status: "unchanged" as const }),
      saveSourceRoot: () => Promise.resolve({ status: "unchanged" as const }),
      setProviderDraft: () => undefined,
      saveProviderSettings: () =>
        Promise.resolve({ status: "unchanged" as const }),
      retryProviderInitialization: () =>
        Promise.resolve({ status: "unchanged" as const }),
      setProviderCredential: () => {
        notify("unknown");
        if (mutation === "success") {
          notify("configured");
          return { ok: true as const, status: "configured" as const };
        }
        if (mutation === "no-change-failure") {
          notify("configured");
          return { ok: false as const, code: "KEYCHAIN_SAVE_FAILED" as const };
        }
        return {
          ok: false as const,
          code: "KEYCHAIN_VERIFICATION_FAILED" as const,
        };
      },
      deleteProviderCredential: () => ({
        ok: true as const,
        status: "missing" as const,
      }),
      refreshProviderCredential: () => {
        notify("configured");
        return { ok: true as const, status: "configured" as const };
      },
      registerStateObserver: (next: () => void) => {
        observer = next;
        return () => {
          observer = undefined;
        };
      },
    };
    const tab = new Chat2VaultSettingTab({} as App, owner as never);
    document.body.append(tab.containerEl);
    tab.display();
    const live = tab.containerEl.querySelector(".c2v-provider-status");
    const action = (text: string): HTMLButtonElement => {
      const button = Array.from(
        tab.containerEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find((candidate) => candidate.textContent === text);
      if (button === undefined) throw new Error(`Missing ${text}`);
      button.focus();
      button.click();
      return button;
    };

    action("Save API key");
    expect(tab.containerEl.querySelector(".c2v-provider-status")).toBe(live);
    expect(live?.textContent).toBe("");
    expect(document.activeElement?.textContent).toBe("Save API key");
    expect(tab.containerEl.textContent).toContain(
      "Keychain status: configured",
    );

    mutation = "no-change-failure";
    action("Save API key");
    expect(tab.containerEl.querySelector(".c2v-provider-status")).toBe(live);
    expect(live?.textContent).toBe("The provider API key was not saved.");
    expect(document.activeElement?.textContent).toBe("Save API key");

    mutation = "indeterminate-failure";
    action("Save API key");
    expect(tab.containerEl.querySelector(".c2v-provider-status")).toBe(live);
    expect(live?.textContent).toBe(
      "The provider API key change could not be verified.",
    );
    expect(tab.containerEl.textContent).toContain("Keychain status: unknown");
    expect(document.activeElement?.textContent).toBe("Save API key");

    credentialState = "configured";
    action("Refresh Keychain status");
    expect(tab.containerEl.querySelector(".c2v-provider-status")).toBe(live);
    expect(live?.textContent).toBe("");
    expect(document.activeElement?.textContent).toBe("Refresh Keychain status");
  });

  it("shows only the fixed initialization failure and retry action on the M05 settings surface", () => {
    const owner = {
      settings: {
        schemaVersion: 3,
        installationId: "11111111-1111-4111-8111-111111111111",
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider: {
          endpoint: "",
          model: "",
          timeoutMs: 60_000,
          maxOutputTokens: 4_096,
          cloudDisclosureAccepted: false,
        },
      },
      identityState: "failed",
      credentialState: "unknown",
      providerDraft: {
        endpoint: "",
        model: "",
        timeoutMs: 60_000,
        maxOutputTokens: 4_096,
        cloudDisclosureAccepted: false,
      },
      savePreviewMessagesPerPage: () =>
        Promise.resolve({ status: "unchanged" }),
      saveSourceRoot: () => Promise.resolve({ status: "unchanged" }),
      retryProviderInitialization: () =>
        Promise.resolve({
          status: "failed",
          code: "PROVIDER_IDENTITY_SAVE_FAILED",
        }),
    };
    const tab = new Chat2VaultSettingTab({} as App, owner as never);
    tab.display();
    const provider = tab.containerEl.querySelector(".c2v-provider-settings");
    expect(provider?.textContent).toBe(
      "Cloud providerProvider installation identity could not be saved.Retry provider initialization",
    );
    expect(provider?.querySelectorAll("button")).toHaveLength(1);
    expect(provider?.querySelector("input, select")).toBeNull();
  });

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

  it("resolves keychain.node only beneath the validated absolute vault plugin directory", () => {
    expect(
      resolveNativeKeychainPath(
        "/Users/synthetic/Vault",
        undefined,
        ".obsidian",
        "chat-to-vault",
      ),
    ).toBe(
      "/Users/synthetic/Vault/.obsidian/plugins/chat-to-vault/native/keychain.node",
    );
    expect(
      resolveNativeKeychainPath(
        "/Users/synthetic/Vault",
        ".obsidian/plugins/chat-to-vault",
        ".ignored",
        "ignored",
      ),
    ).toBe(
      "/Users/synthetic/Vault/.obsidian/plugins/chat-to-vault/native/keychain.node",
    );
    for (const inputs of [
      ["relative-vault", undefined, ".obsidian", "chat-to-vault"],
      ["/Users/synthetic/Vault", "../sibling", ".obsidian", "chat-to-vault"],
      ["/Users/synthetic/Vault", "/tmp/plugin", ".obsidian", "chat-to-vault"],
      ["/Users/synthetic/Vault", undefined, "../config", "chat-to-vault"],
      ["/Users/synthetic/Vault", undefined, ".obsidian", "bad\ud800id"],
    ] as const)
      expect(
        resolveNativeKeychainPath(inputs[0], inputs[1], inputs[2], inputs[3]),
      ).toBeUndefined();
  });

  it("redraws an open settings pane when identity authority settles and unsubscribes when hidden", () => {
    let observer: (() => void) | undefined;
    const owner = {
      settings: {
        schemaVersion: 3,
        installationId: "11111111-1111-4111-8111-111111111111",
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider: {
          endpoint: "",
          model: "",
          timeoutMs: 60_000,
          maxOutputTokens: 4_096,
          cloudDisclosureAccepted: false,
        },
      },
      identityState: "saving",
      credentialState: "unknown",
      providerDraft: {
        endpoint: "",
        model: "",
        timeoutMs: 60_000,
        maxOutputTokens: 4_096,
        cloudDisclosureAccepted: false,
      },
      registerStateObserver: (next: () => void) => {
        observer = next;
        return () => {
          observer = undefined;
        };
      },
    };
    const tab = new Chat2VaultSettingTab({} as App, owner as never);
    tab.display();
    expect(tab.containerEl.textContent).toContain(
      "Provider installation identity is being saved.",
    );
    owner.identityState = "failed";
    observer?.();
    expect(tab.containerEl.textContent).toContain(
      "Provider installation identity could not be saved.",
    );
    expect(tab.containerEl.textContent).toContain(
      "Retry provider initialization",
    );
    tab.hide();
    expect(observer).toBeUndefined();
  });

  it("invalidates exactly once only for each accepted provider save and publishes saving before invalidation", async () => {
    const provider = {
      endpoint: "https://m05.invalid/v1/chat/completions",
      model: "synthetic-m05-model",
      timeoutMs: 60_000 as const,
      maxOutputTokens: 4_096,
      cloudDisclosureAccepted: true,
    };
    const plugin = new Chat2VaultPlugin({} as App, {
      id: "chat-to-vault",
      name: "Chat2Vault",
      version: "0.3.0",
      minAppVersion: "1.7.4",
      description: "test",
      author: "test",
      isDesktopOnly: true,
    });
    let settle!: (value?: void | PromiseLike<void>) => void;
    let persistenceMode: "deferred" | "reject" = "deferred";
    const invalidationStates: string[] = [];
    const pluginIntegration = plugin as unknown as {
      invalidateProvider(reason: "provider-settings-save"): void;
      notifyProviderStateObservers(): void;
      providerInvalidators: Set<() => void>;
    };
    const controller = new SettingsController(
      readSettings({
        schemaVersion: 3,
        installationId: "11111111-1111-4111-8111-111111111111",
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider,
      }),
      () =>
        new Promise<void>((resolve, rejectPromise) => {
          settle = resolve;
          if (persistenceMode === "reject") queueMicrotask(rejectPromise);
        }),
      () => undefined,
      {
        invalidateProviderOwnerAndAbort: () => {
          pluginIntegration.invalidateProvider("provider-settings-save");
          pluginIntegration.notifyProviderStateObservers();
        },
      },
    );
    const harness = plugin as unknown as {
      loaded: boolean;
      settingsController: SettingsController;
    };
    harness.loaded = true;
    harness.settingsController = controller;
    plugin.settings = controller.settings;
    pluginIntegration.providerInvalidators.add(() => {
      invalidationStates.push(
        `${controller.providerSettingsPersistenceState.status}:${String(controller.providerSettingsStatusCode)}`,
      );
    });
    const tab = new Chat2VaultSettingTab({} as App, plugin);
    document.body.append(tab.containerEl);
    tab.display();

    controller.setProviderDraft({ ...provider, timeoutMs: 7 } as never);
    await expect(plugin.saveProviderSettings()).resolves.toMatchObject({
      status: "invalid",
    });
    expect(invalidationStates).toEqual([]);
    expect(plugin.providerSettingsStatusCode).toBeUndefined();

    controller.setProviderDraft({ ...provider, model: "accepted" });
    const accepted = plugin.saveProviderSettings();
    expect(invalidationStates).toEqual(["saving:PROVIDER_SETTINGS_SAVING"]);
    expect(plugin.providerSettingsStatusCode).toBe("PROVIDER_SETTINGS_SAVING");
    expect(tab.containerEl.textContent).toContain(
      "Provider settings are being saved.",
    );
    expect(
      Array.from(
        tab.containerEl.querySelectorAll<HTMLInputElement>(
          ".c2v-provider-settings input, .c2v-provider-settings select, .c2v-provider-settings button",
        ),
      ).every((control) => control.disabled),
    ).toBe(true);
    await expect(plugin.saveProviderSettings()).resolves.toMatchObject({
      status: "in-progress",
    });
    expect(invalidationStates).toHaveLength(1);
    settle();
    await expect(accepted).resolves.toEqual({ status: "saved" });
    expect(invalidationStates).toHaveLength(1);
    expect(plugin.providerSettingsStatusCode).toBeUndefined();
    expect(tab.containerEl.textContent).not.toContain(
      "Provider settings are being saved.",
    );

    persistenceMode = "reject";
    controller.setProviderDraft({ ...provider, model: "failure" });
    await expect(plugin.saveProviderSettings()).resolves.toEqual({
      status: "failed",
      code: "PROVIDER_SETTINGS_SAVE_FAILED",
    });
    expect(plugin.providerSettingsStatusCode).toBe(
      "PROVIDER_SETTINGS_SAVE_FAILED",
    );
    expect(tab.containerEl.textContent).toContain(
      "Provider settings could not be saved.",
    );
    expect(invalidationStates).toEqual([
      "saving:PROVIDER_SETTINGS_SAVING",
      "saving:PROVIDER_SETTINGS_SAVING",
    ]);
  });

  it("drops a deferred identity settlement after unload without publishing authority", async () => {
    let settle!: () => void;
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
      Promise.resolve({
        schemaVersion: 2,
        previewMessagesPerPage: 25,
        sourceRoot: "",
      });
    plugin.saveData = () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      });
    await plugin.onload();
    expect(plugin.identityState).toBe("saving");
    plugin.onunload();
    settle();
    await Promise.resolve();
    expect(plugin.credentialState).toBe("unknown");
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
    expect(harness.savedData).toMatchObject({
      schemaVersion: 3,
      previewMessagesPerPage: 50,
      sourceRoot: "Sources",
      provider: {
        endpoint: "",
        model: "",
        timeoutMs: 60_000,
        maxOutputTokens: 4_096,
        cloudDisclosureAccepted: false,
      },
    });
    expect(Object.keys(harness.savedData as object)).toEqual([
      "schemaVersion",
      "installationId",
      "previewMessagesPerPage",
      "sourceRoot",
      "provider",
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
    "migrates supported/safe-default settings to v3 and leaves a future schema byte-identical for fixture %#",
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
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (parsed?.schemaVersion === 99) {
        expect(persistedBytes).toBe(rawBytes);
        expect(saves).toBe(0);
      } else {
        expect(JSON.parse(persistedBytes)).toMatchObject({
          schemaVersion: 3,
          provider: {
            endpoint: "",
            model: "",
            timeoutMs: 60_000,
            maxOutputTokens: 4_096,
            cloudDisclosureAccepted: false,
          },
        });
        expect(saves).toBe(1);
      }
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
