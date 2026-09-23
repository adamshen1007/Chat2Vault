# Milestone 06 Runtime Gate Report

Version: 0.3-second-remediation-candidate

Date: 2026-09-23

Decision: **PASS — Task 7 remediation is ready for a fresh independent R2 review; whole-M06 acceptance remains pending**

## Qualified candidate

This report records the remediated M06 capability boundary and two-row macOS x86_64 runtime qualification. It does not authorize publication, merge, deployment, release, Community Plugin submission, or M07 work.

- Repository: `Chat2Vault`
- Branch: `codex/milestone-06-design`
- Task 7 base: `eb625490e48fca996d5b64bf8ef9f32fec985f42`
- Reviewed Task 7 commit/tree: `e585939e494cbdb5d8fbef536c5446c70615062e` / `e02e2684754d40f04b22f56da4993186ef57aace`
- First remediation commit/tree: `ae80eb96ebc44b63010ad7a2bfb7d11d1822c5fa` / `d94265899baa290da81ab32bb1645dd280cb3739`
- Second remediation commit/tree: recorded in the ignored Task 7 execution report after commit; a tracked file cannot embed its own commit hash
- Upstream: none configured
- Host: macOS 15.7.9 (build 24G830), x86_64
- Development runtime: Node.js 24.16.0; pnpm 11.7.0
- Candidate input SHA-256: `bb95c304414b47a74ddd8f553484cf8723848b357283e62fc5d3982c82ec0c5c`
- Qualified production `main.js` SHA-256: `ab9d32ef8367094ca71182eb5c76dc6667253811b7c53d8f0fa20d4034599e02`
- Qualified worker SHA-256: `97d1e4f15d3e0600aaf554664075ba4469c96a6dbe5b89dcad65718777653735`
- Qualified runtime-only bundle SHA-256: `48abbd197d592d4393ad8e7df75e577ee849b0bdf16b58d7a8f31aa28a571a54`

Both rows used identical candidate, production bundle, worker, manifest, styles, and native artifacts. Generated bundles were built for qualification and restored to their committed bytes afterward.

## Remediated safety boundary

The aggregate `check:plugin` chain now retains every prior gate:

1. general production import, filesystem, DOM, execution, manifest, dependency, and committed-bundle checks;
2. worker smoke and M03 runtime contracts;
3. the dedicated M04 core/plugin clipboard and manual-view boundary;
4. M05 production boundaries and the SHA-per-input/provider-output-contribution runtime comparator;
5. M06 capability, mutation, privacy, and artifact checks.

The M06 checker parses TypeScript structure rather than comment substrings. It enforces the exact seven provider service keys and exact five knowledge adapter capabilities. Knowledge code cannot import provider/network/source-mutation authority. Its mutation authority is shared with the runtime ledger and covers the complete installed Obsidian API plus prior conservative aliases: `append`, `appendBinary`, `appendFile`, `copy`, `create`, `createBinary`, `createFolder`, `delete`, `mkdir`, `modify`, `modifyBinary`, `process`, `remove`, `rename`, `rm`, `rmdir`, `trash`, `trashFile`, `trashLocal`, `trashSystem`, `truncate`, `unlink`, `write`, `writeBinary`, and `writeFile`. Any reference or escape is denied, including assignment aliases, destructuring assignment, array/object indirection, computed access, optional access, and `.bind`/`.call`/`.apply`. The sole production exception is the exact two-argument destination call `this.#context.io.create(resolvedPath, content)` inside `createKnowledgeNote`.

The runtime-only ledger is installed before the production-like source and knowledge adapters can capture mutation functions. It wraps the same complete authority on both Vault and DataAdapter and records surface, method, relative path, phase, and whether an attempt was blocked. Source fixture creation is separately attributed; any later source-path attempt fails before mutation and remains in the ledger even when the caller catches the failure. The row predicate requires the exact ordered fixture/create/conflict sequence and rejects every extra mutation, including non-source relative paths and restored bytes. Adversarial tests cover assignment/destructuring/container escapes, computed and optional access, `.bind`/`.call`/`.apply`, all newly exposed APIs, and write-then-restore attempts. The synthetic source bytes flow through counted production-like I/O and match byte-for-byte before and after execution.

