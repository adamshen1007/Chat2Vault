# Milestone 06 Runtime Gate Report

Version: 1.0 exact-candidate final gate

Date: 2026-09-26

Decision: **CONDITIONAL GO — final R2 remediation is green in targeted, full automated, boundary, build, and official M06 runtime verification; a fresh aggregate M05 focus row and independent R2 exact-candidate review remain**

## Qualified candidate

This report records the remediated M06 capability boundary, two-row macOS x86_64 runtime qualification, and final Task 8 full-candidate verification. It authorizes only the separately approved local Task 8 documentation commit. It does not authorize push, pull request, merge, deployment, release, Community Plugin submission, provider spend, or M07 work.

- Repository: `Chat2Vault`
- Branch: `codex/milestone-06-design`
- Task 7 base: `eb625490e48fca996d5b64bf8ef9f32fec985f42`
- Reviewed Task 7 commit/tree: `e585939e494cbdb5d8fbef536c5446c70615062e` / `e02e2684754d40f04b22f56da4993186ef57aace`
- First remediation commit/tree: `ae80eb96ebc44b63010ad7a2bfb7d11d1822c5fa` / `d94265899baa290da81ab32bb1645dd280cb3739`
- Second remediation commit/tree: `7ffbe404b3fa8649412c531ab0efab16fade8ba5` / `a0c4339dfb6838c629c2a0dfee8632abe57df061`
- Third remediation commit/tree: `ca79c1605772e94b8a575024dd2b5636cff9eecc` / `0afc9a0f9916abf90f525498eee5e89840f03129`
- Release-artifact remediation commit/tree: `1c3971ecf515a54b9c76a1915ca72f439f1c1948` / `e8438656521c9a256fe1bdef08170af9ea9c1c01`
- Structural-authority remediation commit/tree: `78d93fe8f0e34efbbf47a46fb109713ed581bf4e` / `548b1d80438040eb4af1722c7cc30a6e3f675a40`
- Fail-closed authority remediation commit/tree: `633bbaceeed6fd999a59c7fb9b07572cbea7f663` / `8402ae974ca992b2c4eeac8945c75a0d4b51e507`
- Structural-traversal remediation commit/tree: `841c47e224ca97e8de1f2d6cd4aebf4f4d7ed465` / `6c137055dacf86d6cc67a2672b9e58c0bad8a23f`
- Final indexed-authority remediation commit/tree: recorded in the ignored Task 7 execution report after commit; a tracked file cannot embed its own commit hash
- Task 8 input commit/tree: `a4c6698fdea185177d736836c8686e0c2060cbb1` / `87ce841bc509fc75d0afd825dd6fe62e1a3b30e9`
- Final Task 8 commit/tree: recorded in the ignored Task 8 execution report after commit; a tracked file cannot embed its own commit hash
- Upstream: none configured
- Host: macOS 15.7.9 (build 24G830), x86_64
- Development runtime: Node.js 24.16.0; pnpm 11.7.0
- Candidate input SHA-256: `bb95c304414b47a74ddd8f553484cf8723848b357283e62fc5d3982c82ec0c5c`
- Qualified production `main.js` SHA-256: `54371facb236c4e8a7f1195616207f64d915c3a3c26ee6d232a183672c4fbac4`
- Qualified worker SHA-256: `97d1e4f15d3e0600aaf554664075ba4469c96a6dbe5b89dcad65718777653735`
- Qualified runtime-only bundle SHA-256: `3a8a6d207fad298be31f2c34d046e6adc297108b272ca3dcd4081ac664913470`

Both rows used identical candidate, production bundle, worker, manifest, styles, and native artifacts. The generated `main.js` and `worker.js` were rebuilt from the final sources, matched the qualified identities above, and are retained for the authorized final Task 7 commit.

## Remediated safety boundary

The aggregate `check:plugin` chain now retains every prior gate:

1. general production import, filesystem, DOM, execution, manifest, dependency, and committed-bundle checks;
2. worker smoke and M03 runtime contracts;
3. the dedicated M04 core/plugin clipboard and manual-view boundary;
4. M05 production boundaries and the SHA-per-input/provider-output-contribution runtime comparator;
5. M06 capability, mutation, privacy, and artifact checks.

