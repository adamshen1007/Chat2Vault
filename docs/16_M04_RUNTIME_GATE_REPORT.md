# Milestone 04 Runtime Gate Report

Version: 1.3
Date: 2026-08-28
Decision: **GO — M04 COMMIT READY**

## Objective and authority

This report closes the two-row macOS x86_64 runtime gate required by the exact approved `docs/M04_SPEC.md` v0.6 candidate. It qualifies the uncommitted M04 implementation candidate on the exact minimum Obsidian release and the independently resolved current official stable release without authorizing commit, publication, release, deployment, or M05 work.

- Repository root: Chat2Vault repository checkout (local absolute path withheld from review artifacts)
- Branch: `codex/milestone-04-implementation`
- Candidate base and uncommitted HEAD: `bfbce0f8eb5637ae82cfe6986bba2cc7a66a280e`
- M03 closure baseline: `994bdeabd5a30c343c0d5a4bcbd872c69e794f2b`
- Approved specification SHA-256: `12a6fdd8346b80e1b015c099b78c2d26c3b736b6d09dfecc55254d648df5193c`
- Host: macOS 15.7.7, x86_64
- Publication state: uncommitted; not pushed; no PR; not merged; not deployed or released

## Qualified production artifacts

Both rows loaded installed copies whose byte lengths and SHA-256 values matched the repository artifacts before any scenario ran.