The runtime comparator hashes every shared input and verifies the exact provider-transport output contribution. It permits only the runtime entry, network seam, Keychain seam, M06 scenario seam, and M06 mutation-ledger seam. Byte-count equality alone cannot satisfy the gate.

## Official host provenance

The minimum row no longer relies on `Info.plist` version alone. The harness downloads the official DMG over HTTPS from the exact Obsidian release URL, retains its hash, mounts it read-only, and validates the unmodified app before instrumentation.

| Minimum provenance field       | Value                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| URL                            | `https://github.com/obsidianmd/obsidian-releases/releases/download/v1.7.4/Obsidian-1.7.4.dmg` |
| DMG bytes / SHA-256            | 186,389,186 / `af77521f1df2ec1ce36d6609c17c325827934726b68cb31587357b356a510dbe`              |
| Bundle version                 | `1.7.4`                                                                                       |
| Identifier / team              | `md.obsidian` / `6JSW4SJWN9`                                                                  |
| Leaf authority                 | `Developer ID Application: Dynalist Inc. (6JSW4SJWN9)`                                        |
| Designated requirement SHA-256 | `832b427b2192b9b5ef5051dbfe06a0d41080c165dec1bba1c1b98eb83d2e0f1a`                            |
| Gatekeeper assessment          | `accepted`; source `Notarized Developer ID`                                                   |

The stable row resolves official metadata at execution time, validates its GitHub asset URL, hashes the downloaded compressed asset, and hashes the decompressed ASAR actually loaded by the host.

| Stable provenance field        | Value                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Exact version                  | `1.13.7`                                                                                            |
| Metadata URL                   | `https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json`       |
| Metadata bytes / SHA-256       | 1,219 / `cca9f6dfba8b2b9ee7747189eb3bc3697ffe98898cf9d3a4b736e685d4841112`                          |
| Asset URL                      | `https://github.com/obsidianmd/obsidian-releases/releases/download/v1.13.7/obsidian-1.13.7.asar.gz` |
| Compressed bytes / SHA-256     | 8,773,048 / `69253e39aa0b980e3cf96e9e8a8a4bed6b6481ef7021cd762f67872662d8d25a`                      |
| Official metadata release hash | `aSU+OaoLmA48+W6eiopL7Wtkge9wIc12L2eHJmLY0lo=`                                                      |
| ASAR bytes / SHA-256           | 25,787,463 / `a52a7daf1e2460bae03de80f2816604bd16a56cd374fbe5ce8d1a9ef5604059d`                     |

## Runtime matrix

| Row     | Exact host identity                                                                 | Scenarios | Closed results                                                                             | Source SHA-256 before/after                                        | Canonical packet preimage                                                                                                                   | Result |
| ------- | ----------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Minimum | Obsidian 1.7.4; Electron 31.6.0; Chromium 126.0.6478.234; Node 20.17.0; darwin x64  |       9/9 | 2 created; 2 identical no-op; 1 conflict; provider delta 0; post-fixture source attempts 0 | `0d5e6873fd5a56b574cf7143f4ea2de7c5dfbd9b6188c4161ae3538fa9a7782c` | [`m06-runtime-minimum.json`](evidence/m06-runtime-minimum.json), SHA-256 `b111efdddcf985527b7396bcb80434977cafc9b287821261bf236e3dd0d45948` | PASS   |
| Stable  | Obsidian 1.13.7; Electron 39.8.3; Chromium 142.0.7444.265; Node 22.22.1; darwin x64 |       9/9 | 2 created; 2 identical no-op; 1 conflict; provider delta 0; post-fixture source attempts 0 | `0d5e6873fd5a56b574cf7143f4ea2de7c5dfbd9b6188c4161ae3538fa9a7782c` | [`m06-runtime-stable.json`](evidence/m06-runtime-stable.json), SHA-256 `1307e0a8a68a8c60aca78f47f119fe934036699f562201aa632f7fcdd3dc2d8c`   | PASS   |

The canonical JSON files are the exact sanitized packet preimages. Running `shasum -a 256` on each file reproduces the table values. They contain no trailing bytes outside the canonical JSON.

## Exact scenario ledger

Both rows returned `success` for exactly these unique IDs, in order. The acceptance predicate rejects duplicate, substituted, reordered, or counter-mismatched scenario evidence:

