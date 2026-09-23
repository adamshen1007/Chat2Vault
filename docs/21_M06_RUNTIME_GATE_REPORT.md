# Milestone 06 Runtime Gate Report

Version: 0.1-candidate

Date: 2026-09-23

Decision: **PASS — Task 7 commit ready; whole-M06 independent review remains pending**

## Qualified candidate

This report records the exact Task 7 capability boundary and two-row macOS x86_64 runtime qualification. It does not authorize publication, merge, deployment, release, Community Plugin submission, or M07 work.

- Repository: `Chat2Vault`
- Branch: `codex/milestone-06-design`
- Task 7 base/initial HEAD: `eb625490e48fca996d5b64bf8ef9f32fec985f42`
- Base tree: `99217ecab7f1c6a49c54228cbfe8cbb472c47707`
- Final commit/tree identity is recorded in the ignored Task 7 execution report after commit; embedding a commit's own hash in a tracked file is not possible.
- Upstream: none configured
- Host: macOS 15.7.9 (build 24G830), x86_64
- Development runtime: Node.js 24.16.0; pnpm 11.7.0
- Approved M06 design SHA-256: `5b1a89e02247750908477beb5b0837f0c5c97482608d3178c0093c3de963c0b4`
- Task 7 brief SHA-256: `b8ca12c39b6bdbff685eed564f8bb300b4c3cd42480a9f38992a46c77627e3aa`
- Approved implementation plan SHA-256: `05487a494df538e0e4588ae73d3818c4bde105f4d01247a22e4f4c1ff28fa7bd`
- Production `main.js` SHA-256: `ab9d32ef8367094ca71182eb5c76dc6667253811b7c53d8f0fa20d4034599e02`
- Runtime-only bundle SHA-256: `e5c287bc521b62d730b2c6b550eee8b54060af8f7ad6db215ee05ff31883b209`
- Candidate input SHA-256: `bb95c304414b47a74ddd8f553484cf8723848b357283e62fc5d3982c82ec0c5c`

Both rows loaded byte-identical candidate and production artifacts. The runtime graph differs only by the approved runtime entry, network seam, Keychain seam, and M06 scenario seam. Generated production bundles were built for qualification and restored to their committed bytes before the Task 7 commit.

## Safety boundary

The syntax-aware M06 checker parses TypeScript ASTs, so comments and inert substring matches cannot satisfy or violate the policy. It enforces:

- the exact provider service keys `buildRequest`, `current`, `onCandidatesChanged`, `parseResponse`, `readCredential`, `transport`, and `validateResult`;
- the exact knowledge adapter capabilities `resolveKnowledgeSources`, `observeKnowledgeTarget`, `checkpointKnowledgeTarget`, `createKnowledgeNote`, and `readKnowledgeNote`;
- no provider-to-knowledge, knowledge-to-provider/network, adapter modify/rename/delete, source-note mutation, production runtime-seam import, candidate-content logging, or candidate-content settings persistence;
- one create-only adapter call, closed M06 diagnostics, settings-only `saveData`, one clipboard write, and the retained M04/M05 provider isolation constraints.

The dynamic boundary tests prove dry-run and conflict paths make zero mutation, the writer receives no provider/network capability, source bytes remain unchanged, and a sentinel candidate body is absent from diagnostics, settings, and captured logs.

## Runtime matrix

| Row     | Exact host identity                                                                 | Scenarios | Closed results                                             | Source hash                                                                     | Artifact packet                                                    | Result |
| ------- | ----------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| Minimum | Obsidian 1.7.4; Electron 31.6.0; Chromium 126.0.6478.234; Node 20.17.0; darwin x64  | 9/9       | 2 created; 2 identical no-op; 1 conflict; provider delta 0 | `0d5e6873fd5a56b574cf7143f4ea2de7c5dfbd9b6188c4161ae3538fa9a7782c` before/after | `242380f8e6b1be09b7b03b8dbe7e32b4f4e5520348fc13368d54693de9ddc322` | PASS   |
| Stable  | Obsidian 1.13.7; Electron 39.8.3; Chromium 142.0.7444.265; Node 22.22.1; darwin x64 | 9/9       | 2 created; 2 identical no-op; 1 conflict; provider delta 0 | `0d5e6873fd5a56b574cf7143f4ea2de7c5dfbd9b6188c4161ae3538fa9a7782c` before/after | `30e67804380fa49f88b0df9e61ce4f183a128e1ab15b9190c5f21e9f283ee730` | PASS   |

