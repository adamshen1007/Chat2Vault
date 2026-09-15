import type {
  CandidateConfidence,
  KnowledgeType,
  SourceRef,
} from "../distillation/contracts.js";

export type KnowledgeDecision = "proposed" | "accepted" | "edited" | "rejected";

export interface ReviewedKnowledgeCandidate {
  id: string;
  originalCandidateFingerprint: string;
  type: KnowledgeType;
  confidence: CandidateConfidence;
  sourceRefs: readonly SourceRef[];
  title: string;
  summary: string;
  body: string;
  tags: readonly string[];
  decision: KnowledgeDecision;
  selected: boolean;
}

export interface KnowledgeReviewEdit {
  title: string;
  summary: string;
  body: string;
  tags: readonly string[];
}

export type M06DiagnosticCode =
  | "KNOWLEDGE_REVIEW_INVALID"
  | "KNOWLEDGE_TAG_INVALID"
  | "KNOWLEDGE_NO_SELECTION"
  | "KNOWLEDGE_ROOT_UNCONFIGURED"
  | "KNOWLEDGE_ROOT_INVALID"
  | "KNOWLEDGE_ROOT_OVERLAP"
  | "KNOWLEDGE_SOURCE_UNRESOLVED"
  | "KNOWLEDGE_SOURCE_AMBIGUOUS"
  | "KNOWLEDGE_SOURCE_STALE"
  | "KNOWLEDGE_PATH_UNSAFE"
  | "KNOWLEDGE_BATCH_TARGET_DUPLICATE"
  | "KNOWLEDGE_TARGET_CONFLICT"
  | "KNOWLEDGE_PREVIEW_IN_PROGRESS"
  | "KNOWLEDGE_WRITE_IN_PROGRESS"
  | "KNOWLEDGE_PLAN_STALE"
  | "KNOWLEDGE_CREATE_FAILED"
  | "KNOWLEDGE_VERIFICATION_FAILED";

export interface M06Diagnostic {
  code: M06DiagnosticCode;
  severity: "error";
  message: string;
}

export type KnowledgeReviewEditResult =
  | { ok: true; candidate: ReviewedKnowledgeCandidate }
  | { ok: false; diagnostics: readonly M06Diagnostic[] };
