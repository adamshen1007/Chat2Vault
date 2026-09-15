/* eslint-disable @typescript-eslint/no-deprecated -- Obsidian 1.7.4 requires PluginSettingTab.display(). */
import { M05_DIAGNOSTICS, validateProviderEndpoint } from "@chat2vault/core";
import {
  App,
  PluginSettingTab,
  Setting,
  type Plugin,
  type SettingDefinitionItem,
} from "obsidian";
import type {
  CredentialMutationResult,
  CredentialStatusResult,
} from "./keychain.js";
import {
  DEFAULT_SETTINGS,
  type Chat2VaultSettingsV3,
  type IdentityState,
  type ProviderInitializationResult,
  type ProviderSettings,
  type ProviderSettingsSaveResult,
  type SettingsSaveResult,
} from "./settings-model.js";

export { DEFAULT_SETTINGS, type Chat2VaultSettingsV3, type ProviderSettings };

const CLOUD_DISCLOSURE =
  "Cloud distillation sends the complete selected conversation to the configured provider endpoint. The provider may retain, process, or bill for this data under its own terms. Chat2Vault does not verify the provider's identity, privacy policy, prices, or model behavior.";
const ENDPOINT_NOTICE =
  "M05 connects only to DNS hostnames that resolve entirely to permitted public IPv4 addresses. IPv6-only, IP-literal, local, and private-network endpoints are unavailable.";
const CREDENTIAL_NOTICE =
  "Chat2Vault stores one API key as a generic-password item in the current local macOS user's default file-based Keychain, normally the login Keychain. Access is governed by that Keychain and the Obsidian host identity. Copies of the same plugin data on this Mac share the persisted installation identity. Delete the key before clearing the plugin data to avoid leaving an orphaned Keychain item.";
type CredentialState = "unknown" | "configured" | "missing" | "unavailable";
type ProviderCode =
  keyof typeof M05_DIAGNOSTICS | "UNSUPPORTED_SETTINGS_SCHEMA";

interface SettingsOwner extends Plugin {
  settings: Chat2VaultSettingsV3;
  identityState: IdentityState | "saving" | "failed";
  credentialState: CredentialState;
  providerSettingsStatusCode:
    "PROVIDER_SETTINGS_SAVING" | "PROVIDER_SETTINGS_SAVE_FAILED" | undefined;
  providerDraft: ProviderSettings;
  savePreviewMessagesPerPage(
    value: unknown,
  ): Promise<SettingsSaveResult | undefined>;
  saveSourceRoot(value: unknown): Promise<SettingsSaveResult | undefined>;
  setProviderDraft(draft: ProviderSettings): void;
  saveProviderSettings(): Promise<ProviderSettingsSaveResult | undefined>;
  retryProviderInitialization(): Promise<
    ProviderInitializationResult | undefined
  >;
  setProviderCredential(secret: unknown): CredentialMutationResult;
  deleteProviderCredential(): CredentialMutationResult;
  refreshProviderCredential(): CredentialStatusResult;
  registerStateObserver?(observer: () => void): () => void;
}

function resultCode(
  result:
    | ProviderSettingsSaveResult
    | ProviderInitializationResult
    | CredentialMutationResult
    | CredentialStatusResult
    | undefined,
): ProviderCode | undefined {
  return result !== undefined && "code" in result ? result.code : undefined;
}
function messageFor(code: ProviderCode | undefined): string {
  if (code === undefined) return "";
  return code === "UNSUPPORTED_SETTINGS_SCHEMA"
    ? "The saved Chat2Vault settings schema is unsupported; safe defaults were loaded in memory."
    : M05_DIAGNOSTICS[code].message;
}

