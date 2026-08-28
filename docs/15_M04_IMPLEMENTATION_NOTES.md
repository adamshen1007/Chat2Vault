# Milestone 04 Implementation Notes

Version: 0.2-candidate
Date: 2026-08-27
Decision: **GO — M04 COMMIT READY**

## Authority and repository state

- Repository root: Chat2Vault repository checkout (local absolute path withheld from review artifacts)
- Branch: `codex/milestone-04-implementation`
- Candidate base and current uncommitted HEAD: `bfbce0f8eb5637ae82cfe6986bba2cc7a66a280e`
- M03 closure baseline: `994bdeabd5a30c343c0d5a4bcbd872c69e794f2b`
- Approved specification: `docs/M04_SPEC.md` v0.6-candidate
- Approved specification SHA-256: `12a6fdd8346b80e1b015c099b78c2d26c3b736b6d09dfecc55254d648df5193c`
- Upstream: none for the local implementation branch
- Publication state: uncommitted; not pushed; no PR; not merged; not deployed or released

The Product Owner explicitly authorized M04 implementation against the approved v0.6 specification. No commit, push, PR, merge, deployment, release, or M05 work is part of this candidate.

## Implemented scope

The candidate adds:

- deterministic complete-conversation projection for ChatGPT and unknown providers;
- byte-exact request identity and LF-only length-framed manual prompt rendering;
- a duplicate-aware strict JSON parser with ordered, capped diagnostics;
- locally derived semantic fingerprints, candidate IDs, provenance, and `proposed` status;
- a generation- and token-fenced Prepare/Copy/Validate controller;
- explicit clipboard write only, with denial/failure classification and visible lifetime disclosure;
- bounded textarea handling that clears over-limit values rather than retaining or truncating them;
- inert, read-only, in-memory candidate preview with fixed 10/25/50 pagination;
- static and injected-runtime tripwires for M04 network and mutation boundaries.

## Explicit non-goals preserved

M04 adds no provider API or SDK, network request, automatic clipboard read/restore/clear, browser automation, candidate editing/acceptance/rejection/merge/save, candidate or request persistence, settings field, vault mutation, M05+ behavior, compatibility expansion, release packaging decision, or publication action. M03 source-note saving remains unchanged and separately user initiated.

## Files

Added:

- `packages/core/src/distillation/contracts.ts`
- `packages/core/src/distillation/request.ts`
- `packages/core/src/distillation/result.ts`
- `packages/core/test/distillation-request.test.ts`
- `packages/core/test/distillation-result.test.ts`
- `apps/obsidian-plugin/src/distillation-controller.ts`
- `apps/obsidian-plugin/src/distillation-model.ts`
- `apps/obsidian-plugin/test/distillation-controller.test.ts`
- `apps/obsidian-plugin/test/distillation-model.test.ts`
- `apps/obsidian-plugin/test/m04-boundaries.test.ts`
- `apps/obsidian-plugin/scripts/check-m04-boundaries.mjs`
- `docs/15_M04_IMPLEMENTATION_NOTES.md`
- `docs/16_M04_RUNTIME_GATE_REPORT.md`

Modified:

- `packages/core/src/index.ts`
- `apps/obsidian-plugin/src/main.ts`
- `apps/obsidian-plugin/src/view.ts`
- `apps/obsidian-plugin/styles.css`
- `apps/obsidian-plugin/test/view.test.ts`
- `apps/obsidian-plugin/test/styles.test.ts`
- `apps/obsidian-plugin/scripts/check-plugin.mjs`
- `package.json`
- `README.md`
- `docs/00_DOCUMENT_INDEX.md`

No file is removed. `docs/M04_SPEC.md` is unchanged.

## Deterministic golden evidence

Synthetic fixtures contain no real conversation or personal data.

