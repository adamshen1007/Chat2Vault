import {
  M04_CONTRACT_VERSION,
  M04_RESULT_MAX_UTF8_BYTES,
  sourceWriterDiagnostic,
  type CanonicalConversation,
  type CanonicalMessage,
  type ImportDiagnostic,
  type SourceDescriptor,
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
import {
  SourceWriteController,
  type SourcePreviewResult,
  type SourceWriteExecutionResult,
} from "./source-controller.js";
import { executeSourceWrite } from "./source-executor.js";
import type { ObsidianSourceMutationAdapter } from "./source-vault-adapter.js";
import {
  ManualDistillationController,
  type ManualDistillationServices,
  type ManualOperationResult,
} from "./distillation-controller.js";
import {
  distillationPage,
  distillationPageCount,
  type DistillationPageSize,
} from "./distillation-model.js";

export const VIEW_TYPE = "chat-to-vault-preview";

export interface SourceViewServices {
  sourceRoot(): string;
  sourceRootPending(): boolean;
  settingsGeneration(): number;
  sourceWriterPlatformEligible(): boolean;
  createAdapter(
    source: SourceDescriptor,
    conversation: CanonicalConversation,
  ): ObsidianSourceMutationAdapter;
  registerInvalidator(
    invalidator: (reason: "settings" | "unload") => void,
  ): () => void;
}

export interface ManualDistillationViewServices extends Pick<
  ManualDistillationServices,
  "writeClipboard" | "buildRequest" | "renderPrompt" | "validateResult"
> {
  registerInvalidator?(invalidator: () => void): () => void;
}

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
  private sourceDescriptor: SourceDescriptor | undefined;
  private sourceController: SourceWriteController | undefined;
  private sourcePreviewResult: SourcePreviewResult | undefined;
  private sourceSaveResult: SourceWriteExecutionResult | undefined;
  private sourceBusy = false;
  private sourceGeneration = 0;
  private loaded = true;
  private unregisterSourceInvalidator?: () => void;
  private distillationController?: ManualDistillationController;
  private selectionGeneration = 0;
  private importGeneration = 0;
  private distillationPage = 1;
  private distillationPageSize: DistillationPageSize = 10;
  private unregisterDistillationInvalidator?: () => void;
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly controller: ImportController,
    private readonly pageSize: () => 10 | 25 | 50,
    private readonly sourceServices?: SourceViewServices,
    distillationServices?: ManualDistillationViewServices,
  ) {
    super(leaf);
    if (sourceServices !== undefined) {
      this.sourceController = new SourceWriteController(
        () => ({
          loaded: this.loaded,
          generation:
            this.sourceGeneration + sourceServices.settingsGeneration(),
          selectedConversationContentFingerprint:
            this.selected?.contentFingerprint,
          settledSourceRoot: sourceServices.sourceRoot(),
          sourceRootPending: sourceServices.sourceRootPending(),
        }),
        async () => {
          if (
            this.sourceDescriptor === undefined ||
            this.selected === undefined
          )
            throw new Error("No source selection");
          return sourceServices
            .createAdapter(this.sourceDescriptor, this.selected)
            .plan();
        },
        async (request, token, current) => {
          if (
            this.sourceDescriptor === undefined ||
            this.selected === undefined
          )
            return {
              status: "stale",
              acceptedFolderPaths: [],
              diagnostics: [
                {
                  code: "STALE_SOURCE_WRITE_PLAN",
                  severity: "error",
                  message:
                    "The source-note plan became stale before the write could complete.",
                },
              ],
            };
          return executeSourceWrite(
            request,
            token,
            current,
            sourceServices.createAdapter(this.sourceDescriptor, this.selected),
          );
        },
      );
      this.unregisterSourceInvalidator = sourceServices.registerInvalidator(
        (reason) => {
          if (reason === "unload") this.loaded = false;
          this.invalidateSourceState(reason === "unload");
          this.draw(this.controller.snapshot);
        },
      );
    }
    if (distillationServices !== undefined) {
      this.distillationController = new ManualDistillationController({
        current: () => ({
          loaded: this.loaded,
          selectionGeneration: this.selectionGeneration,
          importGeneration: this.importGeneration,
          ...(this.selected === undefined
            ? {}
            : { conversation: this.selected }),
        }),
        writeClipboard: (text) => distillationServices.writeClipboard(text),
        ...(distillationServices.buildRequest === undefined
          ? {}
          : { buildRequest: distillationServices.buildRequest }),
        ...(distillationServices.renderPrompt === undefined
          ? {}
          : { renderPrompt: distillationServices.renderPrompt }),
        ...(distillationServices.validateResult === undefined
          ? {}
          : { validateResult: distillationServices.validateResult }),
      });
      const unregister = distillationServices.registerInvalidator?.(() => {
        this.loaded = false;
        this.invalidateDistillation(true, true);
        this.draw(this.controller.snapshot);
      });
      if (unregister !== undefined)
        this.unregisterDistillationInvalidator = unregister;
    }
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
    this.loaded = true;
    this.unsubscribe = this.controller.subscribe((snapshot) =>
      this.draw(snapshot),
    );
    return Promise.resolve();
  }
  public override onClose(): Promise<void> {
    this.loaded = false;
    this.invalidateSourceState();
    this.invalidateDistillation(true, true);
    this.unregisterSourceInvalidator?.();
    this.unregisterDistillationInvalidator?.();
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
    if (this.distillationController?.invalidateIfConversationChanged() === true)
      this.distillationPage = 1;
    const stateChanged = snapshot.state !== this.lastState;
    this.lastState = snapshot.state;
    if (snapshot.state === "reading") {
      this.invalidateSourceState();
      if (stateChanged) this.invalidateDistillation(false, true);
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
      this.invalidateSourceState();
      this.invalidateDistillation(true, true);
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
      this.sourceDescriptor = undefined;
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
    this.sourceDescriptor = snapshot.result.source;
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
      if (selectionCleared) {
        this.selected = undefined;
        this.invalidateDistillation(true, false);
      }
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
        if (this.selected !== conversation) {
          this.invalidateSourceState();
          this.invalidateDistillation(true, false);
        }
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
    this.drawManualDistillation(parent);
    this.drawSourceActions(parent);
  }

  private invalidateDistillation(
    selectionChanged: boolean,
    importChanged: boolean,
  ): void {
    if (selectionChanged) this.selectionGeneration += 1;
    if (importChanged) this.importGeneration += 1;
    this.distillationPage = 1;
    this.distillationController?.invalidate();
  }

  private drawManualDistillation(parent: HTMLElement): void {
    const controller = this.distillationController;
    if (controller === undefined) return;
    const snapshot = controller.snapshot;
    const panel = parent.createEl("section", { cls: "c2v-distillation" });
    panel.createEl("h4", { text: "Manual distillation" });
    panel.createEl("p", {
      text: "Prepare a bounded prompt from the complete selected conversation, run it in an AI tool you choose, then paste strict JSON here. Nothing is sent automatically.",
    });
    panel.createEl("p", {
      cls: "c2v-clipboard-disclosure",
      text: "The copied prompt contains the complete selected conversation and remains in the system clipboard until the user, another application, or the operating system replaces or clears it.",
    });
    const prepareActions = panel.createDiv({ cls: "c2v-actions" });
    const prepare = this.button(prepareActions, "Prepare prompt", () => {
      void this.runManualOperation(() => controller.prepare());
    });
    prepare.setAttr("aria-label", "Prepare manual prompt");
    prepare.disabled = snapshot.owner !== undefined;
    const copy = this.button(prepareActions, "Copy prompt", () => {
      void this.runManualOperation(() => controller.copy());
    });
    copy.setAttr("aria-label", "Copy prompt");
    copy.disabled =
      snapshot.owner !== undefined ||
      snapshot.request === undefined ||
      snapshot.prompt === undefined;
    if (snapshot.request !== undefined) {
      const title = snapshot.request.title ?? "Untitled conversation";
      const details = panel.createEl("dl", { cls: "c2v-distillation-meta" });
      for (const [term, value] of [
        ["Contract", M04_CONTRACT_VERSION],
        ["Conversation", title],
        ["Fingerprint", snapshot.request.conversationFingerprint],
        ["Complete messages", String(snapshot.request.messages.length)],
        ["Prompt bytes", String(snapshot.promptBytes ?? 0)],
      ] as const) {
        details.createEl("dt", { text: term });
        details.createEl("dd", { text: value });
      }
    }
    const pasteDescriptionId = "c2v-distillation-paste-status";
    const textarea = panel.createEl("textarea", {
      cls: "c2v-distillation-paste",
    });
    textarea.value = snapshot.paste;
    textarea.spellcheck = false;
    textarea.wrap = "soft";
    textarea.setAttr("aria-label", "Paste strict JSON");
    textarea.setAttr("aria-describedby", pasteDescriptionId);
    textarea.setAttr("placeholder", "Paste strict JSON result");
    textarea.addEventListener("input", () => {
      controller.setPaste(textarea.value);
      this.distillationPage = 1;
      this.draw(this.controller.snapshot);
      this.contentEl
        .querySelector<HTMLTextAreaElement>('[aria-label="Paste strict JSON"]')
        ?.focus();
    });
    const pasteStatus = panel.createEl("p", {
      cls: "c2v-distillation-status",
      text: snapshot.pasteOverLimit
        ? `Result exceeds the ${String(M04_RESULT_MAX_UTF8_BYTES)}-byte limit and was cleared.`
        : `${String(snapshot.pasteBytes)} / ${String(M04_RESULT_MAX_UTF8_BYTES)} UTF-8 bytes · ${snapshot.status}`,
    });
    pasteStatus.id = pasteDescriptionId;
    pasteStatus.setAttr("role", "status");
    pasteStatus.setAttr("aria-live", "polite");
    const validateActions = panel.createDiv({ cls: "c2v-actions" });
    const validate = this.button(validateActions, "Validate result", () => {
      void this.runManualOperation(() => controller.validate());
    });
    validate.setAttr("aria-label", "Validate result");
    validate.disabled =
      snapshot.owner !== undefined ||
      snapshot.request === undefined ||
      snapshot.paste === "" ||
      snapshot.pasteOverLimit;
    if (snapshot.diagnostics.length > 0) {
      const diagnostics = panel.createEl("div", {
        cls: "c2v-distillation-diagnostics",
      });
      diagnostics.setAttr("aria-label", "Distillation diagnostics");
      for (const diagnostic of snapshot.diagnostics)
        diagnostics.createEl("p", {
          cls: "c2v-error",
          text: `${diagnostic.code}${diagnostic.path === "" ? "" : ` at ${diagnostic.path}`}: ${diagnostic.message}`,
        });
    }
    this.drawDistillationCandidates(panel);
  }

  private drawDistillationCandidates(parent: HTMLElement): void {
    const candidates = this.distillationController?.snapshot.candidates ?? [];
    if (candidates.length === 0) return;
    const pages = distillationPageCount(
      candidates.length,
      this.distillationPageSize,
    );
    this.distillationPage = Math.min(this.distillationPage, pages);
    const controls = parent.createDiv({ cls: "c2v-distillation-controls" });
    const label = controls.createEl("label", { text: "Candidates per page" });
    const select = label.createEl("select");
    select.setAttr("aria-label", "Candidates per page");
    for (const size of [10, 25, 50] as const) {
      const option = select.createEl("option", { text: String(size) });
      option.value = String(size);
      option.selected = size === this.distillationPageSize;
    }
    select.addEventListener("change", () => {
      const size = Number(select.value);
      if (size === 10 || size === 25 || size === 50)
        this.distillationPageSize = size;
      this.distillationPage = 1;
      this.draw(this.controller.snapshot);
    });
    const list = parent.createEl("section", {
      cls: "c2v-candidate-preview",
    });
    list.setAttr("aria-label", "Validated knowledge candidates");
    const page = distillationPage(
      candidates,
      this.distillationPage,
      this.distillationPageSize,
    );
    for (const candidate of page) {
      const item = list.createEl("article", { cls: "c2v-candidate" });
      item.createEl("h5", { text: candidate.title });
      item.createEl("p", {
        cls: "c2v-meta",
        text: `${candidate.type} · ${candidate.confidence} · proposed`,
      });
      item.createEl("p", { text: candidate.summary });
      item.createEl("pre").createEl("code", { text: candidate.body });
      item.createEl("p", {
        text: `Sources: ${candidate.sourceRefs[0].messageFingerprints.join(", ")}`,
      });
      item.createEl("p", {
        text: `Suggested links: ${candidate.suggestedLinks.join(", ") || "none"}`,
      });
      item.createEl("p", {
        text: `Suggested tags: ${candidate.suggestedTags.join(", ") || "none"}`,
      });
    }
    this.pager(list, this.distillationPage, pages, (next) => {
      this.distillationPage = next;
    });
  }

  private async runManualOperation(
    operation: () => Promise<ManualOperationResult>,
  ): Promise<void> {
    if (
      this.distillationController?.invalidateIfConversationChanged() === true
    ) {
      this.distillationPage = 1;
      if (this.loaded) this.draw(this.controller.snapshot);
      return;
    }
    const pending = operation();
    this.draw(this.controller.snapshot);
    const operationResult = await pending;
    if (!this.loaded || operationResult.status === "stale") return;
    this.draw(this.controller.snapshot);
  }

  private invalidateSourceState(incrementGeneration = true): void {
    if (incrementGeneration) this.sourceGeneration += 1;
    this.sourceController?.invalidate();
    this.sourcePreviewResult = undefined;
    this.sourceSaveResult = undefined;
  }

  private drawSourceActions(parent: HTMLElement): void {
    const controller = this.sourceController;
    if (controller === undefined) return;
    const panel = parent.createEl("section", { cls: "c2v-source" });
    panel.createEl("h4", { text: "Source preservation" });
    panel.createEl("p", {
      text: "Preview is read-only. Save explicitly creates a new source note and never modifies an existing note.",
    });
    const pending = this.sourceServices?.sourceRootPending() === true;
    const sourceRoot = this.sourceServices?.sourceRoot() ?? "";
    const platformEligible =
      this.sourceServices?.sourceWriterPlatformEligible() === true;
    panel.createEl("p", {
      text:
        sourceRoot === ""
          ? "Source folder: not configured"
          : `Source folder: ${sourceRoot}`,
    });
    if (pending)
      panel.createEl("p", {
        cls: "c2v-error",
        text: "The source folder setting is still being saved; wait for it to settle before previewing or saving a source note.",
      });
    if (!platformEligible) {
      const diagnostic = sourceWriterDiagnostic(
        "UNSUPPORTED_SOURCE_WRITER_PLATFORM",
      );
      panel.createEl("p", {
        cls: "c2v-error",
        text: `${diagnostic.code}: ${diagnostic.message}`,
      });
    }
    const actions = panel.createDiv({ cls: "c2v-actions" });
    const previewEligible =
      this.loaded &&
      !pending &&
      platformEligible &&
      sourceRoot !== "" &&
      this.selected?.provider === "chatgpt" &&
      this.sourceDescriptor?.provider === "chatgpt";
    if (previewEligible) {
      const previewButton = this.button(actions, "Preview source note", () => {
        void this.previewSource();
      });
      previewButton.disabled = this.sourceBusy;
    }
    const installed = controller.installedPreview;
    if (
      installed !== undefined &&
      (installed.plan.disposition === "new" ||
        installed.plan.disposition === "new-version")
    ) {
      const saveButton = this.button(actions, "Save source note", () => {
        void this.saveSource();
      });
      saveButton.disabled = pending || this.sourceBusy;
    }
    const result = this.sourceSaveResult ?? this.sourcePreviewResult;
    if (result !== undefined) {
      panel.createEl("p", { text: `Source action: ${result.status}` });
      if ("createdPath" in result)
        panel.createEl("p", { text: `Saved path: ${result.createdPath}` });
      if ("plan" in result) this.drawSourcePlan(panel, result.plan);
      if ("diagnostics" in result)
        for (const diagnostic of result.diagnostics)
          panel.createEl("p", {
            cls: diagnostic.severity === "error" ? "c2v-error" : "",
            text: `${diagnostic.code}: ${diagnostic.message}`,
          });
    }
  }

  private drawSourcePlan(
    parent: HTMLElement,
    plan: import("@chat2vault/core").SourceWritePlan,
  ): void {
    parent.createEl("p", { text: `Disposition: ${plan.disposition}` });
    for (const diagnostic of plan.diagnostics)
      parent.createEl("p", {
        cls: diagnostic.severity === "error" ? "c2v-error" : "",
        text: `${diagnostic.code}: ${diagnostic.message}`,
      });
    if (plan.disposition === "duplicate") {
      parent.createEl("p", { text: `Existing source: ${plan.existingPath}` });
      parent.createEl("p", {
        text: `All duplicate sources: ${plan.duplicatePaths.join(", ")}`,
      });
      return;
    }
    if (plan.disposition !== "new" && plan.disposition !== "new-version")
      return;
    parent.createEl("p", { text: `Target: ${plan.targetPath}` });
    if (plan.disposition === "new-version")
      parent.createEl("p", {
        text: `Previous versions: ${plan.previousVersionPaths.join(", ")}`,
      });
    const display = this.sourceController?.installedPreview?.display;
    if (display === undefined) return;
    parent.createEl("p", {
      text:
        display.completeness === "complete"
          ? "Complete source-note Markdown preview."
          : "Source-note Markdown preview truncated; showing a prefix of at most 65,536 UTF-16 code units.",
    });
    const code = parent.createEl("pre").createEl("code");
    code.textContent = display.text;
  }

  private async previewSource(): Promise<void> {
    if (this.sourceController === undefined) return;
    this.sourceBusy = true;
    this.sourceSaveResult = undefined;
    this.draw(this.controller.snapshot);
    try {
      this.sourcePreviewResult = await this.sourceController.preview();
    } finally {
      this.sourceBusy = false;
      this.draw(this.controller.snapshot);
    }
  }

  private async saveSource(): Promise<void> {
    if (this.sourceController === undefined) return;
    this.sourceBusy = true;
    this.draw(this.controller.snapshot);
    try {
      this.sourceSaveResult = await this.sourceController.save();
    } finally {
      this.sourceBusy = false;
      this.draw(this.controller.snapshot);
    }
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