1. `review-accept-edit-reject`
2. `multi-select-dry-run`
3. `stale-preview-disabled`
4. `verified-create`
5. `idempotent-retry-no-op`
6. `conflict-refusal`
7. `source-backlink`
8. `source-note-unchanged`
9. `provider-not-called`

The unchanged production view, controller, executor, and `ObsidianKnowledgeVaultAdapter` operated on one synthetic source note and three synthetic candidates. Each runtime ledger contains exactly 12 ordered entries: the separately attributed fixture has Vault `createFolder` plus adapter `mkdir` for `Sources` and `Knowledge`, then Vault `create` plus adapter `write` for the source; `verified-create` has exactly two Vault `create` plus adapter `write` destination pairs; `conflict-fixture` has exactly one such pair. Dry-run, stale-plan refusal, identical retry, production conflict handling, backlink verification, source verification, and provider verification record zero mutations. The outer harness independently observed three post-fixture Vault creates.

The retained knowledge evidence is identical in both rows:

| Synthetic relative path                                     | Status                    | SHA-256                                                            |
| ----------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| `Knowledge/Synthetic edited runtime title--c9ac8ed3a692.md` | created / identical-no-op | `0ec7be9d691bdf119cc77b87bd73b8c779c798371787e67b63b7f3d143b18588` |
| `Knowledge/Synthetic runtime title 1--a4e2e375959f.md`      | created / identical-no-op | `4edf0cc2eced96c6015511badf3e5bc4ce8eb14313f74af0190eb4a7fc7498e7` |
| `Knowledge/Synthetic runtime title 3--019816a233ca.md`      | conflict                  | `c0bc8a1b49d08ce156003b729b8ee9eb6502dc2ab31b2c313c94da3a36c6881c` |

## Artifact identity

| Artifact                       |   Bytes | SHA-256                                                            |
| ------------------------------ | ------: | ------------------------------------------------------------------ |
| qualified `main.js`            | 234,883 | `ab9d32ef8367094ca71182eb5c76dc6667253811b7c53d8f0fa20d4034599e02` |
| qualified `worker.js`          |  19,397 | `97d1e4f15d3e0600aaf554664075ba4469c96a6dbe5b89dcad65718777653735` |
| `manifest.json`                |     251 | `e5fb0e963c510919e4206bbb5d873d75813f1e3d40bbe6e41a2d8fb5a242dfd9` |
| `styles.css`                   |   6,911 | `f89ce612b62c0f0dffdf9c0884e246a26791634e49c8eb94b2e8c188426afce3` |
| `native/source_observer.node`  |  41,352 | `ce334cb2dae22bb803bb0b9e5ef0b44b2359795e53b19c4852e837bfb04418f5` |
| `native/keychain.node`         |  66,376 | `3751f72aa872aa3baae527d3242df2f1750f8c6e13fc91b4ca1b6aad70459c1a` |
| runtime-only `runtime-test.js` | 277,118 | `48abbd197d592d4393ad8e7df75e577ee849b0bdf16b58d7a8f31aa28a571a54` |

## Verification ledger

| Command                                                                                                                                                                                        | Result                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Focused second-remediation RED run                                                                                                                                                             | RED: 3 failed suites; 23 failed and 645 passed tests, reproducing both findings |
| `pnpm exec vitest run apps/obsidian-plugin/test/m06-boundaries.test.ts apps/obsidian-plugin/test/m06-runtime-mutation-ledger.test.ts apps/obsidian-plugin/test/m06-runtime-acceptance.test.ts` | PASS: 3 files, 40 tests                                                         |
| `pnpm check:m06`                                                                                                                                                                               | PASS: AST boundary plus 27 M06 tests                                            |
| `node apps/obsidian-plugin/scripts/check-m06-runtime.mjs --row minimum --evidence-file docs/evidence/m06-runtime-minimum.json`                                                                 | PASS: official Obsidian 1.7.4, 9/9                                              |
| `node apps/obsidian-plugin/scripts/check-m06-runtime.mjs --row stable --evidence-file docs/evidence/m06-runtime-stable.json`                                                                   | PASS: official current stable 1.13.7, 9/9                                       |
| `pnpm typecheck`                                                                                                                                                                               | PASS: core and plugin                                                           |
| `pnpm lint`                                                                                                                                                                                    | PASS: full repository                                                           |
| `pnpm test`                                                                                                                                                                                    | PASS: core 304 tests and plugin 668 tests                                       |
| `pnpm build`                                                                                                                                                                                   | PASS: core and plugin; existing Security-framework deprecation warning only     |
| Generated-bundle restore followed by `pnpm check:plugin`                                                                                                                                       | PASS: full general/M03/M04/M05/M06 clean-state chain                            |
| `shasum -a 256 docs/evidence/m06-runtime-{minimum,stable}.json`                                                                                                                                | PASS: exact packet hashes reproduced                                            |