| Artifact                                           | SHA-256                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/obsidian-plugin/main.js`                     | `d689161ab6984c4c29a64edaaa3ce7f60909f67ba4eb0e4b46b6cccc2c3725b1` |
| `apps/obsidian-plugin/worker.js`                   | `a81949633d2984f3ad801d579d388e7d0fdc055cada86a3db60b004116a1edc4` |
| `apps/obsidian-plugin/manifest.json`               | `e5fb0e963c510919e4206bbb5d873d75813f1e3d40bbe6e41a2d8fb5a242dfd9` |
| `apps/obsidian-plugin/styles.css`                  | `0165d12a23b3ed2bfc0cafb45124eb2fbaa77a14a10b13ba7daf3a6f2c1cd3e9` |
| `apps/obsidian-plugin/native/source_observer.node` | `ce334cb2dae22bb803bb0b9e5ef0b44b2359795e53b19c4852e837bfb04418f5` |

## Runtime matrix

| Row                  | Observed identity                                                                   | Functional matrix                                                 | Network                                                                         | Mutation                                                                                                    | UI and host zoom                                                 | Result |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| macOS minimum        | Obsidian 1.7.4; Electron 31.6.0; Chromium 126.0.6478.234; Node 20.17.0; darwin x64  | 34 named functional/race scenarios; every required status matched | Layer A `0`; 34 same-duration Layer-B pairs; all CSVs contain `0` external rows | M04 call count `0`; manifests identical; OS trace shows no non-metadata/non-positive-control vault mutation | 360/360 px; zoom `1 → 2 → 1`; exact seven-control focus sequence | PASS   |
| macOS current stable | Obsidian 1.13.7; Electron 39.8.3; Chromium 142.0.7444.265; Node 22.22.1; darwin x64 | 34 named functional/race scenarios; every required status matched | Layer A `0`; 34 same-duration Layer-B pairs; all CSVs contain `0` external rows | M04 call count `0`; manifests identical; OS trace shows no non-metadata/non-positive-control vault mutation | 360/360 px; zoom `1 → 2 → 1`; exact seven-control focus sequence | PASS   |

The official stable row was resolved as Obsidian 1.13.7 from the official `obsidianmd/obsidian-releases` desktop release metadata on 2026-08-27. The exact-minimum executable attempted its normal background download of the stable application archive; that profile-only artifact was isolated from the candidate and is not evidence of M04 network activity. The paired Layer-B windows contain no external connection rows in either idle or action capture.

## Scenario results

Both rows returned the same required statuses:

| Scenario                           | Required and observed status |
| ---------------------------------- | ---------------------------- |
| Prepare without selection          | `no-selection`               |
| Invalid request construction       | `request-invalid`            |
| Oversized/unrenderable prompt      | `prompt-too-large`           |
| Concurrent Prepare                 | `prepare-in-progress`        |
| Copy without active request        | `no-active-request`          |
| Prepare success                    | `prepared`                   |
| Clipboard permission denial        | `clipboard-denied`           |
| Clipboard failure                  | `clipboard-failed`           |
| Concurrent Copy                    | `copy-in-progress`           |
| Copy success                       | `copied`                     |
| Invalid JSON                       | `invalid`                    |
| Validate without active request    | `no-active-request`          |
| Concurrent Validate                | `validate-in-progress`       |
| Input supersession during Validate | `stale`                      |
| Hostile valid result               | `valid`                      |

Hostile candidate strings remained inert in both rows: no `script`, `img`, or `a` element was created; hostile text remained visible as text; pagination was present. The exact keyboard sequence was Prepare manual prompt → Copy prompt → Paste strict JSON → Validate result → Candidates per page → Previous → Next.

The supplemental runtime matrix also retained these 16 distinct stale/race outcomes on each row: import replacement during Copy; import clear during Validate; selection change during Copy; fingerprint change at the final pre-clipboard fence; fingerprint invalidation followed by a fresh Prepare before the old Copy settled; view close during Copy; plugin unload during Validate; stale request-builder rejection after a newer owner; stale prompt-renderer rejection after a newer owner; post-clipboard-invocation fulfillment, `NotAllowedError`, and generic rejection after invalidation; normal, clear, and over-limit textarea input during pending Validate; and an old Validate settlement after a newer Validate owner completed. Every old operation returned `stale`, retained no owner, and preserved the winning empty, prepared, invalid, or valid state recorded for that scenario.

## Privacy, network, and mutation attribution

Layer A instrumented renderer APIs, Node networking modules, Obsidian request APIs, resource attributes, and process-launch surfaces only during M04 actions. Each row recorded zero M04 events.

Layer B used privileged `nettop` process-family captures for every named runtime scenario. Each row retains 34 explicitly mapped pairs. Every pair has a two-sample, one-second-interval idle window immediately followed by an action window using the same arguments, sample count, and interval. Each window record retains scenario ID, scenario name, request time, idle/action start and end timestamps, and the matching idle/action filenames. All 136 CSVs contain exactly two schema-header samples and zero external connection rows. The two rows have identical ordered scenario names; no action-only destination exists.

Mutation attribution combined injected Vault, Adapter, FileManager, native `fs`, and `fs.promises` call instrumentation with privileged `fs_usage` traces and byte-level before/after manifests. Each row recorded:

- zero M04 mutation calls;
- byte-identical before/after vault manifests across the complete M04 action matrix;
- no OS-traced mutation outside Obsidian metadata and the later explicit M03 positive control;
- an observed M03 positive-control save with five instrumented mutations in the primary captures and a created synthetic source note.

The positive control proves the instrumentation could observe a real vault write. Its synthetic content contains no personal or imported user data.

## Evidence regeneration disclosure

The first review wrapper expired from temporary storage before ChatGPT accepted its bytes. The runtime gate was therefore repeated against the same unchanged production artifacts. Both regenerated primary rows use disposable synthetic vaults, explicitly dismiss Obsidian's one-time community-plugin trust surface as test setup before measuring focus, and retain the UI/zoom, mutation, Layer-A, and M03 positive-control evidence.

The independently retrievable v7 review found three evidence defects, not production-code defects: Layer-B windows were not same-duration or paired per scenario; the retained runtime JSON collapsed the invalidation/race matrix into one representative stale case; and the durable report misstated the 1.13.7 Chromium and Node component versions. A supplemental two-row capture against the same unchanged production artifact hashes now retains 34 same-duration network pairs per row plus 16 individually named runtime race outcomes. This report uses the raw runtime identity (`Chromium 142.0.7444.265`, `Node 22.22.1`) for the stable row. The original M03 positive controls remain the write-tripwire authority and were intentionally not repeated in the supplement. No implementation bytes changed.

## Evidence inventory and hashes

Raw evidence remains outside the repository and is packaged only in sanitized form for independent review.

| Evidence                                       | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Primary 1.7.4 runtime JSON                     | `77571428413f9e8274c23378b1949ab24aced9344e4e1687f2a1cb20d470601b` |
| Primary 1.7.4 screenshot                       | `b1df09cb25d60fc7b62edbc322be5c9cc868f1b41cbaed28c8bc9f71eb57b294` |
| Primary 1.7.4 sanitized filesystem trace       | `7161f8586dac2199f0798e1fa910cc7cd3d7bb0dc82e96dcd1cacf2313713cbc` |
| Supplemental 1.7.4 runtime JSON                | `4bab0d0bc499b98ae9fffef8133ecc4488225fce1cf9e0c3294188bc2e6b1630` |
| Supplemental 1.7.4 screenshot                  | `cc020268de63db72a053eb30581cc1f6724d9fd688d9b37b24bdaefec4b42445` |
| Supplemental 1.7.4 sanitized filesystem trace  | `36d8c949071fa10ee053d311f69b1957cb530af25f2dc111e6159947610b3354` |
| Supplemental 1.7.4 network manifest hash       | `607aa929e718cdfe8122231402ac694edc0972e3c755bb2ea689b0e7eeab3fb2` |
| Primary 1.13.7 runtime JSON                    | `88cadff48ffe700aecf2e0ff574b87ac2c8a8252ce993dd40c473691d32a0805` |
| Primary 1.13.7 screenshot                      | `9a5fdf8159ce8062141c73703917eff3e1a5d7b8d2af929835d590e0acb6229b` |
| Primary 1.13.7 sanitized filesystem trace      | `94b327d477be261dabc271dc7e1f88b0f9e42cf2142294662c96c8c5a758f8b6` |
| Supplemental 1.13.7 runtime JSON               | `008bd0c42b8b41292631f9378dcb41d91d3ddc6ae6df7911584c4b21467343f7` |
| Supplemental 1.13.7 screenshot                 | `7e7121fad94eec64d2a5ee4b1a356aa5ccf11d311cdc1c394b6a9ff9010648fb` |
| Supplemental 1.13.7 sanitized filesystem trace | `d99b323454d56a3908d433ba4bb1f368de6a970eedcb8491519687fa6c69e1e2` |
| Supplemental 1.13.7 network manifest hash      | `013f83760285bdce8fc9ee5ea13a5753ecdbc04581f73e09a37787c84b7b2e61` |

## Acceptance mapping

| Acceptance criteria | Runtime disposition                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| AC-01–AC-04         | PASS — deterministic request/prompt behavior and closed failure states exercised with exact installed artifacts               |
| AC-05               | PASS — explicit Copy success plus denial/failure/in-progress paths; zero network and final-current-request fences retained    |
| AC-06–AC-12         | PASS — invalid and hostile-valid paste behavior, inert rendering, atomic preview, and diagnostics exercised                   |
| AC-13–AC-14         | PASS — all operation ownership/arbitration states plus 16 named invalidation/race outcomes observed on both rows              |
| AC-15               | PASS — inert pagination, 360 px geometry, exact focus order, and 100%/200% host zoom on both rows                             |
| AC-16               | PASS — zero M04 mutation calls and identical complete manifests on both rows                                                  |
| AC-17               | PASS — both attributed network layers report zero M04 network activity on both rows                                           |
| AC-18               | PASS — injected mutation surfaces, OS traces, and manifests prove zero M04 vault mutation on both rows                        |
| AC-19               | PASS — prior final `CI=true pnpm verify` retained 438/438 tests and M01–M03 gates; positive-control saves worked on both rows |
| AC-20               | PASS — no M05+, release, unsupported-platform, or publication behavior was exercised or introduced                            |
| AC-21               | PASS — exact v8 independent `GO — M04 COMMIT READY` received on 2026-08-28                                                    |

## Risks, limitations, and decision

- Raw process traces are temporary review evidence rather than committed product artifacts. The review packet redacts local user paths while retaining process, timing, operation, and candidate-vault attribution.
- The regenerated rows explicitly close the one-time disposable-vault trust surface before measuring focus. This setup action is disclosed and occurs outside the M04 action-attribution phase.
- The automated full gate predates only documentation and temporary harness/evidence work. No production artifact was rebuilt or modified after the full gate or runtime captures.

The M04 two-row runtime qualification is **PASS**. The exact v8 packet (251 regular files; 1,161,874 bytes; SHA-256 `b5cc0c74e2ac76cab88e6a550490d8f6f6926812f2ff2a8f4072fc72ab0a5118`) received the independent verdict `GO — M04 COMMIT READY` on 2026-08-28 after verification of the wrapper, combined primary/supplemental runtime evidence, and AC-01 through AC-21. Commit, push, PR, merge, deployment, release, and M05 remain separately unauthorized and have not occurred.