The aggregate gate now executes both official M05 runtime rows rather than substituting an artifacts-only check. The release-artifact predicate compares both tracked `main.js` and tracked `worker.js` against a fresh production build, and the M05 and M06 harnesses share one official-source preparer. Default focus behavior remains fail-fast and strict; the bounded `C2V_M05_MANUAL_FOCUS_WAIT_MS=60000` operator assist used for this qualification only extends the assertion window. Both rows still require the exact Obsidian `BrowserWindow` and its `webContents` to report focused.

M06 review mode structurally replaces the M05 candidate-preview/pagination surface. The host probe therefore asserts that the legacy preview and `Candidates per page` control are absent, exactly one synthetic M06 candidate is rendered, no source action is enabled for the unconfigured runtime fixture, and the complete focus order is `Prepare manual prompt` → `Copy prompt` → `Paste strict JSON` → `Distill with provider` → `Accept` → `Edit` → `Reject` → `0 diagnostics`, with exact reverse traversal to `Reject`. It does not skip arbitrary intervening controls or accept a count-only result.

The M06 checker parses TypeScript structure rather than comment substrings. It enforces the exact seven provider service keys and exact five knowledge adapter capabilities. Knowledge code cannot import provider/network/source-mutation authority. Its mutation authority is shared with the runtime ledger and covers the complete installed Obsidian API plus prior conservative aliases: `append`, `appendBinary`, `appendFile`, `copy`, `create`, `createBinary`, `createFolder`, `delete`, `mkdir`, `modify`, `modifyBinary`, `process`, `remove`, `rename`, `rm`, `rmdir`, `trash`, `trashFile`, `trashLocal`, `trashSystem`, `truncate`, `unlink`, `write`, `writeBinary`, and `writeFile`. Authority classification is structural: callable members are matched against that canonical surface and the exact Vault/DataAdapter runtime argument count, including optional, tuple-rest, and general-rest signatures while excluding an explicit TypeScript `this` parameter, then propagated through resolved repository declarations, imported non-root wrappers, type arguments, index-signature value types, properties, returns, and parameters independent of symbol or receiver spelling. Reference type arguments and every `checker.getIndexInfosOfType(type)` value are always inspected under the same type-identity cycle and fail-closed traversal-budget controls, including default-library generics, `Record`, string/number/symbol indexes, and nested indexed containers. Indeterminate callable signatures fail closed. A built-in mutation member is exempt only when that member's own declaration is in the TypeScript default library, plus the exact declaration-resolved Obsidian `Array.remove` augmentation; local global augmentations and repository-local types named `Array`, `Map`, `Object`, or `Promise` remain subject to structural classification while real unaugmented standard containers remain safe. Type-identity cycle detection replaces the former depth cutoff; deep imported envelopes remain fully traversed, and traversal-budget exhaustion both classifies as authority and fails the gate explicitly. Conservative authority taint rejects both forbidden member references and whole-authority transfer through renamed or nested objects, arrays, public/private fields, constructor assignment, destructuring, subsequent reads, function arguments/returns, closures, optional/computed chains, and `.bind`/`.call`/`.apply`; computed mutation calls are normalized by both the general and M06 gates. Necessary production construction and local read-only helper calls are admitted only when their types resolve to the exact existing plugin-adapter or Obsidian declarations and their syntax matches the existing exception; the sole mutation exception is the exact two-argument destination call `this.#context.io.create(resolvedPath, content)` inside `createKnowledgeNote`.

The subprocess-heavy boundary test file retains a bounded 15-second per-test timeout and now routes every checker child through one helper with an actual 15-second `execFileSync` timeout and `SIGKILL`. A regression launches a deliberately non-terminating child under a short test-only override and proves it is terminated with `ETIMEDOUT`; the default helper bound remains exactly 15 seconds. This changes no semantic assertion and prevents the exact named gate from hanging indefinitely. The final candidate passed the exact unmodified `pnpm check:m06` command twice consecutively.