## Failure and remediation ledger

1. Independent R2 review found that the aggregate gate omitted general/M04/M05 artifact checks. The full prior chain is restored, with narrow exact M06 exceptions and adversarial retention tests.
2. Independent R2 review found static and dynamic source-mutation blind spots. The checker now covers all Vault/DataAdapter mutation forms and aliases; the runtime wraps both surfaces and fails source attempts before execution.
3. Independent R2 review found minimum provenance relied on `Info.plist`. Minimum now binds an authenticated official DMG hash and notarized signing identity; stable binds official metadata, compressed download, and loaded ASAR identities. Canonical tracked preimages make packet hashes independently reproducible.
4. The first fresh DMG extraction used APFS clone copying across the mounted image and failed with `Cross-device link`. Replacing only that extraction step with `ditto` preserved the signed app and passed validation.
5. The first real-row retry correctly stopped on a stale tracked generated bundle. A full plugin build established the qualified bundle identity; both rows then used it, and generated files were restored afterward.
6. Initial canonical files had a trailing newline, so file hashes differed from preimage hashes. The writer now emits exact canonical bytes, and both rows were rerun.
7. Self-review found the first designated-requirement hash included a disposable executable path because `codesign` split output across streams. Parsing is now restricted to the `designated =>` line; the deterministic hash above was produced by the final minimum-first execution.
8. The second R2 review found three omitted installed mutation APIs and reference-escape/runtime-sequencing bypasses. One canonical mutation authority now drives both checker and runtime, interception precedes view/adapter construction, and the exact 12-entry sequence is required.
9. The second R2 review found scenario identity was checked only by registry and length. The shared validator now requires ordered equality, uniqueness, exact outcome/counters, and matching observations; duplicate, substituted, reordered, and wrong-counter tests are green.
10. The first two second-remediation minimum attempts failed correctly because exact instrumentation exposed three unrelated Obsidian configuration writes during active scenario windows. A bounded 1.5-second inactive host-settle before scenario activation separated host initialization from M06 phases; the final minimum-first and stable-second rows contain no ignored or allowlisted extra mutation.

No macOS TCC prompt or human-only blocker remained.

## Privacy and scope review

All runtime data was synthetic. Retained evidence contains exact software/provenance and artifact identities, scenario IDs, relative paths, closed statuses/counts, mutation method names, phases, and hashes only. It contains no candidate/source content, prompt, response, credential, username, machine name, vault name, absolute path, real export, or screenshot. Privacy scans reject `/Users/`, repository/private temporary paths, the sentinel, and the inert credential.

The remediation changed only authorized Task 7 files plus the narrowly permitted prior gate/comparator/harness surfaces. Added files outside the original seven-file Task 7 scope are explicitly:

- `apps/obsidian-plugin/scripts/m06-runtime-provenance.mjs`
- `apps/obsidian-plugin/src/runtime-test-mutation-ledger.ts`
- `apps/obsidian-plugin/test/m06-runtime-mutation-ledger.test.ts`
- `apps/obsidian-plugin/test/m06-runtime-acceptance.test.ts`
- `apps/obsidian-plugin/test/m06-runtime-provenance.test.ts`
- `apps/obsidian-plugin/test/runtime-artifact-comparator.test.ts`
- `docs/evidence/m06-runtime-minimum.json`
- `docs/evidence/m06-runtime-stable.json`

Narrow existing pre-M06 surfaces modified to preserve prior guarantees are `check-plugin.mjs`, `check-m04-boundaries.mjs`, `check-m05-runtime.mjs`, and `compare-m05-runtime-artifact.mjs`. Provider, core, knowledge production behavior, native code, dependencies, lockfile, README/index/Task 8 documents, generated committed artifacts, and M07 remain unchanged.

The Task 7 remediation candidate is **GO for its authorized local commit and fresh independent R2 review**. Whole-M06 acceptance, publication, and M07 remain **NO-GO** until separate authorization.
