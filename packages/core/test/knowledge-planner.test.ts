import { describe, expect, it } from "vitest";

import {
  knowledgeWritePlanEqual,
  m06Diagnostic,
  planKnowledgeWrite,
  type KnowledgePlannerInput,
  type KnowledgeWritePlan,
  type ReviewedKnowledgeCandidate,
} from "../src/index.js";

const CONVERSATION_FINGERPRINT = `sha256:${"3".repeat(64)}`;
const MESSAGE_FINGERPRINT = `sha256:${"4".repeat(64)}`;
const FIXED_CANDIDATE_FINGERPRINT =
  "sha256:20e64514803a64d004f516e32f27f012a7f8efe013ffe91a5140701f50002a9c";
const FIXED_NOTE_FINGERPRINT =
  "sha256:dbe9d3699c2768f0168a3015392373b5dc522ec4d2e50261bdfd2cbded45f699";

function candidate(
  overrides: Partial<ReviewedKnowledgeCandidate> = {},
): ReviewedKnowledgeCandidate {
  return {
    id: `sha256:${"1".repeat(64)}`,
    originalCandidateFingerprint: `sha256:${"2".repeat(64)}`,
    type: "insight",
    confidence: "high",
    sourceRefs: [
      {
        provider: "chatgpt",
        providerConversationId: "conv-synthetic",
        conversationFingerprint: CONVERSATION_FINGERPRINT,
        messageFingerprints: [MESSAGE_FINGERPRINT],
      },
    ],
    title: "Edited",
    summary: "Synthetic summary",
    body: "Synthetic body",
    tags: ["synthetic"],
    decision: "edited",
    selected: true,
    ...overrides,
  };
}

function validInput(
  overrides: Partial<KnowledgePlannerInput> = {},
): KnowledgePlannerInput {
  const targetPath =
    "Knowledge/Edited--" + FIXED_CANDIDATE_FINGERPRINT.slice(7, 19) + ".md";
  return {
    sourceRoot: "Sources",
    knowledgeRoot: "Knowledge",
    candidates: [candidate()],
    resolvedSources: [
      {
        provider: "chatgpt",
        providerConversationId: "conv-synthetic",
        conversationFingerprint: CONVERSATION_FINGERPRINT,
        messageFingerprints: [MESSAGE_FINGERPRINT],
        sourceNotePath: "Sources/Synthetic.md",
      },
    ],
    targetObservations: [{ targetPath, observation: { status: "absent" } }],
    ...overrides,
  };
}

function codes(input: KnowledgePlannerInput) {
  return planKnowledgeWrite(input).diagnostics.map(({ code }) => code);
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("Expected one synthetic value.");
  return value;
}

