import { describe, expect, it } from "vitest";

import {
  knowledgeContentFingerprint,
  matchKnowledgeCandidate,
  type CatalogKnowledgeNote,
  type ResolvedKnowledgeSource,
  type ReviewedKnowledgeCandidate,
} from "../src/index.js";

const hash = (digit: string): string => `sha256:${digit.repeat(64)}`;
const source = (
  path: string,
  fingerprint: string,
  providerConversationId?: string,
): ResolvedKnowledgeSource => ({
  provider: "chatgpt",
  conversationFingerprint: fingerprint,
  messageFingerprints: [],
  sourceNotePath: path,
  ...(providerConversationId === undefined ? {} : { providerConversationId }),
});
const candidate: ReviewedKnowledgeCandidate = {
  id: hash("1"),
  originalCandidateFingerprint: hash("2"),
  type: "insight",
  confidence: "high",
  sourceRefs: [
    {
      provider: "chatgpt",
      conversationFingerprint: hash("3"),
      messageFingerprints: [],
      providerConversationId: "conversation-1",
    },
  ],
  title: "alpha",
  summary: "summary",
  body: "body",
  tags: [],
  decision: "accepted",
  selected: true,
};

function note(
  path: string,
  payload: string,
  sourceIdentity = source("Sources/Other.md", hash("8")),
  title = "other",
  tags: readonly string[] = [],
): CatalogKnowledgeNote {
  return {
    schemaVersion: 1,
    path,
    type: "insight",
    title,
    payload,
    tags,
    sourceNotes: [
      {
        provider: sourceIdentity.provider,
        conversationFingerprint: sourceIdentity.conversationFingerprint,
        sourceNotePath: sourceIdentity.sourceNotePath,
      },
    ],
    candidateFingerprint: hash("9"),
    contentFingerprint: knowledgeContentFingerprint("insight", payload, tags),
  };
}