The runtime-only ledger is installed before the production-like source and knowledge adapters can capture mutation functions. It wraps the same complete authority on both Vault and DataAdapter and records surface, method, relative path, phase, and whether an attempt was blocked. Source fixture creation is separately attributed; any later source-path attempt fails before mutation and remains in the ledger even when the caller catches the failure. The row predicate owns an independent fixed inventory: the exact source path/hash, five ordered knowledge records spanning exactly three unique paths with fixed hashes/statuses, and the exact 12-position method/path/phase ledger. It rejects wrong, duplicate, swapped, or status-mismatched paths and every extra mutation, including non-source relative paths and restored bytes. The synthetic source bytes flow through counted production-like I/O and match byte-for-byte before and after execution.

The runtime comparator hashes every shared input and verifies the exact provider-transport output contribution. It permits only the runtime entry, network seam, Keychain seam, M06 scenario seam, and M06 mutation-ledger seam. Byte-count equality alone cannot satisfy the gate.

The host harness uses bounded three-second inactive settle windows before ledger installation/fixture setup and before scenario activation. No mutation is filtered or allowlisted; interception is still installed before fixture, view, controller, or knowledge-adapter construction. This separates Obsidian's asynchronous profile initialization from the exact M06 phases while preserving fail-closed evidence for any mutation that occurs during them.

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
| Minimum | Obsidian 1.7.4; Electron 31.6.0; Chromium 126.0.6478.234; Node 20.17.0; darwin x64  |       9/9 | 2 created; 2 identical no-op; 1 conflict; provider delta 0; post-fixture source attempts 0 | `0d5e6873fd5a56b574cf7143f4ea2de7c5dfbd9b6188c4161ae3538fa9a7782c` | [`m06-runtime-minimum.json`](evidence/m06-runtime-minimum.json), SHA-256 `cca225740e3d2afb00c1d827117f92910aa31bc1a1d6f7dc32ea49b994f83003` | PASS   |
| Stable  | Obsidian 1.13.7; Electron 39.8.3; Chromium 142.0.7444.265; Node 22.22.1; darwin x64 |       9/9 | 2 created; 2 identical no-op; 1 conflict; provider delta 0; post-fixture source attempts 0 | `0d5e6873fd5a56b574cf7143f4ea2de7c5dfbd9b6188c4161ae3538fa9a7782c` | [`m06-runtime-stable.json`](evidence/m06-runtime-stable.json), SHA-256 `2d5a9eb67191877ca3c97edd4e5ca11f8b13a6785e5d0e5ca5eb085cd589442c`   | PASS   |

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
| qualified `main.js`            | 237,042 | `54371facb236c4e8a7f1195616207f64d915c3a3c26ee6d232a183672c4fbac4` |
| qualified `worker.js`          |  19,397 | `97d1e4f15d3e0600aaf554664075ba4469c96a6dbe5b89dcad65718777653735` |
| `manifest.json`                |     251 | `e5fb0e963c510919e4206bbb5d873d75813f1e3d40bbe6e41a2d8fb5a242dfd9` |
| `styles.css`                   |   6,911 | `f89ce612b62c0f0dffdf9c0884e246a26791634e49c8eb94b2e8c188426afce3` |
| `native/source_observer.node`  |  41,352 | `ce334cb2dae22bb803bb0b9e5ef0b44b2359795e53b19c4852e837bfb04418f5` |
| `native/keychain.node`         |  66,376 | `3751f72aa872aa3baae527d3242df2f1750f8c6e13fc91b4ca1b6aad70459c1a` |
| runtime-only `runtime-test.js` | 279,331 | `3a8a6d207fad298be31f2c34d046e6adc297108b272ca3dcd4081ac664913470` |

## Verification ledger

