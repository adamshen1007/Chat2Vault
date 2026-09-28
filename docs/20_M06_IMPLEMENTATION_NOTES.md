# Milestone 06 Implementation Notes

Version: 0.1 exact-candidate documentation

Date: 2026-09-26

Decision: **CONDITIONAL GO — implementation and runtime qualification complete; fresh independent R2 exact-candidate review pending**

## 1. Objective, authority, and repository state

M06 implements explicit review, exact dry-run, and create-only promotion of validated M04/M05 knowledge candidates into deterministic, source-linked Obsidian Markdown notes. It does not give a provider vault authority and does not modify source notes.

The applicable authority and ancestry are:

- repository instructions: `AGENTS.md`;
- approved design: `docs/superpowers/specs/2026-09-15-m06-knowledge-review-writer-design.md`, SHA-256 `5b1a89e02247750908477beb5b0837f0c5c97482608d3178c0093c3de963c0b4`;
- authorized milestone/product base and current `merge-base` with `main`: M05 merge `be0f5803ac39120e00e9994a936a8858a1cf3187`;
- approved-design commit: `81964c7ed7367e59cefe1c946d74c4424dfb144d`;
- committed implementation-plan baseline: `f05b0016cde3ca984f024a1ccf1edd93e56d0323`, plan SHA-256 `05487a494df538e0e4588ae73d3818c4bde105f4d01247a22e4f4c1ff28fa7bd`;
- Task 8 input HEAD/tree: `a4c6698fdea185177d736836c8686e0c2060cbb1` / `87ce841bc509fc75d0afd825dd6fe62e1a3b30e9`;
- branch: `codex/milestone-06-design`;
- upstream: none configured;
- Task 8 started from a clean tracked and untracked worktree;
- publication: local commits only; no push, pull request, merge, tag, deployment, release, Community Plugin submission, provider spend, or M07 work.

The plan's historical scope commands correctly use the M05 merge `be0f580...` because it is the authorized milestone base. Task implementation began after the design and plan were committed, so task-local implementation ranges use `f05b001...`. These ranges answer different questions and neither silently replaces the other.

A tracked file cannot contain the hash of the commit that contains itself. The exact final Task 8 commit/tree and post-commit clean-state evidence are therefore recorded in the ignored `.superpowers/sdd/m06-task-8-report.md` and supplied to the independent reviewer.

## 2. User workflow

### 2.1 Configure the knowledge root

Chat2Vault settings now include a **Knowledge folder**. It is a separately persisted vault-relative root with no default. An empty, invalid, `.obsidian`-scoped, or source-overlapping root disables dry-run and writing. Equality, ancestor, and descendant checks use normalized collision comparison so case and Unicode aliases do not create a second authority.

### 2.2 Review, edit, reject, and select

Every validated candidate starts as `proposed`. The user may:

- **Accept** it unchanged;
- **Edit** only title, summary, body, and tags;
- **Reject** it, which removes write eligibility;
- select accepted/edited candidates individually or use **Select all eligible**.

Type, confidence, ID, and provenance remain immutable. A first dirty edit immediately revokes any prior write plan. Invalid edits remain fail-closed. Review state is view-local and in memory only.

### 2.3 Dry-run and write

**Dry run** resolves the trusted source registry, observes every destination, and renders the exact path, action, and full Markdown for each selection. Actions are closed to `create`, `identical no-op`, or `conflict`. **Write** is enabled only for the complete current conflict-free plan.

Any decision, edit, selection, source resolution, root, settings generation, candidate generation, view lifecycle, or plugin lifecycle change invalidates the plan. Source-root and knowledge-root persistence pending state is part of controller authority: candidate installation, dry-run, and Write fail closed while either root save is pending, and source-save generation changes fence every older plan across both successful and failed settlement. Planning and writing are separately non-queuing.

### 2.4 Create-only, conflicts, partial failure, and retry

