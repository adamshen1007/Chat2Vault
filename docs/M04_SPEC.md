# Milestone 04 Specification — Manual Distillation Contract and Candidate Preview

Version: 0.1-candidate

Status: **NO-GO — specification review pending; implementation not authorized**

## 1. Decision sought

This document defines the complete M04 implementation and acceptance boundary. A genuinely independent, read-only whole-spec review must approve one exact UTF-8 byte sequence and its SHA-256 with:

```text
GO — M04 IMPLEMENTATION AUTHORIZED
```

Any other verdict leaves M04 implementation at NO-GO. Independent approval does not authorize commit, push, PR, merge, release, deployment, Community submission, or M05 work; those remain separate Product Owner decisions.

## 2. Authority and baseline

Authority order:

1. `AGENTS.md` and higher-level platform/user instructions;
2. this specification after exact independent approval;
3. M03 closure merge `994bdeabd5a30c343c0d5a4bcbd872c69e794f2b`;
4. `docs/03_ARCHITECTURE.md`;
5. `docs/04_KNOWLEDGE_SCHEMA.md`;
6. `docs/01_PRODUCT_BRIEF.md`;
7. `docs/05_ROADMAP.md`;
8. `docs/06_OPEN_SOURCE_RELEASE_STRATEGY.md`.

M01–M03 behavior is a regression-protected baseline. The frozen M03 specification and approved amendment remain unchanged.

## 3. Goal

M04 proves provider-neutral knowledge-distillation semantics without a provider integration. A user selects one complete imported conversation, copies a deterministic bounded prompt, runs it in an AI tool of their choice, pastes strict JSON back into Chat2Vault, and previews schema-validated candidates in memory.

M04 is successful only if malformed or untrusted output cannot control workflow state, source authority, paths, settings, network activity, or vault writes.

## 4. In scope

- one complete selected canonical conversation per request;
- deterministic `DistillationRequest` construction and fingerprinting;
- deterministic provider-neutral prompt rendering;
- explicit copy-to-clipboard action;
- bounded strict-JSON paste input;
- exact-shape schema and policy validation;
- all ten existing `KnowledgeType` values;
- locally derived candidate identity, status, and provenance;
- read-only, in-memory, paginated candidate preview;
- safe diagnostics, cancellation/invalidation, accessibility, and zoom behavior;
- static and runtime proof of no M04 network or vault mutation.

## 5. Explicit non-goals

- provider SDKs, HTTP clients, Ollama, or any automatic model call;
- API keys, secrets, accounts, cost estimation, or provider configuration;
- partial conversations, message-range selection, truncation, chunking, aggregation, or retries;
- Markdown-fence extraction, commentary stripping, repair, coercion, or best-effort parsing;
- candidate editing, acceptance, rejection, persistence, merging, or knowledge-note writing;
- suggested-link resolution or tag/path application;
- source-note mutation;
- M05, M06, M07, or later behavior;
- new platform claims beyond the approved M03 macOS desktop x86_64 boundary.

## 6. Trust model

Trusted application values:

- contract constants;
- active import/selection identity;
- canonical conversation and application-generated fingerprints;
- request identity and local candidate identity;
- validation results and locally assigned status.

Untrusted data:

- all imported conversation text and metadata;
- all pasted JSON fields and strings;
- AI-generated titles, tags, links, confidence, and message references;
- clipboard contents and clipboard errors.

Conversation text is always delimited as data. Instructions inside it never alter the prompt contract. Pasted values never choose paths, trigger network activity, mutate settings, or write files.

## 7. String and byte rules

Before rendering or validation, every JavaScript string is scanned by UTF-16 code unit. Each unpaired surrogate becomes exactly U+FFFD; valid pairs remain unchanged. NFC normalization is applied only where this specification explicitly requires it. UTF-8 byte length is measured after well-formed conversion.

JSON paste input:

- must contain no UTF-8 BOM equivalent at string start;
- must be one JSON object accepted by `JSON.parse` with no leading/trailing non-whitespace content;
- must contain no ill-formed string after JSON escape decoding;
- must satisfy all exact-key, type, count, string, and provenance rules;
- receives no repair or partial acceptance.