| Command                                                                                                                        | Result                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused third-remediation RED run                                                                                              | RED: 15 failed and 37 passed tests, reproducing both findings                                                                                                    |
| `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/m06-boundaries.test.ts test/m06-runtime-acceptance.test.ts`    | PASS: 2 files, 52 tests                                                                                                                                          |
| Structural-authority RED run                                                                                                   | RED: four authority escapes plus the aggregate computed-member regression                                                                                        |
| Structural-authority focused GREEN run                                                                                         | PASS: six focused boundary/aggregate tests                                                                                                                       |
| Fail-closed classifier RED run                                                                                                 | RED: eight intended failures; six read-only/cycle controls passed                                                                                                |
| Fail-closed classifier focused GREEN run                                                                                       | PASS: local shadows, signature bounds, deep wrappers, and recursive cycles                                                                                       |
| Structural-traversal follow-up RED run                                                                                         | RED: nine authority escapes plus the missing timeout guard                                                                                                       |
| Structural-traversal focused GREEN run                                                                                         | PASS: eleven focused negative/control/timeout tests                                                                                                              |
| Indexed-authority RED run                                                                                                      | RED: five whole-transfer escapes; computed/read-only controls stayed green                                                                                       |
| Indexed-authority and child-termination focused GREEN run                                                                      | PASS: twelve focused negative/control/termination tests                                                                                                          |
| `pnpm check:m06` (first consecutive run)                                                                                       | PASS: AST boundary plus 95 M06 tests                                                                                                                             |
| `pnpm check:m06` (second consecutive run)                                                                                      | PASS: AST boundary plus 95 M06 tests                                                                                                                             |
| `node apps/obsidian-plugin/scripts/check-m06-runtime.mjs --row minimum --evidence-file docs/evidence/m06-runtime-minimum.json` | PASS: official Obsidian 1.7.4, 9/9                                                                                                                               |
| `node apps/obsidian-plugin/scripts/check-m06-runtime.mjs --row stable --evidence-file docs/evidence/m06-runtime-stable.json`   | PASS: official current stable 1.13.7, 9/9                                                                                                                        |
| `pnpm typecheck`                                                                                                               | PASS: core and plugin                                                                                                                                            |
| `pnpm lint`                                                                                                                    | PASS: full repository                                                                                                                                            |
| Final source-root/provenance RED reproductions                                                                                 | RED: pending-save installation, both settlement outcomes, stale-plan execution, and `#` path rendering reproduced                                                |
| Final source-root/provenance focused GREEN runs                                                                                | PASS: core render 7/7, controller 26/26, and view 30/30                                                                                                          |
| `pnpm test`                                                                                                                    | PASS: core 305 tests and plugin 751 tests                                                                                                                        |
| `pnpm build`                                                                                                                   | PASS: core and plugin; existing Security-framework deprecation warning only                                                                                      |
| `C2V_M05_MANUAL_FOCUS_WAIT_MS=60000 pnpm check:plugin`                                                                         | BLOCKED: all preceding gates passed; exact minimum BrowserWindow/webContents focus assertion failed closed after 60 seconds                                      |
| `shasum -a 256 docs/evidence/m06-runtime-{minimum,stable}.json`                                                                | PASS: exact packet hashes reproduced                                                                                                                             |
| `node --version`                                                                                                               | PASS: `v24.16.0`                                                                                                                                                 |
| `pnpm --version`                                                                                                               | PASS: `11.7.0`                                                                                                                                                   |
| Task 8 targeted core suite                                                                                                     | PASS: 3 files, 42 tests                                                                                                                                          |
| Task 8 targeted plugin suite                                                                                                   | PASS: 4 files, 170 tests, including M06 boundary 95/95                                                                                                           |
| `C2V_M05_MANUAL_FOCUS_WAIT_MS=60000 pnpm verify` (two fresh final-remediation attempts)                                        | BLOCKED: format, lint, strict typecheck, core 305/305, plugin 751/751, and build passed; first attempt failed closed at stable focus and second at minimum focus |

The final R2-remediation candidate rebuilt the production artifacts and passed both official M06 rows independently: minimum Obsidian 1.7.4 and current stable Obsidian 1.13.7 each reached `complete` with 9/9 scenarios. The exact M06 boundary gate passed 95/95, and the retained production `main.js` SHA-256 is `54371facb236c4e8a7f1195616207f64d915c3a3c26ee6d232a183672c4fbac4` with runtime-only bundle SHA-256 `3a8a6d207fad298be31f2c34d046e6adc297108b272ca3dcd4081ac664913470`.

A fresh aggregate `pnpm verify` has not exited 0 for this remediation candidate. Two attempts passed every automated stage through build and then failed closed only at the macOS focus assertion: the first at stable after minimum completed, the second at minimum. A separate `check:plugin` retry using PID-targeted System Events activation also failed the independent minimum `BrowserWindow`/`webContents` assertion. No focus predicate was weakened and no evidence was fabricated; a timely physical foreground click remains required to close this aggregate row.

## Failure and remediation ledger

