import { Plugin } from "obsidian";
import { ImportController } from "./controller.js";
import { runImportInWorker } from "./runner.js";
import {
  Chat2VaultSettingTab,
  DEFAULT_SETTINGS,
  type Chat2VaultSettingsV1,
} from "./settings.js";
import { readSettings } from "./settings-model.js";
import { Chat2VaultView, VIEW_TYPE } from "./view.js";

export default class Chat2VaultPlugin extends Plugin {
  public override settings: Chat2VaultSettingsV1 = DEFAULT_SETTINGS;
  private controller?: ImportController;
  public override async onload(): Promise<void> {
    this.settings = readSettings(await this.loadData());
    this.controller = new ImportController(runImportInWorker);
    const controller = this.controller;
    this.registerView(
      VIEW_TYPE,
      (leaf) =>
        new Chat2VaultView(
          leaf,
          controller,
          () => this.settings.previewMessagesPerPage,
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
    this.controller?.close();
  }
  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
}
