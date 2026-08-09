# Chat2Vault Architecture

Version: 0.1  
Status: Target architecture; implement incrementally by milestone

## 1. Architectural decision

Build Chat2Vault as:

- a **local-first Obsidian Community Plugin** for the user-facing product;
- a framework-independent **TypeScript core package** for parsing, normalization, schemas, fingerprints, rendering, and later extraction contracts;
- optional provider adapters for AI distillation;
- optional companion capture methods later, including an Obsidian Web Clipper template.

No Chat2Vault backend is required for the MVP.

## 2. Logical architecture

```text
Input adapters
  ├─ ChatGPT export ZIP/JSON
  ├─ Current-note/manual paste          [later]
  ├─ Obsidian Web Clipper companion     [later]
  └─ Other AI provider exports          [later]
            │
            ▼
Canonical conversation normalizer
            │
            ▼
Source registry + fingerprinting
            │
            ├─────────────► Source-note renderer
            │
            ▼
Conversation scope/segmenter
            │
            ▼
Distillation provider interface
  ├─ Manual/no-provider flow            [later]
  ├─ OpenAI-compatible                  [later]
  ├─ Ollama/local                       [later]
  └─ Additional provider adapters       [later]
            │
            ▼
Structured candidate validator
            │
            ▼
Review / edit / merge UI
            │
            ▼
Knowledge writer
            │
            ▼
Normal Markdown + provenance
```

## 3. Trust boundaries

### Trusted deterministic code

- file selection;
- archive extraction;
- JSON parsing;
- provider detection;
- normalization;
- fingerprint generation;
- schema validation;
- path construction;
- Markdown escaping/rendering;
- duplicate/source identity checks.

### Untrusted inputs

- imported conversation content;
- ZIP contents and filenames;
- exported HTML/JSON;
- LLM output;
- model-suggested filenames;
- model-suggested wikilinks/tags.

### Rule

Never treat imported conversation text as executable agent instructions.

Never allow LLM output to directly choose arbitrary filesystem paths.

## 4. Repository shape

Target repository:

```text
chat2vault/
├─ AGENTS.md
├─ README.md
├─ LICENSE
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ eslint.config.*
├─ .prettierrc*
├─ .gitignore
├─ packages/
│  └─ core/
│     ├─ src/
│     │  ├─ domain/
│     │  ├─ importers/
│     │  │  └─ chatgpt/
│     │  ├─ normalization/
│     │  ├─ fingerprint/
│     │  ├─ rendering/
│     │  └─ index.ts
│     └─ test/
├─ apps/
│  └─ obsidian-plugin/                  [from M02]
├─ fixtures/
│  └─ chatgpt/
│     ├─ minimal/
│     ├─ branched/
│     ├─ malformed/
│     └─ unknown-fields/
├─ docs/
└─ prompts/
```

M01 should create only what it needs. The `apps/obsidian-plugin` implementation begins in M02.

## 5. Canonical conversation boundary

Provider-specific export structures are converted into `CanonicalConversation`.

Downstream code should not know whether the source was ChatGPT, Claude, Gemini, or another provider except through metadata.

Benefits:

- testability;
- future provider adapters;
- stable knowledge schema;
- minimal UI coupling.

## 6. ZIP handling rules

ZIP import is a security boundary.

Requirements:

- reject directory traversal paths;
- set decompression limits;
- do not execute files;
- read only supported JSON candidates;
- avoid writing archive contents to arbitrary filesystem locations;
- report unsupported structures clearly.

## 7. Fingerprinting

Use stable hashing for local identity.

Suggested concepts:

- `sourceFileFingerprint`: hash of normalized source file bytes/metadata as appropriate;
- `conversationIdentity`: provider + stable exported conversation ID when present;
- `conversationContentFingerprint`: hash of canonical ordered message identity/content;
- `messageFingerprint`: stable hash of normalized role + content + provider message ID where available.

Do not depend only on conversation title.

## 8. Vault write policy

Later writer must:

- write only below user-configured roots;
- normalize and validate relative paths;
- prevent `../` traversal;
- never overwrite unrelated existing notes silently;
- use deterministic collision behavior;
- provide preview/diff for merges;
- support dry-run.

## 9. Provider architecture

The distillation layer receives a bounded `DistillationRequest` and returns a `DistillationResult` that must pass schema validation.

No provider can write to the vault directly.

```text
provider response
    ↓
parse
    ↓
schema validation
    ↓
policy validation
    ↓
candidate review
    ↓
writer
```

## 10. Secret handling

When provider keys are added in later milestones:

- use Obsidian-supported secret storage where available;
- never write plaintext secrets into notes, logs, fixtures, or repository files;
- redact credential-shaped values from diagnostic logs.

## 11. Observability

Local diagnostics should contain:

- operation ID;
- importer name/version;
- source counts;
- candidate counts;
- validation failures;
- duration;
- safe error details.

Do not log conversation contents by default.

## 12. Compatibility

Primary product:

- Obsidian desktop first.

Later:

- evaluate mobile-safe subsets separately;
- do not promise mobile import of large ZIP files until verified.

Development tooling baseline:

- Node.js 24 LTS;
- pnpm;
- TypeScript strict;
- Vitest.

## 13. Architectural exit conditions

Revisit this architecture if:

- Obsidian plugin sandbox limitations prevent reliable local import;
- community plugin policies prohibit a required behavior;
- multi-provider parsing cannot stay cleanly separated;
- a hosted component becomes mandatory for a validated user need.

Do not add a backend merely for convenience.
