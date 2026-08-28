/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/restrict-template-expressions -- synthetic fixtures establish indexed candidates and diagnostic indices. */
import { describe, expect, it } from "vitest";

import {
  M04_RESULT_MAX_UTF8_BYTES,
  buildDistillationRequest,
  fingerprint,
  sha256,
  stableM04Json,
  validateDistillationResult,
  type CanonicalConversation,
  type DistillationRequest,
} from "../src/index.js";

function request(): DistillationRequest {
  const conversation: CanonicalConversation = {
    schemaVersion: 1,
    provider: "unknown",
    providerConversationId: "synthetic-result",
    title: "Synthetic result",
    messages: [
      {
        providerMessageId: "message-one",
        role: "user",
        content: [{ type: "text", text: "Synthetic source" }],
        metadata: {},
        fingerprint: `sha256:${"1".repeat(64)}`,
      },
    ],
    metadata: {},
    contentFingerprint: `sha256:${"2".repeat(64)}`,
  };
  const built = buildDistillationRequest(conversation);
  if (!built.ok) throw new Error("Synthetic request failed");
  return built.request;
}

function validRaw(active: DistillationRequest): string {
  return JSON.stringify(validObject(active));
}

function validObject(active: DistillationRequest) {
  return {
    schemaVersion: 1,
    contractVersion: "m04-manual-v1",
    requestId: active.requestId,
    conversationFingerprint: active.conversationFingerprint,
    candidates: [
      {
        type: "insight",
        title: "Bounded contracts",
        summary: "Strict validation preserves authority.",
        body: "Validate untrusted output before installing preview state.",
        confidence: "high",
        sourceMessageFingerprints: [active.messages[0]!.fingerprint],
        suggestedLinks: ["Contracts"],
        suggestedTags: ["validation"],
      },
    ],
  };
}