## 8. Fixed limits

```ts
const M04_PROMPT_MAX_UTF8_BYTES = 262_144;
const M04_RESULT_MAX_UTF8_BYTES = 524_288;
const M04_MAX_CANDIDATES = 64;
const M04_MAX_SOURCE_REFS_PER_CANDIDATE = 64;
const M04_MAX_SUGGESTED_LINKS = 32;
const M04_MAX_SUGGESTED_TAGS = 32;
const M04_TITLE_MAX_UTF16 = 240;
const M04_TITLE_MAX_UTF8 = 512;
const M04_SUMMARY_MAX_UTF16 = 4_096;
const M04_SUMMARY_MAX_UTF8 = 8_192;
const M04_BODY_MAX_UTF16 = 32_768;
const M04_BODY_MAX_UTF8 = 65_536;
const M04_SUGGESTION_MAX_UTF16 = 240;
const M04_SUGGESTION_MAX_UTF8 = 512;
const M04_DIAGNOSTIC_LIMIT = 50;
```

Limits are inclusive. An over-limit complete conversation fails before prompt installation or clipboard access. M04 never truncates or splits it.

## 9. Knowledge types

M04 preserves the domain baseline exactly:

```ts
type KnowledgeType =
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
```

Confidence is exactly `"high" | "medium" | "low"`.

## 10. Request contract

```ts
interface DistillationRequest {
  schemaVersion: 1;
  contractVersion: "m04-manual-v1";
  requestId: string;
  provider: "chatgpt" | "unknown";
  providerConversationId?: string;
  conversationFingerprint: string;
  title?: string;
  messages: DistillationMessage[];
}

interface DistillationMessage {
  fingerprint: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  createdAt?: string;
  content: CanonicalContentBlock[];
}
```

The builder includes every message on the canonical selected path in canonical order. It neither omits nor synthesizes messages. Unsupported content blocks remain explicit unsupported descriptions.

`requestId` is the existing `sha256:` fingerprint function applied to stable JSON containing only:

- `contractVersion`;
- provider;
- present provider conversation ID;
- conversation fingerprint;
- ordered message fingerprints.

Request construction fails if fingerprints are malformed, message fingerprints repeat, no message exists, required identity is unavailable, or the conversation changes during construction.

## 11. Prompt contract

The prompt is deterministic LF-only UTF-8 text with these ordered sections:

1. contract/version and request identity;
2. security instruction that the transcript is untrusted data;
3. task and ten knowledge-type definitions;
4. exact JSON output shape and strict-JSON-only instruction;
5. field and count limits;
6. provenance requirement using only supplied message fingerprints;
7. complete stable-JSON request between fixed transcript-data delimiters.

The prompt instructs the external model to return one JSON object and nothing else. The transcript delimiters and stable JSON escaping prevent transcript content from terminating or changing the trusted instruction sections.

Prompt generation returns exact UTF-8 byte length. A prompt exceeding `M04_PROMPT_MAX_UTF8_BYTES` produces only `DISTILLATION_PROMPT_TOO_LARGE`.

## 12. Untrusted result shape

The top-level object has exactly:

```ts
interface UntrustedDistillationResult {
  schemaVersion: 1;
  contractVersion: "m04-manual-v1";
  requestId: string;
  conversationFingerprint: string;
  candidates: UntrustedCandidate[];
}
```

Each candidate has exactly:

```ts
interface UntrustedCandidate {
  type: KnowledgeType;
  title: string;
  summary: string;
  body: string;
  confidence: "high" | "medium" | "low";
  sourceMessageFingerprints: string[];
  suggestedLinks: string[];
  suggestedTags: string[];
}
```

All keys are required. Extra keys fail. Candidate count is `1..M04_MAX_CANDIDATES`. Empty results fail rather than representing “nothing useful”; the user may discard the round trip without persistence.

## 13. Validation order

Validation is fail-closed in this order:

