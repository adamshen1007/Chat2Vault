# Chat2Vault

Chat2Vault is a local-first tool for turning AI conversations into source-linked Obsidian knowledge rather than merely archiving transcripts.

## Current status

Milestone 01 provides a deterministic, offline TypeScript core for supported ChatGPT data-export JSON and ZIP inputs. It normalizes exports into a provider-independent canonical schema, preserves conversation graph identity, emits safe typed diagnostics, and generates SHA-256 fingerprints.

M01 does **not** include an Obsidian plugin, vault writes, AI distillation, provider APIs, browser automation, or non-ChatGPT importers.

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

The implementation boundary is `packages/core`. Synthetic fixtures live in `fixtures/chatgpt`.

## Privacy in M01

Parsing, normalization, archive reading, and hashing run locally. The core contains no network client, does not call an LLM, does not depend on Obsidian, and does not write imported content to disk. Imported text is treated strictly as untrusted data. Repository fixtures are synthetic and contain no real conversations.

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
