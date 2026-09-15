# M06 Knowledge Review and Writer Design

- Version: 0.1
- Status: Product Owner approved design
- Date: 2026-09-15
- Baseline: M05 merge `be0f5803ac39120e00e9994a936a8858a1cf3187`

## 1. Goal

Milestone 06 lets a user review validated knowledge candidates, edit their human-authored fields, preview the exact resulting Markdown and paths, and explicitly create durable source-linked knowledge notes in an Obsidian vault.

M06 is a macOS desktop milestone. It preserves the local-first boundary and gives no provider direct or indirect vault-write authority.

## 2. Scope

M06 includes:

- in-memory Accept, Edit, and Reject decisions for validated candidates;
- multi-selection of accepted or edited candidates;
- a separately configured vault-relative knowledge root with no default;
- deterministic filenames and create-only writes;
- a fixed Markdown template with provenance and source backlinks;
- an exact dry-run showing every path, action, and rendered note;
- stale-preview invalidation;
- verified, idempotent execution with a per-file result ledger;
- automated and attributed macOS runtime evidence.

M06 does not include:

- modifying source notes to add forward links;
- exact or semantic knowledge deduplication beyond identical target bytes;
- related-note suggestions or merge flows;
- current-conversation capture or historical batch migration;
- Windows, Linux, mobile, release, deployment, or Community Plugin submission;
- autonomous modification, rename, replacement, merge, or deletion of any vault note.

Those behaviors remain assigned to M07-M10 where applicable.

## 3. Approved product decisions

### 3.1 Source notes remain immutable

Knowledge notes link back to their source notes. M06 never edits a source note to add a forward link. This keeps source preservation independent from knowledge promotion and avoids turning one promotion into a multi-file mutation.

### 3.2 One candidate creates one note

Each accepted or edited candidate plans one Markdown note below the configured knowledge root. M06 does not combine candidates into a single note and does not merge them with existing knowledge.

### 3.3 Review state is ephemeral

Review state exists only in the active plugin view/controller state:

- `proposed`: not eligible to write;
- `accepted`: unchanged validated candidate, eligible to select;
- `edited`: user-edited candidate, eligible to select;
- `rejected`: excluded from selection and writing.

Editing is allowed only for title, summary, body, and tags. Candidate type and provenance remain the validated authority. A new distillation result or invalidated view replaces the old in-memory review state; M06 adds no candidate-history persistence.

### 3.4 Explicit selection and exact preview

Accepted and edited candidates may be selected individually or through accessible multi-select controls. Selection alone cannot write.

The user must run a dry-run for the current candidate content, selection, source resolution, and destination settings. The dry-run displays, for every selected candidate:

- the exact vault-relative target path;
- the planned action: `create`, `identical no-op`, or `conflict`;
- the complete rendered Markdown;
- any closed validation or planning diagnostic.

Write is enabled only when the complete current plan contains no conflict or validation failure.

Any change to an edited field, decision, selection, resolved source, knowledge root, or relevant plugin generation invalidates the plan and disables Write until a new dry-run completes.

## 4. Architecture

M06 extends the existing core/adaptor separation with four bounded units.

### 4.1 Review model

The plugin controller owns the in-memory review state and exposes explicit decision, edit, selection, dry-run, and write actions. It treats candidate strings and tags as untrusted until core validation succeeds. It has no direct path-construction or rendering logic.

### 4.2 Pure knowledge planner

The framework-independent core receives normalized reviewed candidates, trusted resolved source-note references, and a validated knowledge root. It returns an immutable write plan containing exact paths, exact UTF-8 Markdown, candidate fingerprints, and planned actions.

The planner performs:

- editable-field validation and bounded normalization;
- tag validation and deterministic ordering;
- candidate fingerprinting;
- filename sanitization and length enforcement;
- vault-relative path construction;
- Markdown/frontmatter escaping and rendering;
- duplicate target detection within the batch;
- projection of adapter observations into create, no-op, or conflict actions.

