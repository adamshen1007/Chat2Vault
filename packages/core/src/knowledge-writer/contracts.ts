import type {
  CandidateConfidence,
  KnowledgeType,
  SourceRef,
} from "../distillation/contracts.js";
import type { SourceProvider } from "../domain/contracts.js";

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

export interface ResolvedKnowledgeSource {
  provider: SourceProvider;
  providerConversationId?: string;
  conversationFingerprint: string;
  messageFingerprints: readonly string[];
  sourceNotePath: string;
}

export type KnowledgeTargetObservation =
  | { status: "absent" }
  | { status: "regular-file"; bytes: Uint8Array }
  | { status: "obstructed" }
  | { status: "unsafe" };

export interface KnowledgeTargetState {
  targetPath: string;
  observation: KnowledgeTargetObservation;
}

export interface KnowledgePlanEntry {
  candidateId: string;
  candidateFingerprint: string;
  targetPath: string;
  noteContent: string;
  noteContentFingerprint: string;
  action: "create" | "identical-no-op" | "conflict";
}

interface KnowledgeWritePlanBase {
  sourceRoot: string | null;
  knowledgeRoot: string | null;
  entries: readonly KnowledgePlanEntry[];
  planFingerprint: string;
  diagnostics: readonly M06Diagnostic[];
}

export interface ReadyKnowledgeWritePlan extends KnowledgeWritePlanBase {
  status: "ready";
  sourceRoot: string;
  knowledgeRoot: string;
  diagnostics: readonly [];
}

export interface BlockedKnowledgeWritePlan extends KnowledgeWritePlanBase {
  status: "blocked";
}

export type KnowledgeWritePlan =
  ReadyKnowledgeWritePlan | BlockedKnowledgeWritePlan;

export interface KnowledgePlannerInput {
  sourceRoot: unknown;
  knowledgeRoot: unknown;
  candidates: readonly ReviewedKnowledgeCandidate[];
  resolvedSources: readonly ResolvedKnowledgeSource[];
  targetObservations: readonly KnowledgeTargetState[];
}

export type KnowledgeNoteRenderResult =
  | {
      ok: true;
      candidateFingerprint: string;
      filename: string;
      noteContent: string;
      noteContentFingerprint: string;
    }
  | { ok: false; diagnostics: readonly M06Diagnostic[] };
