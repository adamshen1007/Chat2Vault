# Codex Execution Prompt — Chat2Vault Milestone 01

You are implementing **Chat2Vault Milestone 01 — Repository Foundation and ChatGPT Export Parser**.

## Authority

Read and obey these files in order before editing:

1. `AGENTS.md`
2. `docs/07_M01_SPEC.md`
3. `docs/03_ARCHITECTURE.md`
4. `docs/04_KNOWLEDGE_SCHEMA.md`
5. `docs/01_PRODUCT_BRIEF.md`
6. `docs/05_ROADMAP.md`

If the repository is empty, create these files from the supplied planning kit before implementation.

## Goal

Build a production-quality, deterministic, offline TypeScript core that safely parses supported ChatGPT data-export JSON/ZIP inputs into the canonical conversation schema.

This milestone must **not** implement Obsidian UI, vault writing, AI distillation, provider APIs, browser extensions, other AI providers, or future milestones.

## Execution instructions

### 1. Inspect first

Before editing:

- print repository root;
- inspect Git status, branch, HEAD, remotes;
- inventory existing files;
- inspect package manager/tooling if present;
- confirm whether the planning documents are present;
- identify conflicts with the M01 authority documents.

Do not delete unrelated work.

### 2. Establish the minimal repository foundation

Use:

- Node.js 24 LTS baseline;
- pnpm workspace;
- TypeScript strict;
- Vitest;
- ESLint;
- Prettier.

Create `packages/core` as the implementation boundary.

Avoid Turborepo/Nx or unnecessary build orchestration in M01.

Add root scripts so these commands work:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

### 3. Implement canonical domain contracts

Implement the schema from `docs/04_KNOWLEDGE_SCHEMA.md`, including:

- `SourceDescriptor`;
- `CanonicalConversation`;
- `CanonicalMessage`;
- `CanonicalContentBlock`;
- typed diagnostics;
- import result.

Public contracts must not use `any`.

### 4. Implement ChatGPT export ingestion

Support:

- JSON export collection containing conversations;
- ZIP containing `conversations.json`;
- numbered conversation JSON files where the current documented export structure requires them.

Keep archive/file reading separated from ChatGPT-specific normalization where practical.

Do not hard-code only one exact historical JSON shape if unknown/optional fields can be tolerated safely.

### 5. Handle message graphs correctly

ChatGPT export structures may represent branches.

Do not sort all messages by timestamp and pretend that is the conversation.

Preserve provider message and parent IDs.

Implement the most defensible deterministic branch/path rule supported by the actual export structure and document it.

If no definitive active/current branch can be established:

- emit a typed warning;
- preserve sufficient branch identity;
- do not silently discard ambiguity.

### 6. Implement fingerprints

Use SHA-256 for deterministic identifiers.

Test:

- repeatability;
- changed message content changes the appropriate fingerprint;
- non-semantic object-key ordering does not accidentally destabilize canonical serialization if normalization says it should not.

Do not use conversation title as identity.

### 7. Implement ZIP safety

Treat ZIP input as hostile.

Protect against:

- absolute paths;
- traversal (`../`);
- excessive entry count;
- excessive compressed/uncompressed size;
- oversized JSON;
- unsupported entries.

Do not extract arbitrary archive contents to disk if reading them in memory/streamed with limits is sufficient.

### 8. Add synthetic fixtures

Create synthetic, non-sensitive fixtures for at least:

1. minimal valid;
2. multiple conversations;
3. Unicode/CJK;
4. multiline/code content;
5. missing optional metadata;
6. unknown fields;
7. branching;
8. orphan parent;
9. duplicate message ID;
10. malformed JSON;
11. unsupported JSON shape;
12. ZIP without conversations;
13. traversal attempt;
14. archive limit violation.

Do not use any real ChatGPT export from a user.

### 9. Add tests

Cover every acceptance item in `docs/07_M01_SPEC.md`.

Add a test proving diagnostic/error output does not reproduce an entire sensitive message body.

Prefer small contract tests around pure functions.

### 10. Documentation

Update the root README with:

- purpose;
- current M01 status;
- local development;
- verification commands;
- privacy statement for M01;
- supported import limitations.

Add fixture documentation if useful.

If implementation requires a deviation from the architecture/spec, document the reason explicitly. Do not silently broaden scope.

### 11. Verify

From a clean dependency install, run:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

Also inspect:

- Git diff;
- untracked files;
- dependency tree at a high level;
- repository for accidentally committed secrets or real conversation data;
- core package imports for Obsidian/network dependencies.

Fix all in-scope failures before reporting.

### 12. Self-review

Review specifically for:

- ZIP-slip/path traversal;
- decompression/resource exhaustion;
- unsafe JSON assumptions;
- branch flattening errors;
- nondeterministic hashing;
- sensitive content in logs/errors;
- accidental network calls;
- accidental future-milestone implementation.

### 13. Final report

Return:

1. **Decision**
   - `GO — M01 COMPLETE`, or
   - `CONDITIONAL GO — M01 IMPLEMENTED, EXTERNAL CONDITION REMAINS`, or
   - `NO-GO — M01 INCOMPLETE`.

2. **Repository state**
   - branch;
   - HEAD;
   - working tree;
   - staged/unstaged/untracked files.

3. **Implementation summary**
   - files/modules added;
   - parser behavior;
   - branch strategy;
   - ZIP protections;
   - fingerprint strategy.

4. **Verification evidence**
   - exact commands;
   - pass/fail results;
   - test count;
   - build/typecheck/lint result.

5. **Security review**
   - findings and mitigations.

6. **Scope review**
   - explicitly confirm that M02+ features were not implemented.

7. **Known limitations**

8. **Recommended next action**

## Prohibitions

Do **not**:

- create or configure a hosted backend;
- add an LLM SDK;
- add OpenAI/Anthropic/Gemini/Ollama calls;
- implement Obsidian UI;
- write to a real vault;
- add browser automation;
- add Claude/Gemini/Perplexity import;
- commit real conversations;
- commit/push/tag/release/publish without explicit authorization.

Implementation is complete only with evidence, not with a claim.