| Artifact                            | Exact value                                                               |
| ----------------------------------- | ------------------------------------------------------------------------- |
| ChatGPT request ID golden           | `sha256:15a7ab54e53002992592ffcf69c61e48ba9af1a88f398d54c98adf0908ca79c2` |
| ChatGPT prompt UTF-8 bytes          | `2933`                                                                    |
| ChatGPT prompt SHA-256              | `sha256:7b2140a1e10ce1597760e027db1bd0d944a229aa34701fe7f4be35ccca2af323` |
| Unknown-provider request ID golden  | `sha256:cb9278c57dfda8c18ec5a44bf15e36b215fbbfec2518431e02de69cd52c27752` |
| Unknown-provider prompt UTF-8 bytes | `2627`                                                                    |
| Unknown-provider prompt SHA-256     | `sha256:7ba2e9ecc12012fb56cddf2368db43399726cc9ff0394fd7cf2c70de5e21f834` |
| Candidate semantic fingerprint      | `sha256:c5dc13a7029ec1517df339256c3c2a269b15f78a4ab209660eece1530cded684` |
| Candidate ID                        | `sha256:5a6c6e5b1e235e4f4d4d648e0e461a493ecf6bf85525cf24cb13af4a4e8f6996` |

## Automated verification

Fresh candidate command on 2026-08-26:

| Command                                    | Result | Evidence                                                                                                       |
| ------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| `CI=true pnpm verify`                      | PASS   | Prettier, ESLint, strict typecheck, full tests, builds, and plugin gates all passed                            |
| `pnpm -r test` (inside the complete gate)  | PASS   | core `157/157`; plugin `281/281`; total `438/438`                                                              |
| `pnpm -r build` (inside the complete gate) | PASS   | core TypeScript build; native observer; worker `12.9kb`; main `110.0kb`                                        |
| plugin static gate                         | PASS   | 17 plugin source files; built `main.js=113924` bytes and `worker.js=13182` bytes                               |
| bundled worker smoke                       | PASS   | one synthetic conversation                                                                                     |
| M03 runtime-contract helper regression     | PASS   | 28 assertions                                                                                                  |
| M04 boundary gate                          | PASS   | five isolated M04 production modules; one explicit clipboard write; zero declared network or mutation surfaces |

The M04-focused suites contribute 100 passing tests: core request/result `37`, plugin controller/model/view/main/styles/boundary `63`. The full suite retains all M01-M03 tests.

## Acceptance ledger

| AC          | Candidate evidence                                                                                             | State                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| AC-01–AC-04 | Complete projection, topology, direct hashes, exact prompt frame, delimiter collision, and size behavior tests | LOCAL PASS                                                               |
| AC-05       | Explicit fenced `writeText`, failure matrix, no read/restore/clear, visible disclosure                         | PASS — both runtime rows and zero-network attribution                    |
| AC-06–AC-12 | Duplicate-aware total parser, exact stages/paths, boundaries, provenance, derived identities, atomic preview   | LOCAL PASS                                                               |
| AC-13–AC-14 | Generation/token fences, arbitration, stale precedence, textarea-wins races, ownership release                 | PASS — complete status matrix plus 16 named race outcomes on both rows   |
| AC-15       | Inert DOM, exact keyboard DOM order, labels, pagination, and responsive CSS tests                              | PASS — 360 px, exact focus order, and host zoom `1 → 2 → 1` on both rows |
| AC-16       | In-memory-only controller, unchanged settings schema, boundary checks                                          | PASS — zero M04 mutations and identical manifests on both rows           |
| AC-17–AC-18 | Static M04 boundary checker and injected browser tripwires                                                     | PASS — Layer A/Layer B network and mutation evidence on both rows        |
| AC-19       | Full `438/438` regression suite and build/static gates                                                         | LOCAL PASS                                                               |
| AC-20       | Diff scope contains no M05+, release, or platform expansion                                                    | LOCAL PASS                                                               |
| AC-21       | Spec hash remains exact; candidate evidence recorded                                                           | PASS — exact v8 independent `GO — M04 COMMIT READY`                      |

## Review findings and remediations

