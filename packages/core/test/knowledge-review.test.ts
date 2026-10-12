import { describe, expect, it } from "vitest";

import {
  M04_BODY_MAX_UTF16,
  M04_MAX_SUGGESTED_TAGS,
  M04_SUGGESTION_MAX_UTF16,
  M04_SUMMARY_MAX_UTF16,
  M04_TITLE_MAX_UTF16,
  createKnowledgeReview,
  editKnowledgeCandidate,
  m06Diagnostic,
  setKnowledgeDecision,
  setKnowledgeSelected,
  type M06DiagnosticCode,
  type PreviewCandidate,
} from "../src/index.js";

function previewCandidate(): PreviewCandidate {
  return {
    id: `sha256:${"1".repeat(64)}`,
    candidateFingerprint: `sha256:${"2".repeat(64)}`,
    type: "insight",
    title: "Synthetic title",
    summary: "Synthetic summary",
    body: "Synthetic body",
    status: "proposed",
    confidence: "high",
    sourceRefs: [
      {
        provider: "unknown",
        providerConversationId: "synthetic-conversation",
        conversationFingerprint: `sha256:${"3".repeat(64)}`,
        messageFingerprints: [
          `sha256:${"4".repeat(64)}`,
          `sha256:${"5".repeat(64)}`,
        ],
      },
    ],
    suggestedLinks: ["Synthetic link"],
    suggestedTags: ["beta", "alpha"],
  };
}

function acceptedCandidate() {
  return setKnowledgeDecision(
    createKnowledgeReview(previewCandidate()),
    "accepted",
  );
}

function validEdit() {
  return {
    title: "Edited",
    summary: "Edited summary",
    body: "Edited body",
    tags: ["beta", "alpha"],
  };
}

