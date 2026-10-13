# M07 Deduplication and Linking Design

Status: Product Owner-approved written specification; implementation not authorized
Date: 2026-10-12
Baseline: M06 closure on `main`, commit `f180eb9945f0ecdd4bcfc0946cdd6fb2b6f0e685`
Scope: macOS desktop x86_64, matching the qualified M06 writer boundary

## 1. Purpose and authority

M07 prevents duplicate Chat2Vault knowledge notes and makes related knowledge useful without allowing automatic or destructive merging. The active requirements are `docs/05_ROADMAP.md` Milestone 07, `docs/04_KNOWLEDGE_SCHEMA.md` section 8, the M06 approved writer design, and `AGENTS.md`. This document defines M07 behavior; it is not implementation or publication authorization.

The Product Owner selected local-only related-note matching, a new combined note rather than modification of an existing note, and a candidate-plus-existing-note merge flow. The existing note remains untouched. An unsaved candidate has no knowledge-note path: the combined note links to the selected existing knowledge note and to the candidate's source conversation, not to a nonexistent candidate note.

## 2. Scope and non-goals

M07 adds a read-only catalog of eligible Chat2Vault knowledge notes, exact-content duplicate detection, same-source re-extraction handling, deterministic related-note suggestions, and a user-reviewed create-only combined-note flow. Suggestions are advisory; no suggestion silently selects a merge or inserts a link.

M07 does not scan the entire vault, use embeddings or a provider, create a network call, persist a similarity index, change source notes, modify/rename/delete existing knowledge notes, merge two saved knowledge notes, or add release packaging or other platform support. M08 capture, M09 migration, and M10 release work remain out of scope.

## 3. Components and trust boundaries

1. A narrow Obsidian catalog adapter enumerates direct-child Markdown files below the configured knowledge root and reads only eligible bounded files. It uses the established macOS physical-containment observation boundary; it cannot write.
2. A framework-independent core parser accepts bounded bytes and returns validated Chat2Vault note records. It treats Markdown body text and frontmatter values as untrusted data. It supports M06 schema v1 and the M07 combined-note schema v2, never executing or interpreting content as instructions. The v1 note format does not store message fingerprints, so the parser never fabricates them.
3. Pure core functions compute content identity, same-source relationships, and ranked local suggestions from validated records and reviewed candidates.
4. The plugin controller binds catalog and candidate generations to a frozen preview. M07 creation reuses the M06 create-only writer adapter, target preflight, byte readback, and per-file result ledger. No modify, rename, or delete capability is added.

No imported or existing note content is sent to a provider by this flow. Catalog diagnostics contain closed codes and counts, not note bodies, titles, paths, or source text.

## 4. Catalog and eligibility

The catalog scans only direct-child `.md` files under the configured knowledge root; M06 writes notes there. It does not follow nested directories or symlinks. A record is eligible only when its path is physically contained, its filename's 12-hex suffix agrees with the prefix of a full validated `candidate_fingerprint`, and its bounded frontmatter has a supported Chat2Vault schema and closed identity fields. The v1 fingerprint cannot be recomputed from the note because v1 does not persist all message-level inputs. A user-authored note is not assumed to be Chat2Vault-owned merely because it sits under the root; the checks establish format eligibility, not cryptographic authorship.

Unrelated Markdown files are ignored. A file that advertises Chat2Vault identity but fails schema, filename, path, size, or provenance validation makes the catalog incomplete and blocks M07 preview/write with a content-free diagnostic. The same applies to enumeration or read failures. The scan is bounded to 10,000 direct-child Markdown files and 128 KiB per eligible note; exceeding either bound blocks the catalog rather than silently truncating it. Valid records are sorted by normalized vault-relative path before identity and ranking work. No catalog is persisted.

The catalog captures sorted path and byte digest for every eligible note plus a digest of the enumerated direct-child paths. The preview binds that catalog fingerprint. Before any M07 create, the adapter re-enumerates and re-observes the catalog, selected note, source authorities, and target. A change or unreadable state invalidates the preview; the user must run another dry-run. M06's existing target-byte and containment preflight remains in force.

