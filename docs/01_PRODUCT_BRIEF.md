# Chat2Vault Product Brief

Version: 0.1  
Status: Approved planning baseline

## 1. Executive summary

Chat2Vault is an open-source, local-first Obsidian tool that converts useful AI conversations into durable, source-linked knowledge.

Most existing export workflows optimize for **archiving a transcript**. Chat2Vault optimizes for **compiling knowledge from a transcript**.

The product preserves the original conversation as evidence while extracting candidate knowledge such as:

- insights;
- decisions and rationale;
- reusable frameworks;
- procedures;
- reusable prompts;
- resources;
- project facts/context;
- assumptions;
- open questions;
- action items.

Candidates are reviewed by the user before they become permanent knowledge notes.

## 2. Problem

AI conversations increasingly contain high-value thinking, but the useful material is trapped inside long chronological transcripts.

Manual copy/paste creates four problems:

1. **High capture friction** — users repeatedly select, copy, create, name, tag, and file notes.
2. **Low signal density** — full transcripts contain large amounts of conversational scaffolding.
3. **Weak retrieval** — conversation titles are poor long-term knowledge identifiers.
4. **Lost provenance** — manually extracted notes often lose the source conversation and rationale.

A raw transcript archive solves preservation but not knowledge management.

## 3. Target users

### Primary

- Obsidian users who regularly use ChatGPT or other AI assistants for serious work.
- Developers, founders, researchers, writers, consultants, and knowledge workers.
- Users who want local Markdown ownership and do not want a hosted intermediary.

### Secondary, later

- Multi-model users across ChatGPT, Claude, Gemini, Perplexity, coding agents, and meeting transcripts.
- Teams using Git-backed shared vaults.
- Users who want local-model distillation.

## 4. Job to be done

> When an AI conversation produces thinking worth keeping, help me turn the useful parts into clean, linked, source-backed Obsidian knowledge without manually reconstructing the conversation.

## 5. Value proposition

**From:** chat archive  
**To:** knowledge compiler

Chat2Vault should make the user's knowledge base better, not merely larger.

## 6. Core product loop

1. Ingest conversation.
2. Normalize to a provider-independent conversation model.
3. Preserve source identity and content.
4. Select scope.
5. Generate structured knowledge candidates.
6. Validate candidates.
7. Show review/merge UI.
8. Write accepted Markdown notes.
9. Link notes to source provenance.
10. Detect repeat imports and likely duplicate knowledge.

## 7. MVP scope

The product-level MVP is achieved when a nontechnical Obsidian user can:

- install the plugin;
- import a valid ChatGPT export;
- browse parsed conversations;
- select one or more conversations;
- preserve a source note;
- run a configured distillation mode;
- preview structured candidates;
- accept/edit/reject candidates;
- write accepted Markdown notes into configurable folders;
- re-import the same source without uncontrolled duplication;
- trace every generated note back to its source conversation.

## 8. MVP non-goals

Do not include in the initial product:

- hosted accounts;
- cloud sync owned by Chat2Vault;
- ChatGPT credential/session-cookie access;
- browser automation that impersonates a user;
- autonomous rewriting of an entire vault;
- vector database or full RAG;
- autonomous bulk deletion/rename;
- automatic publishing;
- team permissions;
- mobile-first plugin UX;
- proprietary storage format;
- marketplace for prompts/templates.

## 9. Key product principles

### Source ≠ knowledge

A conversation source remains immutable evidence. A knowledge note is a derived artifact.

### Review before commit

AI extraction is advisory. The user owns the acceptance decision.

### Local-first by default

Parsing, normalization, indexing, fingerprinting, and file generation run locally.

### Provider neutral

No knowledge schema should depend on a specific LLM vendor.

### Markdown is the durable output

The vault remains useful if Chat2Vault disappears.

### Idempotence is a feature

Repeated imports must be safe and explainable.

## 10. Public onboarding target

Long-term first-run UX:

1. Install.
2. Choose an inbox/source folder and knowledge folder.
3. Drag ChatGPT export ZIP.
4. Select conversation.
5. Choose distillation mode:
   - Manual / no-provider;
   - Local model;
   - configured cloud provider.
6. Preview.
7. Save.

A new user should not need Terminal, Python, a local REST API plugin, or a Chat2Vault cloud account for standard use.

## 11. Success metrics

Early open-source metrics:

- successful import rate;
- percent of candidate notes accepted;
- duplicate prevention rate;
- time from import to first accepted note;
- first-run completion rate;
- crash/error-free import sessions;
- GitHub issue categories;
- Obsidian Community Plugin installs.

Avoid optimizing for number of notes generated.

## 12. Product decision

**GO.**

There is enough differentiation if Chat2Vault stays focused on source-linked knowledge distillation instead of raw transcript export.