describe("M06 knowledge review", () => {
  it("creates a detached proposed review from a validated preview candidate", () => {
    const preview = previewCandidate();
    const proposed = createKnowledgeReview(preview);

    expect(proposed).toMatchObject({
      id: preview.id,
      originalCandidateFingerprint: preview.candidateFingerprint,
      type: preview.type,
      confidence: preview.confidence,
      sourceRefs: preview.sourceRefs,
      decision: "proposed",
      selected: false,
      title: preview.title,
      summary: preview.summary,
      body: preview.body,
      tags: ["alpha", "beta"],
    });

    preview.sourceRefs[0].messageFingerprints[0] = `sha256:${"9".repeat(64)}`;
    preview.suggestedTags[0] = "mutated";
    expect(proposed.sourceRefs[0]?.messageFingerprints[0]).toBe(
      `sha256:${"4".repeat(64)}`,
    );
    expect(proposed.tags).toEqual(["alpha", "beta"]);
    expect(proposed.sourceRefs).not.toBe(preview.sourceRefs);
    expect(proposed.tags).not.toBe(preview.suggestedTags);
  });

  it("accepts and selects only accepted or edited candidates", () => {
    const proposed = createKnowledgeReview(previewCandidate());
    const accepted = setKnowledgeDecision(proposed, "accepted");

    expect(setKnowledgeSelected(accepted, true).selected).toBe(true);
    expect(setKnowledgeSelected(proposed, true).selected).toBe(false);
    expect(
      setKnowledgeSelected(setKnowledgeDecision(proposed, "edited"), true)
        .selected,
    ).toBe(true);
  });

  it("clears selection when a candidate becomes proposed or rejected", () => {
    const selected = setKnowledgeSelected(acceptedCandidate(), true);

    expect(setKnowledgeDecision(selected, "proposed").selected).toBe(false);
    expect(setKnowledgeDecision(selected, "rejected").selected).toBe(false);
  });

  it("edits only human-authored fields and sorts tags deterministically", () => {
    const accepted = acceptedCandidate();
    const edited = editKnowledgeCandidate(accepted, validEdit());

    expect(edited).toMatchObject({
      ok: true,
      candidate: {
        decision: "edited",
        title: "Edited",
        summary: "Edited summary",
        body: "Edited body",
        tags: ["alpha", "beta"],
      },
    });
    if (!edited.ok) return;
    expect(edited.candidate).toMatchObject({
      id: accepted.id,
      originalCandidateFingerprint: accepted.originalCandidateFingerprint,
      type: accepted.type,
      confidence: accepted.confidence,
      sourceRefs: accepted.sourceRefs,
      selected: accepted.selected,
    });
    expect(edited.candidate.sourceRefs).not.toBe(accepted.sourceRefs);
  });

  it("detaches successful edits from caller-owned arrays", () => {
    const edit = validEdit();
    const result = editKnowledgeCandidate(acceptedCandidate(), edit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    edit.tags[0] = "mutated";
    expect(result.candidate.tags).toEqual(["alpha", "beta"]);
  });

  it.each([
    ["title", M04_TITLE_MAX_UTF16],
    ["summary", M04_SUMMARY_MAX_UTF16],
    ["body", M04_BODY_MAX_UTF16],
  ] as const)("accepts the inclusive %s UTF-16 limit", (field, limit) => {
    const edit = validEdit();
    edit[field] = "x".repeat(limit);
    expect(editKnowledgeCandidate(acceptedCandidate(), edit).ok).toBe(true);

    edit[field] += "x";
    expect(editKnowledgeCandidate(acceptedCandidate(), edit)).toEqual({
      ok: false,
      diagnostics: [m06Diagnostic("KNOWLEDGE_REVIEW_INVALID")],
    });
  });

  it.each(["title", "summary", "body"] as const)(
    "rejects empty, non-NFC, unpaired-surrogate, and over-byte-limit %s",
    (field) => {
      const overByteLimit = {
        title: "\u754c".repeat(171),
        summary: "\u754c".repeat(2_731),
        body: "\u754c".repeat(21_846),
      }[field];
      for (const value of [
        "",
        "e\u0301",
        String.fromCharCode(0xd800),
        String.fromCharCode(0xdc00),
        overByteLimit,
      ]) {
        const edit = validEdit();
        edit[field] = value;
        expect(editKnowledgeCandidate(acceptedCandidate(), edit)).toEqual({
          ok: false,
          diagnostics: [m06Diagnostic("KNOWLEDGE_REVIEW_INVALID")],
        });
      }
    },
  );

  it("enforces inclusive tag count, UTF-16, and UTF-8 limits", () => {
    const edit = validEdit();
    edit.tags = Array.from(
      { length: M04_MAX_SUGGESTED_TAGS },
      (_, index) => `tag-${String(index).padStart(2, "0")}`,
    );
    expect(editKnowledgeCandidate(acceptedCandidate(), edit).ok).toBe(true);

    edit.tags.push("one-too-many");
    expect(editKnowledgeCandidate(acceptedCandidate(), edit)).toEqual({
      ok: false,
      diagnostics: [m06Diagnostic("KNOWLEDGE_TAG_INVALID")],
    });

    for (const value of [
      "x".repeat(M04_SUGGESTION_MAX_UTF16),
      "\u{1f600}".repeat(M04_SUGGESTION_MAX_UTF16 / 2),
    ]) {
      edit.tags = [value];
      expect(editKnowledgeCandidate(acceptedCandidate(), edit).ok).toBe(true);
    }

    for (const value of [
      "x".repeat(M04_SUGGESTION_MAX_UTF16 + 1),
      "\u754c".repeat(171),
    ]) {
      edit.tags = [value];
      expect(editKnowledgeCandidate(acceptedCandidate(), edit)).toEqual({
        ok: false,
        diagnostics: [m06Diagnostic("KNOWLEDGE_TAG_INVALID")],
      });
    }
  });

  it.each([
    "",
    "e\u0301",
    String.fromCharCode(0xd800),
    String.fromCharCode(0xdc00),
  ])("rejects invalid tag %j", (tag) => {
    expect(
      editKnowledgeCandidate(acceptedCandidate(), {
        ...validEdit(),
        tags: [tag],
      }),
    ).toEqual({
      ok: false,
      diagnostics: [m06Diagnostic("KNOWLEDGE_TAG_INVALID")],
    });
  });

  it("rejects exact duplicate tags", () => {
    expect(
      editKnowledgeCandidate(acceptedCandidate(), {
        ...validEdit(),
        tags: ["duplicate", "duplicate"],
      }),
    ).toEqual({
      ok: false,
      diagnostics: [m06Diagnostic("KNOWLEDGE_TAG_INVALID")],
    });
  });

  it("rejects missing, extra, inherited, accessor, and symbol edit authority", () => {
    const missing = validEdit() as Record<string, unknown>;
    delete missing.title;
    const extra = { ...validEdit(), type: "decision" };
    const inherited = Object.create({ title: "Inherited" }) as Record<
      string,
      unknown
    >;
    Object.assign(inherited, {
      summary: "Summary",
      body: "Body",
      tags: ["tag"],
    });
    let accessorRead = false;
    const accessor = validEdit();
    Object.defineProperty(accessor, "title", {
      enumerable: true,
      get() {
        accessorRead = true;
        return "Accessor";
      },
    });
    const symbol = Object.assign(validEdit(), { [Symbol("hidden")]: true });

    for (const value of [missing, extra, inherited, accessor, symbol]) {
      expect(
        editKnowledgeCandidate(
          acceptedCandidate(),
          value as ReturnType<typeof validEdit>,
        ),
      ).toEqual({
        ok: false,
        diagnostics: [m06Diagnostic("KNOWLEDGE_REVIEW_INVALID")],
      });
    }
    expect(accessorRead).toBe(false);
  });

  it("rejects sparse, accessor-bearing, symbol-bearing, and extra-key tag arrays", () => {
    const sparse = new Array<string>(3);
    sparse[0] = "alpha";
    sparse[2] = "beta";
    const accessor = ["alpha"];
    let accessorRead = false;
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        accessorRead = true;
        return "alpha";
      },
    });
    const symbol = Object.assign(["alpha"], { [Symbol("hidden")]: true });
    const extra = Object.assign(["alpha"], { hidden: true });

    for (const tags of [sparse, accessor, symbol, extra]) {
      expect(
        editKnowledgeCandidate(acceptedCandidate(), {
          ...validEdit(),
          tags,
        }),
      ).toEqual({
        ok: false,
        diagnostics: [m06Diagnostic("KNOWLEDGE_TAG_INVALID")],
      });
    }
    expect(accessorRead).toBe(false);
  });

  it("uses one fixed content-free error diagnostic per closed code", () => {
    const codes: readonly M06DiagnosticCode[] = [
      "KNOWLEDGE_REVIEW_INVALID",
      "KNOWLEDGE_TAG_INVALID",
      "KNOWLEDGE_NO_SELECTION",
      "KNOWLEDGE_ROOT_UNCONFIGURED",
      "KNOWLEDGE_ROOT_INVALID",
      "KNOWLEDGE_ROOT_OVERLAP",
      "KNOWLEDGE_SOURCE_UNRESOLVED",
      "KNOWLEDGE_SOURCE_AMBIGUOUS",
      "KNOWLEDGE_SOURCE_STALE",
      "KNOWLEDGE_PATH_UNSAFE",
      "KNOWLEDGE_BATCH_TARGET_DUPLICATE",
      "KNOWLEDGE_TARGET_CONFLICT",
      "KNOWLEDGE_PREVIEW_IN_PROGRESS",
      "KNOWLEDGE_WRITE_IN_PROGRESS",
      "KNOWLEDGE_PLAN_STALE",
      "KNOWLEDGE_CREATE_FAILED",
      "KNOWLEDGE_VERIFICATION_FAILED",
    ];

    expect(new Set(codes.map((code) => m06Diagnostic(code).message)).size).toBe(
      codes.length,
    );
    for (const code of codes) {
      const diagnostic = m06Diagnostic(code);
      expect(diagnostic).toEqual({
        code,
        severity: "error",
        message: diagnostic.message,
      });
      expect(diagnostic.message.length).toBeGreaterThan(0);
      expect(diagnostic).toEqual(m06Diagnostic(code));
    }
  });
});
