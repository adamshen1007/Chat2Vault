import {
  M04_BODY_MAX_UTF16,
  M04_BODY_MAX_UTF8,
  M04_MAX_SUGGESTED_TAGS,
  M04_SUGGESTION_MAX_UTF16,
  M04_SUGGESTION_MAX_UTF8,
  M04_SUMMARY_MAX_UTF16,
  M04_SUMMARY_MAX_UTF8,
  M04_TITLE_MAX_UTF16,
  M04_TITLE_MAX_UTF8,
  type PreviewCandidate,
  type SourceRef,
} from "../distillation/contracts.js";
import { compareStableStrings } from "../fingerprint/stable-json.js";
import type {
  KnowledgeDecision,
  KnowledgeReviewEdit,
  KnowledgeReviewEditResult,
  M06Diagnostic,
  M06DiagnosticCode,
  ReviewedKnowledgeCandidate,
} from "./contracts.js";

const DIAGNOSTIC_MESSAGES: Record<M06DiagnosticCode, string> = {
  KNOWLEDGE_REVIEW_INVALID: "The knowledge review fields are invalid.",
  KNOWLEDGE_TAG_INVALID: "The knowledge tags are invalid.",
  KNOWLEDGE_NO_SELECTION: "Select at least one eligible knowledge candidate.",
  KNOWLEDGE_ROOT_UNCONFIGURED: "Configure a knowledge root before previewing.",
  KNOWLEDGE_ROOT_INVALID: "The configured knowledge root is invalid.",
  KNOWLEDGE_ROOT_OVERLAP: "The knowledge root overlaps the source root.",
  KNOWLEDGE_SOURCE_UNRESOLVED: "A knowledge source could not be resolved.",
  KNOWLEDGE_SOURCE_AMBIGUOUS: "A knowledge source is ambiguous.",
  KNOWLEDGE_SOURCE_STALE: "A knowledge source changed before planning.",
  KNOWLEDGE_PATH_UNSAFE: "A knowledge target path is unsafe.",
  KNOWLEDGE_BATCH_TARGET_DUPLICATE:
    "Multiple candidates resolve to the same knowledge target.",
  KNOWLEDGE_TARGET_CONFLICT: "A knowledge target already has other content.",
  KNOWLEDGE_PREVIEW_IN_PROGRESS: "A knowledge preview is already in progress.",
  KNOWLEDGE_WRITE_IN_PROGRESS: "A knowledge write is already in progress.",
  KNOWLEDGE_PLAN_STALE: "The knowledge write plan is stale.",
  KNOWLEDGE_CREATE_FAILED: "A knowledge note could not be created.",
  KNOWLEDGE_VERIFICATION_FAILED:
    "A created knowledge note could not be verified.",
};

export function m06Diagnostic(code: M06DiagnosticCode): M06Diagnostic {
  return { code, severity: "error", message: DIAGNOSTIC_MESSAGES[code] };
}

function cloneSourceRef(sourceRef: SourceRef): SourceRef {
  return {
    provider: sourceRef.provider,
    ...(sourceRef.providerConversationId === undefined
      ? {}
      : { providerConversationId: sourceRef.providerConversationId }),
    conversationFingerprint: sourceRef.conversationFingerprint,
    messageFingerprints: [...sourceRef.messageFingerprints],
  };
}

function detachCandidate(
  candidate: ReviewedKnowledgeCandidate,
): ReviewedKnowledgeCandidate {
  return {
    id: candidate.id,
    originalCandidateFingerprint: candidate.originalCandidateFingerprint,
    type: candidate.type,
    confidence: candidate.confidence,
    sourceRefs: candidate.sourceRefs.map(cloneSourceRef),
    title: candidate.title,
    summary: candidate.summary,
    body: candidate.body,
    tags: [...candidate.tags],
    decision: candidate.decision,
    selected: candidate.selected,
  };
}

