// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style -- synthetic DOM fixture controls are asserted below. */
import { describe, expect, it, vi } from "vitest";
import { KnowledgeDedupPanel } from "../src/dedup-panel.js";
import {
  parseKnowledgeCatalogNote,
  renderKnowledgeNote,
  sha256,
  type ReviewedKnowledgeCandidate,
  type ResolvedKnowledgeSource,
} from "@chat2vault/core";

const hash = (digit: string): string => `sha256:${digit.repeat(64)}`;
function existingFixture(body = "Existing knowledge payload") {
  const candidate: ReviewedKnowledgeCandidate = {
    id: hash("1"),
    originalCandidateFingerprint: hash("2"),
    type: "insight",
    confidence: "high",
    sourceRefs: [
      {
        provider: "chatgpt",
        conversationFingerprint: hash("3"),
        messageFingerprints: [hash("4")],
      },
    ],
    title: "Existing title",
    summary: "Existing summary",
    body,
    tags: ["synthetic"],
    decision: "accepted",
    selected: true,
  };
  const source: ResolvedKnowledgeSource = {
    provider: "chatgpt",
    conversationFingerprint: hash("3"),
    messageFingerprints: [hash("4")],
    sourceNotePath: "Sources/Synthetic.md",
  };
  const rendered = renderKnowledgeNote(candidate, [source]);
  if (!rendered.ok) throw new Error("synthetic fixture invalid");
  const path = `Knowledge/${rendered.filename}`;
  const bytes = new TextEncoder().encode(rendered.noteContent);
  const parsed = parseKnowledgeCatalogNote(path, bytes);
  if (parsed.status !== "eligible")
    throw new Error("synthetic fixture ineligible");
  return { path, bytes, note: parsed.note };
}