The adapter preflights the whole batch before the first create. Existing different bytes, unexpected object types, containment failures, or observation errors become conflicts and cause zero batch mutation. Exact existing bytes are no-ops.

Eligible notes are created sequentially and read back byte-for-byte. There is no multi-file transaction. If a later create or verification fails, earlier verified creates remain and later rows are `not-attempted`; the content-free per-file ledger reports the exact outcome. Retrying the same unchanged plan is idempotent: earlier verified notes become `identical-no-op`, and only absent targets are created. M06 never overwrites, rolls back, generates numeric collision suffixes, renames, or deletes.

## 3. Approved-design traceability

| Design section               | Implementation symbols and files                                                                                                                                             | Principal tests/evidence                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| §1 Goal                      | `Chat2VaultView.drawKnowledgeReview`, `KnowledgeController`, `planKnowledgeWrite`, `executeKnowledgeWrite`                                                                   | `view.test.ts`, `knowledge-controller.test.ts`, two-row runtime scenarios                                                           |
| §2 Scope/non-goals           | Review/planner/controller/adapter bounded surfaces; no M07 module or capability                                                                                              | `m06-boundaries.test.ts`; whole-branch inventory and scope review                                                                   |
| §3.1 Source immutability     | `ObsidianKnowledgeVaultAdapter.resolveKnowledgeSources`; executor source re-resolution; runtime mutation ledger                                                              | `knowledge-vault-adapter.test.ts`, `knowledge-executor.test.ts`, `source-note-unchanged` runtime scenario                           |
| §3.2 One candidate/one note  | `renderKnowledgeNote`, `safeKnowledgeFilename`, `planKnowledgeWrite`                                                                                                         | `knowledge-render.test.ts`, `knowledge-planner.test.ts`                                                                             |
| §3.3 Ephemeral review        | `createKnowledgeReview`, `setKnowledgeDecision`, `editKnowledgeCandidate`, `setKnowledgeSelected`, `KnowledgeController.installCandidates`                                   | `knowledge-review.test.ts`, `knowledge-controller.test.ts`, persistence boundary checks                                             |
| §3.4 Selection/exact preview | `KnowledgeController.select`, `selectAllEligible`, `preview`; `Chat2VaultView.previewKnowledge`                                                                              | `knowledge-controller.test.ts`, `view.test.ts`, `multi-select-dry-run` and `stale-preview-disabled` runtime scenarios               |
| §4.1 Review model            | `ReviewedKnowledgeCandidate`, closed `M06DiagnosticCode`, `KnowledgeController`                                                                                              | review/controller suites and hostile-object/throw regressions                                                                       |
| §4.2 Pure planner            | `planKnowledgeWrite`, `knowledgeWritePlanEqual`, `renderKnowledgeNote`, `safeKnowledgeFilename` in `@chat2vault/core`                                                        | planner/render tests; core remains Obsidian-independent                                                                             |
| §4.3 Source resolver         | `ObsidianKnowledgeVaultAdapter.resolveKnowledgeSources` and complete two-snapshot registry validation                                                                        | adapter tests for missing/ambiguous/stale/malformed/race cases                                                                      |
| §4.4 Writer adapter          | exact five-capability `KnowledgeVaultAdapter`; `observeKnowledgeTarget`, `checkpointKnowledgeTarget`, `createKnowledgeNote`, `readKnowledgeNote`                             | adapter capability test, M06 static checker, runtime mutation ledger                                                                |
| §5 Data/identity             | canonical review contracts, candidate/source fingerprints, 240-byte filename, root collision rules                                                                           | review/render/planner vectors and Unicode/path cases                                                                                |
| §5.4 Settings migration      | `Chat2VaultSettingsV4`, `readSettings`, root persistence states, `sourceWriteGeneration`, `knowledgeWriteGeneration`                                                         | settings/main/controller pending-save and settlement tests                                                                          |
| §6 Markdown                  | `renderKnowledgeNote` fixed schema/frontmatter/body/backlinks; `#` source paths fail closed before planning because exact property and body links cannot both be represented | golden single/multi-source, `#` root/filename/punctuation render and planner tests; Obsidian view integration; runtime backlink row |
| §7 Write semantics           | frozen `ExecutableKnowledgeWritePlan`; `executeKnowledgeWrite`; controller consumes plan before await                                                                        | executor/controller race, preflight, partial ledger, retry, and no-op tests                                                         |
| §8 Privacy/error handling    | fixed diagnostics, text-only sinks, settings/log boundary checks, provider isolation                                                                                         | `view.test.ts`, `m06-boundaries.test.ts`, privacy scans, canonical evidence packets                                                 |
| §9 Verification              | `check-m06-boundaries.mjs`, `check-m06-runtime.mjs`, provenance and artifact comparators                                                                                     | 95-test M06 gate, full core/plugin suites, official two-row runtime report                                                          |
| §10 Completion boundary      | exact base/head/tree inventory, full gate, independent-review handoff                                                                                                        | this document, `21_M06_RUNTIME_GATE_REPORT.md`, ignored Task 8 report                                                               |

