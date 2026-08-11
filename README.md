# Chat2Vault

Chat2Vault is a local-first tool for turning AI conversations into source-linked Obsidian knowledge rather than merely archiving transcripts.

## Current status

Milestone 02 adds a desktop-only Obsidian preview plugin to the deterministic M01 import core. The plugin accepts supported ChatGPT ZIP/JSON exports, displays bounded conversation and diagnostic pages, and keeps imported material in memory only.

M02 remains preview-only. It does **not** write to a vault, call an AI or network provider, use provider APIs, automate a browser, synthesize knowledge, or support non-ChatGPT importers.

The plugin is desktop-only because it reads export files selected explicitly from outside the vault. It never scans folders: it accepts one ZIP, one JSON, or up to sixteen JSON files through the picker or drag/drop, subject to the documented size limits. M02 contains no network client, telemetry, analytics, remote assets, or update check, and it creates no notes or other vault files.

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

The plugin build produces `apps/obsidian-plugin/main.js` and `worker.js`; install those files together with `manifest.json` and `styles.css` in a disposable Obsidian vault for the runtime smoke procedure documented in [M02 implementation notes](docs/09_M02_IMPLEMENTATION_NOTES.md).

## Privacy

Parsing, normalization, archive reading, hashing, filtering, and preview rendering run locally. Imported text is treated strictly as untrusted data and rendered inertly. The plugin persists only `{ schemaVersion, previewMessagesPerPage }`; it does not persist imports, identifiers, paths, diagnostics, or file names. Repository fixtures are synthetic and contain no real conversations.

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