describe("M06 knowledge planner", () => {
  it("plans the fixed create-only golden target", () => {
    const plan = planKnowledgeWrite(validInput());
    expect(plan).toMatchObject({
      status: "ready",
      sourceRoot: "Sources",
      knowledgeRoot: "Knowledge",
      entries: [
        {
          candidateId: `sha256:${"1".repeat(64)}`,
          candidateFingerprint: FIXED_CANDIDATE_FINGERPRINT,
          action: "create",
          targetPath:
            "Knowledge/Edited--" +
            FIXED_CANDIDATE_FINGERPRINT.slice(7, 19) +
            ".md",
          noteContentFingerprint: FIXED_NOTE_FINGERPRINT,
        },
      ],
      diagnostics: [],
    });
    expect(plan.planFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("maps exact bytes to no-op and different or unsafe objects to conflicts", () => {
    const initial = planKnowledgeWrite(validInput());
    expect(initial.status).toBe("ready");
    const entry = initial.entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const bytes = new TextEncoder().encode(entry.noteContent);

    expect(
      planKnowledgeWrite(
        validInput({
          targetObservations: [
            {
              targetPath: entry.targetPath,
              observation: { status: "regular-file", bytes },
            },
          ],
        }),
      ).entries[0]?.action,
    ).toBe("identical-no-op");

    for (const observation of [
      { status: "regular-file", bytes: new Uint8Array([1, 2, 3]) } as const,
      { status: "obstructed" } as const,
      { status: "unsafe" } as const,
    ]) {
      const plan = planKnowledgeWrite(
        validInput({
          targetObservations: [{ targetPath: entry.targetPath, observation }],
        }),
      );
      expect(plan.status).toBe("blocked");
      expect(plan.entries[0]?.action).toBe("conflict");
      expect(
        codes(
          validInput({
            targetObservations: [{ targetPath: entry.targetPath, observation }],
          }),
        ),
      ).toContain(
        observation.status === "unsafe"
          ? "KNOWLEDGE_PATH_UNSAFE"
          : "KNOWLEDGE_TARGET_CONFLICT",
      );
    }
  });

  it.each([
    ["Sources", "", "KNOWLEDGE_ROOT_UNCONFIGURED"],
    ["Sources", "../Knowledge", "KNOWLEDGE_ROOT_INVALID"],
    ["Sources", "sources", "KNOWLEDGE_ROOT_OVERLAP"],
    ["Sources", "Sources/Nested", "KNOWLEDGE_ROOT_OVERLAP"],
    ["Sources/Nested", "SOURCEs", "KNOWLEDGE_ROOT_OVERLAP"],
    ["Café/Sources", "Cafe\u0301/Sources/Knowledge", "KNOWLEDGE_ROOT_OVERLAP"],
  ] as const)(
    "blocks root combination source=%j knowledge=%j",
    (sourceRoot, knowledgeRoot, diagnostic) => {
      expect(codes(validInput({ sourceRoot, knowledgeRoot }))).toContain(
        diagnostic,
      );
    },
  );

  it("requires at least one eligible selected candidate and unique IDs/targets", () => {
    expect(
      codes(validInput({ candidates: [candidate({ selected: false })] })),
    ).toContain("KNOWLEDGE_NO_SELECTION");
    expect(
      codes(
        validInput({
          candidates: [candidate({ decision: "proposed" })],
        }),
      ),
    ).toContain("KNOWLEDGE_NO_SELECTION");

    const duplicate = candidate({
      id: `sha256:${"9".repeat(64)}`,
    });
    expect(
      codes(validInput({ candidates: [candidate(), duplicate] })),
    ).toContain("KNOWLEDGE_BATCH_TARGET_DUPLICATE");
    expect(
      codes(validInput({ candidates: [candidate(), candidate()] })),
    ).toContain("KNOWLEDGE_REVIEW_INVALID");
  });

  it("distinguishes unresolved, ambiguous, and stale trusted sources", () => {
    const source = first(validInput().resolvedSources);
    expect(codes(validInput({ resolvedSources: [] }))).toContain(
      "KNOWLEDGE_SOURCE_UNRESOLVED",
    );
    expect(
      codes(
        validInput({
          resolvedSources: [
            ...validInput().resolvedSources,
            {
              ...source,
              sourceNotePath: "Sources/Second.md",
            },
          ],
        }),
      ),
    ).toContain("KNOWLEDGE_SOURCE_AMBIGUOUS");
    expect(
      codes(
        validInput({
          resolvedSources: [
            {
              ...source,
              conversationFingerprint: `sha256:${"8".repeat(64)}`,
            },
          ],
        }),
      ),
    ).toContain("KNOWLEDGE_SOURCE_STALE");
  });

  it.each([
    ["Sources#Archive", "Sources#Archive/Foo.md"],
    ["Sources", "Sources/Foo#Archive.md"],
    ["Sources#Archive", "Sources#Archive/Foo)#Q4.md"],
  ])(
    "blocks an unrenderable trusted source before planning a create: %s/%s",
    (sourceRoot, sourceNotePath) => {
      const source = first(validInput().resolvedSources);
      const plan = planKnowledgeWrite(
        validInput({
          sourceRoot,
          resolvedSources: [{ ...source, sourceNotePath }],
        }),
      );
      expect(plan.status).toBe("blocked");
      expect(plan.entries).toEqual([]);
      expect(plan.diagnostics).toContainEqual(
        m06Diagnostic("KNOWLEDGE_SOURCE_UNRESOLVED"),
      );
    },
  );

  it("resolves an exact source among same-provider sources without conversation IDs", () => {
    const exactConversationFingerprint = `sha256:${"5".repeat(64)}`;
    const otherConversationFingerprint = `sha256:${"6".repeat(64)}`;
    const exactSource = {
      provider: "chatgpt" as const,
      conversationFingerprint: exactConversationFingerprint,
      messageFingerprints: [MESSAGE_FINGERPRINT],
      sourceNotePath: "Sources/Exact.md",
    };
    const selected = candidate({
      sourceRefs: [
        {
          provider: "chatgpt",
          conversationFingerprint: exactConversationFingerprint,
          messageFingerprints: [MESSAGE_FINGERPRINT],
        },
      ],
    });
    const preview = planKnowledgeWrite(
      validInput({
        candidates: [selected],
        resolvedSources: [
          {
            ...exactSource,
            conversationFingerprint: otherConversationFingerprint,
            sourceNotePath: "Sources/Other.md",
          },
          exactSource,
        ],
        targetObservations: [],
      }),
    );
    const targetPath = first(preview.entries).targetPath;

    const plan = planKnowledgeWrite(
      validInput({
        candidates: [selected],
        resolvedSources: [
          {
            ...exactSource,
            conversationFingerprint: otherConversationFingerprint,
            sourceNotePath: "Sources/Other.md",
          },
          exactSource,
        ],
        targetObservations: [{ targetPath, observation: { status: "absent" } }],
      }),
    );

    expect(plan.status).toBe("ready");
    expect(plan.diagnostics).toEqual([]);
  });

  it.each([
    ["Sources.md", "sources.md"],
    ["Café.md", "Cafe\u0301.md"],
  ] as const)(
    "rejects collision-equivalent source-root equality for root=%j path=%j",
    (sourceRoot, sourceNotePath) => {
      const source = first(validInput().resolvedSources);
      expect(
        codes(
          validInput({
            sourceRoot,
            resolvedSources: [{ ...source, sourceNotePath }],
          }),
        ),
      ).toContain("KNOWLEDGE_PATH_UNSAFE");
    },
  );

  it("sorts entries independent of candidate order", () => {
    const alpha = candidate({
      id: `sha256:${"a".repeat(64)}`,
      title: "Alpha",
    });
    const zulu = candidate({
      id: `sha256:${"b".repeat(64)}`,
      title: "Zulu",
    });
    const plan = planKnowledgeWrite(
      validInput({ candidates: [zulu, alpha], targetObservations: [] }),
    );
    expect(plan.entries.map(({ targetPath }) => targetPath)).toEqual(
      [...plan.entries.map(({ targetPath }) => targetPath)].sort(
        (left, right) => left.localeCompare(right),
      ),
    );
  });

  it("detaches plans from caller-owned candidate, source, observation, and byte data", () => {
    const input = validInput();
    const initial = planKnowledgeWrite(input);
    const entry = first(initial.entries);
    const bytes = new TextEncoder().encode(entry.noteContent);
    input.targetObservations = [
      {
        targetPath: entry.targetPath,
        observation: { status: "regular-file", bytes },
      },
    ];
    const plan = planKnowledgeWrite(input);
    const fingerprint = plan.planFingerprint;

    bytes[0] = 0;
    first(input.candidates as ReviewedKnowledgeCandidate[]).title = "Mutated";
    const source = first(input.resolvedSources);
    (source.messageFingerprints as string[])[0] = `sha256:${"f".repeat(64)}`;
    expect(plan.planFingerprint).toBe(fingerprint);
    expect(plan.entries[0]?.action).toBe("identical-no-op");
  });

  it("compares every authoritative plan field without invoking accessors", () => {
    const plan = planKnowledgeWrite(validInput());
    expect(knowledgeWritePlanEqual(plan, plan)).toBe(true);
    for (const mutate of [
      (copy: KnowledgeWritePlan) => {
        first(copy.entries).noteContent += "changed";
      },
      (copy: KnowledgeWritePlan) => {
        first(copy.entries).targetPath += ".other";
      },
      (copy: KnowledgeWritePlan) => {
        first(copy.entries).action = "conflict";
      },
      (copy: KnowledgeWritePlan) => {
        copy.planFingerprint = `sha256:${"f".repeat(64)}`;
      },
      (copy: KnowledgeWritePlan) => {
        copy.sourceRoot = "Other";
      },
    ]) {
      const changed = structuredClone(plan);
      mutate(changed);
      expect(knowledgeWritePlanEqual(plan, changed)).toBe(false);
    }
    const changedDiagnostic = structuredClone(plan);
    changedDiagnostic.status = "blocked";
    changedDiagnostic.diagnostics = [m06Diagnostic("KNOWLEDGE_PLAN_STALE")];
    expect(knowledgeWritePlanEqual(plan, changedDiagnostic)).toBe(false);

    let read = false;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "status", {
      enumerable: true,
      get() {
        read = true;
        return "ready";
      },
    });
    expect(knowledgeWritePlanEqual(plan, hostile)).toBe(false);
    expect(read).toBe(false);
  });
});
