# Chat2Vault Roadmap

Version: 0.1

## Overall target

A nontechnical user can install Chat2Vault from Obsidian Community Plugins, import AI conversations, distill them into source-backed knowledge, review the result, and retain normal Markdown files without a Chat2Vault cloud account.

## Milestone 01 — Repository foundation and ChatGPT parser

**Goal:** Establish trusted, deterministic ingestion.

Deliver:

- repository/tooling baseline;
- canonical conversation schema;
- ChatGPT export JSON parser;
- ZIP reader with safety limits;
- branch-aware normalization;
- stable fingerprints;
- synthetic fixtures;
- test suite;
- parser CLI/test harness only if useful for verification.

Gate:
**GO — M01 COMPLETE** only when malformed and adversarial fixtures fail safely and valid fixtures normalize deterministically.

No Obsidian UI.

## Milestone 02 — Obsidian plugin shell and import UX

**Goal:** A user can select a ChatGPT ZIP/JSON inside Obsidian and preview conversations.

Deliver:

- plugin manifest/build;
- commands/settings;
- file picker/drop zone;
- conversation list;
- import diagnostics;
- dry-run only.

Gate:
No vault source-note writes yet unless explicitly included in the reviewed M02 spec.

## Milestone 03 — Source registry and source-note writer

**Goal:** Preserve imported conversations safely in Markdown.

Deliver:

- configured source root;
- safe paths;
- source registry;
- idempotent import;
- source-note rendering;
- collision handling;
- dry-run and verification.

## Milestone 04 — Distillation contract and manual mode

**Goal:** Define the knowledge extraction contract without coupling to a vendor.

Deliver:

- distillation request/result schemas;
- prompt contract;
- structured candidate validator;
- manual/no-provider round-trip;
- candidate preview UI.

This milestone proves product semantics before API integration.

## Milestone 05 — AI provider adapters

**Goal:** One-click distillation for configured users.

Initial adapters:

- OpenAI-compatible endpoint;
- local Ollama or equivalent local endpoint, subject to implementation review.

Requirements:

- secrets handling;
- explicit network disclosure;
- request-size control;
- cancellation/timeouts;
- cost-awareness hooks;
- no vault write from provider.

## Milestone 06 — Knowledge review and writer

**Goal:** Promote candidates into durable knowledge.

Deliver:

- accept/edit/reject;
- multi-select;
- safe filename/path policy;
- note templates;
- provenance;
- source backlinks;
- dry-run/diff;
- deterministic write behavior.

## Milestone 07 — Deduplication and linking

**Goal:** Prevent knowledge pollution.

Deliver:

- exact duplicate detection;
- same-source re-extraction handling;
- suggested related notes;
- reviewable merge flow;
- no autonomous destructive merge.

## Milestone 08 — Fast current-conversation capture

**Goal:** Reduce everyday friction.

Preferred first approach:

- companion template/workflow for official Obsidian Web Clipper;
- clipboard/manual capture where browser limitations require it.

Do not fork Web Clipper without a validated gap.

## Milestone 09 — Historical batch migration

**Goal:** Process large ChatGPT archives safely.

Deliver:

- batch selection/filtering;
- resumable jobs;
- progress;
- rate/cost controls for AI mode;
- deduplication;
- failure recovery;
- report.

## Milestone 10 — Community release hardening

**Goal:** Public Obsidian Community Plugin submission.

Deliver:

- README;
- MIT license;
- privacy/security docs;
- contribution guide;
- issue templates;
- changelog;
- release automation;
- compatibility tests;
- accessibility review;
- plugin guideline self-review;
- installation documentation;
- sample/demo export fixture.

## Future backlog — explicitly out of current scope

- Claude/Gemini/Perplexity import adapters;
- coding-agent transcripts;
- meeting transcripts;
- mobile large-file import;
- semantic local embeddings;
- team/shared-vault coordination;
- public template marketplace;
- automatic recall/RAG;
- bidirectional "send vault context back to AI."

## Release policy

Do not market the project as "multi-provider" until at least two independently verified provider import adapters exist.

Do not market it as "privacy-preserving AI" without clearly distinguishing local parsing from optional cloud-provider distillation.
