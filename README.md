# Chat2Vault

Chat2Vault is a local-first tool for turning AI conversations into source-linked Obsidian knowledge rather than merely archiving transcripts.

## Current status

Milestone 03 is complete and merged. It extends the deterministic M01 import core and M02 desktop preview plugin with an explicit, create-only source-note writer for one selected ChatGPT conversation.

The writer has no default destination. The user must configure a vault-relative source root, run `Preview source note`, and explicitly invoke `Save source note`. It derives registry identity from direct-child Chat2Vault Markdown notes, detects exact duplicates, creates immutable new versions for changed conversation content, checks physical containment, and verifies created bytes and registry rediscovery. Existing source notes are never modified, renamed, deleted, or overwritten.

M03 still does **not** call an AI or network provider, use provider APIs, automate a browser, synthesize knowledge, write knowledge notes, support mobile/Linux source writing, or implement M04 behavior. The Product Owner selected a macOS x86_64-only M03.1 scope and deferred Windows plus non-x86_64 macOS packaging to a separately approved compatibility milestone. The exact scope amendment and implementation candidate received the required independent approvals, production eligibility and packaging are aligned to the amended scope, and genuine host-level Electron zoom evidence passes on both retained macOS rows. Pull request #1 merged M03 into the repository's then-default branch on 2026-08-24; the post-merge quality gate passed again.

## Development

Requirements:

- Node.js 24 LTS
- pnpm 11

Install and run the complete quality gate:

```bash
pnpm install
pnpm verify
```

Individual gates are also available:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The import core is in `packages/core`; the plugin is in `apps/obsidian-plugin`. Synthetic fixtures live in `fixtures/chatgpt`.

The plugin build currently produces `apps/obsidian-plugin/main.js`, `worker.js`, and a macOS x86_64 read-only source-containment observer. Install those files together with `manifest.json` and `styles.css` only in a disposable matching environment. M02 evidence remains in [M02 implementation notes](docs/09_M02_IMPLEMENTATION_NOTES.md); the approved [M03.1 macOS scope amendment](docs/M03_MACOS_SCOPE_AMENDMENT.md), [M03 implementation notes](docs/12_M03_IMPLEMENTATION_NOTES.md), historical [M03 runtime gate report](docs/13_M03_RUNTIME_GATE_REPORT.md), and [M03 closure report](docs/14_M03_CLOSURE_REPORT.md) record the complete governance and readiness chronology.

## Privacy

Parsing, normalization, archive reading, hashing, filtering, preview rendering, source planning, and source writing run locally. Imported text is treated strictly as untrusted data and rendered inertly. Settings v2 persists only `{ schemaVersion, previewMessagesPerPage, sourceRoot }`. Imported material is persisted only when the user explicitly saves the selected conversation as a source note. Repository and runtime fixtures are synthetic and contain no real conversations.

## Supported imports and limitations

Supported inputs:

- a ChatGPT `conversations.json` collection;
- a JSON object containing a `conversations` collection;
- a supported single/numbered conversation JSON file or input set;
- a ZIP containing `conversations.json` or supported numbered conversation files.

ZIP input is read in memory and checked for traversal, absolute paths, excessive entry count, compressed/uncompressed size, oversized JSON, encryption, unsupported compression methods, multi-disk layout, and ZIP64. Safe unrelated entries are ignored with a warning.

The parser supports the documented ChatGPT mapping graph shape. It preserves every message-bearing graph node. An exported `current_node` defines the selected path when valid; otherwise the parser emits `AMBIGUOUS_BRANCH` when needed and selects the longest root-to-leaf path, breaking ties by lexical leaf node ID. Selection metadata is recorded separately and does not discard alternate messages.

Non-text or unknown content parts are represented as `unsupported` blocks rather than guessed. ZIP64 and multi-disk archives are not supported in M01. `importedAt` reflects the import operation; canonical conversation and message fingerprints exclude it and remain deterministic.

See [M01 implementation notes](docs/08_M01_IMPLEMENTATION_NOTES.md) and the [document index](docs/00_DOCUMENT_INDEX.md) for details.