The core package remains independent of Obsidian APIs.

### 4.3 Source resolver

The plugin app layer resolves each immutable candidate `SourceRef` against the existing M03 source registry and supplies the planner with a trusted vault-relative source-note path and source fingerprint. Missing, ambiguous, stale, or outside-root resolution fails closed before writing.

The source resolver does not modify source notes and does not accept a model-suggested backlink path.

### 4.4 Knowledge writer adapter

A narrow Obsidian adapter receives only a previously approved immutable write plan. It may observe targets, create new files, and read created/existing bytes for verification. It receives no rename, modify, delete, provider, or network capability.

All target paths must remain physically and lexically below the configured knowledge root at observation and immediately before creation. M06 reuses the established native observation/containment boundary where needed to defend against races and symlink-like path substitution on supported macOS hosts.

## 5. Data and identity

### 5.1 Reviewed candidate

The review model retains the immutable validated `id`, `type`, confidence, and `sourceRefs`, plus bounded editable `title`, `summary`, `body`, and `tags`. Tags originate from validated suggested tags and may be changed by the user, but they never become paths or arbitrary frontmatter keys.

### 5.2 Candidate fingerprint

The planner computes a SHA-256 fingerprint over stable JSON containing exactly:

- schema version;
- candidate type;
- normalized title, summary, body, and deterministic tag list;
- canonical source references.

Canonical source references are sorted by provider, provider conversation ID when present, conversation fingerprint, and sorted unique message fingerprints. Volatile UI state, selection order, timestamps, source-note path, and model-provided candidate ID are excluded.

### 5.3 Filename

The filename is:

```text
<sanitized-title>--<first-12-lowercase-hex-of-candidate-fingerprint>.md
```

The sanitizer removes separators, control characters, dot-segments, platform-reserved characters, leading/trailing whitespace and dots, and unsafe or empty results. It applies a deterministic fallback title and truncates on Unicode code-point boundaries so the complete filename remains within the defined UTF-8 byte limit.

The knowledge root is a separately persisted, validated vault-relative folder. It has no default. After NFC normalization and path-equivalence folding, the knowledge root and source root must not be equal, and neither may be an ancestor or descendant of the other. An empty, invalid, or overlapping knowledge root disables dry-run and writing.

### 5.4 Settings migration

M06 introduces settings schema version 4 by adding `knowledgeRoot` to the complete persisted v3 shape. Exact valid v3 settings migrate to v4 with `knowledgeRoot: ""`; valid v4 settings load without an implicit write. The existing settings mutex remains binary and non-queuing, and every settings save writes a complete current-schema snapshot while preserving unrelated authoritative fields.

Safe integer settings schemas greater than or equal to 5 enter the existing load-only unsupported-future state and remain byte-identical until an explicit supported baseline-setting save follows the established downgrade contract. Invalid v4 `knowledgeRoot` data is disabled in memory with a closed warning and does not weaken the source-root or provider recovery rules.

## 6. Markdown contract

Every created note uses one fixed, versioned template. Frontmatter contains only closed fields:

```yaml
---
chat2vault_schema: 1
type: <validated knowledge type>
status: accepted
created_from: ai-conversation
candidate_fingerprint: sha256:<fingerprint>
source_provider: <validated provider>
source_fingerprint: sha256:<conversation fingerprint>
source_conversation: "[[<trusted source-note path without .md>]]"
tags:
  - knowledge
  - <validated user tag>
---
```

The body contains the title, Summary, Knowledge, and Source sections. The Source section repeats the trusted source backlink. Values are rendered with deterministic line endings and escaping; imported or model-generated text cannot create additional frontmatter keys or select a path.

For multiple source references, the frontmatter and Source section use deterministic lists ordered by the canonical source-reference order. No raw prompt, provider response envelope, secret, local absolute path, vault name, or hidden provider metadata is persisted.

## 7. Write semantics