- Focused race testing found that Copy initially captured the current selection fingerprint instead of the installed request fingerprint. Copy and Validate now bind their capture to `request.conversationFingerprint`; a changed active fingerprint returns stale before clipboard invocation.
- Strict parsing initially accepted exponent forms that converted to non-finite JavaScript numbers. The parser now rejects non-finite numeric results as invalid JSON for the M04 contract.
- The existing plugin static gate originally prohibited all clipboard identifiers. It now permits exactly one `navigator.clipboard.writeText(text)` production call while continuing to reject automatic reads and other clipboard APIs.
- Independent implementation review found duplicate diagnostics for missing candidate array members. Candidate array validation now leaves missingness exclusively to the exact-key stage, with one exact diagnostic golden for each array field.
- Independent implementation review found that Prepare and Validate service throws/rejections could escape and retain ownership. Request-building exceptions now fail closed as `DISTILLATION_REQUEST_INVALID`, prompt-rendering exceptions as `DISTILLATION_PROMPT_TOO_LARGE`, and validation exceptions as `DISTILLATION_JSON_INVALID`; every path uses token-aware total settlement. Synchronous throw, asynchronous rejection, stale-after-rejection, and newer-owner preservation fixtures cover all three boundaries.
- Independent implementation review found that an empty unknown-provider `providerMessageId` was rejected instead of treated as non-authoritative. Empty values are now omitted from the identity map, while duplicate non-empty values, resolved self-parent edges, and cycles remain invalid.
- The first independent review archive omitted this implementation-notes file even though README and the document index referenced it. The regenerated archive includes the exact file and complete candidate inventory.
- The second independent review found that the view redrew unconditionally after stale manual-operation settlement. The view now consumes the exact operation result, suppresses stale post-settlement draws, and refuses to draw after close. View-level tests bind textarea focus/DOM preservation, newer-owner preservation, and close-during-Copy behavior.
- The second independent review found that active-conversation fingerprint mismatch was detected as stale without performing the required full external invalidation. The controller now tracks the authoritative active/request fingerprint, performs the complete synchronous invalidation transition on mismatch, releases ownership, clears request/prompt/paste/candidates, and permits a fresh Prepare while fencing older Copy/Validate completions. The view synchronizes this boundary before drawing and before starting manual operations.
- The third independent review found that Validate was visually positioned after the textarea but remained in the earlier actions container, producing Prepare → Copy → Validate → textarea DOM order. Validate now lives in its own actions container after the textarea and status, and a production-bound regression asserts Prepare → Copy → textarea → Validate → candidate controls → pagination.
- The third independent review found that a later forged source fingerprint which was also a duplicate emitted only one provenance diagnostic. Membership/malformed authority and later-duplicate authority are now evaluated independently; overlapping exact-multiplicity and post-sort 50-diagnostic-cap regressions bind the result.
- The fourth independent review found the equivalent multiplicity overlap in suggestion arrays. Suggestion semantic validity and later-duplicate authority are now independent after NFC applicability; both links and tags have repeated over-limit exact-multiplicity regressions, and a 26-element overlap fixture proves both violations enter the sorted pre-cap set.
- The fourth review also found that the archive retained a stale `REVIEW_REQUEST.md` entry. The next packet force-replaces that entry and independently verifies its extracted counts and artifact hashes against the final repository bytes before transmission.

## Runtime closure and remaining decision boundary

The two-row macOS x86_64 runtime gate passed on Obsidian 1.7.4 and independently resolved current official stable 1.13.7 with identical final production artifacts. `docs/16_M04_RUNTIME_GATE_REPORT.md` records the attributed Layer-A evidence, 34 explicitly paired same-duration Layer-B scenario windows per row, 16 named invalidation/race outcomes per row, injected and OS-level mutation evidence, byte-identical manifests, complete action matrix, retained positive controls, inert rendering, 360 px geometry, exact keyboard sequence, and host zoom `1 → 2 → 1`.

The exact v8 whole-candidate packet contained 251 regular files, measured 1,161,874 bytes, and had SHA-256 `b5cc0c74e2ac76cab88e6a550490d8f6f6926812f2ff2a8f4072fc72ab0a5118`. Its independent review verified the wrapper, unchanged production/spec/test candidate, combined primary and supplemental runtime evidence, 34 same-duration network pairs per row, 16 named race outcomes per row, and AC-01 through AC-21 before returning exact `GO — M04 COMMIT READY` on 2026-08-28.

The truthful decision is now **GO — M04 COMMIT READY**. This does not itself authorize publication: no commit, push, PR, merge, deployment, release, or M05 action has occurred, and each remains outside this review-loop authorization.
