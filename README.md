# Chat2Vault

Chat2Vault is a local-first tool for turning AI conversations into source-linked Obsidian knowledge rather than merely archiving transcripts.

## Current status

Milestones 03 and 04 are complete and merged. M04 was built against the independently approved byte-frozen v0.6 specification, passed the two-row macOS runtime gate, and received the exact v8 whole-candidate verdict `GO — M04 COMMIT READY`. Pull request #3 merged the authorized implementation into `main` on 2026-08-28; no deployment, release, or M05 work followed.

The writer has no default destination. The user must configure a vault-relative source root, run `Preview source note`, and explicitly invoke `Save source note`. It derives registry identity from direct-child Chat2Vault Markdown notes, detects exact duplicates, creates immutable new versions for changed conversation content, checks physical containment, and verifies created bytes and registry rediscovery. Existing source notes are never modified, renamed, deleted, or overwritten.

M04 adds a provider-neutral manual round trip: select one complete imported conversation, prepare and explicitly copy a deterministic bounded prompt, run it in an AI tool chosen by the user, paste strict JSON, and inspect locally validated read-only candidates in memory. It does not call a provider, read the clipboard, write candidates or settings, mutate vault content, or expose accept/edit/reject/save behavior. Existing M03 source saving remains a separate explicit action.

The Product Owner selected a macOS x86_64-only M03.1 scope and deferred Windows plus non-x86_64 macOS packaging to a separately approved compatibility milestone. Pull request #1 merged M03 into the repository's then-default branch on 2026-08-24; the post-merge quality gate passed again.

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

The plugin build currently produces `apps/obsidian-plugin/main.js`, `worker.js`, and a macOS x86_64 read-only source-containment observer. Install those files together with `manifest.json` and `styles.css` only in a disposable matching environment. M02 evidence remains in [M02 implementation notes](docs/09_M02_IMPLEMENTATION_NOTES.md); the approved [M03.1 macOS scope amendment](docs/M03_MACOS_SCOPE_AMENDMENT.md), [M03 implementation notes](docs/12_M03_IMPLEMENTATION_NOTES.md), historical [M03 runtime gate report](docs/13_M03_RUNTIME_GATE_REPORT.md), and [M03 closure report](docs/14_M03_CLOSURE_REPORT.md) record the M03 chronology. The byte-frozen [M04 specification](docs/M04_SPEC.md), historical [M04 implementation notes](docs/15_M04_IMPLEMENTATION_NOTES.md), historical [M04 runtime gate report](docs/16_M04_RUNTIME_GATE_REPORT.md), and [M04 closure report](docs/17_M04_CLOSURE_REPORT.md) record the complete M04 chronology.

## Privacy

Parsing, normalization, archive reading, hashing, filtering, strict M04 validation, candidate derivation, preview rendering, source planning, and source writing run locally. Imported text and pasted model output are treated strictly as untrusted data and rendered inertly. Settings v2 persists only `{ schemaVersion, previewMessagesPerPage, sourceRoot }`; M04 adds no setting or persisted state. The only M04 outbound action is an explicit clipboard write of the complete prepared prompt. Imported material is persisted only when the user separately invokes the M03 source-note save action. Repository and runtime fixtures are synthetic and contain no real conversations.

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