The official stable metadata resolved during both executions to Obsidian 1.13.7. Its metadata was 1,219 bytes with SHA-256 `cca9f6dfba8b2b9ee7747189eb3bc3697ffe98898cf9d3a4b736e685d4841112`; the selected asset was `obsidian-1.13.7.asar.gz`, and the decompressed ASAR SHA-256 was `a52a7daf1e2460bae03de80f2816604bd16a56cd374fbe5ce8d1a9ef5604059d`.

The identical retained knowledge evidence in both rows was:

| Synthetic relative path                                     | Status          | SHA-256                                                            |
| ----------------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| `Knowledge/Synthetic edited runtime title--c9ac8ed3a692.md` | created         | `0ec7be9d691bdf119cc77b87bd73b8c779c798371787e67b63b7f3d143b18588` |
| `Knowledge/Synthetic runtime title 1--a4e2e375959f.md`      | created         | `4edf0cc2eced96c6015511badf3e5bc4ce8eb14313f74af0190eb4a7fc7498e7` |
| `Knowledge/Synthetic edited runtime title--c9ac8ed3a692.md` | identical-no-op | `0ec7be9d691bdf119cc77b87bd73b8c779c798371787e67b63b7f3d143b18588` |
| `Knowledge/Synthetic runtime title 1--a4e2e375959f.md`      | identical-no-op | `4edf0cc2eced96c6015511badf3e5bc4ce8eb14313f74af0190eb4a7fc7498e7` |
| `Knowledge/Synthetic runtime title 3--019816a233ca.md`      | conflict        | `c0bc8a1b49d08ce156003b729b8ee9eb6502dc2ab31b2c313c94da3a36c6881c` |

## Exact scenario ledger

All nine scenario IDs returned `success` in both rows:

1. `review-accept-edit-reject`
2. `multi-select-dry-run`
3. `stale-preview-disabled`
4. `verified-create`
5. `idempotent-retry-no-op`
6. `conflict-refusal`
7. `source-backlink`
8. `source-note-unchanged`
9. `provider-not-called`

The sequence used one synthetic source note and three synthetic candidates through the production view, controller, executor, and `ObsidianKnowledgeVaultAdapter`. UI controls performed accept, bounded edit/save, reject, selection, dry-run, invalidation, re-preview, write, retry, and conflict refusal. The created notes contained the trusted source backlink. The source note retained the same exact byte hash before and after every action.

Each row observed four total harness-level Vault mutations: the synthetic source fixture create, two authorized knowledge creates, and one deliberate conflict-fixture create. Dry-run, stale-plan refusal, no-op retry, and production conflict handling added zero mutation. Each row also observed one attributed M05 setup provider request before the M06 provider baseline, zero M06 provider-call delta, zero background request, and zero settings-persistence attempt.

## Artifact identity

| Artifact                       |   Bytes | SHA-256                                                            |
| ------------------------------ | ------: | ------------------------------------------------------------------ |
| `main.js`                      | 234,883 | `ab9d32ef8367094ca71182eb5c76dc6667253811b7c53d8f0fa20d4034599e02` |
| `worker.js`                    |  19,397 | `97d1e4f15d3e0600aaf554664075ba4469c96a6dbe5b89dcad65718777653735` |
| `manifest.json`                |     251 | `e5fb0e963c510919e4206bbb5d873d75813f1e3d40bbe6e41a2d8fb5a242dfd9` |
| `styles.css`                   |   6,911 | `f89ce612b62c0f0dffdf9c0884e246a26791634e49c8eb94b2e8c188426afce3` |
| `native/source_observer.node`  |  41,352 | `ce334cb2dae22bb803bb0b9e5ef0b44b2359795e53b19c4852e837bfb04418f5` |
| `native/keychain.node`         |  66,376 | `3751f72aa872aa3baae527d3242df2f1750f8c6e13fc91b4ca1b6aad70459c1a` |
| runtime-only `runtime-test.js` | 274,309 | `e5c287bc521b62d730b2c6b550eee8b54060af8f7ad6db215ee05ff31883b209` |

## Verification ledger

