import { describe, expect, it } from "vitest";

import {
  knowledgeContentFingerprint,
  parseKnowledgeCatalogNote,
  renderKnowledgeNote,
  v2CandidateFingerprint,
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
  title: "Synthetic",
  summary: "A summary",
  body: "A body with ## Summary, ## Knowledge, and ## Source headings.",
  tags: ["alpha"],
  decision: "accepted",
  selected: true,
};
const source: ResolvedKnowledgeSource = {
  provider: "chatgpt",
  conversationFingerprint: hash("3"),
  messageFingerprints: [hash("4")],
  sourceNotePath: "Sources/First.md",
};

function fixture(sourceNotePath = source.sourceNotePath) {
  const rendered = renderKnowledgeNote(candidate, [
    { ...source, sourceNotePath },
  ]);
  if (!rendered.ok) throw new Error("synthetic fixture failed");
  return {
    path: `Knowledge/${rendered.filename}`,
    bytes: new TextEncoder().encode(rendered.noteContent),
    text: rendered.noteContent,
  };
}

function v2Fixture() {
  const base = fixture();
  const parsed = parseKnowledgeCatalogNote(base.path, base.bytes);
  if (parsed.status !== "eligible")
    throw new Error("synthetic v1 parse failed");
  const combinedFrom = "Knowledge/Existing--aaaaaaaaaaaa.md";
  const contentFingerprint = knowledgeContentFingerprint(
    parsed.note.type,
    parsed.note.payload,
    parsed.note.tags,
  );
  const candidateFingerprint = v2CandidateFingerprint(
    parsed.note.type,
    parsed.note.payload,
    parsed.note.tags,
    parsed.note.sourceNotes,
    combinedFrom,
  );
  const text = base.text
    .replace("chat2vault_schema: 1", "chat2vault_schema: 2")
    .replace(
      /^candidate_fingerprint: .*$/mu,
      `candidate_fingerprint: "${candidateFingerprint}"\nknowledge_content_fingerprint: "${contentFingerprint}"\ncombined_from: "[[Knowledge/Existing--aaaaaaaaaaaa]]"`,
    );
  return {
    path: `Knowledge/Combined--${candidateFingerprint.slice(7, 19)}.md`,
    text,
  };
}