describe("knowledge catalog matcher", () => {
  it("normalizes payload before taking its first 2,048 code points", () => {
    const crossingCutoff = "😀".repeat(2046) + "e\u0301x";
    const existing = note(
      "Knowledge/NfcCutoff.md",
      "nonce",
      source("Sources/NfcCutoff.md", hash("5")),
      "éx",
    );
    const result = matchKnowledgeCandidate({
      candidate: { ...candidate, title: "x" },
      payload: crossingCutoff,
      renderedTags: [],
      notes: [existing],
      resolvedSources: [],
    });
    expect(result.related).toEqual([
      { path: "Knowledge/NfcCutoff.md", score: 0.25 },
    ]);
  });

  it("uses maximum field weight per token and minimum-over-maximum weighted Jaccard", () => {
    const existing = note(
      "Knowledge/Asymmetric.md",
      "alpha",
      source("Sources/Asymmetric.md", hash("5")),
      "x",
    );
    const result = matchKnowledgeCandidate({
      candidate: { ...candidate, title: "alpha" },
      payload: "",
      renderedTags: ["alpha"],
      notes: [existing],
      resolvedSources: [],
    });
    expect(result.related).toEqual([
      { path: "Knowledge/Asymmetric.md", score: 1 / 3 },
    ]);
  });

  it("keeps exact, same-source, and related classifications mutually exclusive", () => {
    const sameIdentity = source("Sources/Same.md", hash("3"));
    const differentIdentity = source("Sources/Related.md", hash("5"));
    const exact = note(
      "Knowledge/ExactPrecedence.md",
      "shared",
      sameIdentity,
      "alpha",
    );
    const reextracted = note(
      "Knowledge/Reextracted.md",
      "changed",
      sameIdentity,
      "alpha",
    );
    const related = note(
      "Knowledge/RelatedPrecedence.md",
      "changed",
      differentIdentity,
      "alpha",
    );
    const result = matchKnowledgeCandidate({
      candidate: { ...candidate, title: "alpha" },
      payload: "shared",
      renderedTags: [],
      notes: [related, reextracted, exact],
      resolvedSources: [],
    });
    expect(result.exact.map(({ path }) => path)).toEqual([exact.path]);
    expect(result.sameSource.map(({ path }) => path)).toEqual([
      reextracted.path,
    ]);
    expect(result.related.map(({ path }) => path)).toEqual([related.path]);
  });

  it.each([
    [1, false],
    [2, true],
    [64, true],
    [65, false],
  ])(
    "accepts only 2–64-code-point token runs: length %i",
    (length, included) => {
      const token = "a".repeat(length);
      const existing = note(
        "Knowledge/Length.md",
        token,
        source("Sources/Length.md", hash("5")),
        "x",
      );
      const result = matchKnowledgeCandidate({
        candidate: { ...candidate, title: token },
        payload: "",
        renderedTags: [],
        notes: [existing],
        resolvedSources: [],
      });
      expect(result.related).toEqual(
        included ? [{ path: existing.path, score: 1 / 3 }] : [],
      );
    },
  );

  it("uses rendered tags rather than raw candidate tags for exact identity", () => {
    const existing = note(
      "Knowledge/Rendered.md",
      "same payload",
      source("Sources/Other.md", hash("8")),
      "other",
      ["knowledge"],
    );
    const result = matchKnowledgeCandidate({
      candidate,
      payload: "same payload",
      renderedTags: ["knowledge"],
      notes: [existing],
      resolvedSources: [],
    });
    expect(result.exact).toEqual([existing]);
  });

  it("classifies equal content as exact across sources and different candidate fingerprints", () => {
    const existing = note("Knowledge/Exact.md", "same payload");
    const result = matchKnowledgeCandidate({
      candidate,
      payload: "same payload",
      notes: [existing],
      renderedTags: candidate.tags,
      resolvedSources: [],
    });
    expect(result.exact).toEqual([existing]);
    expect(result.sameSource).toEqual([]);
    expect(result.related).toEqual([]);
  });

  it("uses stable provider conversation IDs for changed-content re-extractions", () => {
    const existingSource = source(
      "Sources/NewVersion.md",
      hash("4"),
      "conversation-1",
    );
    const existing = note("Knowledge/NewVersion.md", "changed", existingSource);
    const result = matchKnowledgeCandidate({
      candidate,
      payload: "original",
      notes: [existing],
      renderedTags: candidate.tags,
      resolvedSources: [existingSource],
    });
    expect(result.sameSource).toEqual([existing]);
    expect(result.sameSourceDetails).toEqual([
      { path: existing.path, kind: "changed-source-content" },
    ]);
    expect(result.exact).toEqual([]);
  });

  it("falls back to provider and conversation fingerprint if either stable ID is absent", () => {
    const sameFingerprint = source("Sources/Fallback.md", hash("3"));
    const result = matchKnowledgeCandidate({
      candidate,
      payload: "original",
      notes: [note("Knowledge/Fallback.md", "changed", sameFingerprint)],
      renderedTags: candidate.tags,
      resolvedSources: [sameFingerprint],
    });
    expect(result.sameSource.map(({ path }) => path)).toEqual([
      "Knowledge/Fallback.md",
    ]);
    expect(result.sameSourceDetails).toEqual([
      {
        path: "Knowledge/Fallback.md",
        kind: "alternative-extraction",
      },
    ]);
  });

  it("does not fall back to matching fingerprints when both stable IDs disagree", () => {
    const differentId = source(
      "Sources/Different.md",
      hash("3"),
      "conversation-2",
    );
    const result = matchKnowledgeCandidate({
      candidate,
      payload: "original",
      notes: [note("Knowledge/Different.md", "changed", differentId)],
      renderedTags: candidate.tags,
      resolvedSources: [differentId],
    });
    expect(result.sameSource).toEqual([]);
  });

  it("keeps the 0.25 boundary and excludes unrelated notes", () => {
    const local = { ...candidate, title: "alpha beta gamma", tags: [] };
    const quarter = note(
      "Knowledge/Quarter.md",
      "delta epsilon zeta",
      source("Sources/Quarter.md", hash("5")),
      "alpha",
    );
    const unrelated = note(
      "Knowledge/Unrelated.md",
      "delta epsilon zeta",
      source("Sources/Unrelated.md", hash("6")),
      "omega",
    );
    const result = matchKnowledgeCandidate({
      candidate: local,
      payload: "",
      notes: [unrelated, quarter],
      renderedTags: local.tags,
      resolvedSources: [],
    });
    expect(result.related).toEqual([
      { path: "Knowledge/Quarter.md", score: 0.25 },
    ]);
  });

  it("normalizes Unicode, applies maximum field weight, and bounds payload by code points", () => {
    const local = { ...candidate, title: "cafe\u0301", tags: ["東京"] };
    const inside = note(
      "Knowledge/Inside.md",
      "😀".repeat(2047) + "東京",
      source("Sources/Inside.md", hash("5")),
      "café",
      ["東京"],
    );
    const outside = note(
      "Knowledge/Outside.md",
      "😀".repeat(2048) + "東京",
      source("Sources/Outside.md", hash("6")),
      "omega",
    );
    const result = matchKnowledgeCandidate({
      candidate: local,
      payload: "東京",
      notes: [outside, inside],
      renderedTags: local.tags,
      resolvedSources: [],
    });
    expect(result.related).toEqual([{ path: "Knowledge/Inside.md", score: 1 }]);
  });

  it("sorts score ties by normalized path, caps at five, and is input-order independent", () => {
    const local = { ...candidate, title: "alpha", tags: [] };
    const paths = [
      "Knowledge/F.md",
      "Knowledge/E.md",
      "Knowledge/D.md",
      "Knowledge/C.md",
      "Knowledge/B.md",
      "Knowledge/A.md",
    ];
    const notes = paths.map((path, index) =>
      note(
        path,
        "nonce",
        source(`Sources/${String(index)}.md`, hash(String(index + 4))),
        "alpha",
      ),
    );
    const input = {
      candidate: local,
      payload: "",
      renderedTags: local.tags,
      notes,
      resolvedSources: [],
    };
    const first = matchKnowledgeCandidate(input);
    const second = matchKnowledgeCandidate({
      ...input,
      notes: [...notes].reverse(),
    });
    expect(first).toEqual(second);
    expect(first.related.map(({ path }) => path)).toEqual(
      paths.slice().reverse().slice(0, 5),
    );
  });
});