| Command                                                                                  | Result                                                                                                    |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/m06-boundaries.test.ts`  | PASS: 1 file, 6 tests                                                                                     |
| `pnpm check:m06`                                                                         | PASS: syntax-aware boundary plus 7/7 dynamic/contract tests                                               |
| `pnpm check:m06:runtime -- --artifacts-only`                                             | PASS: production/runtime graph identity and approved seam delta                                           |
| `C2V_M05_OBSIDIAN_174_APP=<official-1.7.4-copy> pnpm check:m06:runtime -- --row minimum` | PASS: Obsidian 1.7.4, all 9 scenarios                                                                     |
| `C2V_M05_OBSIDIAN_174_APP=<official-1.7.4-copy> pnpm check:m06:runtime -- --row stable`  | PASS: official current stable 1.13.7, all 9 scenarios                                                     |
| `pnpm --filter @chat2vault/obsidian-plugin typecheck`                                    | PASS: `tsc --noEmit`                                                                                      |
| `pnpm --filter @chat2vault/obsidian-plugin build`                                        | PASS: native modules, worker, and production bundle; existing Security-framework deprecation warning only |
| `pnpm check:plugin`                                                                      | PASS: worker, M03 contracts, retained M05 boundary, M06 boundary, and M06 artifact identity               |
| `pnpm --filter @chat2vault/obsidian-plugin test`                                         | PASS: 27 files, 627 tests                                                                                 |
| `pnpm lint`                                                                              | PASS: full repository, zero findings                                                                      |
| `pnpm exec prettier --check <Task-7-owned files>`                                        | PASS: all Task 7 files formatted                                                                          |
| `pnpm format:check`                                                                      | Pre-existing baseline remains red only for ignored Task 1–6 briefs/reports and the Task 7 brief           |

## Failures and remediation

The first minimum-row launch found that the inherited M05 harness supplied the temporary vault through macOS's `/var` symlink. The production native observer intentionally uses `FSOPT_NOFOLLOW_ANY`, so it returned `indeterminate` and the writer failed closed with `KNOWLEDGE_SOURCE_STALE`. The M06 wrapper now canonicalizes only the disposable harness root with `realpath` before Obsidian launch. This is not a production fallback and does not alter native, adapter, controller, or UI behavior.

The first clean-check after generated-bundle restoration found that the inherited artifact-only path still consumed stale committed `worker.js` and required stale committed `main.js` to equal a fresh source build. The M06 wrapper now compiles the worker into its disposable directory for both sides of the comparison and omits only the tracked-`main.js` equality assertion in `--artifacts-only` mode. Real runtime rows retain that assertion. A seventh boundary regression test locks this clean-state contract; final clean-state `pnpm check:plugin` reproduces the exact qualified production/runtime hashes.

The first successful scenario execution was then followed by an unrelated inherited M05 host-focus/zoom exercise. Task 7 does not claim M05 accessibility or zoom evidence, so the transformed M06 driver no longer invokes that legacy exercise. It still uses the existing real-Obsidian launch, trust, instrumentation, artifact, cleanup, network, and mutation harness.

No macOS TCC prompt or human-only action remained. The initial cached 1.7.4 application was incomplete, so a fresh official 1.7.4 DMG was downloaded, mounted read-only, copied to a disposable location, validated as version 1.7.4, and used for the minimum row.

## Privacy and synthetic-data review

All vault data was authored synthetic data. Retained evidence contains only scenario IDs, closed outcomes, counts, SHA-256 values, exact software identities, artifact identities, and synthetic vault-relative paths. The harness rejects repository paths, `/Users/` paths, the candidate sentinel, and non-relative retained knowledge paths. It retains no candidate content, source content, prompt, response, credential, username, machine name, vault name, absolute path, real export, or screenshot. Disposable vaults, profiles, host copies, certificates, and Keychains are removed in `finally` paths.

## Scope, limitations, and decision

- Task 7 changes only the authorized boundary/runtime scripts and tests, runtime-only entry/seam, root scripts, and this report.
- Provider, core, knowledge production behavior, native code, committed generated bundles, README/index/Task 8 documents, and M07 remain unchanged.
- Qualification is macOS x86_64 only. It makes no Apple Silicon, Windows, Linux, mobile, IPv6, real-provider, release, or deployment claim.
- Green Task 7 gates are evidence, not whole-milestone authority. Independent R2 whole-candidate review remains Task 8.

The Task 7 safety and two-row runtime gate is **PASS**. The bounded Task 7 candidate is **GO for its authorized local commit**. Whole-M06 acceptance and any publication remain **NO-GO pending Task 8 independent review and separate authorization**.
