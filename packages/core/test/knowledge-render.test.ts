import { describe, expect, it } from "vitest";

import {
  renderKnowledgeNote,
  safeKnowledgeFilename,
  type ResolvedKnowledgeSource,
  type ReviewedKnowledgeCandidate,
} from "../src/index.js";

const FINGERPRINT_1 = `sha256:${"1".repeat(64)}`;
const FINGERPRINT_2 = `sha256:${"2".repeat(64)}`;
const CONVERSATION_FINGERPRINT = `sha256:${"3".repeat(64)}`;
const MESSAGE_FINGERPRINT_1 = `sha256:${"4".repeat(64)}`;
const MESSAGE_FINGERPRINT_2 = `sha256:${"5".repeat(64)}`;

function reviewedCandidate(
  overrides: Partial<ReviewedKnowledgeCandidate> = {},
): ReviewedKnowledgeCandidate {
  return {
    id: FINGERPRINT_1,
    originalCandidateFingerprint: FINGERPRINT_2,
    type: "insight",
    confidence: "high",
    sourceRefs: [
      {
        provider: "chatgpt",
        providerConversationId: "conv-synthetic",
        conversationFingerprint: CONVERSATION_FINGERPRINT,
        messageFingerprints: [MESSAGE_FINGERPRINT_2, MESSAGE_FINGERPRINT_1],
      },
    ],
    title: "Edited",
    summary: "Line one\r\n---\r\nnew_key: no",
    body: "# Inner\r\n[[not provenance]]",
    tags: ["beta", "alpha"],
    decision: "edited",
    selected: true,
    ...overrides,
  };
}

function resolvedSource(
  overrides: Partial<ResolvedKnowledgeSource> = {},
): ResolvedKnowledgeSource {
  return {
    provider: "chatgpt",
    providerConversationId: "conv-synthetic",
    conversationFingerprint: CONVERSATION_FINGERPRINT,
    messageFingerprints: [MESSAGE_FINGERPRINT_1, MESSAGE_FINGERPRINT_2],
    sourceNotePath: "Sources/Synthetic [Source].md",
    ...overrides,
  };
}