## 4. Settings v4 migration and persistence

`Chat2VaultSettingsV4` adds only `knowledgeRoot` to the complete v3 shape:

- exact valid v3 loads in memory as v4 with `knowledgeRoot: ""` and no implicit write;
- valid v4 loads without rewrite;
- invalid v4 knowledge-root data becomes disabled in memory with `INVALID_PERSISTED_KNOWLEDGE_ROOT`, independently of source/provider recovery;
- safe integer schemas `>= 5` remain unsupported-future and byte-preserved until the existing explicit downgrade path;
- every supported save writes a complete v4 snapshot and preserves unrelated authoritative fields;
- `saveKnowledgeRoot` shares the existing binary non-queuing settings mutex;
- knowledge state is invalidated after pending state is published and before persistence, while root authority and `knowledgeWriteGeneration` advance only after fulfilled persistence;
- review candidates, selections, plans, rendered Markdown, ledgers, prompts, responses, and credentials are never added to settings.

## 5. Implementation inventory

Relative to the authorized M06 base `be0f5803ac39120e00e9994a936a8858a1cf3187`, the milestone contains the approved design/plan plus the following implementation, evidence, and Task 8 documentation surfaces.

### Core

- `packages/core/src/index.ts`
- `packages/core/src/knowledge-writer/contracts.ts`
- `packages/core/src/knowledge-writer/planner.ts`
- `packages/core/src/knowledge-writer/render.ts`
- `packages/core/src/knowledge-writer/review.ts`
- `packages/core/test/knowledge-planner.test.ts`
- `packages/core/test/knowledge-render.test.ts`
- `packages/core/test/knowledge-review.test.ts`

### Plugin production and generated release artifacts

- `apps/obsidian-plugin/src/distillation-controller.ts`
- `apps/obsidian-plugin/src/knowledge-controller.ts`
- `apps/obsidian-plugin/src/knowledge-executor.ts`
- `apps/obsidian-plugin/src/knowledge-vault-adapter.ts`
- `apps/obsidian-plugin/src/main.ts`
- `apps/obsidian-plugin/src/provider-controller.ts`
- `apps/obsidian-plugin/src/settings-model.ts`
- `apps/obsidian-plugin/src/settings.ts`
- `apps/obsidian-plugin/src/view.ts`
- `apps/obsidian-plugin/styles.css`
- `apps/obsidian-plugin/main.js`
- `apps/obsidian-plugin/worker.js`

### Runtime-only, gate, and provenance code

