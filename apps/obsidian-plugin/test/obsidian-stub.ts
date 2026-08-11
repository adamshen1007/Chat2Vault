export class ItemView {
  public contentEl = document.createElement("div");
}

export class WorkspaceLeaf {
  public readonly stub = true;
}

export class App {
  public readonly stub = true;
}

export class Plugin {
  public app: unknown;
  public settings: unknown;
  public readonly registeredViews = new Map<
    string,
    (leaf: unknown) => unknown
  >();
  public readonly commands: {
    id: string;
    name: string;
    callback: () => void;
  }[] = [];
  public readonly settingTabs: unknown[] = [];
  public savedData: unknown;
  public loadData(): Promise<unknown> {
    return Promise.resolve({});
  }
  public saveData(value: unknown): Promise<void> {
    this.savedData = value;
    return Promise.resolve();
  }
  public registerView(type: string, factory: (leaf: unknown) => unknown): void {
    this.registeredViews.set(type, factory);
  }
  public addCommand(command: {
    id: string;
    name: string;
    callback: () => void;
  }): void {
    this.commands.push(command);
  }
  public addSettingTab(tab: unknown): void {
    this.settingTabs.push(tab);
  }
}

export class PluginSettingTab {
  public containerEl = document.createElement("div");
  public constructor(
    public readonly app: unknown,
    public readonly plugin: unknown,
  ) {}
}

export class Setting {
  public constructor(public readonly container: HTMLElement) {}
  public setName(name: string): this {
    void name;
    return this;
  }
  public setDesc(description: string): this {
    void description;
    return this;
  }
  public addDropdown(builder: (dropdown: unknown) => void): this {
    void builder;
    return this;
  }
}
