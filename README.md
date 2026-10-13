# Chat2Vault

Chat2Vault is a local-first tool for turning AI conversations into source-linked Obsidian knowledge rather than merely archiving transcripts.

## Current status

Milestones 03 through 06 are complete and merged. M06 adds explicit review and create-only promotion of validated knowledge candidates. Its Obsidian 1.7.4 and 1.13.7 macOS x86_64 runtime rows passed, and the exact candidate received an independent `GO — M06 COMMIT READY` review before [pull request #6](https://github.com/adamshen1007/Chat2Vault/pull/6) merged. The plugin has not been released or submitted to Obsidian Community Plugins.

The writer has no default destination. The user must configure a vault-relative source root, run `Preview source note`, and explicitly invoke `Save source note`. It derives registry identity from direct-child Chat2Vault Markdown notes, detects exact duplicates, creates immutable new versions for changed conversation content, checks physical containment, and verifies created bytes and registry rediscovery. Existing source notes are never modified, renamed, deleted, or overwritten.

M04 adds a provider-neutral manual round trip: select one complete imported conversation, prepare and explicitly copy a deterministic bounded prompt, run it in an AI tool chosen by the user, paste strict JSON, and inspect locally validated read-only candidates in memory. It does not call a provider, read the clipboard, write candidates or settings, mutate vault content, or expose accept/edit/reject/save behavior. Existing M03 source saving remains a separate explicit action.

M05 adds one explicitly configured OpenAI-compatible HTTPS path for that exact M04 prompt. The API key is stored only in the local macOS file Keychain; non-secret provider settings use the exact local v3 settings shape. Execution requires explicit disclosure and an explicit Distill action, performs one bounded fresh-socket request with no retry, and keeps responses, usage, and candidates in memory. It does not add candidate promotion or any provider-driven vault write.

M06 keeps provider execution and vault writing separate. After a validated manual or provider result is available, each candidate begins as proposed. The user may Accept, Edit, or Reject it; edits are limited to title, summary, body, and tags. Accepted or edited candidates can be selected individually or with Select all eligible. Decisions, edits, selections, dry-runs, and result ledgers remain in memory and are replaced when their authority becomes stale.

The M07 flow adds a local knowledge catalog to the dry-run. Exact duplicates block ordinary creation; same-source re-extractions and related notes are separately labeled suggestions. Existing notes can be opened or explicitly selected for a new combined note. The selected note is displayed read-only, while the user edits and confirms a separate combined draft. A second exact dry-run displays the new path, source links, and full Markdown before **Create combined note** becomes available. M07 never modifies the selected note. The M07 macOS runtime and complete repository verification gates passed; release remains unapproved.

Before using M06, configure a separate vault-relative **Knowledge folder** in Chat2Vault settings. It has no default and must not equal, contain, or sit below the source folder after normalized path comparison. Run **Dry run** after selecting eligible candidates. The dry-run shows every exact target path, planned action (`create`, `identical no-op`, or `conflict`), and the complete Markdown. Any edit, decision, selection, source-resolution change, settings change, candidate replacement, view close, or plugin unload invalidates the plan; **Write** stays disabled until another current, conflict-free dry-run succeeds.

Writing is create-only. Chat2Vault preflights every target before the first create, never overwrites or renames an existing note, and treats different bytes or an unsafe target as a conflict with zero batch mutation. Matching bytes are an `identical no-op`. Creates are sequential and each file is read back byte-for-byte. Obsidian has no multi-file transaction, so a later failure can leave earlier verified creates in place; the per-file ledger identifies what was created, not attempted, or failed. Retrying the same unchanged selection and dry-run is safe: verified earlier files become identical no-ops and only still-absent targets are created.

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

The plugin build currently produces `apps/obsidian-plugin/main.js`, `worker.js`, a macOS x86_64 read-only source-containment observer, and the separate M05 Keychain module. Install those files together with `manifest.json` and `styles.css` only in a disposable matching environment. M02 evidence remains in [M02 implementation notes](docs/09_M02_IMPLEMENTATION_NOTES.md); the approved [M03.1 macOS scope amendment](docs/M03_MACOS_SCOPE_AMENDMENT.md), [M03 implementation notes](docs/12_M03_IMPLEMENTATION_NOTES.md), historical [M03 runtime gate report](docs/13_M03_RUNTIME_GATE_REPORT.md), and [M03 closure report](docs/14_M03_CLOSURE_REPORT.md) record the M03 chronology. The byte-frozen [M04 specification](docs/M04_SPEC.md), historical [M04 implementation notes](docs/15_M04_IMPLEMENTATION_NOTES.md), historical [M04 runtime gate report](docs/16_M04_RUNTIME_GATE_REPORT.md), and [M04 closure report](docs/17_M04_CLOSURE_REPORT.md) record the complete M04 chronology. The approved [M05 specification](docs/M05_SPEC.md), [M05 implementation notes](docs/18_M05_IMPLEMENTATION_NOTES.md), and [M05 runtime gate report](docs/19_M05_RUNTIME_GATE_REPORT.md) record the merged M05 implementation. The approved [M06 design](docs/superpowers/specs/2026-09-15-m06-knowledge-review-writer-design.md), historical [M06 implementation notes](docs/20_M06_IMPLEMENTATION_NOTES.md), historical [M06 runtime gate report](docs/21_M06_RUNTIME_GATE_REPORT.md), and [M06 closure report](docs/22_M06_CLOSURE_REPORT.md) record the complete M06 chronology.

## Privacy

Parsing, normalization, archive reading, hashing, filtering, strict validation, candidate derivation, preview rendering, source planning, source writing, M06 review, knowledge planning, and knowledge writing run locally. Imported text and provider/pasted model output are treated strictly as untrusted data and rendered inertly. Settings v4 persists only the installation identity, preview size, source root, knowledge root, and non-secret provider endpoint/model/timeout/output-cap/disclosure fields. It does not persist candidates, review state, plans, rendered notes, ledgers, prompts, or provider responses. The provider API key persists only in the local macOS Keychain. A network request occurs only after the user configures the provider, accepts disclosure, and explicitly invokes Distill; there is no automatic retry or background request. M06 writing performs no provider call and never changes a source note. Repository and runtime fixtures are synthetic and contain no real conversations or credentials.

## Supported imports and limitations

Supported inputs:

- a ChatGPT `conversations.json` collection;
- a JSON object containing a `conversations` collection;
- a supported single/numbered conversation JSON file or input set;
- a ZIP containing `conversations.json` or supported numbered conversation files.

ZIP input is read in memory and checked for traversal, absolute paths, excessive entry count, compressed/uncompressed size, oversized JSON, encryption, unsupported compression methods, multi-disk layout, and ZIP64. Safe unrelated entries are ignored with a warning.

The parser supports the documented ChatGPT mapping graph shape. It preserves every message-bearing graph node. An exported `current_node` defines the selected path when valid; otherwise the parser emits `AMBIGUOUS_BRANCH` when needed and selects the longest root-to-leaf path, breaking ties by lexical leaf node ID. Selection metadata is recorded separately and does not discard alternate messages.

Non-text or unknown content parts are represented as `unsupported` blocks rather than guessed. ZIP64 and multi-disk archives are not supported in M01. `importedAt` reflects the import operation; canonical conversation and message fingerprints exclude it and remain deterministic.

M06 production eligibility remains macOS desktop x86_64. Windows, Linux, mobile, and non-x86_64 macOS packaging are not claimed. M06 does not implement exact or semantic knowledge deduplication beyond byte-identical target no-ops, related-note suggestions, merge flows, source-note forward links, current-conversation capture, historical batch migration, release hardening, deployment, or Community Plugin availability. Those remain M07-M10 or separately authorized work.

See [M01 implementation notes](docs/08_M01_IMPLEMENTATION_NOTES.md) and the [document index](docs/00_DOCUMENT_INDEX.md) for details.