- `apps/obsidian-plugin/scripts/check-m04-boundaries.mjs`
- `apps/obsidian-plugin/scripts/check-m05-runtime.mjs`
- `apps/obsidian-plugin/scripts/check-m06-boundaries.mjs`
- `apps/obsidian-plugin/scripts/check-m06-runtime.mjs`
- `apps/obsidian-plugin/scripts/check-plugin.mjs`
- `apps/obsidian-plugin/scripts/compare-m05-runtime-artifact.mjs`
- `apps/obsidian-plugin/scripts/m06-runtime-provenance.mjs`
- `apps/obsidian-plugin/scripts/prepare-official-runtime-sources.mjs`
- `apps/obsidian-plugin/src/runtime-test-entry.ts`
- `apps/obsidian-plugin/src/runtime-test-m06.ts`
- `apps/obsidian-plugin/src/runtime-test-mutation-ledger.ts`
- `package.json`

### Plugin tests

- `apps/obsidian-plugin/test/distillation-controller.test.ts`
- `apps/obsidian-plugin/test/knowledge-controller.test.ts`
- `apps/obsidian-plugin/test/knowledge-executor.test.ts`
- `apps/obsidian-plugin/test/knowledge-vault-adapter.test.ts`
- `apps/obsidian-plugin/test/m05-boundaries.test.ts`
- `apps/obsidian-plugin/test/m06-boundaries.test.ts`
- `apps/obsidian-plugin/test/m06-runtime-acceptance.test.ts`
- `apps/obsidian-plugin/test/m06-runtime-mutation-ledger.test.ts`
- `apps/obsidian-plugin/test/m06-runtime-provenance.test.ts`
- `apps/obsidian-plugin/test/main.test.ts`
- `apps/obsidian-plugin/test/provider-controller.test.ts`
- `apps/obsidian-plugin/test/runtime-artifact-comparator.test.ts`
- `apps/obsidian-plugin/test/settings-model.test.ts`
- `apps/obsidian-plugin/test/styles.test.ts`
- `apps/obsidian-plugin/test/view.test.ts`

### Documentation and retained evidence

- `.prettierignore` (only the ignored SDD coordination directory and two exact canonical one-line evidence preimages were added)
- `README.md`
- `docs/00_DOCUMENT_INDEX.md`
- `docs/20_M06_IMPLEMENTATION_NOTES.md`
- `docs/21_M06_RUNTIME_GATE_REPORT.md`
- `docs/evidence/m06-runtime-minimum.json`
- `docs/evidence/m06-runtime-stable.json`
- `docs/superpowers/plans/2026-09-15-m06-knowledge-review-writer.md`
- `docs/superpowers/specs/2026-09-15-m06-knowledge-review-writer-design.md`

No file was removed. The exact final `git diff --name-status` inventory and file count are recorded in the ignored Task 8 report.

## 6. Privacy and security boundaries

- Imported/source/model text remains untrusted data. Review edits require exact own data fields, bounded NFC strings, closed tags, and detached arrays.
- The core constructs paths and Markdown without Obsidian APIs. Candidate text cannot choose a root, source path, frontmatter key, or extra destination.
- Source paths come only from a complete, stable, direct-child M03 registry snapshot with repeated physical containment checks. Model-suggested backlink paths are never trusted.
- Source paths containing `#` are valid M03 source paths but cannot satisfy the M06 two-backlink contract: Obsidian parses `#` in a wikilink as a subpath, while Markdown links are not supported in properties. M06 dry-run returns the closed `KNOWLEDGE_SOURCE_UNRESOLVED` diagnostic with no plan entries and Write disabled. The source note remains untouched; changing its path is outside M06 authority. Ordinary paths retain quoted wikilinks in both metadata and body.
- The knowledge adapter exposes exactly resolve, observe, checkpoint, create, and read. It exposes no modify, rename, delete, source-create, provider, network, or general filesystem capability.
- Provider service keys remain exactly the M05 allowlist. Provider execution receives no writer, vault, source-registry, or filesystem object.
- Write authority is the exact frozen current dry-run. It includes both root-save generations and pending states, is consumed synchronously before asynchronous execution, and cannot be queued or reinstated by a stale settlement.
- Static analysis rejects mutation authority hidden behind renamed/computed members, imported wrappers, generic/indexed containers, fields, arguments, returns, closures, destructuring, or callable aliases. Traversal is cycle-safe and fails closed on indeterminate authority or resource exhaustion.
- Runtime interception covers the complete installed Obsidian mutation surface before application objects capture it. The fixed sequence proves no source mutation and only the intended destination creates.
- Diagnostics, settings, logs, and retained evidence exclude candidate/source content, rendered user notes, prompts, responses, credentials, absolute paths, usernames, machine/vault names, and real exports.
- UI sinks use text APIs; tests reject `innerHTML` use in the knowledge review surface.