## 5. Identity and matching

M06's candidate fingerprint includes source references and remains the provenance-sensitive identity used for filenames and existing v1 notes. M07 adds a separate **knowledge-content fingerprint**: SHA-256 over a versioned canonical JSON object containing validated knowledge type, the exact rendered knowledge payload, and sorted unique rendered tags, excluding source references, timestamps, paths, and presentation state. The payload is the Markdown from the first title heading through the end of the Knowledge section, before the fixed Source footer; case, whitespace, and text bytes are preserved. For a v1 note, the parser validates the M06 frontmatter and exact source-footer suffix against its listed source links, then takes the preceding payload without trying to split arbitrary user text into summary and body. The reviewed candidate uses the same renderer to produce its payload. Thus equal content can be recognized across sources without inventing fields absent from v1; an edited existing note is classified from its observed bytes, not an old cached digest. If the v1 envelope or footer no longer validates, the note is Chat2Vault-like malformed and the catalog is incomplete.

Matching precedence is:

1. **Exact duplicate:** equal knowledge-content fingerprint, even when provenance differs. The default create is blocked; the UI points to all matching existing notes. An equal M06 candidate fingerprint is also shown as the same-provenance subtype. M07 never silently updates an existing note with the new source reference. Source-provenance expansion for an exact duplicate is a future design decision.
2. **Same-source re-extraction:** not exact content, but at least one source reference has the same provider and stable conversation ID; if no stable ID exists, the same provider and conversation fingerprint. Changed source-content fingerprints are called out separately from same-content alternative candidates. This is a warning, not an automatic block or merge.
3. **Related suggestion:** neither exact nor same-source, but local text similarity meets the threshold below. This is not a duplicate verdict and never blocks a normal create.

For suggestions, tokenize NFC-normalized title, tags, and a bounded 2,048-code-point payload teaser with Unicode letter/number runs, locale-independent lowercase, and token length 2–64 code points. Use weighted-set Jaccard similarity with title tokens weighted 3, tags 2, and teaser tokens 1; a token's weight is its maximum weight across fields. Keep scores at or above 0.25, sort by descending score then normalized path, and display at most five. The teaser can contain summary and body text; it is a heuristic only, never identity authority. The remainder of a long body is excluded from fuzzy ranking to bound cost. These constants are part of the contract and require tests. A low score means “no suggestion,” not “no relationship.”

## 6. Review experience and create flow

The knowledge dry-run shows three separately labeled groups: exact duplicates, same-source re-extractions, and related suggestions. Each entry can open the existing note. Exact duplicates disable ordinary creation of that candidate. Same-source and related entries leave ordinary creation available, with explicit warnings. Selecting a suggestion never changes an approved write plan.

For a reviewable merge, the user chooses one eligible existing Chat2Vault note and the currently reviewed, unsaved candidate. The editable draft starts with the candidate's title, summary, body, and tags; the selected existing note's full bounded knowledge payload is displayed alongside it, read-only. The plugin does not autonomously summarize, copy, discard, or reconcile that note's text. The user edits the draft to include the knowledge they want to preserve and explicitly confirms the combined result. This avoids pretending that arbitrary Markdown in a v1 note can be safely split into summary and body. Draft fields must remain within the established candidate text and tag limits; oversized input is never silently truncated. Provenance is immutable: the combined note carries the canonical union of the candidate's resolved source notes and the selected note's validated source-note links. The selected note remains unchanged. The v1 format does not preserve its original message fingerprints, so combined provenance is source-note-level; the candidate's finer-grained references are not misrepresented as references from the existing note. No merge is available if the selected note or any source-note link cannot be validated and resolved against the source registry.

