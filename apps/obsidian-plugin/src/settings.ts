import { App, PluginSettingTab, Setting, type Plugin } from "obsidian";
import {
  DEFAULT_SETTINGS,
  type Chat2VaultSettingsV2,
  type SettingsSaveResult,
} from "./settings-model.js";

export { DEFAULT_SETTINGS, type Chat2VaultSettingsV2 };

export class Chat2VaultSettingTab extends PluginSettingTab {
  public constructor(
    app: App,
    private readonly owner: Plugin & {
      settings: Chat2VaultSettingsV2;
      savePreviewMessagesPerPage(
        value: unknown,
      ): Promise<SettingsSaveResult | undefined>;
      saveSourceRoot(value: unknown): Promise<SettingsSaveResult | undefined>;
    },
  ) {
    super(app, owner);
  }
  public override display(): void {
    this.containerEl.empty();
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
              const parsed = Number(value);
              showResult(
                previewStatus,
                await this.owner.savePreviewMessagesPerPage(parsed),
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
}
