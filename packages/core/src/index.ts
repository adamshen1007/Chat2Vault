export type {
  ArchiveLimits,
  CanonicalContentBlock,
  CanonicalConversation,
  CanonicalMessage,
  CanonicalRole,
  ChatGptExportFile,
  DiagnosticSeverity,
  ImportDiagnostic,
  ImportDiagnosticCode,
  ImportOptions,
  ImportResult,
  SourceDescriptor,
  SourceProvider,
} from "./domain/contracts.js";
export {
  compareStableStrings,
  fingerprint,
  sha256,
  stableStringify,
} from "./fingerprint/stable-json.js";
export { DEFAULT_ARCHIVE_LIMITS } from "./importers/archive.js";
export { parseChatGptExport } from "./importers/chatgpt/parser.js";
export {
  isCanonicalM03Timestamp,
  isM03WellFormedString,
  normalizeSourceRoot,
  pathCollisionKey,
  renderSourceNote,
  safeSourceTitle,
  SOURCE_MARKDOWN_PREVIEW_LIMIT_UTF16,
  sourceTopologyAvailable,
  sourceMarkdownPreview,
  toM03WellFormedString,
} from "./source-writer/primitives.js";
export {
  M04_BODY_MAX_UTF16,
  M04_BODY_MAX_UTF8,
  M04_CONTRACT_VERSION,
  M04_DIAGNOSTIC_LIMIT,
  M04_MAX_CANDIDATES,
  M04_MAX_SOURCE_MESSAGE_FINGERPRINTS_PER_CANDIDATE,
  M04_MAX_SUGGESTED_LINKS,
  M04_MAX_SUGGESTED_TAGS,
  M04_PROMPT_MAX_UTF8_BYTES,
  M04_RESULT_MAX_UTF8_BYTES,
  M04_SUGGESTION_MAX_UTF16,
  M04_SUGGESTION_MAX_UTF8,
  M04_SUMMARY_MAX_UTF16,
  M04_SUMMARY_MAX_UTF8,
  M04_TITLE_MAX_UTF16,
  M04_TITLE_MAX_UTF8,
} from "./distillation/contracts.js";
export type {
  CandidateConfidence,
  DistillationValidationResult,
  DistillationMessage,
  DistillationRequest,
  DistillationRequestCore,
  DistillationTopology,
  DistillationTopologyEntry,
  M04Diagnostic,
  M04DiagnosticCode,
  KnowledgeType,
  PreviewCandidate,
  PromptRenderResult,
  RequestBuildResult,
  SourceRef,
} from "./distillation/contracts.js";
export {
  buildDistillationRequest,
  renderDistillationPrompt,
  stableM04Json,
  toM04WellFormedString,
} from "./distillation/request.js";
export {
  m04Diagnostic,
  validateDistillationResult,
} from "./distillation/result.js";
export {
  compareSourcePaths,
  isChat2VaultLikeMalformed,
  parseSourceRegistryEntry,
  planSourceWrite,
  sourceWritePreRegistryGate,
  sourceWritePreRootGate,
  sourceWritePlanEqual,
  sourceWriterDiagnostic,
} from "./source-writer/planner.js";
export type {
  BlockedSourceWritePlan,
  DuplicateSourceWritePlan,
  NewSourceWritePlan,
  NewVersionSourceWritePlan,
  SourcePlannerInput,
  SourcePreRootGateInput,
  SourceRegistryEntry,
  SourceWritePlan,
  SourceWriterDiagnostic,
  SourceWriterDiagnosticCode,
  SourceWriterDiagnosticSeverity,
} from "./source-writer/planner.js";
export type {
  NormalizedSourceRoot,
  SourceMarkdownPreviewDisplay,
  SourceNoteRenderInput,
  SourceNoteRenderResult,
} from "./source-writer/primitives.js";