describe("knowledge catalog parser", () => {
  it("retains the rendered payload and gives identical content across source links", () => {
    const firstFixture = fixture();
    const secondFixture = fixture("Sources/Second.md");
    const first = parseKnowledgeCatalogNote(
      firstFixture.path,
      firstFixture.bytes,
    );
    const second = parseKnowledgeCatalogNote(
      secondFixture.path,
      secondFixture.bytes,
    );
    expect(first.status).toBe("eligible");
    expect(second.status).toBe("eligible");
    if (first.status !== "eligible" || second.status !== "eligible") return;
    expect(first.note.contentFingerprint).toBe(second.note.contentFingerprint);
    expect(first.note.sourceNotes).not.toEqual(second.note.sourceNotes);
    expect(first.note.payload).toContain(
      "## Summary, ## Knowledge, and ## Source",
    );
    expect(first.note.payload).toBe(
      firstFixture.text
        .split("\n---\n\n")[1]
        ?.split("\n\n## Source\n\nDerived from ")[0],
    );
  });

  it("changes content identity when the observed payload changes", () => {
    const base = fixture();
    const edited = base.text.replace("A body with", "An edited body with");
    const first = parseKnowledgeCatalogNote(base.path, base.bytes);
    const second = parseKnowledgeCatalogNote(
      base.path,
      new TextEncoder().encode(edited),
    );
    expect(first.status).toBe("eligible");
    expect(second.status).toBe("eligible");
    if (first.status === "eligible" && second.status === "eligible")
      expect(first.note.contentFingerprint).not.toBe(
        second.note.contentFingerprint,
      );
  });

  it("validates recoverable v2 content and candidate fingerprints", () => {
    const valid = v2Fixture();
    const result = parseKnowledgeCatalogNote(
      valid.path,
      new TextEncoder().encode(valid.text),
    );
    expect(result.status).toBe("eligible");
    if (result.status === "eligible" && result.note.schemaVersion === 2) {
      const combinedFrom: string = result.note.combinedFrom;
      expect(combinedFrom).toBe("Knowledge/Existing--aaaaaaaaaaaa.md");
    }
    expect(
      parseKnowledgeCatalogNote(
        valid.path,
        new TextEncoder().encode(
          valid.text.replace("A body with", "An edited body with"),
        ),
      ).status,
    ).toBe("malformed");
    expect(
      parseKnowledgeCatalogNote(
        valid.path,
        new TextEncoder().encode(
          valid.text.replace(
            'knowledge_content_fingerprint: "sha256:',
            'knowledge_content_fingerprint: "sha256:0',
          ),
        ),
      ).status,
    ).toBe("malformed");
    expect(
      parseKnowledgeCatalogNote(
        valid.path,
        new TextEncoder().encode(
          valid.text.replace(
            "Knowledge/Existing--aaaaaaaaaaaa",
            "Knowledge/Other--aaaaaaaaaaaa",
          ),
        ),
      ).status,
    ).toBe("malformed");
  });

  it("accepts M06's parallel source arrays and escaped wikilinks", () => {
    const second: ResolvedKnowledgeSource = {
      provider: "unknown",
      conversationFingerprint: hash("5"),
      messageFingerprints: [hash("6")],
      sourceNotePath: "Sources/Second [synthetic].md",
    };
    const rendered = renderKnowledgeNote(
      {
        ...candidate,
        sourceRefs: [
          ...candidate.sourceRefs,
          {
            provider: second.provider,
            conversationFingerprint: second.conversationFingerprint,
            messageFingerprints: [...second.messageFingerprints],
          },
        ],
      },
      [source, second],
    );
    if (!rendered.ok) throw new Error("synthetic array fixture failed");
    const parsed = parseKnowledgeCatalogNote(
      `Knowledge/${rendered.filename}`,
      new TextEncoder().encode(rendered.noteContent),
    );
    expect(parsed.status).toBe("eligible");
    if (parsed.status === "eligible")
      expect(parsed.note.sourceNotes).toHaveLength(2);
  });

  it("ignores unrelated notes but rejects malformed Chat2Vault notes", () => {
    expect(
      parseKnowledgeCatalogNote(
        "Knowledge/Personal.md",
        new TextEncoder().encode("# Personal\n"),
      ).status,
    ).toBe("ignored");
    expect(
      parseKnowledgeCatalogNote(
        "Knowledge/Personal.md",
        new TextEncoder().encode(
          "---\ntitle: Personal\n---\n# Notes\nchat2vault_schema: 1\n",
        ),
      ).status,
    ).toBe("ignored");
    const base = fixture();
    expect(
      parseKnowledgeCatalogNote(
        base.path,
        new TextEncoder().encode(
          base.text.replace("chat2vault_schema: 1", "chat2vault_schema: 9"),
        ),
      ),
    ).toEqual({
      status: "malformed",
      code: "M07_CATALOG_MALFORMED",
    });
  });

  it("ignores oversized unrelated Markdown but blocks oversized Chat2Vault-like notes", () => {
    const unrelated = new TextEncoder().encode(
      `# Personal\n${"x".repeat(128 * 1024)}`,
    );
    expect(
      parseKnowledgeCatalogNote("Knowledge/Personal.md", unrelated).status,
    ).toBe("ignored");
    const base = fixture();
    const oversizedOwned = new TextEncoder().encode(
      base.text + "x".repeat(128 * 1024),
    );
    expect(parseKnowledgeCatalogNote(base.path, oversizedOwned).status).toBe(
      "malformed",
    );
    expect(
      parseKnowledgeCatalogNote("Knowledge/Renamed.md", oversizedOwned).status,
    ).toBe("malformed");
    const lateMarker = new TextEncoder().encode(
      `---\n${"x".repeat(128 * 1024)}\nchat2vault_schema: 1`,
    );
    expect(
      parseKnowledgeCatalogNote("Knowledge/Renamed.md", lateMarker).status,
    ).toBe("malformed");
    const bodyMarker = new TextEncoder().encode(
      `---\ntitle: Personal\n---\n\n# Notes\nchat2vault_schema: 1\n${"x".repeat(128 * 1024)}`,
    );
    expect(
      parseKnowledgeCatalogNote("Knowledge/Personal.md", bodyMarker).status,
    ).toBe("ignored");
    const noFrontmatter = new TextEncoder().encode(
      `# Notes\nchat2vault_schema: 1\n${"x".repeat(128 * 1024)}`,
    );
    expect(
      parseKnowledgeCatalogNote("Knowledge/Personal.md", noFrontmatter).status,
    ).toBe("ignored");
    const quotedMention = new TextEncoder().encode(
      `---\ndescription: "Discuss chat2vault_schema: 1"\n---\n\n${"x".repeat(128 * 1024)}`,
    );
    expect(
      parseKnowledgeCatalogNote("Knowledge/Personal.md", quotedMention).status,
    ).toBe("ignored");
  });

  it("uses sorted unique tags in versioned content identity", () => {
    expect(
      knowledgeContentFingerprint("insight", "# Exact", [
        "beta",
        "alpha",
        "alpha",
      ]),
    ).toBe(
      knowledgeContentFingerprint("insight", "# Exact", ["alpha", "beta"]),
    );
  });

  it("matches an independent fixed v2 candidate digest vector", () => {
    expect(
      v2CandidateFingerprint(
        "insight",
        "# Exact",
        ["knowledge", "alpha"],
        [
          {
            provider: "chatgpt",
            conversationFingerprint: hash("1"),
            sourceNotePath: "Sources/One.md",
          },
        ],
        "Knowledge/Existing--aaaaaaaaaaaa.md",
      ),
    ).toBe(
      "sha256:7cc05043e0cde11cc1b65872af2ae5f5f75f7cd4b1c33c1f5c7ddbb56296b43c",
    );
  });

  it.each([
    [
      "wrong footer",
      (text: string) =>
        text.replace(
          "Derived from [[Sources/First]].",
          "Derived from [[Sources/Other]].",
        ),
    ],
    [
      "unknown identity key",
      (text: string) =>
        text.replace(
          "status: accepted",
          "status: accepted\nsource_message: bogus",
        ),
    ],
    [
      "duplicate identity key",
      (text: string) =>
        text.replace("status: accepted", "status: accepted\nstatus: accepted"),
    ],
    [
      "ambiguous source arrays",
      (text: string) =>
        text.replace(
          "source_provider: chatgpt",
          "source_provider:\n  - chatgpt",
        ),
    ],
    [
      "tampered fingerprint",
      (text: string) =>
        text.replace(
          'candidate_fingerprint: "sha256:',
          'candidate_fingerprint: "sha256:0',
        ),
    ],
  ])("rejects %s", (_name, mutate) => {
    const base = fixture();
    expect(
      parseKnowledgeCatalogNote(
        base.path,
        new TextEncoder().encode(mutate(base.text)),
      ).status,
    ).toBe("malformed");
  });

  it("rejects invalid UTF-8, oversized input, and filename mismatches", () => {
    const base = fixture();
    expect(
      parseKnowledgeCatalogNote(
        "Knowledge/Personal.md",
        Uint8Array.from([0xff]),
      ).status,
    ).toBe("ignored");
    expect(
      parseKnowledgeCatalogNote(
        "Knowledge/Personal.md",
        Uint8Array.from([
          ...new TextEncoder().encode("---\nchat2vault_schema: 1\n"),
          0xff,
        ]),
      ).status,
    ).toBe("malformed");
    expect(
      parseKnowledgeCatalogNote(base.path, Uint8Array.from([0xff])).status,
    ).toBe("malformed");
    expect(
      parseKnowledgeCatalogNote(base.path, new Uint8Array(128 * 1024 + 1))
        .status,
    ).toBe("malformed");
    expect(
      parseKnowledgeCatalogNote("Knowledge/Wrong--000000000000.md", base.bytes)
        .status,
    ).toBe("malformed");
  });
});