export function createKnowledgeReview(
  preview: PreviewCandidate,
): ReviewedKnowledgeCandidate {
  return {
    id: preview.id,
    originalCandidateFingerprint: preview.candidateFingerprint,
    type: preview.type,
    confidence: preview.confidence,
    sourceRefs: preview.sourceRefs.map(cloneSourceRef),
    title: preview.title,
    summary: preview.summary,
    body: preview.body,
    tags: [...preview.suggestedTags].sort(compareStableStrings),
    decision: "proposed",
    selected: false,
  };
}

export function setKnowledgeDecision(
  candidate: ReviewedKnowledgeCandidate,
  decision: KnowledgeDecision,
): ReviewedKnowledgeCandidate {
  const detached = detachCandidate(candidate);
  return {
    ...detached,
    decision,
    selected:
      decision === "accepted" || decision === "edited"
        ? detached.selected
        : false,
  };
}

export function setKnowledgeSelected(
  candidate: ReviewedKnowledgeCandidate,
  selected: boolean,
): ReviewedKnowledgeCandidate {
  const detached = detachCandidate(candidate);
  return {
    ...detached,
    selected:
      selected &&
      (detached.decision === "accepted" || detached.decision === "edited"),
  };
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function validString(
  value: unknown,
  maxUtf16: number,
  maxUtf8: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !hasUnpairedSurrogate(value) &&
    value.normalize("NFC") === value &&
    value.length <= maxUtf16 &&
    new TextEncoder().encode(value).length <= maxUtf8
  );
}

const EDIT_KEYS = ["title", "summary", "body", "tags"] as const;
const EDIT_KEY_SET: ReadonlySet<string> = new Set(EDIT_KEYS);

function readEditData(value: unknown): KnowledgeReviewEdit | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== EDIT_KEYS.length ||
    keys.some((key) => typeof key !== "string" || !EDIT_KEY_SET.has(key))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of EDIT_KEYS) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      return undefined;
  }
  const title: unknown = descriptors.title?.value;
  const summary: unknown = descriptors.summary?.value;
  const body: unknown = descriptors.body?.value;
  const tags: unknown = descriptors.tags?.value;
  return {
    title: title as string,
    summary: summary as string,
    body: body as string,
    tags: tags as readonly string[],
  };
}

function readTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > M04_MAX_SUGGESTED_TAGS)
    return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)),
    ) ||
    keys.length !== value.length + 1
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const tags: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !validString(
        descriptor.value,
        M04_SUGGESTION_MAX_UTF16,
        M04_SUGGESTION_MAX_UTF8,
      ) ||
      seen.has(descriptor.value)
    )
      return undefined;
    seen.add(descriptor.value);
    tags.push(descriptor.value);
  }
  return tags.sort(compareStableStrings);
}

function failure(code: M06DiagnosticCode): KnowledgeReviewEditResult {
  return { ok: false, diagnostics: [m06Diagnostic(code)] };
}

export function editKnowledgeCandidate(
  candidate: ReviewedKnowledgeCandidate,
  value: unknown,
): KnowledgeReviewEditResult {
  const edit = readEditData(value);
  if (edit === undefined) return failure("KNOWLEDGE_REVIEW_INVALID");
  if (
    !validString(edit.title, M04_TITLE_MAX_UTF16, M04_TITLE_MAX_UTF8) ||
    !validString(edit.summary, M04_SUMMARY_MAX_UTF16, M04_SUMMARY_MAX_UTF8) ||
    !validString(edit.body, M04_BODY_MAX_UTF16, M04_BODY_MAX_UTF8)
  )
    return failure("KNOWLEDGE_REVIEW_INVALID");
  const tags = readTags(edit.tags);
  if (tags === undefined) return failure("KNOWLEDGE_TAG_INVALID");

  const detached = detachCandidate(candidate);
  return {
    ok: true,
    candidate: {
      ...detached,
      title: edit.title,
      summary: edit.summary,
      body: edit.body,
      tags,
      decision: "edited",
    },
  };
}