## 7. Verification and runtime evidence

The current backlink-remediation gate ran targeted RED/GREEN suites, the exact `C2V_M05_MANUAL_FOCUS_WAIT_MS=60000 pnpm verify` aggregate, M06 boundary 95/95, and both official M06 9/9 rows against the rebuilt bundle. The aggregate passed formatting, lint, strict typecheck, core 312/312, plugin 751/751, build, both official M05 runtime rows, and the M06 artifact gate. Exact outcomes are recorded in `docs/21_M06_RUNTIME_GATE_REPORT.md`. Scope, privacy, hash, and self-review results are reported at the post-commit handoff.

The already-qualified official runtime matrix is:

- minimum: Obsidian 1.7.4, 9/9 scenarios, canonical packet SHA-256 `e6931279d6ef8a10aeddf29e137a8c5825e507a3b08d650c5bde2a18a782a535`;
- stable: Obsidian 1.13.7, 9/9 scenarios, canonical packet SHA-256 `1b99a84b88707c53185a0022d41d3558c0ff1202c393643be89c70baf7ad3c61`;
- both rows: two creates, two identical no-ops, one conflict, zero M06 provider calls, zero post-fixture source mutation attempts, and identical source SHA-256 before/after;
- qualified production artifacts: `main.js` SHA-256 `7921c29b3350a124e6ad4e087ac94c268eaa3297726d60fbba4a09a247ce3245`; `worker.js` SHA-256 `11916b26e7c0e74f308a87b3ad1ae59ef54070ff6e6f1203fb92000064d5abfc`.

## 8. Known limitations and residual gates

- Production qualification is limited to macOS desktop x86_64. Windows, Linux, mobile, and non-x86_64 macOS are unsupported by this milestone.
- Obsidian provides no transaction across multiple creates. Verified earlier files remain after a later failure; retry relies on exact-byte no-ops.
- M06 deduplicates only an identical target path with byte-identical content. It does not discover semantic or cross-path duplicates.
- Knowledge roots must already exist; M06 does not create destination folders.
- Source notes remain immutable, so they receive no forward links to knowledge notes.
- The native Keychain build retains the existing macOS Security-framework deprecation warning; M06 does not change that module.
- The exact M05 host focus assertion remains an operator-timing gate on future reruns; both rows passed in the current aggregate run without weakening the assertion.
- The final fresh independent R2 review is intentionally performed after the exact documentation commit by the parent task. Until it returns the required token, milestone acceptance remains conditional.

## 9. Explicit non-goals preserved

M07 deduplication/linking, M08 current-conversation capture, M09 historical batch migration, and M10 Community release hardening were not implemented. There is no semantic merge, related-note suggestion, source-note forward-link mutation, overwrite, rename, delete, rollback, cross-platform claim, deployment, release, or Community Plugin availability claim.

## 10. Next gate

Create the single authorized local Task 8 commit after the stabilized gates, then obtain one fresh independent R2 read-only review of that exact commit/tree. Push, pull request, merge, tag, deployment, release, Community Plugin submission, provider spend, and M07 remain separate Product Owner decisions.