describe("M04 distillation result", () => {
  it("derives trusted candidate identity and provenance locally", () => {
    const active = request();
    const result = validateDistillationResult(validRaw(active), active);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: "sha256:5a6c6e5b1e235e4f4d4d648e0e461a493ecf6bf85525cf24cb13af4a4e8f6996",
      candidateFingerprint:
        "sha256:c5dc13a7029ec1517df339256c3c2a269b15f78a4ab209660eece1530cded684",
      status: "proposed",
      sourceRefs: [
        {
          provider: "unknown",
          providerConversationId: "synthetic-result",
          conversationFingerprint: active.conversationFingerprint,
          messageFingerprints: [active.messages[0]!.fingerprint],
        },
      ],
    });
    const semantic = {
      type: "insight",
      title: "Bounded contracts",
      summary: "Strict validation preserves authority.",
      body: "Validate untrusted output before installing preview state.",
      confidence: "high",
      sourceMessageFingerprints: [active.messages[0]!.fingerprint],
      suggestedLinks: ["Contracts"],
      suggestedTags: ["validation"],
    };
    expect(result.candidates[0]!.candidateFingerprint).toBe(
      sha256(stableM04Json(semantic)),
    );
    expect(result.candidates[0]!.candidateFingerprint).not.toBe(
      fingerprint(stableM04Json(semantic)),
    );
  });

  it("round-trips every knowledge type and confidence value", () => {
    const active = request();
    const types = [
      "insight",
      "decision",
      "framework",
      "procedure",
      "prompt",
      "resource",
      "project-context",
      "assumption",
      "open-question",
      "action",
    ] as const;
    const confidences = ["high", "medium", "low"] as const;
    const value = validObject(active);
    value.candidates = types.map((type, index) => ({
      ...value.candidates[0]!,
      type,
      confidence: confidences[index % confidences.length]!,
      title: `Candidate ${String(index)}`,
    }));
    const result = validateDistillationResult(JSON.stringify(value), active);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.map(({ type }) => type)).toEqual(types);
  });

  it("rejects duplicate decoded object member names before shape validation", () => {
    const active = request();
    const raw = validRaw(active).replace(
      '"requestId":',
      `"requestId":"forged","\\u0072equestId":`,
    );
    expect(validateDistillationResult(raw, active)).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "DISTILLATION_JSON_INVALID",
          severity: "error",
          path: "",
          message:
            "Paste one strict JSON object with no duplicate keys or invalid Unicode.",
        },
      ],
    });
  });

  it.each([
    ["empty", ""],
    ["leading BOM", `\ufeff${validRaw(request())}`],
    ["fenced", `\`\`\`json\n${validRaw(request())}\n\`\`\``],
    ["commentary", `Result: ${validRaw(request())}`],
    ["multiple values", `${validRaw(request())} {}`],
    ["trailing content", `${validRaw(request())}x`],
    ["escaped lone surrogate", '{"bad":"\\ud800"}'],
    ["literal lone surrogate", '{"bad":"\ud800"}'],
    ["comment", '{"bad":/* no */1}'],
    ["non-finite exponent", '{"bad":1e999}'],
  ])("rejects %s as strict JSON", (_name, raw) => {
    const result = validateDistillationResult(raw, request());
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "DISTILLATION_JSON_INVALID", path: "" }],
    });
  });

  it("accepts only the permitted leading and trailing JSON whitespace", () => {
    const active = request();
    expect(
      validateDistillationResult(` \t\r\n${validRaw(active)}\n\r\t `, active)
        .ok,
    ).toBe(true);
  });

  it("enforces the raw UTF-8 limit at exactly minus one, equal, and plus one", () => {
    const active = request();
    const raw = validRaw(active);
    const padding = M04_RESULT_MAX_UTF8_BYTES - raw.length;
    expect(
      validateDistillationResult(`${raw}${" ".repeat(padding - 1)}`, active).ok,
    ).toBe(true);
    expect(
      validateDistillationResult(`${raw}${" ".repeat(padding)}`, active).ok,
    ).toBe(true);
    expect(
      validateDistillationResult(`${raw}${" ".repeat(padding + 1)}`, active),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: "DISTILLATION_RESULT_TOO_LARGE", path: "" }],
    });
  });

  it("reports deterministic top-level missing, extra, type, and identity errors", () => {
    const active = request();
    const value = validObject(active) as Record<string, unknown>;
    delete value.requestId;
    value.extra = true;
    value.schemaVersion = "1";
    value.contractVersion = "wrong";
    expect(validateDistillationResult(JSON.stringify(value), active)).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "DISTILLATION_REQUEST_MISMATCH",
          path: "/contractVersion",
        }),
        expect.objectContaining({
          code: "DISTILLATION_SHAPE_INVALID",
          path: "/extra",
        }),
        expect.objectContaining({
          code: "DISTILLATION_SHAPE_INVALID",
          path: "/requestId",
        }),
        expect.objectContaining({
          code: "DISTILLATION_SHAPE_INVALID",
          path: "/schemaVersion",
        }),
      ],
    });
  });

  it.each([
    "sourceMessageFingerprints",
    "suggestedLinks",
    "suggestedTags",
  ] as const)("emits exactly one missing-member diagnostic for %s", (key) => {
    const active = request();
    const value = validObject(active);
    Reflect.deleteProperty(value.candidates[0]!, key);
    expect(validateDistillationResult(JSON.stringify(value), active)).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "DISTILLATION_SHAPE_INVALID",
          path: `/candidates/0/${key}`,
        }),
      ],
    });
  });

  it("reports exact suggestion and source element diagnostic authority", () => {
    const active = request();
    const value = validObject(active);
    value.candidates[0]!.suggestedLinks = [42 as unknown as string];
    value.candidates[0]!.suggestedTags = ["ok", "ok"];
    value.candidates[0]!.sourceMessageFingerprints = [42 as unknown as string];

    const suggestion = validateDistillationResult(
      JSON.stringify(value),
      active,
    );
    expect(suggestion).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "DISTILLATION_CANDIDATE_INVALID",
          path: "/candidates/0/suggestedLinks/0",
        }),
        expect.objectContaining({
          code: "DISTILLATION_CANDIDATE_INVALID",
          path: "/candidates/0/suggestedTags/1",
        }),
      ],
    });

    value.candidates[0]!.suggestedLinks = [];
    value.candidates[0]!.suggestedTags = [];
    expect(validateDistillationResult(JSON.stringify(value), active)).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "DISTILLATION_SOURCE_REF_INVALID",
          path: "/candidates/0/sourceMessageFingerprints/0",
        }),
      ],
    });
  });

  it("rejects forged and later duplicate provenance independently", () => {
    const active = request();
    const value = validObject(active);
    value.candidates[0]!.sourceMessageFingerprints = [
      `sha256:${"9".repeat(64)}`,
      active.messages[0]!.fingerprint,
      active.messages[0]!.fingerprint,
    ];
    expect(validateDistillationResult(JSON.stringify(value), active)).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "DISTILLATION_SOURCE_REF_INVALID",
          path: "/candidates/0/sourceMessageFingerprints/0",
        }),
        expect.objectContaining({
          code: "DISTILLATION_SOURCE_REF_INVALID",
          path: "/candidates/0/sourceMessageFingerprints/2",
        }),
      ],
    });
  });

  it("emits both provenance diagnostics when a later forged reference is also a duplicate", () => {
    const active = request();
    const value = validObject(active);
    const forged = `sha256:${"9".repeat(64)}`;
    value.candidates[0]!.sourceMessageFingerprints = [forged, forged];
    expect(validateDistillationResult(JSON.stringify(value), active)).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "DISTILLATION_SOURCE_REF_INVALID",
          path: "/candidates/0/sourceMessageFingerprints/0",
        }),
        expect.objectContaining({
          code: "DISTILLATION_SOURCE_REF_INVALID",
          path: "/candidates/0/sourceMessageFingerprints/1",
        }),
        expect.objectContaining({
          code: "DISTILLATION_SOURCE_REF_INVALID",
          path: "/candidates/0/sourceMessageFingerprints/1",
        }),
      ],
    });
  });

  it("applies the diagnostic cap after overlapping provenance violations", () => {
    const active = request();
    const value = validObject(active);
    const forged = `sha256:${"9".repeat(64)}`;
    value.candidates[0]!.sourceMessageFingerprints = Array.from(
      { length: 26 },
      () => forged,
    );
    const result = validateDistillationResult(JSON.stringify(value), active);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(50);
    expect(result.diagnostics.at(-1)).toEqual(
      expect.objectContaining({
        code: "DISTILLATION_DIAGNOSTIC_LIMIT",
        path: "",
      }),
    );
  });

  it.each(["suggestedLinks", "suggestedTags"] as const)(
    "emits both suggestion diagnostics when a later over-limit %s value is also a duplicate",
    (key) => {
      const active = request();
      const value = validObject(active);
      const overLimit = "x".repeat(241);
      value.candidates[0]![key] = [overLimit, overLimit];
      expect(validateDistillationResult(JSON.stringify(value), active)).toEqual(
        {
          ok: false,
          diagnostics: [
            expect.objectContaining({
              code: "DISTILLATION_CANDIDATE_INVALID",
              path: `/candidates/0/${key}/0`,
            }),
            expect.objectContaining({
              code: "DISTILLATION_CANDIDATE_INVALID",
              path: `/candidates/0/${key}/1`,
            }),
            expect.objectContaining({
              code: "DISTILLATION_CANDIDATE_INVALID",
              path: `/candidates/0/${key}/1`,
            }),
          ],
        },
      );
    },
  );

  it("applies the diagnostic cap after overlapping suggestion violations", () => {
    const active = request();
    const value = validObject(active);
    const overLimit = "x".repeat(241);
    value.candidates[0]!.suggestedLinks = Array.from(
      { length: 26 },
      () => overLimit,
    );
    const result = validateDistillationResult(JSON.stringify(value), active);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(50);
    expect(result.diagnostics.at(-1)).toEqual(
      expect.objectContaining({
        code: "DISTILLATION_DIAGNOSTIC_LIMIT",
        path: "",
      }),
    );
  });

  it("treats set-array order as non-semantic for duplicate candidates", () => {
    const active = request();
    const value = validObject(active);
    value.candidates[0]!.suggestedLinks = ["Zulu", "Alpha"];
    value.candidates.push({
      ...value.candidates[0]!,
      suggestedLinks: ["Alpha", "Zulu"],
      suggestedTags: [...value.candidates[0]!.suggestedTags].reverse(),
      sourceMessageFingerprints: [
        ...value.candidates[0]!.sourceMessageFingerprints,
      ].reverse(),
    });
    expect(validateDistillationResult(JSON.stringify(value), active)).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "DISTILLATION_DUPLICATE_CANDIDATE",
          path: "/candidates/1",
        }),
      ],
    });
  });

  it("enforces NFC, non-empty, UTF-16, and UTF-8 string limits", () => {
    const active = request();
    for (const title of ["", "e\u0301", "x".repeat(241), "界".repeat(171)]) {
      const value = validObject(active);
      value.candidates[0]!.title = title;
      expect(validateDistillationResult(JSON.stringify(value), active)).toEqual(
        {
          ok: false,
          diagnostics: [
            expect.objectContaining({
              code: "DISTILLATION_CANDIDATE_INVALID",
              path: "/candidates/0/title",
            }),
          ],
        },
      );
    }
  });

  it("caps sorted diagnostics at 49 entries plus the limit marker", () => {
    const active = request();
    const value = validObject(active);
    value.candidates = Array.from({ length: 64 }, (_unused, index) => ({
      ...value.candidates[0]!,
      title: `candidate-${index}`,
      suggestedLinks: [42 as unknown as string],
    }));
    const result = validateDistillationResult(JSON.stringify(value), active);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(50);
    expect(result.diagnostics[49]).toMatchObject({
      code: "DISTILLATION_DIAGNOSTIC_LIMIT",
      path: "",
    });
  });
});
