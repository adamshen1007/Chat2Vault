import { App, PluginSettingTab, Setting, type Plugin } from "obsidian";
import {
  DEFAULT_SETTINGS,
  type Chat2VaultSettingsV1,
} from "./settings-model.js";

export { DEFAULT_SETTINGS, type Chat2VaultSettingsV1 };

export class Chat2VaultSettingTab extends PluginSettingTab {
  public constructor(
    app: App,
    private readonly owner: Plugin & {
      settings: Chat2VaultSettingsV1;
      saveSettings(): Promise<void>;
    },
  ) {
    super(app, owner);
  }
  public override display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Messages per preview page")
      .setDesc("Maximum messages mounted for the selected conversation.")
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({ "10": "10", "25": "25", "50": "50" })
          .setValue(String(this.owner.settings.previewMessagesPerPage))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (parsed === 10 || parsed === 25 || parsed === 50) {
              this.owner.settings = {
                schemaVersion: 1,
                previewMessagesPerPage: parsed,
              };
              await this.owner.saveSettings();
            }
          });
      });
  }
}