describe("M07 knowledge panel", () => {
  it("reloads a changed existing note and requires a new confirmation", async () => {
    const first = existingFixture();
    const changedBytes = new TextEncoder().encode(
      new TextDecoder()
        .decode(first.bytes)
        .replace(
          "Existing knowledge payload",
          "Newer existing knowledge payload",
        ),
    );
    expect(parseKnowledgeCatalogNote(first.path, changedBytes).status).toBe(
      "eligible",
    );
    const readKnowledgeNote = vi
      .fn()
      .mockResolvedValueOnce(first.bytes)
      .mockResolvedValue(changedBytes);
    const previewCombined = vi.fn().mockResolvedValue({
      status: "stale",
      diagnostics: [
        {
          code: "M07_SELECTED_CHANGED",
          severity: "error",
          message: "The selected note changed.",
        },
      ],
    });
    const root = document.createElement("section");
    const panel = new KnowledgeDedupPanel(root, {
      readKnowledgeNote,
      previewCombined,
      createCombined: vi.fn(),
      openKnowledgeNote: vi.fn(),
    });
    panel.render({
      candidates: [
        {
          id: "c1",
          title: "Candidate",
          summary: "Summary",
          body: "Body",
          tags: ["tag"],
          decision: "accepted",
        },
      ],
      matches: [
        {
          candidateId: "c1",
          result: {
            exact: [first.note],
            sameSource: [],
            sameSourceDetails: [],
            related: [],
          },
        },
      ],
      diagnostics: [],
    });
    (
      root.querySelector(
        `[aria-label="Select existing note ${first.path}"]`,
      ) as HTMLButtonElement
    ).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirm = root.querySelector(
      '[aria-label="Confirm combined draft"]',
    ) as HTMLInputElement;
    confirm.checked = true;
    confirm.dispatchEvent(new Event("change"));
    (
      root.querySelector(
        '[aria-label="Preview combined note"]',
      ) as HTMLButtonElement
    ).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(previewCombined).toHaveBeenCalledWith(
      "c1",
      first.path,
      expect.any(Object),
      sha256(first.bytes),
    );
    expect(readKnowledgeNote).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain("Newer existing knowledge payload");
    expect(
      (
        root.querySelector(
          '[aria-label="Confirm combined draft"]',
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        root.querySelector(
          '[aria-label="Create combined note"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("renders separate groups, safe open controls, and no combined Create before exact preview", async () => {
    const existing = existingFixture();
    const root = document.createElement("section");
    const previewCombined = vi.fn().mockResolvedValue({
      status: "ready",
      action: "create",
      entry: {
        targetPath: "Knowledge/new.md",
        noteContent: "# Full markdown\n",
      },
      selectedPath: existing.path,
      selectedByteDigest: sha256(existing.bytes),
      sourcePaths: ["Sources/source.md"],
    });
    const panel = new KnowledgeDedupPanel(root, {
      previewCombined,
      createCombined: vi.fn().mockResolvedValue({
        status: "completed",
        ledger: [],
        diagnostics: [],
      }),
      readKnowledgeNote: vi.fn().mockResolvedValue(existing.bytes),
      openKnowledgeNote: vi.fn(),
    });
    panel.render({
      candidates: [
        {
          id: "c1",
          title: "Candidate",
          summary: "Summary",
          body: "Body",
          tags: ["tag"],
          decision: "accepted",
        },
      ],
      matches: [
        {
          candidateId: "c1",
          result: {
            exact: [existing.note],
            sameSource: [
              { ...existing.note, path: "Knowledge/changed.md" },
              { ...existing.note, path: "Knowledge/alternative.md" },
            ],
            sameSourceDetails: [
              {
                path: "Knowledge/changed.md",
                kind: "changed-source-content",
              },
              {
                path: "Knowledge/alternative.md",
                kind: "alternative-extraction",
              },
            ],
            related: [{ path: "Knowledge/near.md", score: 0.8 }],
          },
        },
      ],
      diagnostics: [],
    });
    expect(
      root.querySelector('[aria-label="Exact duplicate notes"]'),
    ).not.toBeNull();
    expect(
      root.querySelector('[aria-label="Changed source content"]'),
    ).not.toBeNull();
    expect(
      root.querySelector(
        '[aria-label="Alternative extraction of unchanged source"]',
      ),
    ).not.toBeNull();
    expect(
      root.querySelector('[aria-label="Changed source content"]')?.textContent,
    ).toContain("Knowledge/changed.md");
    expect(
      root.querySelector(
        '[aria-label="Alternative extraction of unchanged source"]',
      )?.textContent,
    ).toContain("Knowledge/alternative.md");
    expect(
      root.querySelector('[aria-label="Related suggestions"]'),
    ).not.toBeNull();
    expect(
      root.querySelector('[aria-label="Create combined note"]'),
    ).toBeNull();
    (
      root.querySelector(
        `[aria-label="Select existing note ${existing.path}"]`,
      ) as HTMLButtonElement
    ).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain("Existing knowledge payload");
    expect(
      root.querySelector('[aria-label="Selected existing note, read only"]')
        ?.textContent,
    ).not.toContain("chat2vault_schema");
    expect(
      root.querySelector('[aria-label="Selected existing note, read only"]')
        ?.textContent,
    ).not.toContain("Derived from");
    expect(
      (
        root.querySelector(
          '[aria-label="Create combined note"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    const confirm = root.querySelector(
      '[aria-label="Confirm combined draft"]',
    ) as HTMLInputElement;
    confirm.checked = true;
    confirm.dispatchEvent(new Event("change"));
    expect(
      (
        root.querySelector(
          '[aria-label="Preview combined note"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    (
      root.querySelector(
        '[aria-label="Preview combined note"]',
      ) as HTMLButtonElement
    ).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain("Knowledge/new.md");
    expect(root.textContent).toContain("# Full markdown");
    expect(
      (
        root.querySelector(
          '[aria-label="Create combined note"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    (
      root.querySelector('[aria-label="Combined title"]') as HTMLInputElement
    ).value = "Changed";
    root
      .querySelector('[aria-label="Combined title"]')
      ?.dispatchEvent(new Event("input"));
    expect(
      (
        root.querySelector(
          '[aria-label="Create combined note"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    panel.render({
      candidates: [
        {
          id: "c1",
          title: "Candidate",
          summary: "Summary",
          body: "Body",
          tags: ["tag"],
          decision: "accepted",
        },
      ],
      matches: [],
      diagnostics: [],
    });
    expect(
      root.querySelector('[aria-label="Create combined note"]'),
    ).toBeNull();
  });

  it.each(["created", "identical-no-op", "create-failed"] as const)(
    "reports verified %s ledger with target path",
    async (ledgerStatus) => {
      const existing = existingFixture();
      const root = document.createElement("section");
      const panel = new KnowledgeDedupPanel(root, {
        readKnowledgeNote: vi.fn().mockResolvedValue(existing.bytes),
        openKnowledgeNote: vi.fn(),
        previewCombined: vi.fn().mockResolvedValue({
          status: "ready",
          action: ledgerStatus === "created" ? "create" : "identical-no-op",
          entry: {
            targetPath: "Knowledge/Combined.md",
            noteContent: "# Combined\n",
          },
          selectedPath: existing.path,
          selectedByteDigest: sha256(existing.bytes),
          sourcePaths: ["Sources/Synthetic.md"],
        }),
        createCombined: vi.fn().mockResolvedValue({
          status: ledgerStatus === "create-failed" ? "failed" : "saved",
          ledger: [
            { targetPath: "Knowledge/Combined.md", status: ledgerStatus },
          ],
          diagnostics: [],
        }),
      });
      panel.render({
        candidates: [
          {
            id: "c1",
            title: "New",
            summary: "New summary",
            body: "New body",
            tags: [],
            decision: "accepted",
          },
        ],
        matches: [
          {
            candidateId: "c1",
            result: {
              exact: [existing.note],
              sameSource: [],
              sameSourceDetails: [],
              related: [],
            },
          },
        ],
        diagnostics: [],
      });
      (
        root.querySelector(
          `[aria-label="Select existing note ${existing.path}"]`,
        ) as HTMLButtonElement
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const confirm = root.querySelector(
        '[aria-label="Confirm combined draft"]',
      ) as HTMLInputElement;
      confirm.checked = true;
      confirm.dispatchEvent(new Event("change"));
      (
        root.querySelector(
          '[aria-label="Preview combined note"]',
        ) as HTMLButtonElement
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      (
        root.querySelector(
          '[aria-label="Create combined note"]',
        ) as HTMLButtonElement
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(root.querySelector('[role="status"]')?.textContent).toContain(
        "Knowledge/Combined.md",
      );
      expect(root.querySelector('[role="status"]')?.textContent).toContain(
        ledgerStatus,
      );
    },
  );
});
