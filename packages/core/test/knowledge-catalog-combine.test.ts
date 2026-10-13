import { describe, expect, it } from "vitest";

import {
  parseKnowledgeCatalogNote,
  renderCombinedKnowledgeNote,
  renderKnowledgeNote,
  validateCombinedDraft,
  type CatalogKnowledgeNote,
  type CombinedKnowledgeInput,
  type ResolvedKnowledgeSource,
  type ReviewedKnowledgeCandidate,
} from "../src/index.js";

const hash = (digit: string): string => `sha256:${digit.repeat(64)}`;
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
  title: "Synthetic candidate",
  summary: "Candidate summary",
  body: "Candidate body",
  tags: ["candidate"],
  decision: "accepted",
  selected: true,
};
const source: ResolvedKnowledgeSource = {
  provider: "chatgpt",
  conversationFingerprint: hash("3"),
  messageFingerprints: [hash("4")],
  sourceNotePath: "Sources/Candidate.md",
};

function existing(): CatalogKnowledgeNote {
  const existingSource = {
    ...source,
    conversationFingerprint: hash("5"),
    messageFingerprints: [hash("6")],
    sourceNotePath: "Sources/Existing.md",
  };
  const rendered = renderKnowledgeNote(
    {
      ...candidate,
      title: "Existing",
      sourceRefs: [
        {
          provider: "chatgpt",
          conversationFingerprint: hash("5"),
          messageFingerprints: [hash("6")],
        },
      ],
    },
    [existingSource],
  );
  if (!rendered.ok) throw new Error("fixture render failed");
  const path = `Knowledge/${rendered.filename}`;
  const parsed = parseKnowledgeCatalogNote(
    path,
    new TextEncoder().encode(rendered.noteContent),
  );
  if (parsed.status !== "eligible") throw new Error("fixture parse failed");
  return parsed.note;
}

function input(
  overrides: Partial<CombinedKnowledgeInput> = {},
): CombinedKnowledgeInput {
  const selectedNote = existing();
  return {
    candidate,
    selectedNote,
    draft: {
      title: "Combined",
      summary: "Both summaries",
      body: "Both bodies",
      tags: ["combined"],
    },
    sourceNotes: [
      {
        provider: source.provider,
        conversationFingerprint: source.conversationFingerprint,
        sourceNotePath: source.sourceNotePath,
      },
      ...selectedNote.sourceNotes,
    ],
    existingContentFingerprints: [selectedNote.contentFingerprint],
    knowledgeRoot: "Knowledge",
    ...overrides,
  };
}

