import { Plugin } from "obsidian";
import { join } from "node:path";
import {
  isM03WellFormedString,
  sourceWritePlanEqual,
  type CanonicalConversation,
  type SourceDescriptor,
} from "@chat2vault/core";
import {
  createDesktopNativeAdapter,
  isNativePathContained,
  verifyNativeComponent,
} from "./containment.js";
import { ImportController } from "./controller.js";
import { configureNativeObserver } from "./native-observer.js";
import { runImportInWorker } from "./runner.js";
import {
  Chat2VaultSettingTab,
  DEFAULT_SETTINGS,
  type Chat2VaultSettingsV2,
} from "./settings.js";
import {
  readSettings,
  SettingsController,
  type SettingsLoadDiagnostic,
} from "./settings-model.js";
import { Chat2VaultView, VIEW_TYPE } from "./view.js";
import {
  createObsidianSourceVaultIO,
  ObsidianSourceMutationAdapter,
} from "./source-vault-adapter.js";

export function resolveNativePluginDirectory(
  configuredPluginDir: unknown,
  configDir: unknown,
  pluginId: unknown,
): string | undefined {
  if (configuredPluginDir !== undefined)
    return isM03WellFormedString(configuredPluginDir)
      ? configuredPluginDir
      : undefined;
  if (!isM03WellFormedString(configDir) || !isM03WellFormedString(pluginId))
    return undefined;
  return `${configDir}/plugins/${pluginId}`;
}

export function sourceWriterPlatformEligible(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): boolean {
  return platform === "darwin" && arch === "x64";
}

export default class Chat2VaultPlugin extends Plugin {
  public static readonly m03RuntimeEvidence = {
    isNativePathContained,
    verifyNativeComponent,
    sourceWritePlanEqual,
  };
  public override settings: Chat2VaultSettingsV2 = DEFAULT_SETTINGS;
  public settingsLoadDiagnostics: SettingsLoadDiagnostic[] = [];
  private settingsController?: SettingsController;
  private readonly sourceInvalidators = new Set<
    (reason: "settings" | "unload") => void
  >();
  private readonly distillationInvalidators = new Set<() => void>();
  private loaded = false;
  private controller?: ImportController;
  public override async onload(): Promise<void> {
    this.loaded = true;
    const loaded = readSettings(await this.loadData());
    this.settings = loaded.settings;
    this.settingsLoadDiagnostics = loaded.diagnostics;
    this.settingsController = new SettingsController(
      this.settings,
      (settings) => this.saveData(settings),
      () => {
        for (const invalidate of this.sourceInvalidators)
          invalidate("settings");
      },
    );
    this.controller = new ImportController(runImportInWorker);
    const controller = this.controller;
    this.registerView(
      VIEW_TYPE,
      (leaf) =>
        new Chat2VaultView(
          leaf,
          controller,
          () =>
            this.settingsController?.settings.previewMessagesPerPage ??
            this.settings.previewMessagesPerPage,
          {
            sourceRoot: () =>
              this.settingsController?.settings.sourceRoot ??
              this.settings.sourceRoot,
            sourceRootPending: () =>
              this.settingsController?.sourceRootPersistenceState.status ===
              "pending",
            settingsGeneration: () =>
              this.settingsController?.sourceWriteGeneration ?? 0,
            sourceWriterPlatformEligible: () =>
              sourceWriterPlatformEligible(process.platform, process.arch),
            createAdapter: (source, conversation) =>
              this.createSourceAdapter(source, conversation),
            registerInvalidator: (invalidator) => {
              this.sourceInvalidators.add(invalidator);
              return () => this.sourceInvalidators.delete(invalidator);
            },
          },
          {
            writeClipboard: (text) => navigator.clipboard.writeText(text),
            registerInvalidator: (invalidator) => {
              this.distillationInvalidators.add(invalidator);
              return () => this.distillationInvalidators.delete(invalidator);
            },
          },
        ),
    );
    this.addCommand({
      id: "import-chatgpt-export",
      name: "Import ChatGPT export",
      callback: () => {
        void this.openImporter();
      },
    });
    this.addSettingTab(new Chat2VaultSettingTab(this.app, this));
  }
  public override onunload(): void {
    this.loaded = false;
    for (const invalidate of this.sourceInvalidators) invalidate("unload");
    this.sourceInvalidators.clear();
    for (const invalidate of this.distillationInvalidators) invalidate();
    this.distillationInvalidators.clear();
    this.controller?.close();
  }
  public async savePreviewMessagesPerPage(value: unknown) {
    const result =
      await this.settingsController?.savePreviewMessagesPerPage(value);
    if (this.settingsController !== undefined)
      this.settings = this.settingsController.settings;
    return result;
  }
  public async saveSourceRoot(value: unknown) {
    const result = await this.settingsController?.saveSourceRoot(value);
    if (this.settingsController !== undefined)
      this.settings = this.settingsController.settings;
    return result;
  }
  private async openImporter(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (leaf === undefined) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof Chat2VaultView) leaf.view.focusImport();
  }
  private createSourceAdapter(
    source: SourceDescriptor,
    conversation: CanonicalConversation,
  ): ObsidianSourceMutationAdapter {
    const io = createObsidianSourceVaultIO(this.app);
    const configuredPluginDir = this.manifest.dir;
    const configDir = this.app.vault.configDir;
    const pluginId = this.manifest.id;
    const pluginDir = resolveNativePluginDirectory(
      configuredPluginDir,
      configDir,
      pluginId,
    );
    const nativeConfigured =
      io.basePath !== "" &&
      isM03WellFormedString(io.basePath) &&
      pluginDir !== undefined &&
      configureNativeObserver(
        join(
          io.basePath,
          ...pluginDir.split("/"),
          "native",
          "source_observer.node",
        ),
      );
    return new ObsidianSourceMutationAdapter(
      io,
      io.basePath === "" || !nativeConfigured
        ? undefined
        : createDesktopNativeAdapter(),
      source,
      conversation,
      () => this.settings.sourceRoot,
      () =>
        this.settingsController?.sourceRootPersistenceState.status ===
        "pending",
      process.platform,
      () => this.loaded,
    );
  }
}
