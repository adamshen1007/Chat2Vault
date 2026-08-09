# Milestone 01 Implementation Notes

Version: 0.1  
Status: Implemented; verification evidence belongs in the milestone completion report

## Public boundary

`packages/core/src/index.ts` exports the canonical domain types, `parseChatGptExport`, deterministic serialization/fingerprint helpers, and default archive limits. The importer accepts one in-memory file or an in-memory set of numbered JSON files. It performs no filesystem writes and no network calls.

## Conversation graph strategy

ChatGPT `mapping` objects are normalized as graphs, not timestamp-sorted transcripts. Every message-bearing node is preserved in a deterministic lexical node-ID order. Provider message IDs and structural parent node IDs are retained on messages, while `metadata.chatgptGraph` records:

- total node count;
- selected path node IDs;
- alternative leaf node IDs;
- exported current node, when present.

Mapping keys provide structural node identity because they are unique within the exported object; a conflicting declared `node.id` is preserved as metadata. When `current_node` resolves to an exported mapping key, its ancestor chain is the selected path. Without a valid current node, the importer selects the longest root-to-leaf chain and uses locale-independent UTF-16 lexical leaf node ID as the tie-breaker. Multiple possible leaves, or an invalid exported current node, produce `AMBIGUOUS_BRANCH`. Cyclic graphs and duplicate declared node IDs produce `INVALID_MESSAGE_GRAPH` with deterministic structural handling. No alternate message is discarded.

## Fingerprints

SHA-256 identifiers use a stable JSON serializer that recursively sorts object keys with a locale-independent comparator and preserves array order. Message fingerprints cover normalized provider identity, parent, role, timestamp, content, and stable metadata. Conversation content fingerprints cover all canonical messages and graph selection metadata; titles and conversation-level timestamps do not define content identity. Source fingerprints cover sorted file names and raw file hashes; conversation titles are never used as identity.

## Archive boundary

ZIP metadata is validated before any candidate entry is decompressed. Defaults limit entry count, archive bytes, declared aggregate uncompressed bytes, and candidate JSON bytes. Absolute/traversal paths, malformed directory metadata, encryption, unsupported compression methods, ZIP64, and multi-disk archives fail with typed diagnostics. Supported stored and DEFLATE candidate entries are read directly in memory. No archive entry is extracted to disk.

Safe unrelated ZIP entries are neutralized by ignoring them and emitting a count-only warning. Diagnostics never interpolate imported conversation bodies, and provider-controlled identifiers are represented only by SHA-256 diagnostic references.

## Known M01 limitations

- The importer targets the documented `mapping`-based ChatGPT export family; a materially different future export shape may require a parser revision.
- Non-text multimodal/provider content is preserved only as a safe `unsupported` description.
- ZIP64 and multi-disk archives are rejected.
- Timestamps that cannot be converted to ISO 8601 are omitted.
- Branch selection is metadata for later UI resolution; M01 has no branch-selection UI.
