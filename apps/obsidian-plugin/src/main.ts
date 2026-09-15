import { Plugin } from "obsidian";
import { isAbsolute, join, normalize } from "node:path";
import {
  isM03WellFormedString,
  sourceWritePlanEqual,
  validateProviderEndpoint,
  validateProviderModel,
  validateProviderOutputCap,
  validateProviderTimeout,
  type CanonicalConversation,
  type M05ProviderConfig,
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
  type Chat2VaultSettingsV3,
  type ProviderSettings,
} from "./settings.js";
import {
  readSettings,
  SettingsController,
  type AnySettingsLoadDiagnostic,
} from "./settings-model.js";
import {
  configureKeychain,
  credentialGenerationForTest,
  credentialStatus,
  deleteCredential,
  readCredentialForOperation,
  refreshCredentialStatus,
  setCredential,
  type CredentialMutationResult,
  type CredentialStatusResult,
} from "./keychain.js";
import { sendOpenAICompatibleRequest } from "./provider-transport.js";
import type { ProviderInvalidationReason } from "./provider-controller.js";
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

export function resolveNativeKeychainPath(
  vaultBasePath: unknown,
  configuredPluginDir: unknown,
  configDir: unknown,
  pluginId: unknown,
): string | undefined {
  if (
    !isM03WellFormedString(vaultBasePath) ||
    !isAbsolute(vaultBasePath) ||
    normalize(vaultBasePath) !== vaultBasePath
  )
    return undefined;
  const pluginDirectory = resolveNativePluginDirectory(
    configuredPluginDir,
    configDir,
    pluginId,
  );
  if (
    pluginDirectory === undefined ||
    isAbsolute(pluginDirectory) ||
    normalize(pluginDirectory) !== pluginDirectory ||
    pluginDirectory === "." ||
    pluginDirectory.split("/").includes("..")
  )
    return undefined;
  return join(vaultBasePath, pluginDirectory, "native", "keychain.node");
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
  public override settings = undefined as unknown as Chat2VaultSettingsV3;
  public settingsLoadDiagnostics: AnySettingsLoadDiagnostic[] = [];
  private settingsController?: SettingsController;
  private readonly sourceInvalidators = new Set<
    (reason: "settings" | "unload") => void
  >();
  private readonly distillationInvalidators = new Set<() => void>();
  private readonly providerInvalidators = new Set<
    (reason: ProviderInvalidationReason) => void
  >();
  private readonly providerStateObservers = new Set<() => void>();
  private providerCredentialState:
    "unknown" | "configured" | "missing" | "unavailable" = "unknown";
  private pluginGeneration = 0;
  private loaded = false;
  private controller?: ImportController;
  public override async onload(): Promise<void> {
    this.loaded = true;
    const loadGeneration = ++this.pluginGeneration;
    const loaded = readSettings(await this.loadData());
    if (!this.isCurrentLoad(loadGeneration)) return;
    this.settings = loaded.settings;
    this.settingsLoadDiagnostics = loaded.diagnostics;
    this.settingsController = new SettingsController(
      loaded,
      (settings) => this.saveData(settings),
      () => {
        for (const invalidate of this.sourceInvalidators)
          invalidate("settings");
      },
      {
        onIdentityAuthorized: (installationId) => {
          if (this.isCurrentLoad(loadGeneration))
            this.initializeProviderIdentity(installationId, loadGeneration);
        },
        invalidateProviderOwnerAndAbort: () => {
          if (this.isCurrentLoad(loadGeneration)) {
            this.invalidateProvider("provider-settings-save");
            this.notifyProviderStateObservers();
          }
        },
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
          {
            current: () => this.providerCurrent(),
            readCredential: readCredentialForOperation,
            transport: sendOpenAICompatibleRequest,
            observeCredentialOnViewOpen: () =>
              this.isCurrentLoad(loadGeneration) &&
              this.settingsController?.identityState === "authoritative"
                ? credentialStatus()
                : { ok: true, status: "unavailable" },
            registerInvalidator: (invalidator) => {
              this.providerInvalidators.add(invalidator);
              return () => this.providerInvalidators.delete(invalidator);
            },
            registerStateObserver: (observer) => {
              return this.registerStateObserver(observer);
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
    if (loaded.identityState === "authoritative")
      this.initializeProviderIdentity(
        loaded.settings.installationId,
        loadGeneration,
      );
    else if (loaded.identityState === "pending") {
      const controllerAtLoad = this.settingsController;
      void controllerAtLoad.initializeIdentity().then(() => {
        if (
          this.isCurrentLoad(loadGeneration) &&
          this.settingsController === controllerAtLoad
        ) {
          this.settings = controllerAtLoad.settings;
          this.notifyProviderStateObservers();
        }
      });
    }
  }
  public override onunload(): void {
    this.loaded = false;
    this.pluginGeneration += 1;
    for (const invalidate of this.sourceInvalidators) invalidate("unload");
    this.sourceInvalidators.clear();
    for (const invalidate of this.distillationInvalidators) invalidate();
    this.distillationInvalidators.clear();
    this.invalidateProvider("plugin-unload");
    this.providerInvalidators.clear();
    this.providerStateObservers.clear();
    this.settingsController?.discardUnpersistedIdentityOnUnload();
    this.controller?.close();
  }
  public get identityState() {
    return this.settingsController?.identityState ?? "failed";
  }
  public get credentialState() {
    return this.providerCredentialState;
  }
  public get providerSettingsStatusCode() {
    return this.settingsController?.providerSettingsStatusCode;
  }
  public get providerDraft(): ProviderSettings {
    return (
      this.settingsController?.providerDraft ?? { ...this.settings.provider }
    );
  }
  public setProviderDraft(draft: ProviderSettings): void {
    this.settingsController?.setProviderDraft(draft);
  }
  public registerStateObserver(observer: () => void): () => void {
    this.providerStateObservers.add(observer);
    return () => this.providerStateObservers.delete(observer);
  }
  public async saveProviderSettings() {
    const controller = this.settingsController;
    if (controller === undefined) return undefined;
    const result = await controller.saveProviderSettings(
      controller.providerDraft,
    );
    if (this.settingsController === controller && this.loaded) {
      this.settings = controller.settings;
      if (result.status === "saved" || result.status === "failed")
        this.notifyProviderStateObservers();
    }
    return result;
  }
  public async retryProviderInitialization() {
    const controller = this.settingsController;
    if (controller === undefined) return undefined;
    const generation = this.pluginGeneration;
    const pending = controller.retryProviderInitialization();
    if (this.isCurrentLoad(generation)) this.notifyProviderStateObservers();
    const result = await pending;
    if (
      this.isCurrentLoad(generation) &&
      this.settingsController === controller
    ) {
      this.settings = controller.settings;
      this.notifyProviderStateObservers();
    }
    return result;
  }
  public setProviderCredential(secret: unknown): CredentialMutationResult {
    return setCredential(secret);
  }
  public deleteProviderCredential(): CredentialMutationResult {
    return deleteCredential();
  }
  public refreshProviderCredential(): CredentialStatusResult {
    return refreshCredentialStatus();
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
  private initializeProviderIdentity(
    installationId: string,
    loadGeneration: number,
  ): void {
    if (!this.isCurrentLoad(loadGeneration)) return;
    const io = createObsidianSourceVaultIO(this.app);
    const nativePath = resolveNativeKeychainPath(
      io.basePath,
      this.manifest.dir,
      this.app.vault.configDir,
      this.manifest.id,
    );
    configureKeychain(nativePath ?? "", installationId, {
      invalidateProviderOwnerAndAbort: () => {
        if (this.isCurrentLoad(loadGeneration))
          this.invalidateProvider("credential-change");
      },
      onCredentialState: (state) => {
        if (!this.isCurrentLoad(loadGeneration)) return;
        this.providerCredentialState = state;
        this.notifyProviderStateObservers();
      },
    });
    if (!this.isCurrentLoad(loadGeneration)) return;
    const observed = credentialStatus();
    if (this.isCurrentLoad(loadGeneration) && observed.ok)
      this.providerCredentialState = observed.status;
  }
  private isCurrentLoad(generation: number): boolean {
    return this.loaded && this.pluginGeneration === generation;
  }
  private notifyProviderStateObservers(): void {
    for (const observe of this.providerStateObservers) observe();
  }
  private invalidateProvider(reason: ProviderInvalidationReason): void {
    for (const invalidate of this.providerInvalidators) invalidate(reason);
  }
  private providerConfig(): M05ProviderConfig | undefined {
    const provider = this.settingsController?.settings.provider;
    if (provider === undefined) return undefined;
    const endpoint = validateProviderEndpoint(provider.endpoint);
    const model = validateProviderModel(provider.model);
    const timeout = validateProviderTimeout(provider.timeoutMs);
    const output = validateProviderOutputCap(provider.maxOutputTokens);
    return endpoint.ok && model.ok && timeout.ok && output.ok
      ? {
          endpoint: endpoint.endpoint,
          hostname: endpoint.hostname,
          port: endpoint.port,
          model: model.model,
          timeoutMs: timeout.timeoutMs,
          maxOutputTokens: output.maxOutputTokens,
        }
      : undefined;
  }
  private providerCurrent() {
    const controller = this.settingsController;
    const config = this.providerConfig();
    return {
      platformEligible: sourceWriterPlatformEligible(
        process.platform,
        process.arch,
      ),
      unsupportedFutureSettings:
        controller?.identityState === "unsupported-future",
      identityState:
        controller?.identityState === "authoritative"
          ? ("authoritative" as const)
          : controller?.identityState === "saving" ||
              controller?.identityState === "pending"
            ? ("saving" as const)
            : ("failed" as const),
      credentialState: this.providerCredentialState,
      credentialOperationInProgress: false,
      providerSettingsSaving:
        controller?.providerSettingsPersistenceState.status === "saving",
      ...(controller?.providerSettingsStatusCode === undefined
        ? {}
        : {
            providerSettingsStatusCode: controller.providerSettingsStatusCode,
          }),
      cloudDisclosureAccepted:
        controller?.settings.provider.cloudDisclosureAccepted ?? false,
      pluginGeneration: this.pluginGeneration,
      providerSettingsGeneration: controller?.providerSettingsGeneration ?? 0,
      providerSaveGeneration: controller?.providerSaveGeneration ?? 0,
      credentialGeneration: credentialGenerationForTest(),
      ...(config === undefined ? {} : { config }),
    };
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