The user runs a separate exact dry-run showing the new target path, full Markdown bytes, source links, selected existing-note link, and action. The dry-run blocks a combined draft whose knowledge-content fingerprint equals any cataloged note, including the selected note; the merge path cannot bypass exact-duplicate prevention. Only a successful, current, frozen preview enables **Create combined note**. The output is a new schema-v2 Chat2Vault knowledge note with `status: accepted`, `knowledge_content_fingerprint`, `candidate_fingerprint`, canonical `source_provider` / `source_fingerprint` / `source_conversation` fields in the M06 scalar-or-array shape, and one `combined_from` link to the selected existing note. The note's body labels the combined knowledge and sources; it does not claim the unsaved candidate was an existing note. The v2 candidate fingerprint is SHA-256 over version 2, type, exact rendered knowledge payload, rendered tags, sorted source-note triples, and the normalized selected-note path. These are all recoverable from the v2 note. Its safe filename uses the M06 sanitizer with the first 12 hexadecimal characters of that fingerprint; repeated identical merges address the same target. A byte-identical target is an explicit no-op; different bytes or unsafe state are conflicts, never overwrite requests. A rendered note above the catalog's 128 KiB limit is rejected before creation.

The combined note is not automatically a replacement for either input. The UI reports the new path and leaves the original note and source notes untouched. If the candidate, selected note, roots, settings, catalog, source authority, or target changes after preview, creation is disabled until a fresh dry-run. Writes remain non-queuing and preserve M06's partial-result ledger and readback verification.

## 7. Error handling and privacy

Catalog incompleteness, malformed Chat2Vault-like notes, unsupported schema, duplicate/ambiguous note identities, unsafe containment, unavailable source references, stale preview, and target conflicts are closed diagnostics. They block the affected M07 preview or create rather than silently falling back to unchecked creation. A malformed unrelated note does not block. Errors do not print note contents, provider responses, secrets, local absolute paths, or vault names.

The plugin does not make an external request for cataloging, ranking, linking, or combining. Existing M05 provider behavior remains separately user-configured and user-initiated; M07 does not initiate it.

## 8. Verification and acceptance

Core tests must cover v1/v2 parsing, adversarial frontmatter and Markdown, filename/provenance validation, canonical content-fingerprint vectors, duplicate content across different sources, duplicate paths and ambiguous identities, same-source changed extraction, unknown/partial structures, Unicode/token boundaries, score ordering/ties, and bounded scans. Adapter/controller tests must cover symlinks and physical containment, inaccessible or changing catalog entries, stale generations, source resolution, target races, non-queuing execution, byte-identical no-op, conflict, failed create/readback, and proof that no existing note is modified, renamed, or deleted.

The M06 writer and M03 source-registry suites remain green. The full repository format, lint, typecheck, tests, build, boundary/security scans, and relevant M07 runtime gates must run against the exact candidate. Runtime qualification uses the supported macOS x86_64 Obsidian minimum and current-stable rows, a disposable synthetic vault, and evidence for both a duplicate prevention and an explicitly approved create-only combined note. Runtime success does not authorize publication or release; a separate exact-candidate review and Product Owner decision remain required.

## 9. Acceptance ledger

| Roadmap deliverable             | Acceptance condition                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact duplicate detection       | Same canonical knowledge content, including across different sources, is shown with existing-note links and ordinary duplicate creation blocked. |
| Same-source re-extraction       | Changed content from the same stable conversation is labeled separately and remains reviewable without an automatic merge.                       |
| Suggested related notes         | Up to five deterministic, local, bounded, non-authoritative suggestions are shown; no provider call occurs.                                      |
| Reviewable merge flow           | One reviewed candidate plus one eligible existing note yields an editable exact preview and a new verified note only after explicit user action. |
| No autonomous destructive merge | Existing knowledge and source notes remain byte-identical; no modify, rename, delete, or overwrite capability is added.                          |

## 10. Gate and follow-up

This design requires Product Owner review of the written spec before implementation planning. Approval of this document alone does not authorize implementation, commit, push, pull request, merge, deployment, release, Community Plugin submission, or provider spend. Implementation planning and those later actions have separate gates under `AGENTS.md`.

Deferred follow-up: exact duplicates from different sources currently cannot add their new source reference to an existing note because M07 preserves existing notes and blocks a redundant new note. A future explicitly approved provenance-update design may address that gap without weakening the create-only M07 boundary.
