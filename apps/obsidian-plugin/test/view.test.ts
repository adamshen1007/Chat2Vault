// @vitest-environment jsdom
import {
  fingerprint,
  type CanonicalConversation,
  type CanonicalMessage,
  type ImportDiagnostic,
  type ImportResult,
} from "@chat2vault/core";
import { beforeAll, describe, expect, it } from "vitest";

import { ImportController } from "../src/controller.js";
import { Chat2VaultView } from "../src/view.js";

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
});