describe("M06 knowledge rendering", () => {
  it("renders the fixed LF-only golden Markdown and fixed fingerprints", () => {
    const fixedCandidateFingerprint =
      "sha256:8ddfa89256ac663cdaaf8f6d54aca83ab5788f0e3ef66bdffc193879252bca42";
    const fixedNoteFingerprint =
      "sha256:181b2c7192aeb376b7b01891239f3c789b6365539ffc6d182848ad31c9dd577f";
    const fixedGoldenMarkdown = `---
chat2vault_schema: 1
type: insight
status: accepted
created_from: ai-conversation
candidate_fingerprint: "sha256:8ddfa89256ac663cdaaf8f6d54aca83ab5788f0e3ef66bdffc193879252bca42"
source_provider: chatgpt
source_fingerprint: "sha256:3333333333333333333333333333333333333333333333333333333333333333"
source_conversation: "[[Sources/Synthetic \\\\[Source\\\\]]]"
tags:
  - "knowledge"
  - "alpha"
  - "beta"
---

# Edited

## Summary

Line one
---
new_key: no

## Knowledge

# Inner
[[not provenance]]

## Source

Derived from [[Sources/Synthetic \\[Source\\]]].
`;

    expect(
      renderKnowledgeNote(reviewedCandidate(), [resolvedSource()]),
    ).toEqual({
      ok: true,
      candidateFingerprint: fixedCandidateFingerprint,
      filename: `Edited--${fixedCandidateFingerprint.slice(7, 19)}.md`,
      noteContent: fixedGoldenMarkdown,
      noteContentFingerprint: fixedNoteFingerprint,
    });
    expect(fixedGoldenMarkdown).not.toContain("\r");
  });

  it("canonicalizes tags, source order, message order, and line endings", () => {
    const second: ResolvedKnowledgeSource = {
      provider: "unknown",
      conversationFingerprint: `sha256:${"6".repeat(64)}`,
      messageFingerprints: [`sha256:${"7".repeat(64)}`],
      sourceNotePath: "Sources/Other.md",
    };
    const sourceRef = {
      provider: second.provider,
      conversationFingerprint: second.conversationFingerprint,
      messageFingerprints: [...second.messageFingerprints],
    };
    const first = reviewedCandidate({
      id: `sha256:${"8".repeat(64)}`,
      originalCandidateFingerprint: `sha256:${"9".repeat(64)}`,
      confidence: "low",
      sourceRefs: [...reviewedCandidate().sourceRefs, sourceRef],
    });
    const reordered = reviewedCandidate({
      id: `sha256:${"a".repeat(64)}`,
      originalCandidateFingerprint: `sha256:${"b".repeat(64)}`,
      confidence: "medium",
      sourceRefs: [sourceRef, ...reviewedCandidate().sourceRefs],
      summary: "Line one\n---\nnew_key: no",
      body: "# Inner\n[[not provenance]]",
      tags: ["alpha", "beta"],
      decision: "accepted",
      selected: false,
    });

    const left = renderKnowledgeNote(first, [resolvedSource(), second]);
    const right = renderKnowledgeNote(reordered, [second, resolvedSource()]);
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(left.candidateFingerprint).toBe(right.candidateFingerprint);
    expect(left.noteContent).toBe(right.noteContent);
    expect(left.noteContent).toContain(
      'source_provider:\n  - chatgpt\n  - unknown\nsource_fingerprint:\n  - "sha256:3333',
    );
    expect(left.noteContent).toContain(
      "- Derived from [[Sources/Synthetic \\[Source\\]]].\n- Derived from [[Sources/Other]].",
    );
  });

  it("uses portable fallback and sanitization without numeric suffixes", () => {
    const fingerprint = `sha256:${"a".repeat(64)}`;
    expect(safeKnowledgeFilename("../Hello", fingerprint)).toBe(
      "Hello--aaaaaaaaaaaa.md",
    );
    expect(safeKnowledgeFilename("CON", fingerprint)).toBe(
      "Untitled knowledge--aaaaaaaaaaaa.md",
    );
    expect(safeKnowledgeFilename("  ...  ", fingerprint)).toBe(
      "Untitled knowledge--aaaaaaaaaaaa.md",
    );
    expect(safeKnowledgeFilename("a/b\\c:<d>?*|e", fingerprint)).toBe(
      "a-b-c-d-e--aaaaaaaaaaaa.md",
    );
    expect(safeKnowledgeFilename("a\u0000b", fingerprint)).toBe(
      "a-b--aaaaaaaaaaaa.md",
    );
  });

  it("truncates filenames on code-point boundaries to 240 UTF-8 bytes", () => {
    const filename = safeKnowledgeFilename(
      `${"a".repeat(220)}${"😀".repeat(10)}`,
      `sha256:${"b".repeat(64)}`,
    );
    expect(new TextEncoder().encode(filename)).toHaveLength(237);
    expect(new TextEncoder().encode(filename).length).toBeLessThanOrEqual(240);
    expect(filename.endsWith("--bbbbbbbbbbbb.md")).toBe(true);
    expect(filename).not.toContain("�");
  });

  it("rejects non-Markdown source paths and source/candidate mismatches", () => {
    expect(
      renderKnowledgeNote(reviewedCandidate(), [
        resolvedSource({ sourceNotePath: "Sources/Synthetic" }),
      ]),
    ).toMatchObject({ ok: false });
    expect(
      renderKnowledgeNote(reviewedCandidate(), [
        resolvedSource({ conversationFingerprint: `sha256:${"f".repeat(64)}` }),
      ]),
    ).toMatchObject({ ok: false });
  });

  it("refuses proposed/rejected reviews and malformed immutable authority", () => {
    for (const overrides of [
      { decision: "proposed" as const },
      { decision: "rejected" as const },
      { id: "not-a-fingerprint" },
      { originalCandidateFingerprint: "not-a-fingerprint" },
      { confidence: "certain" as never },
    ]) {
      expect(
        renderKnowledgeNote(reviewedCandidate(overrides), [resolvedSource()]),
      ).toMatchObject({ ok: false });
    }
  });
});
