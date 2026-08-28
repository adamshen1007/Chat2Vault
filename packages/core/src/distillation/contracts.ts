import type {
  CanonicalContentBlock,
  CanonicalRole,
  SourceProvider,
} from "../domain/contracts.js";

export const M04_CONTRACT_VERSION = "m04-manual-v1" as const;
export const M04_PROMPT_MAX_UTF8_BYTES = 262_144;
export const M04_RESULT_MAX_UTF8_BYTES = 524_288;
export const M04_MAX_CANDIDATES = 64;
export const M04_MAX_SOURCE_MESSAGE_FINGERPRINTS_PER_CANDIDATE = 64;
export const M04_MAX_SUGGESTED_LINKS = 32;
export const M04_MAX_SUGGESTED_TAGS = 32;
export const M04_TITLE_MAX_UTF16 = 240;
export const M04_TITLE_MAX_UTF8 = 512;
export const M04_SUMMARY_MAX_UTF16 = 4_096;
export const M04_SUMMARY_MAX_UTF8 = 8_192;
export const M04_BODY_MAX_UTF16 = 32_768;
export const M04_BODY_MAX_UTF8 = 65_536;
export const M04_SUGGESTION_MAX_UTF16 = 240;
export const M04_SUGGESTION_MAX_UTF8 = 512;
export const M04_DIAGNOSTIC_LIMIT = 50;

export type M04DiagnosticCode =
  | "DISTILLATION_NO_SELECTION"
  | "DISTILLATION_REQUEST_INVALID"
  | "DISTILLATION_PROMPT_TOO_LARGE"
  | "DISTILLATION_PREPARE_IN_PROGRESS"
  | "DISTILLATION_COPY_IN_PROGRESS"
  | "DISTILLATION_CLIPBOARD_DENIED"
  | "DISTILLATION_CLIPBOARD_FAILED"
  | "DISTILLATION_NO_ACTIVE_REQUEST"
  | "DISTILLATION_RESULT_TOO_LARGE"
  | "DISTILLATION_JSON_INVALID"
  | "DISTILLATION_SHAPE_INVALID"
  | "DISTILLATION_REQUEST_MISMATCH"
  | "DISTILLATION_CANDIDATE_INVALID"
  | "DISTILLATION_SOURCE_REF_INVALID"
  | "DISTILLATION_DUPLICATE_CANDIDATE"
  | "DISTILLATION_VALIDATE_IN_PROGRESS"
  | "DISTILLATION_STALE_OPERATION"
  | "DISTILLATION_DIAGNOSTIC_LIMIT";

export interface M04Diagnostic {
  code: M04DiagnosticCode;
  severity: "error";
  path: string;
  message: string;
}

export interface DistillationMessage {
  ref: string;
  fingerprint: string;
  role: CanonicalRole;
  createdAt?: string;
  content: CanonicalContentBlock[];
}

export interface DistillationTopologyEntry {
  ref: string;
  parent: string | null;
  onSelectedPath: boolean;
  alternativeLeaf: boolean;
}

export interface DistillationTopology {
  current: string | null;
  selectedPath: string[];
  alternativeLeaves: string[];
  unrepresentedNodeCount: number;
  entries: DistillationTopologyEntry[];
}

export interface DistillationRequestCore {
  schemaVersion: 1;
  contractVersion: typeof M04_CONTRACT_VERSION;
  provider: SourceProvider;
  providerConversationId?: string;
  conversationFingerprint: string;
  title?: string;
  messages: DistillationMessage[];
  topology: DistillationTopology;
}

export interface DistillationRequest extends DistillationRequestCore {
  requestId: string;
}

export type RequestBuildResult =
  | { ok: true; request: DistillationRequest }
  | { ok: false; diagnostics: [M04Diagnostic] };

export type PromptRenderResult =
  | { ok: true; text: string; utf8Bytes: number }
  | { ok: false; diagnostics: [M04Diagnostic] };

export type KnowledgeType =
  | "insight"
  | "decision"
  | "framework"
  | "procedure"
  | "prompt"
  | "resource"
  | "project-context"
  | "assumption"
  | "open-question"
  | "action";

export type CandidateConfidence = "high" | "medium" | "low";

export interface SourceRef {
  provider: SourceProvider;
  providerConversationId?: string;
  conversationFingerprint: string;
  messageFingerprints: string[];
}

export interface PreviewCandidate {
  id: string;
  candidateFingerprint: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  body: string;
  status: "proposed";
  confidence: CandidateConfidence;
  sourceRefs: [SourceRef];
  suggestedLinks: string[];
  suggestedTags: string[];
}

export type DistillationValidationResult =
  | { ok: true; candidates: PreviewCandidate[] }
  | { ok: false; diagnostics: M04Diagnostic[] };
