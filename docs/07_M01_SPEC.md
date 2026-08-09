# Milestone 01 Specification — Repository Foundation and ChatGPT Export Parser

Version: 0.1  
Status: READY FOR IMPLEMENTATION

## 1. Decision

**GO — implement Milestone 01 only.**

## 2. Objective

Create a production-quality deterministic core that safely accepts supported ChatGPT export JSON/ZIP inputs and normalizes conversations into a provider-independent canonical model.

M01 is successful without an Obsidian UI and without any LLM call.

## 3. Scope

### In scope

- TypeScript/pnpm repository foundation.
- `packages/core`.
- Canonical source/conversation/message/content schemas.
- ChatGPT export format detection.
- Parsing `conversations.json`.
- Parsing numbered conversation JSON files when supplied.
- ZIP discovery of supported conversation JSON files.
- Safe archive path handling and resource limits.
- Conversation graph/path normalization.
- Unknown-field tolerance.
- Stable SHA-256-based fingerprints.
- Structured warnings/errors.
- Synthetic fixtures.
- Unit and contract tests.
- Documentation updates.

### Out of scope

- Obsidian plugin UI.
- Vault writes.
- LLM/API integration.
- Web Clipper.
- Claude/Gemini/Perplexity.
- semantic dedupe.
- atomic note generation.
- API-key handling.
- hosted service.
- GitHub release/community submission.

## 4. Functional requirements

### FR-01 Input detection

Accept:

- a JSON file representing a supported ChatGPT conversation export collection;
- a ZIP containing `conversations.json`;
- a ZIP or input set containing supported numbered conversation JSON exports.

Unsupported inputs return a typed error.

### FR-02 Canonical normalization

Return `CanonicalConversation[]` conforming to schema version 1.

### FR-03 Content extraction

Preserve supported textual content without executing or interpreting it.

Code/text distinctions may be represented when reliably derivable; otherwise preserve as text rather than inventing semantics.

### FR-04 Message identity

Preserve provider message IDs and parent IDs when present.

### FR-05 Branch handling

Do not flatten a branch graph arbitrarily.

Implement a documented deterministic rule based on the export data actually available. When a definitive active/current branch cannot be inferred, emit a warning and preserve enough graph identity for a later UX to resolve it.

### FR-06 Unknown fields

Unknown fields must not crash a valid import.

### FR-07 Fingerprints

Generate deterministic SHA-256 fingerprints for:

- source;
- conversation content;
- message.

Equivalent normalized content must produce stable fingerprints across repeated runs.

### FR-08 Diagnostics

Return typed diagnostics with:

- code;
- severity;
- safe message;
- optional source/conversation/message identifier.

Do not include entire conversation contents in error strings.

### FR-09 ZIP safety

Reject or neutralize:

- absolute paths;
- `../` traversal;
- unsupported archive entries.

Impose configurable/default safeguards for:

- entry count;
- compressed/uncompressed size;
- JSON size.

### FR-10 Determinism

The same fixture and parser version must produce byte-equivalent canonical JSON when serialized with the project's deterministic serializer.

## 5. Nonfunctional requirements

- TypeScript strict.
- No `any` in public domain contracts.
- Core package has no Obsidian dependency.
- No network calls.
- No secret handling.
- Pure/parsing functions should be testable without filesystem side effects.
- Synthetic test data only.
- Parser failure must not crash the test runner/process unexpectedly.

## 6. Suggested public API

Exact names may vary with justification.

```ts
parseChatGptExport(input): Promise<ImportResult>

interface ImportResult {
  source: SourceDescriptor;
  conversations: CanonicalConversation[];
  diagnostics: ImportDiagnostic[];
}
```

Separate byte/archive reading from provider normalization where practical.

## 7. Test matrix

Required:

1. minimal valid export;
2. multiple conversations;
3. Unicode/CJK content;
4. code blocks / multiline content;
5. missing optional metadata;
6. unknown provider fields;
7. branching conversation;
8. orphan parent;
9. duplicate message ID;
10. malformed JSON;
11. unsupported JSON shape;
12. ZIP with no conversation export;
13. ZIP traversal entry;
14. excessive archive limits;
15. repeated import determinism;
16. changed content changes fingerprint;
17. diagnostics do not leak full fixture content.

## 8. Tooling

Baseline:

- Node.js 24 LTS;
- pnpm;
- TypeScript;
- Vitest;
- ESLint;
- Prettier.

Avoid adding a monorepo orchestrator unless M01 actually needs it.

## 9. Required commands

At minimum:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

`pnpm verify` should run the required quality checks in a deterministic sequence.

## 10. Documentation

Update/create:

- root README development section;
- architecture notes if implementation diverges;
- fixture documentation;
- parser support/limitations.

## 11. Acceptance criteria

M01 is complete only if:

- all required commands pass from a clean install;
- valid fixtures parse deterministically;
- required invalid/adversarial fixtures fail safely;
- no network call exists in core import path;
- no Obsidian dependency exists in `packages/core`;
- fingerprints are covered by tests;
- branching behavior is documented and tested;
- scope review confirms no future milestone implementation;
- working tree/report state is explicit.

## 12. Verification gate

Final report decision must be one of:

- **GO — M01 COMPLETE**
- **CONDITIONAL GO — M01 IMPLEMENTED, EXTERNAL CONDITION REMAINS**
- **NO-GO — M01 INCOMPLETE**

A passing test count alone is not sufficient; report scope and security findings.

## 13. Commit policy

Do not commit, push, tag, release, publish, or create a public repository unless separately authorized.