The controller freezes the exact successful dry-run as the only writable authority. Write execution is non-queuing: a second invocation while planning or writing is active returns an in-progress result and causes no effect.

Before any create, the adapter re-observes every target against the frozen plan:

- absent target: eligible for `create`;
- regular Markdown file with byte-identical content: `identical no-op`;
- any different content, unexpected type, unsafe containment result, or observation failure: `conflict` and no batch write begins.

After this preflight, eligible files are created sequentially. Each create is immediately read back and compared byte-for-byte with the planned content.

Obsidian does not provide a true multi-file transaction. If a later create or verification fails, earlier verified creates remain. The controller returns an exact per-file ledger containing `created`, `identical no-op`, `not attempted`, or a closed failure result. It never deletes or rolls back a created note.

Retrying the same unchanged plan is safe: verified files resolve to identical no-ops and only absent targets are created. A target that changes to different bytes at any point fails closed; M06 never generates additional numeric collision filenames and never overwrites the conflict.

## 8. Error handling and privacy

Diagnostics use a closed, content-free vocabulary for invalid review fields, invalid tags, unresolved sources, invalid roots, unsafe paths, duplicate batch targets, conflicts, stale plans, in-progress operations, create failures, and readback failures.

Logs and retained evidence may include operation IDs, synthetic fixture identifiers, counts, stages, relative synthetic paths, and closed diagnostic codes. They must not contain imported conversation text, candidate content, rendered user notes, real vault paths, vault names, credentials, provider payloads, or personal data.

Provider execution and knowledge writing remain separate explicit actions. Provider objects receive no writer capability. Writing uses only candidates already validated by the frozen M04/M05 boundary and subsequently reviewed by the user.

## 9. Verification strategy

M06 is an R2 vault-integrity change. Verification is concentrated at the stabilized-candidate boundary rather than repeating the complete runtime ceremony after every intermediate edit.

### 9.1 Core tests

Pure unit and contract tests cover:

- editable-field and tag bounds;
- stable canonicalization and fingerprint vectors;
- separator, traversal, control-character, reserved-name, empty-title, Unicode, and byte-limit filename cases;
- deterministic Markdown and escaping;
- single and multiple provenance references;
- duplicate batch targets, identical bytes, and conflicts.

### 9.2 Controller and adapter tests

Tests cover:

- Accept, Edit, Reject, and multi-select transitions;
- stale dry-run invalidation for every authoritative input;
- double-click and concurrent-operation rejection;
- source-resolution failure and staleness;
- lexical and physical root containment;
- target changes between dry-run, preflight, and create;
- create-only enforcement and byte readback;
- partial failure ledgers and idempotent retry;
- zero provider call and zero source-note mutation during planning/writing.

All fixtures use synthetic, non-sensitive vaults and conversations.

### 9.3 Stabilized-candidate gates

The completion candidate must pass:

- dependency/runtime validation on Node.js 24 LTS and the repository pnpm version;
- formatting, lint, TypeScript strict checking, full tests, and production build;
- M06 boundary checks for network isolation, create-only authority, source immutability, and secret/content-safe diagnostics;
- attributed macOS runtime smoke on the exact minimum supported Obsidian 1.7.4 and the then-current supported Obsidian version;
- whole-branch diff and scope review against the M05 merge baseline;
- secret and sensitive-fixture scan;
- one fresh independent R2 read-only review of the exact stabilized candidate.

Runtime evidence proves review/edit/reject, multi-select, dry-run, invalidation, create, no-op retry, conflict refusal, backlink correctness, and zero source-note mutation using only synthetic data.

## 10. Completion boundary

M06 can receive `GO — M06 COMMIT READY` only when all approved acceptance behavior is implemented, the exact candidate passes the stabilized gates, runtime evidence is complete for both required rows, the independent review has no unresolved material finding, and the completion report maps requirements to evidence.

Commit readiness does not itself authorize push, pull request, merge, tag, release, deployment, Community submission, provider spend, or M07 implementation. Those states must remain separate and truthfully reported.
