import { compareStableStrings, sha256 } from "../fingerprint/stable-json.js";
import {
  M04_BODY_MAX_UTF16,
  M04_BODY_MAX_UTF8,
  M04_CONTRACT_VERSION,
  M04_DIAGNOSTIC_LIMIT,
  M04_MAX_CANDIDATES,
  M04_MAX_SOURCE_MESSAGE_FINGERPRINTS_PER_CANDIDATE,
  M04_MAX_SUGGESTED_LINKS,
  M04_MAX_SUGGESTED_TAGS,
  M04_RESULT_MAX_UTF8_BYTES,
  M04_SUGGESTION_MAX_UTF16,
  M04_SUGGESTION_MAX_UTF8,
  M04_SUMMARY_MAX_UTF16,
  M04_SUMMARY_MAX_UTF8,
  M04_TITLE_MAX_UTF16,
  M04_TITLE_MAX_UTF8,
  type CandidateConfidence,
  type DistillationRequest,
  type DistillationValidationResult,
  type KnowledgeType,
  type M04Diagnostic,
  type M04DiagnosticCode,
  type PreviewCandidate,
} from "./contracts.js";
import { stableM04Json } from "./request.js";

const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const KNOWLEDGE_TYPES = new Set<KnowledgeType>([
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
]);
const CONFIDENCE_VALUES = new Set<CandidateConfidence>([
  "high",
  "medium",
  "low",
]);

const DIAGNOSTIC_MESSAGES: Record<M04DiagnosticCode, string> = {
  DISTILLATION_NO_SELECTION: "Select one conversation first.",
  DISTILLATION_REQUEST_INVALID:
    "The selected conversation cannot form a valid distillation request.",
  DISTILLATION_PROMPT_TOO_LARGE:
    "This complete conversation exceeds the manual distillation prompt limit.",
  DISTILLATION_PREPARE_IN_PROGRESS:
    "Another distillation operation prevents prompt preparation.",
  DISTILLATION_COPY_IN_PROGRESS:
    "Another distillation operation prevents prompt copying.",
  DISTILLATION_CLIPBOARD_DENIED:
    "Clipboard permission was denied; no prompt was copied.",
  DISTILLATION_CLIPBOARD_FAILED: "The prompt could not be copied.",
  DISTILLATION_NO_ACTIVE_REQUEST: "Prepare a current prompt first.",
  DISTILLATION_RESULT_TOO_LARGE:
    "The pasted result exceeds the validation limit.",
  DISTILLATION_JSON_INVALID:
    "Paste one strict JSON object with no duplicate keys or invalid Unicode.",
  DISTILLATION_SHAPE_INVALID:
    "The result does not match the exact M04 object shape.",
  DISTILLATION_REQUEST_MISMATCH:
    "The result does not belong to the current request.",
  DISTILLATION_CANDIDATE_INVALID: "A candidate field is invalid.",
  DISTILLATION_SOURCE_REF_INVALID: "A candidate source reference is invalid.",
  DISTILLATION_DUPLICATE_CANDIDATE:
    "The result contains duplicate semantic candidates.",
  DISTILLATION_VALIDATE_IN_PROGRESS:
    "Another distillation operation prevents result validation.",
  DISTILLATION_STALE_OPERATION:
    "The distillation operation became stale and was discarded.",
  DISTILLATION_DIAGNOSTIC_LIMIT: "Additional validation errors were omitted.",
};

export function m04Diagnostic(
  code: M04DiagnosticCode,
  path = "",
): M04Diagnostic {
  return {
    code,
    severity: "error",
    path,
    message: DIAGNOSTIC_MESSAGES[code],
  };
}

function hasLiteralUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

class StrictJsonParser {
  private index = 0;
  public constructor(private readonly source: string) {}

  public parse(): unknown {
    this.whitespace();
    const value = this.value();
    this.whitespace();
    if (this.index !== this.source.length) throw new Error("trailing");
    return value;
  }

  private whitespace(): void {
    while (
      this.source[this.index] === " " ||
      this.source[this.index] === "\t" ||
      this.source[this.index] === "\n" ||
      this.source[this.index] === "\r"
    )
      this.index += 1;
  }