1. active request exists and is still current;
2. input UTF-8 size is within limit;
3. strict JSON parse succeeds;
4. top-level exact shape and scalar constants match;
5. request ID and conversation fingerprint equal the active request;
6. candidate array count is valid;
7. every candidate has exact shape and valid enums;
8. all strings are well formed, non-empty where required, and within both limits;
9. suggestion arrays contain unique, non-empty NFC strings within limits;
10. source-reference arrays are non-empty, unique, within limit, and every fingerprint belongs to the active request;
11. derive semantic candidate fingerprints and reject duplicates;
12. derive trusted candidates and install one preview atomically.

No earlier error is represented as a later error. Diagnostics are capped at 50, deterministic, field-addressed, and never contain conversation text or candidate body text.

## 14. Trusted candidate derivation

For each validated untrusted candidate:

- `candidateFingerprint` is the stable fingerprint of all validated semantic fields with source fingerprints preserved in response order;
- `id` is the stable fingerprint of `{ requestId, candidateFingerprint }`;
- `status` is locally assigned `"proposed"`;
- `sourceRefs` is locally constructed from the active provider, optional provider conversation ID, conversation fingerprint, and validated message fingerprints;
- suggestions remain inert arrays.

Duplicate semantic fingerprints or duplicate derived IDs fail the whole result. Response order is preserved for display but grants no authority.

## 15. Controller and invalidation

Only one active request and one installed preview may exist.

These events synchronously invalidate both:

- import replacement or clear;
- selected conversation change;
- view close/unload;
- new prompt preparation;
- active conversation fingerprint change.

Prepare, copy, and validate operations use operation tokens. Reentry while the same operation owns its mutex returns an in-progress diagnostic; operations are never queued or replayed. Completion may install state only if its token, selection generation, request ID, and conversation fingerprint remain current.

Any validation attempt clears the previous candidate preview before parsing. Failure cannot leave stale candidates visible.

## 16. User interface

The selected-conversation view adds a “Manual distillation” panel.

Prepare state displays contract version, safe conversation title, conversation fingerprint, message count, and exact prompt bytes. “Copy prompt” is enabled only for a current prepared request and requires explicit user activation.

Paste uses a bounded plain-text control with an explicit “Validate result” action. The plugin never reads clipboard content automatically.

The read-only preview displays type, title, summary, body, confidence, inert suggestions, and source-reference indicators. It is paginated with fixed choices `10 | 25 | 50`, keyboard reachable, screen-reader labeled, and usable at genuine host-level 100% and 200% zoom without clipping actionable controls or hiding diagnostics.

M04 exposes no accept, edit, reject, merge, save, path, or writer control.

## 17. Diagnostics

Required codes include:

- `DISTILLATION_NO_SELECTION`;
- `DISTILLATION_REQUEST_INVALID`;
- `DISTILLATION_PROMPT_TOO_LARGE`;
- `DISTILLATION_PREPARE_IN_PROGRESS`;
- `DISTILLATION_CLIPBOARD_DENIED`;
- `DISTILLATION_CLIPBOARD_FAILED`;
- `DISTILLATION_NO_ACTIVE_REQUEST`;
- `DISTILLATION_RESULT_TOO_LARGE`;
- `DISTILLATION_JSON_INVALID`;
- `DISTILLATION_SHAPE_INVALID`;
- `DISTILLATION_REQUEST_MISMATCH`;
- `DISTILLATION_CANDIDATE_INVALID`;
- `DISTILLATION_SOURCE_REF_INVALID`;
- `DISTILLATION_DUPLICATE_CANDIDATE`;
- `DISTILLATION_VALIDATE_IN_PROGRESS`;
- `DISTILLATION_STALE_OPERATION`.

User messages are concise and actionable. Logs may include code, operation ID, safe counts, byte lengths, and duration, but no prompt, transcript, pasted JSON, candidate content, titles, IDs from providers, or file/vault paths.

## 18. Privacy and side-effect boundary

M04 persists no new setting and no request/result/candidate data. All state is memory-only and cleared on view close or plugin unload.

Production M04 code contains no `fetch`, `requestUrl`, XMLHttpRequest, WebSocket, provider SDK, child-process invocation, or new network dependency. Copying to the system clipboard is the only outbound data action and occurs only after an explicit click on a prepared prompt.

