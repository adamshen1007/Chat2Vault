// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/require-await -- synthetic UI fixtures use proven indexed values and async adapter mocks. */
import {
  buildDistillationRequest,
  fingerprint,
  validateDistillationResult,
  type CanonicalConversation,
  type CanonicalMessage,
  type DistillationValidationResult,
  type ImportDiagnostic,
  type ImportResult,
} from "@chat2vault/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ImportController } from "../src/controller.js";
import {
  Chat2VaultView,
  type ManualDistillationViewServices,
} from "../src/view.js";

beforeAll(() => {
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

const message = (ordinal: number): CanonicalMessage => ({
  providerMessageId: `private-message-${String(ordinal)}`,
  role: "assistant",
  content: [{ type: "text", text: `Message ${String(ordinal)}` }],
  metadata: { private: "metadata-marker" },
  fingerprint: `sha256:private-fingerprint-${String(ordinal)}`,
});

const conversation = (ordinal: number): CanonicalConversation => ({
  schemaVersion: 1,
  provider: "chatgpt",
  providerConversationId: `private-conversation-${String(ordinal)}`,
  title: `Conversation ${String(ordinal)}`,
  messages: Array.from({ length: 60 }, (_, index) => message(index)),
  metadata: { private: "metadata-marker" },
  contentFingerprint: `sha256:private-conversation-fingerprint-${String(ordinal)}`,
});

const importResult = (
  conversations: CanonicalConversation[],
  diagnostics: ImportDiagnostic[] = [],
): ImportResult => ({
  source: {
    provider: "chatgpt",
    importFormat: "chatgpt-json",
    sourceFileName: "synthetic.json",
    sourceFileFingerprint: "sha256:source",
    importedAt: "2026-01-01T00:00:00.000Z",
  },
  conversations,
  diagnostics,
});

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

function manualConversation(): CanonicalConversation {
  return {
    schemaVersion: 1,
    provider: "unknown",
    providerConversationId: "manual-race",
    title: "Manual race",
    messages: [
      {
        providerMessageId: "message-one",
        role: "user",
        content: [{ type: "text", text: "Synthetic manual input" }],
        metadata: {},
        fingerprint: `sha256:${"1".repeat(64)}`,
      },
    ],
    metadata: {},
    contentFingerprint: `sha256:${"2".repeat(64)}`,
  };
}

async function openManualView(
  services: ManualDistillationViewServices,
): Promise<{
  view: Chat2VaultView;
  controller: ImportController;
  item: CanonicalConversation;
  validPaste: string;
}> {
  const item = manualConversation();
  const built = buildDistillationRequest(item);
  if (!built.ok) throw new Error("Synthetic request failed");
  const controller = new ImportController(() =>
    Promise.resolve(importResult([item])),
  );
  const view = new Chat2VaultView(
    {} as never,
    controller,
    () => 25,
    undefined,
    services,
  );
  document.body.append(view.contentEl);
  await view.onOpen();
  await controller.import([
    {
      name: "synthetic.json",
      size: 1,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
    },
  ]);
  view.contentEl.querySelector<HTMLButtonElement>(".c2v-row")?.click();
  view.contentEl
    .querySelector<HTMLButtonElement>('[aria-label="Prepare manual prompt"]')
    ?.click();
  await flush();
  return {
    view,
    controller,
    item,
    validPaste: JSON.stringify({
      schemaVersion: 1,
      contractVersion: "m04-manual-v1",
      requestId: built.request.requestId,
      conversationFingerprint: built.request.conversationFingerprint,
      candidates: [
        {
          type: "insight",
          title: "Race winner",
          summary: "The newer UI state wins.",
          body: "A stale completion cannot redraw the view.",
          confidence: "high",
          sourceMessageFingerprints: [built.request.messages[0]!.fingerprint],
          suggestedLinks: [],
          suggestedTags: [],
        },
      ],
    }),
  };
}

async function openResult(
  result: ImportResult,
  pageSize: 10 | 25 | 50 = 25,
): Promise<{ view: Chat2VaultView; controller: ImportController }> {
  const controller = new ImportController(() => Promise.resolve(result));
  const view = new Chat2VaultView({} as never, controller, () => pageSize);
  document.body.append(view.contentEl);
  await view.onOpen();
  await controller.import([
    {
      name: "synthetic.json",
      size: 1,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
    },
  ]);
  return { view, controller };
}

describe("preview view", () => {
  it("renders the accessible manual distillation round trip as inert read-only UI", async () => {
    const item: CanonicalConversation = {
      schemaVersion: 1,
      provider: "unknown",
      providerConversationId: "manual-ui",
      title: "Manual UI",
      messages: [
        {
          providerMessageId: "message-one",
          role: "user",
          content: [{ type: "text", text: "Synthetic manual input" }],
          metadata: {},
          fingerprint: `sha256:${"1".repeat(64)}`,
        },
      ],
      metadata: {},
      contentFingerprint: `sha256:${"2".repeat(64)}`,
    };
    const built = buildDistillationRequest(item);
    if (!built.ok) throw new Error("Synthetic request failed");
    const copied = vi.fn(async () => undefined);
    const controller = new ImportController(() =>
      Promise.resolve(importResult([item])),
    );
    const view = new Chat2VaultView(
      {} as never,
      controller,
      () => 25,
      undefined,
      { writeClipboard: copied },
    );
    document.body.append(view.contentEl);
    await view.onOpen();
    await controller.import([
      {
        name: "synthetic.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);
    view.contentEl.querySelector<HTMLButtonElement>(".c2v-row")?.click();

    const prepare = view.contentEl.querySelector<HTMLButtonElement>(
      '[aria-label="Prepare manual prompt"]',
    );
    expect(prepare).not.toBeNull();
    prepare?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const copy = view.contentEl.querySelector<HTMLButtonElement>(
      '[aria-label="Copy prompt"]',
    );
    expect(copy?.disabled).toBe(false);
    copy?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(copied).toHaveBeenCalledOnce();

    const textarea = view.contentEl.querySelector<HTMLTextAreaElement>(
      '[aria-label="Paste strict JSON"]',
    );
    expect(textarea?.spellcheck).toBe(false);
    expect(textarea?.getAttribute("aria-describedby")).toBeTruthy();
    if (textarea === null) throw new Error("Missing M04 textarea");
    textarea.value = JSON.stringify({
      schemaVersion: 1,
      contractVersion: "m04-manual-v1",
      requestId: built.request.requestId,
      conversationFingerprint: built.request.conversationFingerprint,
      candidates: Array.from(
        { length: 11 },
        (_, index) =>
          ({
            type: "insight",
            title:
              index === 0
                ? "<script>inert title</script>"
                : `Candidate ${String(index + 1)}`,
            summary: "[[inert link]]",
            body: "<img src=https://example.invalid/remote.png>",
            confidence: "high",
            sourceMessageFingerprints: [built.request.messages[0]!.fingerprint],
            suggestedLinks: ["https://example.invalid/inert"],
            suggestedTags: ["#inert"],
          }) as const,
      ),
    });
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const validate = view.contentEl.querySelector<HTMLButtonElement>(
      '[aria-label="Validate result"]',
    );
    expect(validate?.disabled).toBe(false);
    validate?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const panel = view.contentEl.querySelector(".c2v-distillation");
    const keyboardOrder = [
      "Prepare manual prompt",
      "Copy prompt",
      "Paste strict JSON",
      "Validate result",
      "Candidates per page",
      "Previous",
      "Next",
    ];
    expect(
      [...panel!.querySelectorAll("button, textarea, select")].map(
        (element) =>
          element.getAttribute("aria-label") ?? element.textContent.trim(),
      ),
    ).toEqual(keyboardOrder);
    expect(panel?.textContent).toContain("<script>inert title</script>");
    expect(panel?.querySelector("script")).toBeNull();
    expect(panel?.querySelector("img")).toBeNull();
    expect(panel?.querySelector("a")).toBeNull();
    expect(panel?.textContent).toContain(
      "remains in the system clipboard until",
    );
    for (const forbidden of ["Accept", "Edit", "Reject", "Save candidate"])
      expect(
        [...view.contentEl.querySelectorAll("button")].some(
          (button) => button.textContent === forbidden,
        ),
      ).toBe(false);
    await view.onClose();
  });

  it("preserves textarea focus and DOM when an old Validate settles stale", async () => {
    let resolveValidation!: (value: DistillationValidationResult) => void;
    const { view, validPaste } = await openManualView({
      writeClipboard: async () => undefined,
      validateResult: () =>
        new Promise<DistillationValidationResult>((resolve) => {
          resolveValidation = resolve;
        }),
    });
    const textarea = view.contentEl.querySelector<HTMLTextAreaElement>(
      '[aria-label="Paste strict JSON"]',
    )!;
    textarea.value = validPaste;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    view.contentEl
      .querySelector<HTMLButtonElement>('[aria-label="Validate result"]')
      ?.click();
    await flush();

    const pendingTextarea = view.contentEl.querySelector<HTMLTextAreaElement>(
      '[aria-label="Paste strict JSON"]',
    )!;
    pendingTextarea.value = "newer input";
    pendingTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    const winner = view.contentEl.querySelector<HTMLTextAreaElement>(
      '[aria-label="Paste strict JSON"]',
    )!;
    expect(document.activeElement).toBe(winner);

    resolveValidation({ ok: true, candidates: [] });
    await flush();
    expect(
      view.contentEl.querySelector('[aria-label="Paste strict JSON"]'),
    ).toBe(winner);
    expect(document.activeElement).toBe(winner);
    expect(winner.value).toBe("newer input");
    await view.onClose();
  });

  it("keeps a newer validated winner mounted when an older Validate settles stale", async () => {
    let resolveOld!: (value: DistillationValidationResult) => void;
    let calls = 0;
    const { view, validPaste } = await openManualView({
      writeClipboard: async () => undefined,
      validateResult: (raw, request) => {
        calls += 1;
        if (calls === 1)
          return new Promise<DistillationValidationResult>((resolve) => {
            resolveOld = resolve;
          });
        return validateDistillationResult(raw, request);
      },
    });
    let textarea = view.contentEl.querySelector<HTMLTextAreaElement>(
      '[aria-label="Paste strict JSON"]',
    )!;
    textarea.value = validPaste;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    view.contentEl
      .querySelector<HTMLButtonElement>('[aria-label="Validate result"]')
      ?.click();
    await flush();

    textarea = view.contentEl.querySelector<HTMLTextAreaElement>(
      '[aria-label="Paste strict JSON"]',
    )!;
    textarea.value = validPaste;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    view.contentEl
      .querySelector<HTMLButtonElement>('[aria-label="Validate result"]')
      ?.click();
    await flush();
    const winner = view.contentEl.querySelector(".c2v-candidate-preview");
    expect(winner?.textContent).toContain("Race winner");

    resolveOld({ ok: false, diagnostics: [] });
    await flush();
    expect(view.contentEl.querySelector(".c2v-candidate-preview")).toBe(winner);
    expect(view.contentEl.textContent).toContain("Race winner");
    await view.onClose();
  });

  it("does not repopulate a closed view when an unsettled Copy finishes stale", async () => {
    let resolveCopy!: () => void;
    const { view } = await openManualView({
      writeClipboard: () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    });
    view.contentEl
      .querySelector<HTMLButtonElement>('[aria-label="Copy prompt"]')
      ?.click();
    await flush();
    await view.onClose();
    expect(view.contentEl.childElementCount).toBe(0);

    resolveCopy();
    await flush();
    expect(view.contentEl.childElementCount).toBe(0);
  });

  it("synchronously clears the manual workflow when the active conversation fingerprint changes", async () => {
    let resolveCopy!: () => void;
    const { view, item } = await openManualView({
      writeClipboard: () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    });
    view.contentEl
      .querySelector<HTMLButtonElement>('[aria-label="Copy prompt"]')
      ?.click();
    await flush();

    item.contentFingerprint = `sha256:${"3".repeat(64)}`;
    const search = view.contentEl.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      view.contentEl.querySelector<HTMLButtonElement>(
        '[aria-label="Copy prompt"]',
      )?.disabled,
    ).toBe(true);
    expect(view.contentEl.textContent).not.toContain("Complete messages");

    view.contentEl
      .querySelector<HTMLButtonElement>('[aria-label="Prepare manual prompt"]')
      ?.click();
    await flush();
    const winner = view.contentEl.querySelector<HTMLButtonElement>(
      '[aria-label="Copy prompt"]',
    );
    expect(winner?.disabled).toBe(false);

    resolveCopy();
    await flush();
    expect(
      view.contentEl.querySelector<HTMLButtonElement>(
        '[aria-label="Copy prompt"]',
      ),
    ).toBe(winner);
    await view.onClose();
  });

  it("caps mounted rows and excludes identifiers, fingerprints, and metadata", async () => {
    const conversations = Array.from({ length: 201 }, (_, index) =>
      conversation(index),
    );
    const diagnostics: ImportDiagnostic[] = Array.from(
      { length: 26 },
      (_, index) => ({
        code: "AMBIGUOUS_BRANCH",
        severity: "warning",
        message: `Safe diagnostic ${String(index)}`,
        conversationIdentifier: fingerprint({
          providerIdentifier: "private-conversation-0",
        }),
        messageIdentifier: `private-diagnostic-${String(index)}`,
      }),
    );
    const result: ImportResult = {
      source: {
        provider: "chatgpt",
        importFormat: "chatgpt-json",
        sourceFileName: "private-path.json",
        sourceFileFingerprint: "sha256:private-source-fingerprint",
        importedAt: "2026-01-01T00:00:00.000Z",
      },
      conversations,
      diagnostics,
    };
    const controller = new ImportController(() => Promise.resolve(result));
    const view = new Chat2VaultView({} as never, controller, () => 25);
    document.body.append(view.contentEl);
    await view.onOpen();
    await controller.import([
      {
        name: "synthetic.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);

    expect(view.contentEl.querySelectorAll(".c2v-row")).toHaveLength(200);
    expect(view.contentEl.querySelectorAll(".c2v-diagnostic")).toHaveLength(25);
    expect(view.contentEl.textContent).toContain("warning");
    view.contentEl.querySelector<HTMLButtonElement>(".c2v-row")?.click();
    expect(view.contentEl.querySelectorAll(".c2v-message")).toHaveLength(25);
    const rendered = view.contentEl.textContent;
    expect(rendered).not.toContain("private-message");
    expect(rendered).not.toContain("private-fingerprint");
    expect(rendered).not.toContain("metadata-marker");
    expect(rendered).not.toContain("private-diagnostic");
    expect(rendered).not.toContain("private-source");
    await view.onClose();
  });

  it("mounts exactly the configured 10, 25, or 50 message page", async () => {
    for (const size of [10, 25, 50] as const) {
      const { view } = await openResult(
        importResult([conversation(size)]),
        size,
      );
      view.contentEl.querySelector<HTMLButtonElement>(".c2v-row")?.click();
      expect(view.contentEl.querySelectorAll(".c2v-message")).toHaveLength(
        size,
      );
      await view.onClose();
    }
  });

  it("bounds every preview field and renders hostile reference URLs inertly", async () => {
    const item = conversation(1);
    item.messages = [
      {
        role: "assistant",
        metadata: {},
        fingerprint: "sha256:message",
        content: [
          { type: "text", text: `<script>${"t".repeat(17_000)}</script>` },
          { type: "code", text: `<svg onload=alert(1)>${"c".repeat(17_000)}` },
          {
            type: "reference",
            text: "reference",
            url: `https://example.invalid/${"u".repeat(3000)}`,
          },
          { type: "unsupported", description: "d".repeat(2000) },
        ],
      },
    ];
    const { view } = await openResult(importResult([item]));
    view.contentEl.querySelector<HTMLButtonElement>(".c2v-row")?.click();
    const detail = view.contentEl.querySelector<HTMLElement>(".c2v-detail");
    expect(detail?.querySelector("script")).toBeNull();
    expect(detail?.querySelector("svg")).toBeNull();
    expect(detail?.querySelector("a")).toBeNull();
    expect(detail?.querySelector("pre > code")?.textContent).toContain("<svg");
    expect(detail?.textContent).toContain("… [preview truncated]");
    expect(detail?.textContent).toContain("https://example.invalid/");
    await view.onClose();
  });

  it("enforces the total preview budget with one fixed exhaustion marker", async () => {
    const item = conversation(2);
    item.messages = Array.from({ length: 25 }, (_, index) => ({
      role: "assistant" as const,
      metadata: {},
      fingerprint: `sha256:${String(index)}`,
      content: [{ type: "text" as const, text: "x".repeat(16_384) }],
    }));
    const { view } = await openResult(importResult([item]));
    view.contentEl.querySelector<HTMLButtonElement>(".c2v-row")?.click();
    expect(
      view.contentEl.textContent.match(/Preview text limit reached/gu),
    ).toHaveLength(1);
    await view.onClose();
  });

  it("bounds diagnostic fields, aggregate text, and page size while showing branch warnings", async () => {
    const item = conversation(0);
    const identifier = fingerprint({
      providerIdentifier: item.providerConversationId,
    });
    const diagnostics: ImportDiagnostic[] = Array.from({ length: 26 }, () => ({
      code: "AMBIGUOUS_BRANCH",
      severity: "warning",
      message: "m".repeat(3000),
      conversationIdentifier: identifier,
    }));
    const { view } = await openResult(importResult([item], diagnostics));
    const rows = Array.from(
      view.contentEl.querySelectorAll<HTMLElement>(".c2v-diagnostic"),
    );
    expect(rows).toHaveLength(25);
    for (const row of rows) {
      expect(
        row.querySelector("strong")?.textContent.length,
      ).toBeLessThanOrEqual(128);
      expect(
        row.querySelector("span:last-child")?.textContent.length,
      ).toBeLessThanOrEqual(2000);
    }
    expect(
      rows.reduce((sum, row) => sum + row.textContent.length, 0),
    ).toBeLessThanOrEqual(65_536);
    expect(view.contentEl.querySelector(".c2v-row")?.textContent).toContain(
      "warning",
    );
    await view.onClose();
  });

  it("focuses visible controls and accessible zero-result errors", async () => {
    const controller = new ImportController(() =>
      Promise.resolve(importResult([])),
    );
    const view = new Chat2VaultView({} as never, controller, () => 25);
    document.body.append(view.contentEl);
    await view.onOpen();
    view.focusImport();
    expect(document.activeElement?.classList.contains("c2v-choose")).toBe(true);
    await controller.import([
      {
        name: "x.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);
    const error = view.contentEl.querySelector<HTMLElement>(".c2v-error");
    expect(error?.getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(error);
    await view.onClose();
  });

  it("keeps custom state content-free and clears imports on view close", async () => {
    const { view, controller } = await openResult(
      importResult([conversation(1)]),
    );
    expect(view.getState()).toEqual({ version: 1 });
    await view.onClose();
    expect(controller.snapshot).toEqual({ state: "idle" });
    expect(view.contentEl.childElementCount).toBe(0);
  });

  it("prevents drop navigation and rejects a folder before reading", async () => {
    let reads = 0;
    const controller = new ImportController(() =>
      Promise.resolve(importResult([])),
    );
    const view = new Chat2VaultView({} as never, controller, () => 25);
    await view.onOpen();
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
        files: [
          {
            name: "folder",
            size: 0,
            arrayBuffer: () => {
              reads += 1;
              return Promise.resolve(new ArrayBuffer(0));
            },
          },
        ],
      },
    });
    view.contentEl.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(reads).toBe(0);
    expect(controller.snapshot.state).toBe("error");
    await view.onClose();
  });

  it("renders the source-note plan as bounded inert raw text and enables explicit Save only for writable plans", async () => {
    const item: CanonicalConversation = {
      schemaVersion: 1,
      provider: "chatgpt",
      title: "Source UI",
      messages: [],
      metadata: {
        chatgptGraph: {
          nodeCount: 0,
          selectedPathNodeIds: [],
          alternativeLeafNodeIds: [],
          currentNodeId: null,
        },
      },
      contentFingerprint: `sha256:${"b".repeat(64)}`,
    };
    const result = importResult([item]);
    result.source.sourceFileFingerprint = `sha256:${"a".repeat(64)}`;
    const controller = new ImportController(() => Promise.resolve(result));
    const noteContent = `<script>alert(1)</script>\n${"x".repeat(65_530)}😀tail`;
    let createdContent: string | undefined;
    let createdPath: string | undefined;
    const writablePlan = {
      disposition: "new" as const,
      targetPath: "Sources/note.md",
      noteContent,
      noteContentFingerprint: `sha256:${"c".repeat(64)}`,
      foldersToCreate: [],
      diagnostics: [],
    };
    const view = new Chat2VaultView({} as never, controller, () => 25, {
      sourceRoot: () => "Sources",
      sourceRootPending: () => false,
      settingsGeneration: () => 0,
      sourceWriterPlatformEligible: () => true,
      createAdapter: () =>
        ({
          plan: async () => writablePlan,
          checkpointFolder: async () => ({
            status: "missing-safe",
            resolvedPath: "",
          }),
          createFolder: async () => undefined,
          verifyFolder: async () => ({ status: "safe" }),
          checkpointFinalParent: async () => ({
            status: "safe",
            resolvedTargetPath: writablePlan.targetPath,
          }),
          createNote: async (path: string, content: string) => {
            createdPath = path;
            createdContent = content;
          },
          verifyCreatedNote: async () => ({ status: "verified" }),
        }) as never,
      registerInvalidator: () => () => undefined,
    });
    document.body.append(view.contentEl);
    await view.onOpen();
    await controller.import([
      {
        name: "synthetic.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);
    view.contentEl.querySelector<HTMLButtonElement>(".c2v-row")?.click();
    const preview = [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Preview source note",
    );
    preview?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.contentEl.querySelector(".c2v-source script")).toBeNull();
    expect(
      view.contentEl
        .querySelector(".c2v-source pre > code")
        ?.textContent.startsWith("<script>"),
    ).toBe(true);
    expect(view.contentEl.textContent).toContain(
      "Source-note Markdown preview truncated",
    );
    expect(
      [...view.contentEl.querySelectorAll("button")].some(
        (button) => button.textContent === "Save source note",
      ),
    ).toBe(true);
    const save = [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Save source note",
    );
    save?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createdPath).toBe(writablePlan.targetPath);
    expect(createdContent).toBe(noteContent);
    expect(createdContent?.length).toBe(noteContent.length);
    expect(createdContent?.endsWith("😀tail")).toBe(true);
    await view.onClose();
  });

  it("fails closed with the exact diagnostic and zero source I/O on an unsupported platform", async () => {
    const item = conversation(0);
    const result = importResult([item]);
    const controller = new ImportController(() => Promise.resolve(result));
    let adapterCalls = 0;
    const view = new Chat2VaultView({} as never, controller, () => 25, {
      sourceRoot: () => "Sources",
      sourceRootPending: () => false,
      settingsGeneration: () => 0,
      sourceWriterPlatformEligible: () => false,
      createAdapter: () => {
        adapterCalls += 1;
        return { plan: async () => ({}) } as never;
      },
      registerInvalidator: () => () => undefined,
    });
    document.body.append(view.contentEl);
    await view.onOpen();
    await controller.import([
      {
        name: "synthetic.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);
    view.contentEl.querySelector<HTMLButtonElement>(".c2v-row")?.click();
    expect(
      [...view.contentEl.querySelectorAll("button")].some(
        (button) => button.textContent === "Preview source note",
      ),
    ).toBe(false);
    expect(view.contentEl.textContent).toContain(
      "UNSUPPORTED_SOURCE_WRITER_PLATFORM: Source-note writing is not qualified on this operating system in M03.",
    );
    expect(adapterCalls).toBe(0);
    await view.onClose();
  });
});