  private value(): unknown {
    const current = this.source[this.index];
    if (current === '"') return this.string();
    if (current === "{") return this.object();
    if (current === "[") return this.array();
    if (current === "t") return this.literal("true", true);
    if (current === "f") return this.literal("false", false);
    if (current === "n") return this.literal("null", null);
    if (current === "-" || (current !== undefined && /[0-9]/u.test(current)))
      return this.number();
    throw new Error("value");
  }

  private literal<T>(text: string, value: T): T {
    if (this.source.slice(this.index, this.index + text.length) !== text)
      throw new Error("literal");
    this.index += text.length;
    return value;
  }

  private number(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.source.slice(this.index),
    );
    if (match === null) throw new Error("number");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new Error("number-range");
    return value;
  }

  private unicodeEscape(): string {
    const hex = this.source.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/u.test(hex)) throw new Error("unicode");
    this.index += 4;
    const first = Number.parseInt(hex, 16);
    if (first >= 0xd800 && first <= 0xdbff) {
      if (this.source.slice(this.index, this.index + 2) !== "\\u")
        throw new Error("surrogate");
      this.index += 2;
      const lowHex = this.source.slice(this.index, this.index + 4);
      if (!/^[0-9a-fA-F]{4}$/u.test(lowHex)) throw new Error("surrogate");
      this.index += 4;
      const low = Number.parseInt(lowHex, 16);
      if (low < 0xdc00 || low > 0xdfff) throw new Error("surrogate");
      return String.fromCodePoint(
        0x10000 + ((first - 0xd800) << 10) + (low - 0xdc00),
      );
    }
    if (first >= 0xdc00 && first <= 0xdfff) throw new Error("surrogate");
    return String.fromCharCode(first);
  }

  private string(): string {
    this.index += 1;
    let output = "";
    while (this.index < this.source.length) {
      const current = this.source[this.index++];
      if (current === undefined) throw new Error("string");
      if (current === '"') return output;
      if (current.charCodeAt(0) <= 0x1f) throw new Error("control");
      if (current !== "\\") {
        output += current;
        continue;
      }
      const escaped = this.source[this.index++];
      if (escaped === '"' || escaped === "\\" || escaped === "/")
        output += escaped;
      else if (escaped === "b") output += "\b";
      else if (escaped === "f") output += "\f";
      else if (escaped === "n") output += "\n";
      else if (escaped === "r") output += "\r";
      else if (escaped === "t") output += "\t";
      else if (escaped === "u") output += this.unicodeEscape();
      else throw new Error("escape");
    }
    throw new Error("string");
  }

  private array(): unknown[] {
    this.index += 1;
    this.whitespace();
    const result: unknown[] = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    for (;;) {
      result.push(this.value());
      this.whitespace();
      const current = this.source[this.index++];
      if (current === "]") return result;
      if (current !== ",") throw new Error("array");
      this.whitespace();
    }
  }

  private object(): Record<string, unknown> {
    this.index += 1;
    this.whitespace();
    const entries: [string, unknown][] = [];
    const names = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return {};
    }
    for (;;) {
      if (this.source[this.index] !== '"') throw new Error("member");
      const name = this.string();
      if (names.has(name)) throw new Error("duplicate");
      names.add(name);
      this.whitespace();
      if (this.source[this.index++] !== ":") throw new Error("colon");
      this.whitespace();
      entries.push([name, this.value()]);
      this.whitespace();
      const current = this.source[this.index++];
      if (current === "}") return Object.fromEntries(entries);
      if (current !== ",") throw new Error("object");
      this.whitespace();
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointer(parent: string, member: string | number): string {
  const encoded = String(member).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${parent}/${encoded}`;
}

function capped(diagnostics: M04Diagnostic[]): M04Diagnostic[] {
  diagnostics.sort(
    (left, right) =>
      compareStableStrings(left.path, right.path) ||
      compareStableStrings(left.code, right.code),
  );
  return diagnostics.length <= M04_DIAGNOSTIC_LIMIT
    ? diagnostics
    : [
        ...diagnostics.slice(0, M04_DIAGNOSTIC_LIMIT - 1),
        m04Diagnostic("DISTILLATION_DIAGNOSTIC_LIMIT"),
      ];
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  parent: string,
): M04Diagnostic[] {
  const diagnostics: M04Diagnostic[] = [];
  for (const key of expected)
    if (!Object.hasOwn(value, key))
      diagnostics.push(
        m04Diagnostic("DISTILLATION_SHAPE_INVALID", pointer(parent, key)),
      );
  for (const key of Object.keys(value))
    if (!expected.includes(key))
      diagnostics.push(
        m04Diagnostic("DISTILLATION_SHAPE_INVALID", pointer(parent, key)),
      );
  return diagnostics;
}

interface UntrustedCandidate {
  type: KnowledgeType;
  title: string;
  summary: string;
  body: string;
  confidence: CandidateConfidence;
  sourceMessageFingerprints: string[];
  suggestedLinks: string[];
  suggestedTags: string[];
}

function validString(
  value: string,
  maxUtf16: number,
  maxUtf8: number,
): boolean {
  return (
    value.length > 0 &&
    value.normalize("NFC") === value &&
    value.length <= maxUtf16 &&
    new TextEncoder().encode(value).length <= maxUtf8
  );
}

const CANDIDATE_KEYS = [
  "type",
  "title",
  "summary",
  "body",
  "confidence",
  "sourceMessageFingerprints",
  "suggestedLinks",
  "suggestedTags",
] as const;

function validateCandidateStage(values: unknown[]): {
  diagnostics: M04Diagnostic[];
  candidates: UntrustedCandidate[];
} {
  const diagnostics: M04Diagnostic[] = [];
  const candidates: UntrustedCandidate[] = [];
  for (const [index, value] of values.entries()) {
    const base = `/candidates/${String(index)}`;
    if (!isObject(value)) {
      diagnostics.push(m04Diagnostic("DISTILLATION_SHAPE_INVALID", base));
      continue;
    }
    diagnostics.push(...exactKeys(value, CANDIDATE_KEYS, base));
    const scalarTypes = ["type", "title", "summary", "body", "confidence"];
    for (const key of scalarTypes)
      if (Object.hasOwn(value, key) && typeof value[key] !== "string")
        diagnostics.push(
          m04Diagnostic("DISTILLATION_SHAPE_INVALID", pointer(base, key)),
        );
    const arrays = [
      [
        "sourceMessageFingerprints",
        1,
        M04_MAX_SOURCE_MESSAGE_FINGERPRINTS_PER_CANDIDATE,
      ],
      ["suggestedLinks", 0, M04_MAX_SUGGESTED_LINKS],
      ["suggestedTags", 0, M04_MAX_SUGGESTED_TAGS],
    ] as const;
    for (const [key, minimum, maximum] of arrays) {
      if (!Object.hasOwn(value, key)) continue;
      const child = value[key];
      if (
        !Array.isArray(child) ||
        child.length < minimum ||
        child.length > maximum
      )
        diagnostics.push(
          m04Diagnostic("DISTILLATION_SHAPE_INVALID", pointer(base, key)),
        );
    }
    if (
      typeof value.type === "string" &&
      !KNOWLEDGE_TYPES.has(value.type as KnowledgeType)
    )
      diagnostics.push(
        m04Diagnostic("DISTILLATION_CANDIDATE_INVALID", `${base}/type`),
      );
    if (
      typeof value.confidence === "string" &&
      !CONFIDENCE_VALUES.has(value.confidence as CandidateConfidence)
    )
      diagnostics.push(
        m04Diagnostic("DISTILLATION_CANDIDATE_INVALID", `${base}/confidence`),
      );
    const stringRules = [
      ["title", M04_TITLE_MAX_UTF16, M04_TITLE_MAX_UTF8],
      ["summary", M04_SUMMARY_MAX_UTF16, M04_SUMMARY_MAX_UTF8],
      ["body", M04_BODY_MAX_UTF16, M04_BODY_MAX_UTF8],
    ] as const;
    for (const [key, max16, max8] of stringRules)
      if (
        typeof value[key] === "string" &&
        !validString(value[key], max16, max8)
      )
        diagnostics.push(
          m04Diagnostic("DISTILLATION_CANDIDATE_INVALID", pointer(base, key)),
        );
    for (const key of ["suggestedLinks", "suggestedTags"] as const) {
      const child = value[key];
      if (!Array.isArray(child)) continue;
      const seen = new Set<string>();
      for (const [childIndex, item] of child.entries()) {
        const childPath = pointer(pointer(base, key), childIndex);
        const isNfc =
          typeof item === "string" && item.normalize("NFC") === item;
        if (
          typeof item !== "string" ||
          !validString(item, M04_SUGGESTION_MAX_UTF16, M04_SUGGESTION_MAX_UTF8)
        )
          diagnostics.push(
            m04Diagnostic("DISTILLATION_CANDIDATE_INVALID", childPath),
          );
        if (isNfc && seen.has(item))
          diagnostics.push(
            m04Diagnostic("DISTILLATION_CANDIDATE_INVALID", childPath),
          );
        if (isNfc) seen.add(item);
      }
    }
    candidates.push(value as unknown as UntrustedCandidate);
  }
  return { diagnostics, candidates };
}

function deriveCandidate(
  candidate: UntrustedCandidate,
  request: DistillationRequest,
): PreviewCandidate {
  const messageOrder = new Map(
    request.messages.map((message, index) => [message.fingerprint, index]),
  );
  const canonicalSources = [...candidate.sourceMessageFingerprints].sort(
    (left, right) =>
      (messageOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (messageOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
  const semantic = {
    type: candidate.type,
    title: candidate.title,
    summary: candidate.summary,
    body: candidate.body,
    confidence: candidate.confidence,
    sourceMessageFingerprints: canonicalSources,
    suggestedLinks: [...candidate.suggestedLinks].sort(compareStableStrings),
    suggestedTags: [...candidate.suggestedTags].sort(compareStableStrings),
  };
  const candidateFingerprint = sha256(stableM04Json(semantic));
  const id = sha256(
    stableM04Json({ requestId: request.requestId, candidateFingerprint }),
  );
  return {
    id,
    candidateFingerprint,
    type: candidate.type,
    title: candidate.title,
    summary: candidate.summary,
    body: candidate.body,
    status: "proposed",
    confidence: candidate.confidence,
    sourceRefs: [
      {
        provider: request.provider,
        ...(request.providerConversationId === undefined
          ? {}
          : { providerConversationId: request.providerConversationId }),
        conversationFingerprint: request.conversationFingerprint,
        messageFingerprints: canonicalSources,
      },
    ],
    suggestedLinks: [...candidate.suggestedLinks],
    suggestedTags: [...candidate.suggestedTags],
  };
}

export function validateDistillationResult(
  raw: string,
  request: DistillationRequest,
): DistillationValidationResult {
  if (
    raw.length === 0 ||
    raw.charCodeAt(0) === 0xfeff ||
    hasLiteralUnpairedSurrogate(raw)
  )
    return {
      ok: false,
      diagnostics: [m04Diagnostic("DISTILLATION_JSON_INVALID")],
    };
  if (new TextEncoder().encode(raw).length > M04_RESULT_MAX_UTF8_BYTES)
    return {
      ok: false,
      diagnostics: [m04Diagnostic("DISTILLATION_RESULT_TOO_LARGE")],
    };
  let parsed: unknown;
  try {
    parsed = new StrictJsonParser(raw).parse();
  } catch {
    return {
      ok: false,
      diagnostics: [m04Diagnostic("DISTILLATION_JSON_INVALID")],
    };
  }
  if (!isObject(parsed))
    return {
      ok: false,
      diagnostics: [m04Diagnostic("DISTILLATION_JSON_INVALID")],
    };

  const topDiagnostics = exactKeys(
    parsed,
    [
      "schemaVersion",
      "contractVersion",
      "requestId",
      "conversationFingerprint",
      "candidates",
    ],
    "",
  );
  for (const key of [
    "contractVersion",
    "requestId",
    "conversationFingerprint",
  ] as const)
    if (Object.hasOwn(parsed, key) && typeof parsed[key] !== "string")
      topDiagnostics.push(
        m04Diagnostic("DISTILLATION_SHAPE_INVALID", `/${key}`),
      );
  if (
    Object.hasOwn(parsed, "schemaVersion") &&
    typeof parsed.schemaVersion !== "number"
  )
    topDiagnostics.push(
      m04Diagnostic("DISTILLATION_SHAPE_INVALID", "/schemaVersion"),
    );
  if (
    Object.hasOwn(parsed, "candidates") &&
    (!Array.isArray(parsed.candidates) ||
      parsed.candidates.length < 1 ||
      parsed.candidates.length > M04_MAX_CANDIDATES)
  )
    topDiagnostics.push(
      m04Diagnostic("DISTILLATION_SHAPE_INVALID", "/candidates"),
    );
  if (typeof parsed.schemaVersion === "number" && parsed.schemaVersion !== 1)
    topDiagnostics.push(
      m04Diagnostic("DISTILLATION_REQUEST_MISMATCH", "/schemaVersion"),
    );
  if (
    typeof parsed.contractVersion === "string" &&
    parsed.contractVersion !== M04_CONTRACT_VERSION
  )
    topDiagnostics.push(
      m04Diagnostic("DISTILLATION_REQUEST_MISMATCH", "/contractVersion"),
    );
  if (
    typeof parsed.requestId === "string" &&
    parsed.requestId !== request.requestId
  )
    topDiagnostics.push(
      m04Diagnostic("DISTILLATION_REQUEST_MISMATCH", "/requestId"),
    );
  if (
    typeof parsed.conversationFingerprint === "string" &&
    parsed.conversationFingerprint !== request.conversationFingerprint
  )
    topDiagnostics.push(
      m04Diagnostic(
        "DISTILLATION_REQUEST_MISMATCH",
        "/conversationFingerprint",
      ),
    );
  if (topDiagnostics.length > 0)
    return { ok: false, diagnostics: capped(topDiagnostics) };

  const candidateStage = validateCandidateStage(parsed.candidates as unknown[]);
  if (candidateStage.diagnostics.length > 0)
    return { ok: false, diagnostics: capped(candidateStage.diagnostics) };

  const sourceDiagnostics: M04Diagnostic[] = [];
  const membership = new Set(
    request.messages.map(({ fingerprint }) => fingerprint),
  );
  for (const [index, candidate] of candidateStage.candidates.entries()) {
    const seen = new Set<string>();
    for (const [
      sourceIndex,
      source,
    ] of candidate.sourceMessageFingerprints.entries()) {
      const path = `/candidates/${String(index)}/sourceMessageFingerprints/${String(sourceIndex)}`;
      if (
        typeof source !== "string" ||
        !FINGERPRINT_PATTERN.test(source) ||
        !membership.has(source)
      )
        sourceDiagnostics.push(
          m04Diagnostic("DISTILLATION_SOURCE_REF_INVALID", path),
        );
      if (typeof source === "string" && seen.has(source))
        sourceDiagnostics.push(
          m04Diagnostic("DISTILLATION_SOURCE_REF_INVALID", path),
        );
      if (typeof source === "string") seen.add(source);
    }
  }
  if (sourceDiagnostics.length > 0)
    return { ok: false, diagnostics: capped(sourceDiagnostics) };

  const candidates = candidateStage.candidates.map((candidate) =>
    deriveCandidate(candidate, request),
  );
  const duplicateDiagnostics: M04Diagnostic[] = [];
  const fingerprints = new Set<string>();
  for (const [index, candidate] of candidates.entries()) {
    if (fingerprints.has(candidate.candidateFingerprint))
      duplicateDiagnostics.push(
        m04Diagnostic(
          "DISTILLATION_DUPLICATE_CANDIDATE",
          `/candidates/${String(index)}`,
        ),
      );
    fingerprints.add(candidate.candidateFingerprint);
  }
  return duplicateDiagnostics.length > 0
    ? { ok: false, diagnostics: capped(duplicateDiagnostics) }
    : { ok: true, candidates };
}