describe("M07 create-only combined knowledge rendering", () => {
  it("validates user edits with M06 limits and leaves the reviewed candidate untouched", () => {
    const reviewed = input().candidate;
    const valid = validateCombinedDraft(reviewed, input().draft);
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.candidate.title).toBe("Combined");
      expect(reviewed.title).toBe("Synthetic candidate");
    }
    expect(
      validateCombinedDraft(reviewed, {
        ...input().draft,
        tags: ["duplicate", "duplicate"],
      }),
    ).toEqual({ ok: false, code: "M07_DRAFT_INVALID" });
  });

  it("renders recoverable v2 metadata, canonical source union, and only the saved note link", () => {
    const rendered = renderCombinedKnowledgeNote(input());
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.noteContent).toContain("chat2vault_schema: 2");
    expect(rendered.noteContent).toContain(
      `combined_from: "[[${existing().path.slice(0, -3)}]]"`,
    );
    expect(rendered.noteContent).not.toContain("unsaved-candidate.md");
    expect(rendered.noteContent).not.toContain(hash("4"));
    expect(rendered.noteContent).toMatch(
      /\n\n## Source\n\n- Derived from \[\[Sources\/Candidate\]\]\.\n- Derived from \[\[Sources\/Existing\]\]\.\n$/u,
    );
    expect(rendered.targetPath).toBe(
      `Knowledge/Combined--${rendered.candidateFingerprint.slice(7, 19)}.md`,
    );
    expect(rendered.entry.action).toBe("create");
    expect(rendered.entry.targetPath).toBe(rendered.targetPath);
    expect(rendered.entry.noteContent).toBe(rendered.noteContent);
    const parsed = parseKnowledgeCatalogNote(
      rendered.targetPath,
      new TextEncoder().encode(rendered.noteContent),
    );
    expect(parsed.status).toBe("eligible");
    if (parsed.status === "eligible") {
      expect(parsed.note.contentFingerprint).toBe(rendered.contentFingerprint);
      expect(parsed.note.candidateFingerprint).toBe(
        rendered.candidateFingerprint,
      );
      expect(parsed.note.schemaVersion).toBe(2);
    }
  });

  it("is stable under source union reordering", () => {
    const first = renderCombinedKnowledgeNote(input());
    const reversed = renderCombinedKnowledgeNote(
      input({ sourceNotes: [...input().sourceNotes].reverse() }),
    );
    expect(first).toEqual(reversed);
  });

  it("blocks exact content duplicates in the complete catalog", () => {
    const rendered = renderCombinedKnowledgeNote(input());
    if (!rendered.ok) throw new Error("fixture render failed");
    expect(
      renderCombinedKnowledgeNote(
        input({
          existingContentFingerprints: [
            existing().contentFingerprint,
            rendered.contentFingerprint,
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "M07_EXACT_DUPLICATE" });
  });

  it("rejects excessive draft text or tags without truncation", () => {
    expect(
      renderCombinedKnowledgeNote(
        input({
          draft: {
            title: "Combined",
            summary: "x".repeat(100_000),
            body: "Body",
            tags: [],
          },
        }),
      ),
    ).toEqual({ ok: false, code: "M07_DRAFT_INVALID" });
    expect(
      renderCombinedKnowledgeNote(
        input({
          draft: {
            title: "Combined",
            summary: "Summary",
            body: "Body",
            tags: ["x".repeat(10_000)],
          },
        }),
      ),
    ).toEqual({ ok: false, code: "M07_DRAFT_INVALID" });
  });

  it("rejects unsafe selected and source paths", () => {
    expect(
      renderCombinedKnowledgeNote(
        input({
          selectedNote: { ...existing(), path: "Knowledge/../Outside.md" },
        }),
      ),
    ).toEqual({ ok: false, code: "M07_PATH_UNSAFE" });
    expect(
      renderCombinedKnowledgeNote(
        input({
          sourceNotes: [
            {
              provider: "chatgpt",
              conversationFingerprint: hash("3"),
              sourceNotePath: "Sources/Bad#heading.md",
            },
            ...existing().sourceNotes,
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "M07_PATH_UNSAFE" });
  });

  it("rejects forged selected-note identity fields", () => {
    expect(
      renderCombinedKnowledgeNote(
        input({
          selectedNote: { ...existing(), candidateFingerprint: hash("a") },
        }),
      ),
    ).toEqual({ ok: false, code: "M07_PATH_UNSAFE" });
    expect(
      renderCombinedKnowledgeNote(
        input({
          selectedNote: { ...existing(), contentFingerprint: hash("b") },
          existingContentFingerprints: [hash("b")],
        }),
      ),
    ).toEqual({ ok: false, code: "M07_DRAFT_INVALID" });
  });

  it("rejects a source union missing the candidate or selected note", () => {
    expect(
      renderCombinedKnowledgeNote(
        input({ sourceNotes: existing().sourceNotes }),
      ),
    ).toEqual({ ok: false, code: "M07_DRAFT_INVALID" });
    const candidateSource = input().sourceNotes[0];
    if (candidateSource === undefined)
      throw new Error("fixture source missing");
    expect(
      renderCombinedKnowledgeNote(input({ sourceNotes: [candidateSource] })),
    ).toEqual({ ok: false, code: "M07_DRAFT_INVALID" });
  });

  it("rejects a note above the catalog byte cap instead of truncating its sources", () => {
    const many = Array.from({ length: 800 }, (_, index) => ({
      provider: "chatgpt" as const,
      conversationFingerprint: `sha256:${index.toString(16).padStart(64, "0")}`,
      messageFingerprints: [hash("4")],
      sourceNotePath: `Sources/Synthetic-${String(index)}.md`,
    }));
    const selectedNote = existing();
    expect(
      renderCombinedKnowledgeNote(
        input({
          candidate: {
            ...candidate,
            sourceRefs: many.map(
              ({ provider, conversationFingerprint, messageFingerprints }) => ({
                provider,
                conversationFingerprint,
                messageFingerprints,
              }),
            ),
          },
          sourceNotes: [
            ...many.map(
              ({ provider, conversationFingerprint, sourceNotePath }) => ({
                provider,
                conversationFingerprint,
                sourceNotePath,
              }),
            ),
            ...selectedNote.sourceNotes,
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "M07_NOTE_TOO_LARGE" });
  });
});
