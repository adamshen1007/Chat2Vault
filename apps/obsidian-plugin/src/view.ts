import type {
  CanonicalConversation,
  CanonicalMessage,
  ImportDiagnostic,
} from "@chat2vault/core";
import { ItemView, WorkspaceLeaf } from "obsidian";
import type {
  ImportController,
  ImportSnapshot,
  ReadableFile,
} from "./controller.js";
import {
  boundText,
  ConversationOrderCache,
  conversationDiagnosticSeverity,
  diagnosticDisplay,
  displayTimestamp,
  filterConversations,
  pageItems,
  type PreviewState,
} from "./model.js";
import { renderText } from "./render.js";

export const VIEW_TYPE = "chat-to-vault-preview";

export class Chat2VaultView extends ItemView {
  private readonly conversationOrder = new ConversationOrderCache();
  private unsubscribe?: () => void;
  private query = "";
  private conversationPage = 1;
  private messagePage = 1;
  private diagnosticPage = 1;
  private selected: CanonicalConversation | undefined;
  private lastState: PreviewState | undefined;
  private chooseButton: HTMLButtonElement | undefined;
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly controller: ImportController,
    private readonly pageSize: () => 10 | 25 | 50,
  ) {
    super(leaf);
  }
  public getViewType(): string {
    return VIEW_TYPE;
  }
  public getDisplayText(): string {
    return "Chat2Vault import preview";
  }
  public override getState(): Record<string, unknown> {
    return { version: 1 };
  }
  public override onOpen(): Promise<void> {
    this.unsubscribe = this.controller.subscribe((snapshot) =>
      this.draw(snapshot),
    );
    return Promise.resolve();
  }
  public override onClose(): Promise<void> {
    this.unsubscribe?.();
    this.controller.close();
    this.contentEl.ondragover = null;
    this.contentEl.ondrop = null;
    this.contentEl.empty();
    return Promise.resolve();
  }
  public focusImport(): void {
    this.chooseButton?.focus();
  }
  private button(
    parent: HTMLElement,
    label: string,
    action: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", { text: label });
    button.addEventListener("click", action);
    return button;
  }
  private draw(snapshot: ImportSnapshot): void {
    const stateChanged = snapshot.state !== this.lastState;
    this.lastState = snapshot.state;
    if (snapshot.state === "reading") {
      this.selected = undefined;
      this.query = "";
      this.conversationPage = 1;
      this.messagePage = 1;
      this.diagnosticPage = 1;
    }
    const root = this.contentEl;
    root.empty();
    root.addClass("c2v-preview");
    root.tabIndex = -1;
    root.setAttr("aria-label", "Chat2Vault import preview");
    const header = root.createDiv({ cls: "c2v-header" });
    header.createEl("h2", { text: "Conversation evidence" });
    const state = header.createEl("span", {
      cls: "c2v-state",
      text: snapshot.state,
    });
    state.setAttr("aria-live", "polite");
    const actions = header.createDiv({ cls: "c2v-actions" });
    const input = actions.createEl("input", { type: "file" });
    input.accept = ".zip,.json,application/json,application/zip";
    input.multiple = true;
    input.setAttr("aria-label", "Choose ChatGPT export");
    input.addClass("c2v-file");
    input.addEventListener("change", () => {
      const files =
        input.files === null ? [] : (Array.from(input.files) as ReadableFile[]);
      if (files.length > 0) void this.controller.import(files);
      input.value = "";
    });
    const choose = this.button(actions, "Choose export", () => input.click());
    choose.addClass("c2v-choose");
    this.chooseButton = choose;
    choose.disabled =
      snapshot.state === "reading" || snapshot.state === "parsing";
    this.button(actions, "Clear", () => {
      this.selected = undefined;
      this.query = "";
      this.conversationPage = 1;
      this.messagePage = 1;
      this.diagnosticPage = 1;
      this.controller.clear();
      this.contentEl.querySelector<HTMLButtonElement>(".c2v-choose")?.focus();
    });
    root.ondragover = (event) => {
      event.preventDefault();
    };
    root.ondrop = (event) => {
      event.preventDefault();
      const containsDirectory = Array.from(
        event.dataTransfer?.items ?? [],
      ).some((item) => {
        const entry = item.webkitGetAsEntry();
        return entry?.isDirectory === true;
      });
      if (containsDirectory) {
        void this.controller.import([
          {
            name: "folder/",
            size: 0,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          },
        ]);
        return;
      }
      const files = Array.from(
        event.dataTransfer?.files ?? [],
      ) as ReadableFile[];
      if (files.length > 0) void this.controller.import(files);
    };
    if (snapshot.error !== undefined) {
      const error = root.createEl("p", {
        cls: "c2v-error",
        text: boundText(snapshot.error, 2000),
      });
      error.setAttr("role", "alert");
      error.setAttr("aria-live", "assertive");
    }
    if (snapshot.result === undefined) {
      root.createEl("p", {
        cls: "c2v-empty",
        text:
          snapshot.state === "idle"
            ? "Choose or drop a ChatGPT ZIP or JSON export. Import stays local and creates no notes."
            : snapshot.state === "parsing"
              ? "Parsing conversations…"
              : "Reading export…",
      });
      if (stateChanged) this.focusState(snapshot.state);
      return;
    }
    this.drawResult(
      root,
      snapshot.result.conversations,
      snapshot.result.diagnostics,
    );
    if (stateChanged) this.focusState(snapshot.state);
  }
  private drawResult(
    root: HTMLElement,
    conversations: readonly CanonicalConversation[],
    diagnostics: readonly ImportDiagnostic[],
  ): void {
    if (conversations.length === 0) {
      const error = root.createEl("p", {
        cls: "c2v-error",
        text: "No supported conversations found",
      });
      error.setAttr("role", "alert");
      error.setAttr("aria-live", "assertive");
      this.drawDiagnostics(root, diagnostics);
      return;
    }
    const toolbar = root.createDiv({ cls: "c2v-toolbar" });
    const search = toolbar.createEl("input", {
      type: "search",
      placeholder: "Filter titles",
      value: this.query,
    });
    search.maxLength = 240;
    search.setAttr("aria-label", "Filter conversations by title");
    search.addEventListener("input", () => {
      this.query = search.value;
      this.conversationPage = 1;
      const selectionCleared =
        this.selected !== undefined &&
        !filterConversations([this.selected], this.query).length;
      if (selectionCleared) this.selected = undefined;
      this.draw(this.controller.snapshot);
      const target = selectionCleared
        ? this.contentEl.querySelector<HTMLElement>(".c2v-list")
        : this.contentEl.querySelector<HTMLInputElement>(
            'input[type="search"]',
          );
      target?.focus();
    });
    const filtered = filterConversations(
      this.conversationOrder.order(conversations),
      this.query,
    );
    const page = pageItems(filtered, this.conversationPage, 200);
    this.conversationPage = page.page;
    const layout = root.createDiv({ cls: "c2v-layout" });
    const list = layout.createEl("section", { cls: "c2v-list" });
    list.tabIndex = -1;
    list.setAttr("aria-label", "Conversation results");
    list.createEl("h3", { text: `${String(filtered.length)} conversations` });
    if (filtered.length === 0)
      list.createEl("p", { text: "No matching conversations" });
    for (const conversation of page.items) {
      const row = list.createEl("button", { cls: "c2v-row" });
      renderText(row, conversation.title ?? "Untitled conversation", 240);
      row.createEl("small", {
        text: ` · ${String(conversation.messages.length)} messages · ${displayTimestamp(conversation.updatedAt) ?? displayTimestamp(conversation.createdAt) ?? "date unavailable"}`,
      });
      const severity = conversationDiagnosticSeverity(
        conversation,
        diagnostics,
      );
      if (severity !== undefined)
        row.createEl("span", { text: ` · ${severity}` });
      row.addEventListener("click", () => {
        this.selected = conversation;
        this.messagePage = 1;
        this.draw(this.controller.snapshot);
        const detail = this.contentEl.querySelector<HTMLElement>(".c2v-detail");
        if (detail !== null) {
          detail.tabIndex = -1;
          detail.focus();
        }
      });
    }
    this.pager(list, page.page, page.pages, (next) => {
      this.conversationPage = next;
    });
    const preview = layout.createEl("article", { cls: "c2v-detail" });
    if (this.selected === undefined)
      preview.createEl("p", {
        text: "Select a conversation to inspect its source thread.",
      });
    else this.drawConversation(preview, this.selected);
    this.drawDiagnostics(root, diagnostics);
  }
  private drawConversation(
    parent: HTMLElement,
    conversation: CanonicalConversation,
  ): void {
    renderText(
      parent.createEl("h3"),
      conversation.title ?? "Untitled conversation",
      240,
    );
    parent.createEl("p", {
      cls: "c2v-meta",
      text: [
        conversation.provider,
        displayTimestamp(conversation.updatedAt) ??
          displayTimestamp(conversation.createdAt) ??
          "Timestamp unavailable",
        `${String(conversation.messages.length)} messages`,
      ].join(" · "),
    });
    const page = pageItems(
      conversation.messages,
      this.messagePage,
      this.pageSize(),
    );
    this.messagePage = page.page;
    let total = 0;
    for (const message of page.items) {
      if (total >= 131_072) {
        parent.createEl("p", { text: "Preview text limit reached" });
        break;
      }
      total = this.drawMessage(parent, message, total);
    }
    this.pager(parent, page.page, page.pages, (next) => {
      this.messagePage = next;
    });
  }
  private drawMessage(
    parent: HTMLElement,
    message: CanonicalMessage,
    total: number,
  ): number {
    const section = parent.createEl("section", { cls: "c2v-message" });
    section.createEl("h4", { text: message.role });
    for (const block of message.content) {
      const raw = block.type === "unsupported" ? block.description : block.text;
      const remaining = Math.max(0, 131_072 - total);
      if (remaining === 0) {
        section.createEl("p", { text: "Preview text limit reached" });
        break;
      }
      const blockLimit = block.type === "unsupported" ? 1024 : 16_384;
      const text = boundText(raw, Math.min(blockLimit, remaining));
      total += text.length;
      if (block.type === "code")
        renderText(section.createEl("pre").createEl("code"), text);
      else renderText(section.createEl("p"), text);
      if (block.type === "reference" && block.url !== undefined) {
        const urlRemaining = Math.max(0, 131_072 - total);
        if (urlRemaining === 0) {
          section.createEl("p", { text: "Preview text limit reached" });
          break;
        }
        const url = boundText(block.url, Math.min(2048, urlRemaining));
        total += url.length;
        renderText(section.createEl("p"), url);
      }
    }
    return total;
  }
  private drawDiagnostics(
    root: HTMLElement,
    diagnostics: readonly ImportDiagnostic[],
  ): void {
    const panel = root.createEl("details", { cls: "c2v-diagnostics" });
    panel.createEl("summary", {
      text: `${String(diagnostics.length)} diagnostics`,
    });
    const page = pageItems(diagnostics, this.diagnosticPage, 25);
    this.diagnosticPage = page.page;
    let total = 0;
    for (const diagnostic of page.items) {
      const remaining = Math.max(0, 65_536 - total);
      if (remaining === 0) {
        panel.createEl("p", { text: "… [diagnostic truncated]" });
        break;
      }
      const display = diagnosticDisplay(diagnostic);
      const item = panel.createDiv({
        cls: `c2v-diagnostic is-${display.severity}`,
      });
      item.createEl("span", { text: display.severity });
      const code = boundText(
        display.code,
        Math.min(128, remaining),
        "… [diagnostic truncated]",
      );
      item.createEl("strong", { text: code });
      total += code.length;
      const messageRemaining = Math.max(0, 65_536 - total);
      const message = boundText(
        display.message,
        Math.min(2000, messageRemaining),
        "… [diagnostic truncated]",
      );
      total += message.length;
      item.createEl("span", { text: message });
    }
    this.pager(panel, page.page, page.pages, (next) => {
      this.diagnosticPage = next;
    });
  }
  private pager(
    parent: HTMLElement,
    page: number,
    pages: number,
    update: (page: number) => void,
  ): void {
    if (pages <= 1) return;
    const nav = parent.createDiv({ cls: "c2v-pager" });
    this.button(nav, "Previous", () => {
      update(Math.max(1, page - 1));
      this.draw(this.controller.snapshot);
    });
    nav.createEl("span", { text: `${String(page)} / ${String(pages)}` });
    this.button(nav, "Next", () => {
      update(Math.min(pages, page + 1));
      this.draw(this.controller.snapshot);
    });
  }
  private focusState(state: PreviewState): void {
    if (state === "error") {
      const error = this.contentEl.querySelector<HTMLElement>(".c2v-error");
      if (error !== null) {
        error.tabIndex = -1;
        error.focus();
        return;
      }
    }
    if (
      state === "success" ||
      state === "success-with-warnings" ||
      state === "partial-success"
    ) {
      const row = this.contentEl.querySelector<HTMLButtonElement>(".c2v-row");
      if (row !== null) {
        row.focus();
        return;
      }
    }
    this.contentEl.focus();
  }
}