export class Chat2VaultSettingTab extends PluginSettingTab {
  private unregisterStateObserver: (() => void) | undefined;
  private readonly providerStatusRegion: HTMLParagraphElement;
  private credentialResultCode: ProviderCode | undefined;
  public constructor(
    app: App,
    private readonly owner: SettingsOwner,
  ) {
    super(app, owner);
    this.providerStatusRegion =
      this.containerEl.ownerDocument.createElement("p");
    this.providerStatusRegion.className = "c2v-provider-status";
    this.providerStatusRegion.setAttribute("role", "status");
    this.providerStatusRegion.setAttribute("aria-live", "polite");
    this.providerStatusRegion.setAttribute("aria-atomic", "true");
  }
  public override getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }
  public override display(): void {
    if (
      this.unregisterStateObserver === undefined &&
      this.owner.registerStateObserver !== undefined
    )
      this.unregisterStateObserver = this.owner.registerStateObserver(() =>
        this.redrawFromObservedState(),
      );
    this.containerEl.empty();
    this.drawM03Settings();
    this.drawProviderSettings();
  }
  public override hide(): void {
    this.unregisterStateObserver?.();
    this.unregisterStateObserver = undefined;
    super.hide();
  }

  private redrawFromObservedState(): void {
    const active =
      document.activeElement instanceof HTMLElement &&
      this.containerEl.contains(document.activeElement)
        ? document.activeElement
        : undefined;
    const ariaLabel = active?.getAttribute("aria-label") ?? undefined;
    const buttonText =
      active instanceof HTMLButtonElement ? active.textContent : undefined;
    this.display();
    const replacement =
      ariaLabel === undefined
        ? buttonText === undefined
          ? undefined
          : Array.from(this.containerEl.querySelectorAll("button")).find(
              (button) => button.textContent === buttonText,
            )
        : this.containerEl.querySelector<HTMLElement>(
            `[aria-label=${JSON.stringify(ariaLabel)}]`,
          );
    replacement?.focus();
  }

  private drawM03Settings(): void {
    const showResult = (
      target: HTMLElement,
      result: SettingsSaveResult | undefined,
    ): void => {
      target.textContent =
        result !== undefined && "message" in result ? result.message : "";
      target.classList.toggle(
        "c2v-error",
        result?.status === "invalid" || result?.status === "failed",
      );
      target.setAttribute("aria-live", "polite");
    };
    const previewStatus = this.containerEl.createEl("p");
    new Setting(this.containerEl)
      .setName("Messages per preview page")
      .setDesc("Maximum messages mounted for the selected conversation.")
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({ "10": "10", "25": "25", "50": "50" })
          .setValue(String(this.owner.settings.previewMessagesPerPage))
          .onChange(async (value) => {
            dropdown.setDisabled(true);
            try {
              showResult(
                previewStatus,
                await this.owner.savePreviewMessagesPerPage(Number(value)),
              );
            } finally {
              dropdown.setDisabled(false);
            }
          });
      });
    const sourceStatus = this.containerEl.createEl("p");
    this.containerEl.createEl("p", {
      text: "Source notes are created only after you Preview and explicitly choose Save source note.",
    });
    this.containerEl.createEl("p", {
      text: "Changing this folder does not move, rename, delete, or modify existing source notes or folders.",
    });
    this.containerEl.createEl("p", {
      text: "Environmental and physical eligibility is checked again during Preview and Save; an unsafe or unavailable folder remains visible here but cannot be written.",
    });
    new Setting(this.containerEl)
      .setName("Source folder")
      .setDesc("Vault-relative folder used for create-only source notes.")
      .addText((text) => {
        text
          .setValue(this.owner.settings.sourceRoot)
          .setPlaceholder("Sources/AI conversations")
          .onChange(async (value) => {
            text.setDisabled(true);
            try {
              showResult(sourceStatus, await this.owner.saveSourceRoot(value));
            } finally {
              text.setDisabled(false);
            }
          });
      });
  }

  private drawProviderSettings(): void {
    const state = this.owner.identityState;
    const panel = this.containerEl.createEl("section", {
      cls: "c2v-provider-settings",
    });
    panel.createEl("h3", { text: "Cloud provider" });
    if (state !== "authoritative") {
      const code: ProviderCode =
        state === "failed"
          ? "PROVIDER_IDENTITY_SAVE_FAILED"
          : state === "unsupported-future"
            ? "UNSUPPORTED_SETTINGS_SCHEMA"
            : "PROVIDER_IDENTITY_SAVING";
      this.updateProviderStatus(code);
      panel.append(this.providerStatusRegion);
      if (state === "failed") {
        const retry = panel.createEl("button", {
          text: "Retry provider initialization",
        });
        retry.addEventListener("click", () => {
          void this.retryInitialization(retry);
        });
      }
      return;
    }

    const draft = this.owner.providerDraft;
    const providerSaving =
      this.owner.providerSettingsStatusCode === "PROVIDER_SETTINGS_SAVING";
    const controls = panel.createDiv({ cls: "c2v-provider-controls" });
    const endpoint = this.input(
      controls,
      "Provider endpoint",
      "text",
      draft.endpoint,
    );
    controls.createEl("p", {
      cls: "c2v-provider-notice",
      text: ENDPOINT_NOTICE,
    });
    const model = this.input(controls, "Provider model", "text", draft.model);
    const timeout = controls.createEl("select", {
      cls: "c2v-provider-draft-control",
    });
    timeout.setAttr("aria-label", "Provider timeout");
    for (const value of [10_000, 30_000, 60_000, 120_000] as const) {
      const option = timeout.createEl("option", {
        text: `${String(value / 1000)} seconds`,
      });
      option.value = String(value);
      option.selected = value === draft.timeoutMs;
    }
    const output = this.input(
      controls,
      "Maximum output tokens",
      "number",
      String(draft.maxOutputTokens),
    );
    output.min = "1";
    output.max = "32768";
    const disclosureLabel = controls.createEl("label", {
      cls: "c2v-provider-disclosure",
    });
    const disclosure = disclosureLabel.createEl("input", {
      type: "checkbox",
      cls: "c2v-provider-draft-control",
    });
    disclosure.setAttr("aria-label", "Accept cloud data disclosure");
    disclosure.checked = draft.cloudDisclosureAccepted;
    disclosure.disabled = !validateProviderEndpoint(draft.endpoint).ok;
    disclosureLabel.append(document.createTextNode(CLOUD_DISCLOSURE));
    const updateDraft = (): void => {
      const endpointChanged =
        endpoint.value !== this.owner.providerDraft.endpoint;
      this.owner.setProviderDraft({
        endpoint: endpoint.value,
        model: model.value,
        timeoutMs: Number(timeout.value) as ProviderSettings["timeoutMs"],
        maxOutputTokens: Number(output.value),
        cloudDisclosureAccepted: endpointChanged ? false : disclosure.checked,
      });
      if (endpointChanged) disclosure.checked = false;
      disclosure.disabled = !validateProviderEndpoint(endpoint.value).ok;
    };
    for (const control of [endpoint, model, timeout, output, disclosure])
      control.addEventListener("change", updateDraft);
    for (const control of [endpoint, model, timeout, output, disclosure])
      control.disabled = control.disabled || providerSaving;

    this.updateProviderStatus(
      this.owner.providerSettingsStatusCode ?? this.credentialResultCode,
    );
    panel.append(this.providerStatusRegion);
    const actions = panel.createDiv({ cls: "c2v-provider-actions" });
    const save = actions.createEl("button", { text: "Save provider settings" });
    save.disabled = providerSaving;
    save.addEventListener("click", () => {
      void this.saveProviderDraft(save, updateDraft);
    });
    panel.createEl("p", {
      text: `Keychain status: ${this.owner.credentialState}`,
    });
    panel.createEl("p", {
      cls: "c2v-provider-notice",
      text: CREDENTIAL_NOTICE,
    });
    const key = panel.createEl("input", {
      type: "password",
      cls: "c2v-provider-key",
    });
    key.setAttr("aria-label", "Provider API key");
    key.autocomplete = "off";
    key.disabled = providerSaving;
    const credentialActions = panel.createDiv({ cls: "c2v-provider-actions" });
    const runCredential = (
      button: HTMLButtonElement,
      operation: () => CredentialMutationResult | CredentialStatusResult,
    ): void => {
      button.disabled = true;
      try {
        const result = operation();
        this.credentialResultCode = resultCode(result);
      } finally {
        key.value = "";
      }
      this.redrawFromObservedState();
      Array.from(this.containerEl.querySelectorAll<HTMLButtonElement>("button"))
        .find((candidate) => candidate.textContent === button.textContent)
        ?.focus();
    };
    const saveKey = credentialActions.createEl("button", {
      text: "Save API key",
    });
    saveKey.disabled = providerSaving;
    saveKey.addEventListener("click", () =>
      runCredential(saveKey, () => this.owner.setProviderCredential(key.value)),
    );
    const deleteKey = credentialActions.createEl("button", {
      text: "Delete API key",
    });
    deleteKey.disabled = providerSaving;
    deleteKey.addEventListener("click", () =>
      runCredential(deleteKey, () => this.owner.deleteProviderCredential()),
    );
    const refresh = credentialActions.createEl("button", {
      text: "Refresh Keychain status",
    });
    refresh.disabled = providerSaving;
    refresh.addEventListener("click", () =>
      runCredential(refresh, () => this.owner.refreshProviderCredential()),
    );
  }

  private input(
    parent: HTMLElement,
    label: string,
    type: "text" | "number",
    value: string,
  ): HTMLInputElement {
    const input = parent.createEl("input", {
      type,
      cls: "c2v-provider-draft-control",
      value,
    });
    input.setAttr("aria-label", label);
    return input;
  }

  private updateProviderStatus(code: ProviderCode | undefined): void {
    const message = messageFor(code);
    if (this.providerStatusRegion.textContent !== message)
      this.providerStatusRegion.textContent = message;
  }

  private async retryInitialization(retry: HTMLButtonElement): Promise<void> {
    retry.disabled = true;
    const result = await this.owner.retryProviderInitialization();
    if (result?.status === "saved") {
      this.display();
      this.containerEl
        .querySelector<HTMLInputElement>('[aria-label="Provider endpoint"]')
        ?.focus();
    } else {
      const currentRetry = Array.from(
        this.containerEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find(
        (button) => button.textContent === "Retry provider initialization",
      );
      if (currentRetry !== undefined) {
        currentRetry.disabled = false;
        currentRetry.focus();
      } else {
        retry.disabled = false;
        this.updateProviderStatus(resultCode(result));
        retry.focus();
      }
    }
  }

  private async saveProviderDraft(
    save: HTMLButtonElement,
    updateDraft: () => void,
  ): Promise<void> {
    updateDraft();
    save.disabled = true;
    const result = await this.owner.saveProviderSettings();
    const currentSave = Array.from(
      this.containerEl.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Save provider settings");
    if (currentSave !== undefined) {
      currentSave.disabled = false;
      this.updateProviderStatus(resultCode(result));
      currentSave.focus();
    } else {
      save.disabled = false;
      this.updateProviderStatus(resultCode(result));
      save.focus();
    }
  }
}