M04 performs no Vault/Adapter/FileManager create, modify, process, rename, delete, trash, or binary operation. Existing M03 source-save behavior is unchanged and separately user initiated.

## 19. Verification requirements

Implementation verification must include:

- formatting, lint, strict typecheck, full tests, build, and static plugin gate;
- golden request identity and exact prompt bytes;
- every knowledge type and confidence value;
- malformed JSON, BOM, fences, commentary, trailing content, and ill-formed strings;
- missing/extra keys, wrong constants, empty arrays, and every boundary ±1;
- forged, missing, duplicate, and over-limit source references;
- duplicate semantic candidates and reordered candidates;
- prompt-injection-like transcript fixtures proving inert treatment;
- Unicode/CJK, code blocks, links, tool messages, unsupported blocks, and branched canonical paths;
- oversized complete conversation rejection with no truncation/chunking;
- selection/import/view-close invalidation at each asynchronous boundary;
- reentry and stale completion with no queue/replay;
- clipboard denial/failure and proof of no automatic clipboard read;
- preview pagination, keyboard access, screen-reader labels, and host-level 100%/200% zoom;
- static and runtime network tripwire with zero M04 egress;
- vault mutation tripwire with zero M04 mutation;
- M01–M03 regression verification.

Fixtures must be synthetic and non-sensitive.

## 20. Acceptance criteria

| ID    | Criterion                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------- |
| AC-01 | One complete selected canonical conversation produces one deterministic request or a closed diagnostic. |
| AC-02 | Request ID and exact prompt bytes are reproducible from identical input.                                |
| AC-03 | Transcript instructions remain inert and cannot alter trusted prompt sections.                          |
| AC-04 | Oversized prompts fail with no truncation, chunking, clipboard access, or installed request.            |
| AC-05 | Clipboard write requires an explicit click; automatic clipboard read never occurs.                      |
| AC-06 | Only strict JSON with exact top-level and candidate keys is accepted.                                   |
| AC-07 | All ten knowledge types and three confidence values round-trip.                                         |
| AC-08 | Every accepted candidate references at least one real active-request message fingerprint.               |
| AC-09 | Forged, duplicate, missing, malformed, or over-limit provenance fails the whole result.                 |
| AC-10 | Candidate IDs, status, and `SourceRef` authority are derived locally.                                   |
| AC-11 | Duplicate semantic candidates fail the whole result.                                                    |
| AC-12 | Invalid paste clears prior preview and cannot install partial candidates.                               |
| AC-13 | Selection/import/request/view changes invalidate stale work at every asynchronous boundary.             |
| AC-14 | Reentry is rejected with no queue or replay.                                                            |
| AC-15 | Preview is read-only, bounded, paginated, accessible, and usable at 100%/200% host zoom.                |
| AC-16 | M04 state is memory-only and absent from settings, vault files, and logs.                               |
| AC-17 | Static and runtime tripwires prove zero M04 network activity.                                           |
| AC-18 | Static and runtime tripwires prove zero M04 vault mutation.                                             |
| AC-19 | M01–M03 semantics and verification remain green.                                                        |
| AC-20 | No M05+ behavior, release, or unsupported platform claim is introduced.                                 |
| AC-21 | Complete implementation/evidence receives exact independent `GO — M04 COMMIT READY` before publication. |

## 21. Required evidence and review gate

The implementation candidate must provide:

- branch, base, HEAD, upstream, and complete candidate inventory including untracked files;
- frozen approved-spec hash;
- whole diff against exact baseline;
- exact commands and outputs for every verification gate;
- AC-01–AC-21 traceability;
- prompt/result golden hashes;
- network and vault-mutation tripwire evidence;
- genuine host-level zoom evidence on the supported macOS x86_64 Obsidian rows;
- secret/privacy scan and dependency inventory;
- explicit proof that M05+ was not implemented.

Only a genuinely independent whole-candidate verdict of:

```text
GO — M04 COMMIT READY
```

permits a later Product Owner publication decision.

## 22. Current decision

**NO-GO — M04 specification candidate requires independent whole-spec review.**

Prohibited next actions until exact spec approval and separate Product Owner authorization: implementation, dependency changes, commit-ready claims, release work, and M05+ work.
