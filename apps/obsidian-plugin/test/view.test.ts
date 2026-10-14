// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/require-await -- synthetic UI fixtures use proven indexed values and async adapter mocks. */
import {
  buildDistillationRequest,
  fingerprint,
  parseKnowledgeCatalogNote,
  validateDistillationResult,
  type CanonicalConversation,
  type CanonicalMessage,
  type CatalogKnowledgeNote,
  type DistillationValidationResult,
  type ImportDiagnostic,
  type ImportResult,
  type PreviewCandidate,
} from "@chat2vault/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ImportController } from "../src/controller.js";
import {
  Chat2VaultView,
  type KnowledgeViewServices,
  type ManualDistillationViewServices,
} from "../src/view.js";
import type { KnowledgeVaultAdapter } from "../src/knowledge-vault-adapter.js";

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

async function openKnowledgeView(
  options: {
    knowledgeRoot?: string;
    observation?: "absent" | "conflict";
    createFails?: boolean;
    failCreateAt?: number;
    invalidateOnCreate?: boolean;
    candidateCount?: number;
    sourceRoot?: string;
    sourcePath?: string;
    sourceRootPending?: boolean;
    knowledgeRootPending?: boolean;
  } = {},
): Promise<{
  view: Chat2VaultView;
  controller: ImportController;
  adapter: KnowledgeVaultAdapter;
  created: Map<string, Uint8Array>;
  catalogNotes: CatalogKnowledgeNote[];
  openedNotes: string[];
  invalidate: (reason: "settings" | "unload") => void;
}> {
  const item = manualConversation();
  const built = buildDistillationRequest(item);
  if (!built.ok) throw new Error("Synthetic request failed");
  const created = new Map<string, Uint8Array>();
  const catalogNotes: CatalogKnowledgeNote[] = [];
  const openedNotes: string[] = [];
  let invalidator: ((reason: "settings" | "unload") => void) | undefined;
  let createCalls = 0;
  const adapter: KnowledgeVaultAdapter = {
    resolveKnowledgeSources: async (candidate) => ({
      ok: true,
      sources: candidate.sourceRefs.map((sourceRef) => ({
        ...sourceRef,
        messageFingerprints: [...sourceRef.messageFingerprints],
        sourceNotePath: options.sourcePath ?? "Sources/synthetic-source.md",
      })),
    }),
    observeKnowledgeTarget: async (path) => {
      if (options.observation === "conflict")
        return {
          status: "regular-file",
          bytes: new TextEncoder().encode("different bytes"),
        };
      const bytes = created.get(path);
      return bytes === undefined
        ? { status: "absent" }
        : { status: "regular-file", bytes: new Uint8Array(bytes) };
    },
    checkpointKnowledgeTarget: async (path) => ({
      status: "absent-safe",
      resolvedPath: path,
    }),
    createKnowledgeNote: async (path, content) => {
      createCalls += 1;
      if (options.createFails || createCalls === options.failCreateAt)
        throw new Error("synthetic create failure");
      created.set(path, new TextEncoder().encode(content));
      if (options.invalidateOnCreate) invalidator?.("settings");
    },
    readKnowledgeNote: async (path) => {
      const bytes = created.get(path);
      if (bytes === undefined) throw new Error("missing synthetic note");
      return new Uint8Array(bytes);
    },
  };
  const knowledgeServices: KnowledgeViewServices = {
    sourceRoot: () => options.sourceRoot ?? "Sources",
    sourceRootPending: () => options.sourceRootPending ?? false,
    sourceSettingsGeneration: () => 1,
    knowledgeRoot: () => options.knowledgeRoot ?? "Knowledge",
    knowledgeRootPending: () => options.knowledgeRootPending ?? false,
    settingsGeneration: () => 1,
    knowledgeWriterPlatformEligible: () => true,
    adapter,
    catalog: {
      readKnowledgeCatalog: async () => {
        const notes = [...created].flatMap(([path, bytes]) => {
          const parsed = parseKnowledgeCatalogNote(path, bytes);
          return parsed.status === "eligible" ? [parsed.note] : [];
        });
        notes.push(...catalogNotes);
        return {
          status: "ready" as const,
          notes,
          resolvedSources: [
            {
              provider: "chatgpt" as const,
              providerConversationId: "synthetic-conversation",
              conversationFingerprint: built.request.conversationFingerprint,
              messageFingerprints: [],
              sourceNotePath:
                options.sourcePath ?? "Sources/synthetic-source.md",
            },
          ],
          fingerprint: fingerprint({
            created: [...created].map(([path, bytes]) => [path, [...bytes]]),
            catalogNotes,
          }),
        };
      },
    },
    openKnowledgeNote: (path) => {
      openedNotes.push(path);
      return Promise.resolve();
    },
    registerInvalidator: (next) => {
      invalidator = next;
      return () => {
        invalidator = undefined;
      };
    },
  };
  const controller = new ImportController(() =>
    Promise.resolve(importResult([item])),
  );
  const view = new Chat2VaultView(
    {} as never,
    controller,
    () => 25,
    undefined,
    { writeClipboard: () => Promise.resolve() },
    undefined,
    knowledgeServices,
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
  const textarea = view.contentEl.querySelector<HTMLTextAreaElement>(
    '[aria-label="Paste strict JSON"]',
  );
  if (textarea === null) throw new Error("Missing manual result input");
  textarea.value = JSON.stringify({
    schemaVersion: 1,
    contractVersion: "m04-manual-v1",
    requestId: built.request.requestId,
    conversationFingerprint: built.request.conversationFingerprint,
    candidates: Array.from(
      { length: options.candidateCount ?? 1 },
      (_, index) => ({
        type: "insight",
        title:
          index === 0
            ? "<script>Exact knowledge title</script>"
            : `Exact knowledge title ${String(index + 1)}`,
        summary: `[[Exact summary stays inert ${String(index + 1)}]]`,
        body: `Exact body ${String(index + 1)} <img src=x onerror=alert(1)>`,
        confidence: "high",
        sourceMessageFingerprints: [built.request.messages[0]!.fingerprint],
        suggestedLinks: [],
        suggestedTags: ["synthetic"],
      }),
    ),
  });
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  view.contentEl
    .querySelector<HTMLButtonElement>('[aria-label="Validate result"]')
    ?.click();
  await flush();
  return {
    view,
    controller,
    adapter,
    created,
    catalogNotes,
    openedNotes,
    invalidate: (reason) => invalidator?.(reason),
  };
}

describe("preview view", () => {
  it("does not use innerHTML in the knowledge-review production view", () => {
    const source = readFileSync(resolve(process.cwd(), "src/view.ts"), "utf8");
    expect(source).not.toMatch(/\.innerHTML\b/u);
  });

  it("labels exact, same-source, and related catalog matches with open actions while only exact blocks write", async () => {
    const { view, catalogNotes, openedNotes } = await openKnowledgeView();
    const button = (label: string): HTMLButtonElement | undefined =>
      Array.from(
        view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find((entry) => entry.textContent === label);
    button("Accept")?.click();
    view.contentEl
      .querySelector<HTMLInputElement>(
        '[aria-label^="Select knowledge candidate"]',
      )
      ?.click();
    button("Dry run")?.click();
    await flush();
    const plan = view.contentEl.querySelector(".c2v-knowledge-plan-entry");
    const path = plan
      ?.querySelector("p")
      ?.textContent.replace("Target path: ", "");
    const markdown = plan?.querySelector("code")?.textContent;
    if (path === undefined || markdown === undefined)
      throw new Error("Missing exact dry-run");
    const parsed = parseKnowledgeCatalogNote(
      path,
      new TextEncoder().encode(markdown),
    );
    if (parsed.status !== "eligible")
      throw new Error("Invalid planned note fixture");
    const note = parsed.note;
    const exact = { ...note, path: "Knowledge/exact-aaaaaaaaaaaa.md" };
    const sameSource = {
      ...note,
      path: "Knowledge/same-bbbbbbbbbbbb.md",
      contentFingerprint: fingerprint("same-source"),
    };
    const related = {
      ...note,
      path: "Knowledge/related-cccccccccccc.md",
      contentFingerprint: fingerprint("related"),
      sourceNotes: [
        {
          provider: "chatgpt" as const,
          conversationFingerprint: fingerprint("other-conversation"),
          sourceNotePath: "Sources/other.md",
        },
      ],
    };
    catalogNotes.push(exact, sameSource, related);
    button("Dry run")?.click();
    await flush();
    expect(view.contentEl.textContent).toContain("Exact duplicates");
    expect(view.contentEl.textContent).toContain(
      "Alternative extraction of unchanged source",
    );
    expect(view.contentEl.textContent).toContain("Related suggestions");
    expect(button("Write")?.disabled).toBe(true);
    for (const existing of [exact, sameSource, related])
      button(`Open ${existing.path}`)?.click();
    expect(openedNotes).toEqual([exact.path, sameSource.path, related.path]);
    catalogNotes.shift();
    button("Dry run")?.click();
    await flush();
    expect(button("Write")?.disabled).toBe(false);
    await view.onClose();
  });

  it("renders labeled M06 decisions, bounded edits, and only eligible selection controls", async () => {
    const { view } = await openKnowledgeView();
    const candidate = view.contentEl.querySelector<HTMLElement>(
      ".c2v-knowledge-candidate",
    );
    expect(candidate).not.toBeNull();
    expect(candidate?.querySelector("script, img, a")).toBeNull();
    expect(candidate?.textContent).toContain(
      "<script>Exact knowledge title</script>",
    );
    expect(
      candidate?.querySelector('[role="group"]')?.getAttribute("aria-label"),
    ).toContain("Decision for");
    expect(candidate?.textContent).toContain("Type: insight");
    expect(candidate?.textContent).toContain("Confidence: high");
    expect(candidate?.textContent).toContain("Provenance:");

    const selection = candidate?.querySelector<HTMLInputElement>(
      '[aria-label^="Select knowledge candidate"]',
    );
    expect(selection?.disabled).toBe(true);
    const accept = Array.from(
      candidate?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent === "Accept");
    accept?.click();
    expect(
      view.contentEl.querySelector<HTMLInputElement>(
        '[aria-label^="Select knowledge candidate"]',
      )?.disabled,
    ).toBe(false);
    const selectAll = Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Select all eligible");
    expect(selectAll?.disabled).toBe(false);
    selectAll?.click();
    expect(
      view.contentEl.querySelector<HTMLInputElement>(
        '[aria-label^="Select knowledge candidate"]',
      )?.checked,
    ).toBe(true);

    const edit = Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".c2v-knowledge-candidate button",
      ),
    ).find((button) => button.textContent === "Edit");
    edit?.click();
    for (const label of [
      "Knowledge title",
      "Knowledge summary",
      "Knowledge body",
      "Knowledge tags, one per line",
    ]) {
      const field = view.contentEl.querySelector<
        HTMLInputElement | HTMLTextAreaElement
      >(`[aria-label="${label}"]`);
      expect(field).not.toBeNull();
      expect(field?.maxLength).toBeGreaterThan(0);
    }
    const title = view.contentEl.querySelector<HTMLInputElement>(
      '[aria-label="Knowledge title"]',
    );
    const summary = view.contentEl.querySelector<HTMLTextAreaElement>(
      '[aria-label="Knowledge summary"]',
    );
    const body = view.contentEl.querySelector<HTMLTextAreaElement>(
      '[aria-label="Knowledge body"]',
    );
    const tags = view.contentEl.querySelector<HTMLTextAreaElement>(
      '[aria-label="Knowledge tags, one per line"]',
    );
    if (title === null || summary === null || body === null || tags === null)
      throw new Error("Missing knowledge edit fields");
    title.value = "Edited title";
    summary.value = "Edited summary";
    body.value = "Edited body";
    tags.value = "edited\nsecond-tag";
    Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".c2v-knowledge-candidate button",
      ),
    )
      .find((button) => button.textContent === "Save edit")
      ?.click();
    expect(view.contentEl.textContent).toContain("Edited title");
    expect(view.contentEl.textContent).toContain("edited, second-tag");
    expect(view.contentEl.textContent).toContain("edited");

    Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".c2v-knowledge-candidate button",
      ),
    )
      .find((button) => button.textContent === "Reject")
      ?.click();
    expect(
      view.contentEl.querySelector<HTMLInputElement>(
        '[aria-label^="Select knowledge candidate"]',
      )?.disabled,
    ).toBe(true);
    expect(
      view.contentEl.querySelector<HTMLInputElement>(
        '[aria-label^="Select knowledge candidate"]',
      )?.checked,
    ).toBe(false);
    await view.onClose();
  });

  it("revokes a ready plan on the first dirty edit and keeps invalid Save fail-closed with zero mutation", async () => {
    const { view, created } = await openKnowledgeView();
    const button = (label: string): HTMLButtonElement | undefined =>
      Array.from(
        view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find((candidate) => candidate.textContent === label);
    button("Accept")?.click();
    view.contentEl
      .querySelector<HTMLInputElement>(
        '[aria-label^="Select knowledge candidate"]',
      )
      ?.click();
    button("Dry run")?.click();
    await flush();
    expect(button("Write")?.disabled).toBe(false);

    button("Edit")?.click();
    let title = view.contentEl.querySelector<HTMLInputElement>(
      '[aria-label="Knowledge title"]',
    );
    if (title === null) throw new Error("Missing title editor");
    title.value = "Dirty title";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    expect(button("Dry run")?.disabled).toBe(true);
    expect(button("Write")?.disabled).toBe(true);
    expect(view.contentEl.querySelector(".c2v-knowledge-plan")).toBeNull();
    const integration = view as unknown as {
      knowledgeController: { snapshot: { plan?: unknown } };
    };
    expect(integration.knowledgeController.snapshot.plan).toBeUndefined();
    button("Write")?.click();
    await flush();
    expect(created).toHaveLength(0);

    title = view.contentEl.querySelector<HTMLInputElement>(
      '[aria-label="Knowledge title"]',
    );
    if (title === null) throw new Error("Missing dirty title editor");
    title.value = "";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    button("Save edit")?.focus();
    button("Save edit")?.click();
    expect(view.contentEl.textContent).toContain("KNOWLEDGE_REVIEW_INVALID");
    expect(document.activeElement).toBe(
      view.contentEl.querySelector('[aria-label="Knowledge title"]'),
    );
    expect(button("Dry run")?.disabled).toBe(true);
    expect(button("Write")?.disabled).toBe(true);
    expect(created).toHaveLength(0);

    title = view.contentEl.querySelector<HTMLInputElement>(
      '[aria-label="Knowledge title"]',
    );
    if (title === null) throw new Error("Missing invalid title editor");
    title.value = "Valid saved title";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    button("Save edit")?.click();
    expect(button("Dry run")?.disabled).toBe(false);
    expect(button("Write")?.disabled).toBe(true);
    button("Dry run")?.click();
    await flush();
    expect(button("Write")?.disabled).toBe(false);
    expect(created).toHaveLength(0);
    await view.onClose();
  });

  it("restores deterministic keyboard focus after every M06 review transition", async () => {
    const { view } = await openKnowledgeView();
    const button = (label: string): HTMLButtonElement => {
      const result = Array.from(
        view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find((candidate) => candidate.textContent === label);
      if (result === undefined) throw new Error(`Missing ${label}`);
      return result;
    };
    const selected = (): HTMLInputElement => {
      const result = view.contentEl.querySelector<HTMLInputElement>(
        '[aria-label^="Select knowledge candidate"]',
      );
      if (result === null) throw new Error("Missing selection");
      return result;
    };

    button("Accept").focus();
    button("Accept").click();
    expect(document.activeElement).toBe(button("Accept"));

    button("Edit").focus();
    button("Edit").click();
    let title = view.contentEl.querySelector<HTMLInputElement>(
      '[aria-label="Knowledge title"]',
    );
    expect(document.activeElement).toBe(title);

    button("Cancel edit").focus();
    button("Cancel edit").click();
    expect(document.activeElement).toBe(button("Edit"));

    button("Edit").focus();
    button("Edit").click();
    title = view.contentEl.querySelector<HTMLInputElement>(
      '[aria-label="Knowledge title"]',
    );
    if (title === null) throw new Error("Missing title editor");
    title.value = "Keyboard saved title";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    button("Save edit").focus();
    button("Save edit").click();
    expect(document.activeElement).toBe(button("Edit"));

    button("Reject").focus();
    button("Reject").click();
    expect(document.activeElement).toBe(button("Reject"));

    button("Accept").focus();
    button("Accept").click();
    selected().focus();
    selected().click();
    expect(document.activeElement).toBe(selected());
    await view.onClose();
  });

  it("keeps edit labels bound to their own controls across simultaneous views", async () => {
    const first = await openKnowledgeView();
    const second = await openKnowledgeView();
    for (const view of [first.view, second.view])
      Array.from(view.contentEl.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "Edit")
        ?.click();

    const firstLabel = Array.from(
      first.view.contentEl.querySelectorAll<HTMLLabelElement>("label"),
    ).find((label) => label.textContent.startsWith("Knowledge title"));
    const secondLabel = Array.from(
      second.view.contentEl.querySelectorAll<HTMLLabelElement>("label"),
    ).find((label) => label.textContent.startsWith("Knowledge title"));
    const firstTitle = first.view.contentEl.querySelector<HTMLInputElement>(
      '[aria-label="Knowledge title"]',
    );
    const secondTitle = second.view.contentEl.querySelector<HTMLInputElement>(
      '[aria-label="Knowledge title"]',
    );
    expect(firstLabel?.control).toBe(firstTitle);
    expect(secondLabel?.control).toBe(secondTitle);
    expect(firstLabel?.control).not.toBe(secondLabel?.control);
    expect(firstTitle?.id === "" || firstTitle?.id !== secondTitle?.id).toBe(
      true,
    );
    await first.view.onClose();
    await second.view.onClose();
  });

  it("requires eligible selection and valid non-overlapping roots before an exact dry-run", async () => {
    const { view } = await openKnowledgeView();
    const dryRun = (): HTMLButtonElement | undefined =>
      Array.from(
        view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent === "Dry run");
    const write = (): HTMLButtonElement | undefined =>
      Array.from(
        view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent === "Write");
    expect(dryRun()?.disabled).toBe(true);
    expect(write()?.disabled).toBe(true);
    Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".c2v-knowledge-candidate button",
      ),
    )
      .find((button) => button.textContent === "Accept")
      ?.click();
    const select = view.contentEl.querySelector<HTMLInputElement>(
      '[aria-label^="Select knowledge candidate"]',
    );
    select?.click();
    expect(dryRun()?.disabled).toBe(false);
    dryRun()?.click();
    await flush();

    const integration = view as unknown as {
      knowledgeController: {
        snapshot: {
          status: string;
          plan?: { entries: readonly { noteContent: string }[] };
        };
      };
    };
    const exactMarkdown =
      integration.knowledgeController.snapshot.plan?.entries[0]?.noteContent;
    expect(view.contentEl.textContent).toContain("Selected candidates: 1");
    expect(view.contentEl.textContent).toContain("Target path:");
    expect(view.contentEl.textContent).toContain("Action: create");
    expect(
      view.contentEl.querySelector(".c2v-knowledge-plan pre > code")
        ?.textContent,
    ).toBe(exactMarkdown);
    expect(write()?.disabled).toBe(false);
    expect(
      view.contentEl.querySelector(".c2v-knowledge-plan script, img, a"),
    ).toBeNull();
    await view.onClose();

    const overlap = await openKnowledgeView({ knowledgeRoot: "Sources/AI" });
    Array.from(
      overlap.view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".c2v-knowledge-candidate button",
      ),
    )
      .find((button) => button.textContent === "Accept")
      ?.click();
    overlap.view.contentEl
      .querySelector<HTMLInputElement>(
        '[aria-label^="Select knowledge candidate"]',
      )
      ?.click();
    expect(
      Array.from(
        overlap.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent === "Dry run")?.disabled,
    ).toBe(true);
    await overlap.view.onClose();

    const unconfigured = await openKnowledgeView({ knowledgeRoot: "" });
    Array.from(
      unconfigured.view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".c2v-knowledge-candidate button",
      ),
    )
      .find((button) => button.textContent === "Accept")
      ?.click();
    unconfigured.view.contentEl
      .querySelector<HTMLInputElement>(
        '[aria-label^="Select knowledge candidate"]',
      )
      ?.click();
    expect(
      Array.from(
        unconfigured.view.contentEl.querySelectorAll<HTMLButtonElement>(
          "button",
        ),
      ).find((button) => button.textContent === "Dry run")?.disabled,
    ).toBe(true);
    await unconfigured.view.onClose();
  });

  it("keeps dry-run and write disabled while the source-root save is pending", async () => {
    const options = { sourceRootPending: false };
    const { view, created } = await openKnowledgeView(options);
    const button = (label: string): HTMLButtonElement | undefined =>
      Array.from(
        view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find((candidate) => candidate.textContent === label);

    options.sourceRootPending = true;
    button("Accept")?.click();

    expect(view.contentEl.textContent).toContain(
      "The source folder setting is still being saved.",
    );
    expect(button("Dry run")?.disabled).toBe(true);
    expect(button("Write")?.disabled).toBe(true);
    expect(created.size).toBe(0);
    await view.onClose();
  });

  it.each([
    ["Sources#Archive", "Sources#Archive/Foo.md"],
    ["Sources", "Sources/Foo#Archive.md"],
    ["Sources^Archive", "Sources^Archive/Foo.md"],
    ["Sources", "Sources/Foo^Archive.md"],
    ["Sources%%Archive", "Sources%%Archive/Foo.md"],
    ["Sources", "Sources/Foo%%Archive.md"],
    ["Sources[[Archive", "Sources[[Archive/Foo.md"],
    ["Sources", "Sources/Foo[[Archive.md"],
    ["Sources]]Archive", "Sources]]Archive/Foo.md"],
    ["Sources", "Sources/Foo]]Archive.md"],
  ])(
    "keeps dry-run and write closed for reserved source link %s/%s",
    async (sourceRoot, sourcePath) => {
      const { view, created } = await openKnowledgeView({
        sourceRoot,
        sourcePath,
      });
      const button = (label: string): HTMLButtonElement | undefined =>
        Array.from(
          view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
        ).find((candidate) => candidate.textContent === label);
      button("Accept")?.click();
      view.contentEl
        .querySelector<HTMLInputElement>(
          '[aria-label^="Select knowledge candidate"]',
        )
        ?.click();
      button("Dry run")?.click();
      await flush();

      expect(view.contentEl.textContent).toContain(
        "A knowledge source could not be resolved.",
      );
      expect(button("Write")?.disabled).toBe(true);
      button("Write")?.click();
      await flush();
      expect(created.size).toBe(0);
      await view.onClose();
    },
  );

  it("blocks conflicts, writes only a current ready plan, and renders the complete content-free ledger", async () => {
    const conflict = await openKnowledgeView({ observation: "conflict" });
    Array.from(
      conflict.view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".c2v-knowledge-candidate button",
      ),
    )
      .find((button) => button.textContent === "Accept")
      ?.click();
    conflict.view.contentEl
      .querySelector<HTMLInputElement>(
        '[aria-label^="Select knowledge candidate"]',
      )
      ?.click();
    Array.from(
      conflict.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Dry run")
      ?.click();
    await flush();
    expect(conflict.view.contentEl.textContent).toContain("Action: conflict");
    expect(
      Array.from(
        conflict.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent === "Write")?.disabled,
    ).toBe(true);
    await conflict.view.onClose();

    const writable = await openKnowledgeView({ candidateCount: 2 });
    for (const accept of Array.from(
      writable.view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".c2v-knowledge-candidate button",
      ),
    ).filter((button) => button.textContent === "Accept"))
      accept.click();
    Array.from(
      writable.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Select all eligible")
      ?.click();
    Array.from(
      writable.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Dry run")
      ?.click();
    await flush();
    Array.from(
      writable.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Write")
      ?.click();
    await flush();
    const ledger = writable.view.contentEl.querySelector(
      ".c2v-knowledge-ledger",
    );
    expect(ledger?.textContent).toContain("created");
    expect(ledger?.querySelectorAll("li")).toHaveLength(2);
    expect(writable.created).toHaveLength(2);
    const diagnostics = writable.view.contentEl.querySelector(
      ".c2v-knowledge-diagnostics",
    );
    expect(diagnostics?.textContent ?? "").not.toContain("Exact body");

    Array.from(
      writable.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Dry run")
      ?.click();
    await flush();
    expect(writable.view.contentEl.textContent).toContain(
      "M07_EXACT_DUPLICATE",
    );
    expect(
      Array.from(
        writable.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent === "Write")?.disabled,
    ).toBe(true);
    expect(writable.created).toHaveLength(2);
    await writable.view.onClose();

    const partial = await openKnowledgeView({
      candidateCount: 2,
      failCreateAt: 2,
    });
    for (const accept of Array.from(
      partial.view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".c2v-knowledge-candidate button",
      ),
    ).filter((button) => button.textContent === "Accept"))
      accept.click();
    Array.from(
      partial.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Select all eligible")
      ?.click();
    Array.from(
      partial.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Dry run")
      ?.click();
    await flush();
    Array.from(
      partial.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Write")
      ?.click();
    await flush();
    expect(partial.view.contentEl.textContent).toContain(
      "Write status: partial",
    );
    expect(
      Array.from(
        partial.view.contentEl.querySelectorAll(".c2v-knowledge-ledger li"),
      ).map((entry) => entry.textContent),
    ).toEqual([
      expect.stringContaining("created"),
      expect.stringContaining("create-failed"),
    ]);
    expect(
      partial.view.contentEl.querySelector(
        ".c2v-knowledge-ledger .c2v-knowledge-diagnostics",
      )?.textContent ?? "",
    ).not.toContain("Exact body");
    await partial.view.onClose();

    const stale = await openKnowledgeView({
      candidateCount: 2,
      invalidateOnCreate: true,
    });
    for (const accept of Array.from(
      stale.view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".c2v-knowledge-candidate button",
      ),
    ).filter((button) => button.textContent === "Accept"))
      accept.click();
    Array.from(
      stale.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Select all eligible")
      ?.click();
    Array.from(
      stale.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Dry run")
      ?.click();
    await flush();
    Array.from(
      stale.view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    )
      .find((button) => button.textContent === "Write")
      ?.click();
    await flush();
    expect(stale.view.contentEl.textContent).toContain("Write status: stale");
    expect(stale.view.contentEl.textContent).toContain("KNOWLEDGE_PLAN_STALE");
    expect(
      stale.view.contentEl.querySelectorAll(".c2v-knowledge-ledger li"),
    ).toHaveLength(2);
    expect(
      stale.view.contentEl.querySelector(
        ".c2v-knowledge-ledger .c2v-knowledge-diagnostics",
      )?.textContent ?? "",
    ).not.toContain("Exact body");
    await stale.view.onClose();
  });

  it("installs only validated candidate replacements and invalidates review state on settings, selection, import, close, and unload", async () => {
    const { view, invalidate } = await openKnowledgeView();
    expect(
      view.contentEl.querySelectorAll(".c2v-knowledge-candidate"),
    ).toHaveLength(1);
    invalidate("settings");
    expect(view.contentEl.querySelector(".c2v-knowledge-candidate")).toBeNull();
    expect(view.contentEl.textContent).not.toContain("Exact knowledge title");
    await view.onClose();

    const selection = await openKnowledgeView();
    const search = selection.view.contentEl.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    if (search === null) throw new Error("Missing conversation search");
    search.value = "no matching conversation";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      selection.view.contentEl.querySelector(".c2v-knowledge-candidate"),
    ).toBeNull();
    await selection.view.onClose();

    const imported = await openKnowledgeView();
    await imported.controller.import([
      {
        name: "replacement.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);
    expect(
      imported.view.contentEl.querySelector(".c2v-knowledge-candidate"),
    ).toBeNull();
    await imported.view.onClose();

    const unloaded = await openKnowledgeView();
    unloaded.invalidate("unload");
    const unloadedIntegration = unloaded.view as unknown as {
      loaded: boolean;
      knowledgeController: { snapshot: { status: string } };
    };
    expect(unloadedIntegration.loaded).toBe(false);
    expect(unloadedIntegration.knowledgeController.snapshot.status).toBe(
      "empty",
    );
    await unloaded.view.onClose();
    expect(unloaded.view.contentEl.childElementCount).toBe(0);
  });

  it("renders provider preflight and execute controls without candidate write actions", async () => {
    const item = manualConversation();
    const controller = new ImportController(() =>
      Promise.resolve(importResult([item])),
    );
    const Constructor = Chat2VaultView as unknown as new (
      ...args: unknown[]
    ) => Chat2VaultView;
    const transport = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        code: "PROVIDER_NETWORK_FAILED" as const,
      }),
    );
    let credentialState = "configured" as
      "configured" | "missing" | "unknown" | "unavailable";
    let providerSettingsStatusCode:
      "PROVIDER_SETTINGS_SAVING" | "PROVIDER_SETTINGS_SAVE_FAILED" | undefined;
    let stateObserver: (() => void) | undefined;
    const view = new Constructor(
      {},
      controller,
      () => 25,
      undefined,
      { writeClipboard: () => Promise.resolve() },
      {
        current: () => ({
          platformEligible: true,
          unsupportedFutureSettings: false,
          identityState: "authoritative",
          credentialState,
          credentialOperationInProgress: false,
          providerSettingsSaving: false,
          providerSettingsStatusCode,
          cloudDisclosureAccepted: true,
          providerSettingsGeneration: 1,
          providerSaveGeneration: 1,
          credentialGeneration: 1,
          config: {
            endpoint: "https://m05.invalid/v1/chat/completions",
            hostname: "m05.invalid",
            port: 443,
            model: "synthetic-m05-model",
            timeoutMs: 60_000,
            maxOutputTokens: 4_096,
          },
        }),
        readCredential: () => ({ ok: true, secret: "synthetic-key" }),
        transport,
        observeCredentialOnViewOpen: () => ({ ok: true, status: "configured" }),
        registerInvalidator: () => () => undefined,
        registerStateObserver: (observer: () => void) => {
          stateObserver = observer;
          return () => {
            stateObserver = undefined;
          };
        },
      },
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

    for (const text of [
      "Destination",
      "Model",
      "Prompt bytes",
      "Maximum output tokens",
      "Distill with provider",
    ])
      expect(view.contentEl.textContent).toContain(text);
    for (const forbidden of [
      "Accept candidate",
      "Edit candidate",
      "Save candidate",
    ])
      expect(view.contentEl.textContent).not.toContain(forbidden);
    const live = view.contentEl.querySelector(".c2v-provider-status");
    expect(live?.getAttribute("role")).toBe("status");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.getAttribute("aria-atomic")).toBe("true");
    credentialState = "missing";
    stateObserver?.();
    const missingLive = view.contentEl.querySelector(".c2v-provider-status");
    expect(missingLive).toBe(live);
    expect(view.contentEl.textContent).toContain(
      "Save a provider API key in macOS Keychain before sending.",
    );
    expect(
      view.contentEl.querySelector<HTMLButtonElement>(".c2v-provider-distill")
        ?.disabled,
    ).toBe(true);
    stateObserver?.();
    expect(view.contentEl.querySelector(".c2v-provider-status")).toBe(live);
    credentialState = "configured";
    providerSettingsStatusCode = "PROVIDER_SETTINGS_SAVING";
    stateObserver?.();
    expect(view.contentEl.querySelector(".c2v-provider-status")).toBe(live);
    expect(view.contentEl.textContent).toContain(
      "Provider settings are being saved.",
    );
    expect(
      view.contentEl.querySelector<HTMLButtonElement>(".c2v-provider-distill")
        ?.disabled,
    ).toBe(true);
    providerSettingsStatusCode = "PROVIDER_SETTINGS_SAVE_FAILED";
    stateObserver?.();
    expect(view.contentEl.textContent).toContain(
      "Provider settings could not be saved.",
    );
    providerSettingsStatusCode = undefined;
    stateObserver?.();
    view.contentEl
      .querySelector<HTMLButtonElement>(".c2v-provider-distill")
      ?.click();
    await flush();
    expect(transport).toHaveBeenCalledOnce();
    expect(view.contentEl.textContent).toContain(
      "The provider request failed before a valid response was received.",
    );
    await view.onClose();
  });

  it.each(["saving", "failed"] as const)(
    "does not observe Keychain status when identity is %s",
    async (identityState) => {
      const controller = new ImportController(() =>
        Promise.resolve(importResult([])),
      );
      const observe = vi.fn(() => ({
        ok: true as const,
        status: "configured" as const,
      }));
      const view = new Chat2VaultView(
        {} as never,
        controller,
        () => 25,
        undefined,
        undefined,
        {
          current: () => ({
            platformEligible: true,
            unsupportedFutureSettings: false,
            identityState,
            credentialState: "unknown",
            credentialOperationInProgress: false,
            providerSettingsSaving: false,
            cloudDisclosureAccepted: false,
            providerSettingsGeneration: 0,
            providerSaveGeneration: 0,
            credentialGeneration: 0,
          }),
          readCredential: () => ({
            ok: false,
            code: "KEYCHAIN_STATUS_UNKNOWN",
          }),
          transport: () =>
            Promise.resolve({ ok: false, code: "PROVIDER_NETWORK_FAILED" }),
          observeCredentialOnViewOpen: observe,
          registerInvalidator: () => () => undefined,
        },
      );
      await view.onOpen();
      expect(observe).not.toHaveBeenCalled();
      await view.onClose();
    },
  );

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
      {
        current: () => ({
          platformEligible: true,
          unsupportedFutureSettings: false,
          identityState: "authoritative",
          credentialState: "configured",
          credentialOperationInProgress: false,
          providerSettingsSaving: false,
          cloudDisclosureAccepted: true,
          providerSettingsGeneration: 1,
          providerSaveGeneration: 1,
          credentialGeneration: 1,
          config: {
            endpoint: "https://m05.invalid/v1/chat/completions",
            hostname: "m05.invalid",
            port: 443,
            model: "synthetic-m05-model",
            timeoutMs: 60_000,
            maxOutputTokens: 4_096,
          },
        }),
        readCredential: () => ({ ok: true, secret: "synthetic-key" }),
        transport: () =>
          Promise.resolve({ ok: false, code: "PROVIDER_NETWORK_FAILED" }),
        observeCredentialOnViewOpen: () => ({
          ok: true,
          status: "configured",
        }),
        registerInvalidator: () => () => undefined,
      },
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

    const panel = view.contentEl.querySelector(".c2v-detail");
    const keyboardOrder = [
      "Prepare manual prompt",
      "Copy prompt",
      "Paste strict JSON",
      "Validate result",
      "Distill with provider",
      "Candidates per page",
      "Next page",
    ];
    expect(
      [
        ...panel!.querySelectorAll(
          "button:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
        ),
      ].map(
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

  it.each(["Prepare", "Validate"] as const)(
    "uses one preview winner and synchronously clears provider candidates on accepted %s entry",
    async (manualKind) => {
      const item = manualConversation();
      const built = buildDistillationRequest(item);
      if (!built.ok) throw new Error("Synthetic request failed");
      const controller = new ImportController(() =>
        Promise.resolve(importResult([item])),
      );
      const providerCandidate: PreviewCandidate = {
        id: "provider-candidate",
        candidateFingerprint: `sha256:${"4".repeat(64)}`,
        type: "insight",
        title: "Provider winner",
        summary: "Provider summary",
        body: "Provider body",
        status: "proposed",
        confidence: "high",
        sourceRefs: [
          {
            provider: "unknown",
            conversationFingerprint: built.request.conversationFingerprint,
            messageFingerprints: [built.request.messages[0]!.fingerprint],
          },
        ],
        suggestedLinks: [],
        suggestedTags: [],
      };
      let failProviderTransport = false;
      let invalidateProviderResult = false;
      const knowledgeAdapter: KnowledgeVaultAdapter = {
        resolveKnowledgeSources: async (candidate) => ({
          ok: true,
          sources: candidate.sourceRefs.map((sourceRef) => ({
            ...sourceRef,
            messageFingerprints: [...sourceRef.messageFingerprints],
            sourceNotePath: "Sources/synthetic-source.md",
          })),
        }),
        observeKnowledgeTarget: async () => ({ status: "absent" }),
        checkpointKnowledgeTarget: async (path) => ({
          status: "absent-safe",
          resolvedPath: path,
        }),
        createKnowledgeNote: async () => undefined,
        readKnowledgeNote: async () => new Uint8Array(),
      };
      const view = new Chat2VaultView(
        {} as never,
        controller,
        () => 25,
        undefined,
        { writeClipboard: () => Promise.resolve() },
        {
          current: () => ({
            platformEligible: true,
            unsupportedFutureSettings: false,
            identityState: "authoritative",
            credentialState: "configured",
            credentialOperationInProgress: false,
            providerSettingsSaving: false,
            cloudDisclosureAccepted: true,
            providerSettingsGeneration: 1,
            providerSaveGeneration: 1,
            credentialGeneration: 1,
            config: {
              endpoint: "https://m05.invalid/v1/chat/completions",
              hostname: "m05.invalid",
              port: 443,
              model: "synthetic-m05-model",
              timeoutMs: 60_000,
              maxOutputTokens: 4_096,
            },
          }),
          readCredential: () => ({ ok: true, secret: "synthetic-key" }),
          transport: () =>
            failProviderTransport
              ? Promise.resolve({
                  ok: false as const,
                  code: "PROVIDER_NETWORK_FAILED" as const,
                })
              : Promise.resolve({
                  ok: true as const,
                  status: 200,
                  body: new TextEncoder().encode(
                    JSON.stringify({
                      choices: [{ message: { content: "synthetic-result" } }],
                    }),
                  ),
                }),
          validateResult: () =>
            invalidateProviderResult
              ? { ok: false, diagnostics: [] }
              : {
                  ok: true,
                  candidates: [providerCandidate],
                },
          observeCredentialOnViewOpen: () => ({
            ok: true,
            status: "configured",
          }),
          registerInvalidator: () => () => undefined,
        },
        {
          sourceRoot: () => "Sources",
          sourceRootPending: () => false,
          sourceSettingsGeneration: () => 1,
          knowledgeRoot: () => "Knowledge",
          knowledgeRootPending: () => false,
          settingsGeneration: () => 1,
          knowledgeWriterPlatformEligible: () => true,
          adapter: knowledgeAdapter,
          catalog: {
            readKnowledgeCatalog: async () => ({
              status: "ready",
              notes: [],
              resolvedSources: [],
              fingerprint: "synthetic-empty",
            }),
          },
          registerInvalidator: () => () => undefined,
        },
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
        .querySelector<HTMLButtonElement>(
          '[aria-label="Prepare manual prompt"]',
        )
        ?.click();
      await flush();
      const textarea = view.contentEl.querySelector<HTMLTextAreaElement>(
        '[aria-label="Paste strict JSON"]',
      )!;
      textarea.value = JSON.stringify({
        schemaVersion: 1,
        contractVersion: "m04-manual-v1",
        requestId: built.request.requestId,
        conversationFingerprint: built.request.conversationFingerprint,
        candidates: [
          {
            type: "insight",
            title: "Manual winner",
            summary: "Manual summary",
            body: "Manual body",
            confidence: "high",
            sourceMessageFingerprints: [built.request.messages[0]!.fingerprint],
            suggestedLinks: [],
            suggestedTags: [],
          },
        ],
      });
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      view.contentEl
        .querySelector<HTMLButtonElement>('[aria-label="Validate result"]')
        ?.click();
      await flush();
      expect(view.contentEl.textContent).toContain("Manual winner");

      view.contentEl
        .querySelector<HTMLButtonElement>(".c2v-provider-distill")
        ?.click();
      await flush();
      expect(view.contentEl.textContent).toContain("Provider winner");
      expect(view.contentEl.textContent).not.toContain("Manual winner");
      expect(
        view.contentEl.querySelectorAll(".c2v-knowledge-candidate"),
      ).toHaveLength(1);
      expect(
        view.contentEl.querySelector(".c2v-knowledge-candidate")?.textContent,
      ).toContain("Provider winner");
      invalidateProviderResult = true;
      view.contentEl
        .querySelector<HTMLButtonElement>(".c2v-provider-distill")
        ?.click();
      await flush();
      expect(view.contentEl.textContent).toContain("Provider winner");
      expect(view.contentEl.textContent).toContain(
        "The provider result did not satisfy the distillation contract.",
      );
      expect(
        view.contentEl.querySelector(".c2v-knowledge-candidate")?.textContent,
      ).toContain("Provider winner");
      invalidateProviderResult = false;
      failProviderTransport = true;
      view.contentEl
        .querySelector<HTMLButtonElement>(".c2v-provider-distill")
        ?.click();
      await flush();
      expect(view.contentEl.textContent).toContain("Provider winner");
      expect(view.contentEl.textContent).toContain(
        "The provider request failed before a valid response was received.",
      );

      if (manualKind === "Prepare")
        view.contentEl
          .querySelector<HTMLButtonElement>(
            '[aria-label="Prepare manual prompt"]',
          )
          ?.click();
      else
        view.contentEl
          .querySelector<HTMLButtonElement>('[aria-label="Validate result"]')
          ?.click();
      expect(view.contentEl.textContent).not.toContain("Provider winner");
      await flush();
      await view.onClose();
    },
  );

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