1. Independent R2 review found that the aggregate gate omitted general/M04/M05 artifact checks. The full prior chain is restored, with narrow exact M06 exceptions and adversarial retention tests.
2. Independent R2 review found static and dynamic source-mutation blind spots. The checker now covers all Vault/DataAdapter mutation forms and aliases; the runtime wraps both surfaces and fails source attempts before execution.
3. Independent R2 review found minimum provenance relied on `Info.plist`. Minimum now binds an authenticated official DMG hash and notarized signing identity; stable binds official metadata, compressed download, and loaded ASAR identities. Canonical tracked preimages make packet hashes independently reproducible.
4. The first fresh DMG extraction used APFS clone copying across the mounted image and failed with `Cross-device link`. Replacing only that extraction step with `ditto` preserved the signed app and passed validation.
5. The first real-row retry correctly stopped on a stale tracked generated bundle. A full plugin build established the qualified bundle identity; both rows then used it. The earlier review phase restored generated files, while the final release-artifact remediation rebuilt and retained the exact qualified `main.js` and `worker.js` bytes for commit.
6. Initial canonical files had a trailing newline, so file hashes differed from preimage hashes. The writer now emits exact canonical bytes, and both rows were rerun.
7. Self-review found the first designated-requirement hash included a disposable executable path because `codesign` split output across streams. Parsing is now restricted to the `designated =>` line; the deterministic hash above was produced by the final minimum-first execution.
8. The second R2 review found three omitted installed mutation APIs and reference-escape/runtime-sequencing bypasses. One canonical mutation authority now drives both checker and runtime, interception precedes view/adapter construction, and the exact 12-entry sequence is required.
9. The second R2 review found scenario identity was checked only by registry and length. The shared validator now requires ordered equality, uniqueness, exact outcome/counters, and matching observations; duplicate, substituted, reordered, and wrong-counter tests are green.
10. The first two second-remediation minimum attempts failed correctly because exact instrumentation exposed three unrelated Obsidian configuration writes during active scenario windows. A bounded 1.5-second inactive host-settle before scenario activation separated host initialization from M06 phases; the final minimum-first and stable-second rows contain no ignored or allowlisted extra mutation.
11. The third R2 review found that whole writer authority could still cross container/class/function boundaries. Ten RED probes reproduced nested object, array, public/private field, constructor, return/pass-through, closure, destructuring, and optional-computed chains. Conservative authority taint plus narrow structural production exceptions closes them.
12. The third R2 review found expected paths and hashes were derived from evidence under validation. The validator now owns the fixed synthetic source and three-path knowledge inventory; five negative tests cover wrong, duplicate, swapped, wrong-hash, and status/path-mismatch evidence.
13. Two third-remediation stable attempts failed closed on asynchronous Obsidian profile writes: `.obsidian/workspace.json` during `conflict-fixture`, then `.obsidian/core-plugins.json` during `fixture-setup`. Bounded three-second inactive settles were added before fixture setup and scenario activation, still before M06 object construction. The final minimum-first/stable-second run passed without filtering or allowlisting either path and produced the canonical packets above.
14. The release gate previously compared tracked `main.js` but not tracked `worker.js`, and aggregate `check:plugin` invoked M05 in artifacts-only mode. One shared tracked-release comparator now binds both artifacts, and the aggregate executes both official M05 rows before the M06 boundary and artifact gates.
15. The first full two-row M05 execution exposed the frozen M05 focus expectation after M06 replaced the candidate-preview surface. The final probe asserts the complete deterministic M06 review-mode focus sequence and exact reverse edge, plus structural absence of legacy pagination, on both official hosts.
16. macOS did not grant programmatic focus reliably on every attempt. The final run used the bounded operator-assist window, but evidence was accepted only after both the exact `BrowserWindow` and exact `webContents` focus assertions passed.
17. The fresh R2 review found that nominal/root-limited authority detection could miss a renamed structural writer, computed writer calls, and a wrapper declaration resolved outside explicit root names. Four RED probes reproduced the single-root imported envelope, renamed `writer["write"]`, combined `Envelope.writer["write"]`, and whole-object transfer escapes. Canonical structural classification, recursive resolved-declaration propagation, computed-member normalization, and declaration-resolved exact exceptions close them; the aggregate regression also locks the general gate path.
18. The R2 re-review found three classifier fail-open edges: built-in exemptions used owner spelling, callable arity ignored optional/rest acceptance, and recursion returned safe after a fixed depth. Eight RED results reproduced four local built-in-name shadows, three optional/rest writers, and an imported 18-layer envelope. Default-library symbol resolution, exact signature bounds with indeterminate fail-closed handling, type-identity cycle detection, and explicit fail-closed resource exhaustion close the findings; read-only standard containers, incompatible mutation shapes, and recursive read-only graphs remain non-authority.
19. The next R2 re-review found four remaining edges: generic arguments were skipped for default-library containers, merged symbols exempted local global mutation augmentations, explicit `this` inflated runtime arity, and subprocess-heavy probes retained Vitest's unreliable five-second default. Nine RED authority cases plus the timeout guard reproduced the findings. Reference arguments now traverse before container eligibility, exemption is based on each mutation declaration's own source with one exact Obsidian augmentation, explicit `this` is excluded, and the file uses a bounded 15-second timeout. Both final unmodified `pnpm check:m06` runs passed 84/84.
20. The latest R2 re-review found that whole indexed containers could hide writer authority and that Vitest's timeout could not terminate a synchronous child. Five RED whole-transfer probes reproduced `Record`, string, number, symbol, and nested indexed escapes while computed extraction and read-only indexed controls stayed green. Every index-info value now traverses under existing cycle/budget controls, and every boundary child uses the centralized real 15-second subprocess timeout with `SIGKILL`; an actual non-terminating-child regression proves termination. Both exact unmodified `pnpm check:m06` runs passed 95/95.
21. Three earlier Task 8 full-gate attempts reached the minimum `ui-main-focus` stage but failed closed because the macOS foreground click was not delivered during the bounded operator-assist window. They were operator-timing failures, not product failures. The final Task 8 run delivered the cues at the emitted minimum and stable focus stages; both exact `BrowserWindow` and `webContents` assertions passed, both rows completed, and `pnpm verify` exited 0.
22. Final R2 review found that a fresh candidate could be installed during a pending source-root save and then previewed or written under the previous settled root because M06 authority carried only the knowledge-root generation/pending state. Controller authority now carries the source-save generation plus both root pending states; candidate installation, preview, and Write fail closed while either save is pending, and stale plans are fenced across source-save start and either settlement outcome. RED/GREEN controller and UI tests cover pending installation, success/failure settlement, and stale-plan execution.
23. Final R2 review found that valid source roots or filenames containing `#` produced a wikilink that Obsidian interpreted as a heading subpath. Rendering now retains wikilinks for ordinary paths and uses an exact standard Markdown link with a percent-encoded destination for `#` paths. Core golden coverage and Obsidian view/write integration cover `#` in both a root and filename.
24. Fresh aggregate verification for the final R2 remediation passed formatting, lint, strict typecheck, core 305/305, plugin 751/751, and build twice, but macOS did not deliver a foreground focus event inside the bounded M05 operator window. A direct PID-targeted System Events activation also failed the host's independent focus assertion. The gate remained fail-closed; the separately executed official M06 minimum and stable rows both passed 9/9 and regenerated the canonical packets.

No macOS TCC prompt remained. A visible operator click was required only to satisfy the strict focus assertion during the bounded qualification window.

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

Narrow existing pre-M06 surfaces modified to preserve prior guarantees are `check-plugin.mjs`, `check-m04-boundaries.mjs`, `check-m05-runtime.mjs`, and `compare-m05-runtime-artifact.mjs`. The final qualified generated `main.js` and `worker.js` are intentionally included. This final R2 remediation changes only the core provenance renderer, knowledge-controller/view authority wiring, corresponding synthetic tests, generated bundles, evidence, and these implementation/runtime documents. Provider behavior, native source, dependencies, lockfile, README/index, and M07 remain unchanged.

The final R2-remediation candidate is **GO for the separately authorized local remediation commit**. Whole-M06 acceptance remains conditional on a fresh aggregate focus completion and independent R2 exact-candidate review. Push, pull request, merge, tag, deployment, release, Community Plugin submission, provider spend, and M07 remain **NO-GO** until separately authorized.
