# M02 Runtime Closure Report

Status: **runtime closure complete; independent final review required**  
Date: 2026-08-11  
Milestone: M02 — local Obsidian import preview

## 1. Decision

`GO — M02 RUNTIME CLOSURE COMPLETE; INDEPENDENT FINAL REVIEW REQUIRED`

All AC-01 through AC-32 pass against the approved amended specification and the required runtime matrix: exact Obsidian Desktop 1.7.4 plus exact public stable 1.13.6. No BLOCKED, UNPROVEN, or NOT VERIFIED result remains. This decision closes the runtime-evidence task only. It does not authorize a commit, push, tag, merge, release, deployment, publication, plugin submission, or M03 work.

## 2. Authority identity

- Repository: `/Users/adam/Developer/Chat2Vault`
- Branch: `codex/milestone-02`
- HEAD: `1f03110b03e07bccba5503303c510518c86773bd`
- Upstream: none configured for `codex/milestone-02`
- M01 tag `chat2vault-m01-complete-v0.1`: `1f03110b03e07bccba5503303c510518c86773bd`
- Approved M02 specification: version 0.5.1
- `docs/M02_SPEC.md` SHA-256: `44e2a6ac95dce4d3fa39f09bb773ab9fde36e176c8cf5a25db7c8932e041a68c`
- Governing closure prompt: `CODEX_M02_RUNTIME_CLOSURE_PROMPT_v2.md`

The authority identity matched the hard start gate. The working tree already contained the uncommitted M02 implementation and documentation before closure; those user-owned changes were preserved.

## 3. Official public version metadata

Official `obsidianmd/obsidian-releases` metadata was fetched at `2026-08-11T03:33:43Z` before final native execution. It reported:

```text
public latestVersion = 1.13.6
beta latestVersion   = 1.13.6
```

The metadata response is `/tmp/chat2vault-m02-runtime-closure/evidence/desktop-releases-2026-08-11.json` (SHA-256 `ccd359e328c13398d2c00f0f4419a57298aec38518d8635509da40909eaac1d2`). Its official archive URL is `https://github.com/obsidianmd/obsidian-releases/releases/download/v1.13.6/obsidian-1.13.6.asar.gz`. Consequently, 1.13.6—not the prompt's preparation-time 1.12.7—is the required public-stable row. Earlier exact-1.13.4 evidence remains supplementary historical beta/Catalyst evidence and is not counted toward closure.

## 4. Implementation reconciliation

The declared public minimum is now exactly `1.7.4`. References to 1.7.2 are retained only as historical deferred-view introduction evidence. The finalized historical report `docs/10_M02_RUNTIME_GATE_REPORT.md` was not edited.

Runtime defects found during closure were remediated with the smallest M02-scoped changes:

- browser-worker input buffers are transferred instead of cloning as much as 128 MiB in the renderer;
- browser-worker diagnostics are returned in paced chunks of 250, preventing a single large renderer handoff;
- immutable conversation ordering is cached by result-array identity, keeping 10,000-row filter redraws bounded;
- list/content containment and a narrow-container layout prevent 200% zoom and 360 px overflow;
- tests cover transfer lists, chunk assembly, ordering-cache reuse, and containment/layout rules.

No M01 parser semantics changed. No vault-note writer, provider, LLM, telemetry, remote code, mobile feature, packaging, submission, or M03 behavior was added.

Final production artifacts used unchanged in both required vaults:

| Artifact        | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| `main.js`       | `410804236a6500b3ab5d16c7314f8fb5be25cedbb1deb1ff2ec7b0b3ded945a5` |
| `worker.js`     | `cf84e931aa1b1377fdb3ed425a12a6d64616a91e6f43a749dd38bc3ce54219c2` |
| `manifest.json` | `bcd5b861b6c63dd33d1764a8994a4194169b71aaf505c7d1bac8f3c97b851ff6` |
| `styles.css`    | `246f532b708f87ca551ea349c1a0d3ce802aeb6267613a7ab03af41913590ab3` |

## 5. Automated verification

Test machine: MacBookPro15,2; Intel Core i7 2.7 GHz; 4 cores/8 logical CPUs; 16 GB RAM; macOS 15.7.7 (24G720), x86_64. Serial number and hardware UUID are excluded. Repository tooling used Node.js v24.16.0 and pnpm 11.7.0.

| Command                          | Result | Evidence                                                                      |
| -------------------------------- | ------ | ----------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | PASS   | Existing lockfile accepted without dependency update.                         |
| `pnpm format:check`              | PASS   | All checked files use Prettier formatting.                                    |
| `pnpm lint`                      | PASS   | ESLint exited 0.                                                              |
| `pnpm typecheck`                 | PASS   | Core and plugin strict TypeScript checks exited 0.                            |
| `pnpm test`                      | PASS   | Core 36/36; plugin 33/33 across 10 files.                                     |
| `pnpm build`                     | PASS   | Core build and plugin `main.js`/`worker.js` builds exited 0.                  |
| `pnpm check:plugin`              | PASS   | Static gate passed; bundled-worker smoke imported one synthetic conversation. |
| `pnpm verify`                    | PASS   | Final aggregate format/lint/typecheck/test/build/static/worker gate exited 0. |

The final `pnpm verify` was executed after the last production edit and after formatting the closure documentation already present at that point.

## 6. Exact Obsidian 1.7.4 runtime

- Official source: `https://github.com/obsidianmd/obsidian-releases/releases/download/v1.7.4/Obsidian-1.7.4.dmg`
- DMG SHA-256: `af77521f1df2ec1ce36d6609c17c325827934726b68cb31587357b356a510dbe`
- Bundled application archive SHA-256: `454462e6316bb9ea9726403e887a8be691eb34b2cff70a0a8d6db4d3de7615d9`
- Loaded API/app version: 1.7.4 exact
- Electron: 31.6.0; Chromium: 126.0.6478.234; Node: 20.17.0
- `app.vault.configDir`: `.obsidian`, captured dynamically rather than assumed
- Startup, 20 enables: median 9.5 ms; p95 15.9 ms; final state disabled
- Complete 16-case picker/drop/lifecycle/settings/accessibility smoke: PASS
- Final smoke SHA-256: `2cc331212224d9fc0f7f3ad53d0cd2eaf2953377de92885337b62d3efa6ebf6c`

The fresh disposable vault was `/tmp/chat2vault-m02-runtime-closure/obsidian-1.7.4/vault`. It contained no real export and was not a production vault.

## 7. Exact public-stable Obsidian 1.13.6 runtime

- Official source: `https://github.com/obsidianmd/obsidian-releases/releases/download/v1.13.6/obsidian-1.13.6.asar.gz`
- Downloaded gzip SHA-256: `7872c1a2dfd4f20146a19d394bf904c153c61ba7abde3eeda9ddaae19d9eee31`
- Decoded application archive SHA-256: `d769003f81435abe53576172f3bb0695132880cc7b7970f2f0086f7d5ea968b5`
- Outer desktop shell: 1.12.7 (the loaded signed archive identity above is authoritative for the 1.13.6 API runtime)
- Loaded API/app version: 1.13.6 exact
- Electron: 39.8.3; Chromium: 142.0.7444.265; Node: 22.22.1
- `app.vault.configDir`: `.obsidian`, captured dynamically rather than assumed
- Startup, 20 enables: median 12.8 ms; p95 24.2 ms; final state disabled
- Complete 16-case picker/drop/lifecycle/settings/accessibility smoke: PASS
- Final smoke SHA-256: `adab5848ec67ccc725f307e84f7378bb70bb006aafbd66fd9fbb01c53b446f43`

The fresh disposable vault was `/tmp/chat2vault-m02-runtime-closure/obsidian-public-stable/vault`. Exact 1.13.4 prior evidence is supplementary only and was not used to satisfy any required runtime row.

## 8. Filesystem privacy trace

For each required runtime, three plugin-disabled `fs_usage -w -f filesys`/manifest windows and one enabled window were captured against isolated process trees. All eight `fs_usage` commands exited without stderr. The six disabled recursive vault manifests had zero added, removed, or changed paths.

Enabled recursive vault deltas were identical in policy terms:

- added: `<configDir>/plugins/chat-to-vault/data.json`, 56 bytes, the only allowed Chat2Vault persistent write;
- changed: test-probe `tripwire-events.jsonl`, instrumentation-owned;
- changed: `workspace.json`, Obsidian-owned view/workspace state;
- no vault content path outside config changed;
- no path was removed;
- direct Chat2Vault write/vault/FSA/OPFS violation count: zero.

The pathname-bearing process trace was cross-checked against recursive manifests and direct API stacks. Fixture paths were reads; probe-log writes were instrumentation; the exact settings write was expected; descriptor-only process activity did not produce any additional path delta. No unexplained Chat2Vault-attributable external, temporary, profile, vault, or config write remained.

## 9. Network Layer A and Layer B

Layer A installed 140 direct patches per runtime across renderer fetch/XHR/WebSocket/EventSource/beacon/Worker/SharedWorker/resource surfaces, browser storage and FSA/OPFS, Obsidian/vault methods, Node HTTP/HTTPS/HTTP2/net/TLS/dgram/DNS, child processes, Electron shell, and module-proxied Obsidian/Electron imports. Direct export mutation was unavailable for two frozen Obsidian exports, but the module-load proxy covered calls imported by the target bundle. Unavailable Electron-net renderer members and synchronous OPFS methods were backed by static bundle checks and process tracing.

Target-attributed results:

| Runtime | Expected Blob workers | Expected resource attributes | Direct violations |
| ------- | --------------------: | ---------------------------: | ----------------: |
| 1.7.4   |                    45 |                        1,734 |                 0 |
| 1.13.6  |                    59 |                        2,014 |                 0 |

Layer B scoped `nettop` to the isolated Obsidian process trees during all six disabled controls and both enabled smoke windows. Every capture exited 0 with empty stderr; CSVs contained headers only and zero connection rows. Static plugin and worker gates found no network dependency or call. Therefore there was zero direct Chat2Vault network violation and zero unexplained new egress.

## 10. Filter p95

Twenty representative title-filter/repaint operations ran on the approved 10,000-conversation result. Queries covered empty, common prefix, rare/no match, NFKC-equivalent input, mixed case, whitespace, and positions across the set.

| Runtime | Operations |     p95 | Maximum mounted rows | Threshold                |
| ------- | ---------: | ------: | -------------------: | ------------------------ |
| 1.7.4   |         20 | 35.0 ms |                  200 | PASS: <=100 ms and <=200 |
| 1.13.6  |         20 | 34.8 ms |                  200 | PASS: <=100 ms and <=200 |

## 11. Diagnostic p95 and reachability

Twenty forward/reverse page operations ran on the approved 50,000-diagnostic result, including page 1, middle pages 1000/1001, near-end page 1999, and final page 2000. Page 1 exposed diagnostic 0, middle navigation exposed diagnostics around 24,975–25,024, and page 2000 exposed diagnostic 49,999. The real M01-path amplification case separately produced 50,002 diagnostics and rendered 25.

| Runtime | Operations |     p95 | Max rows |  Max imported text | Reachability            |
| ------- | ---------: | ------: | -------: | -----------------: | ----------------------- |
| 1.7.4   |         20 | 34.3 ms |       25 | 1,425 UTF-16 units | first/middle/final PASS |
| 1.13.6  |         20 | 33.9 ms |       25 | 1,425 UTF-16 units | first/middle/final PASS |

Both rows pass the <=100 ms, <=25-row, and <=65,536-code-unit requirements.

## 12. Chromium/Electron main-thread traces

Each trace is from the final production hashes. `Task` is the longest renderer main-thread `RunTask`; `busy` is the longest contiguous renderer busy interval.

| Workload                                 |  1.7.4 task / busy |  1.13.6 task / busy | Result |
| ---------------------------------------- | -----------------: | ------------------: | ------ |
| Near-limit JSON                          | 10.363 / 35.244 ms |  13.021 / 85.277 ms | PASS   |
| Near-limit stored ZIP                    |  9.224 / 23.194 ms |  16.089 / 67.663 ms | PASS   |
| Exact 16-file JSON                       | 8.765 / 126.045 ms | 10.780 / 120.038 ms | PASS   |
| 10,000-conversation handoff/render       | 14.322 / 29.021 ms |  24.266 / 43.746 ms | PASS   |
| 50,000-diagnostic handoff/render         | 10.131 / 11.252 ms |  10.731 / 13.242 ms | PASS   |
| Real M01 50,002-diagnostic amplification | 47.918 / 53.616 ms |  35.252 / 44.295 ms | PASS   |

All twelve traces pass: no renderer task exceeded 100 ms and no busy interval exceeded 250 ms. Full trace JSON and hash-bearing `.summary.json` files use the prefix `/tmp/chat2vault-m02-runtime-closure/evidence/definitive-`.

## 13. Privacy markers and settings

The full forbidden marker set—including raw source values, identifiers, URLs, lowercase variants, exact output fingerprints, and SHA-256 derivatives—was searched byte-for-byte across each complete disposable vault and isolated runtime profile. Both scans returned zero findings and zero read errors.

Browser persistence snapshots showed only Obsidian's isolated-vault enable key and Obsidian-owned cache/backup/sync databases. Session storage, Cache Storage, and OPFS were empty. No imported marker or target-owned browser persistence was present.

Both runtimes persisted exactly:

```json
{ "schemaVersion": 1, "previewMessagesPerPage": 25 }
```

No imported source text, source identifier, diagnostic identifier, conversation result, or preview state was persisted. Clear, close/reopen, disable/re-enable, and stale completion fencing all returned to content-free state.

## 14. Accessibility, theme, and layout

Both exact runtimes passed command-to-import focus, result/error focus, keyboard result activation, Clear focus recovery, polite status announcements, assertive errors, native control labels, light and dark themes, long diagnostic wrapping, and reachable controls. Native picker/drop, cancellation, replacement, close/reopen, and settings reload were included.

At 360 CSS pixels, client width equaled scroll width and no control overlap was detected. At 200% zoom, client width and scroll width were both 168 pixels in each runtime, with no horizontal overflow. Wide layout also had no overflow. The responsive container stacked content without relying on the outer application width.

## 15. AC-01–AC-32 final matrix

| AC    | Status | Closure evidence                                                        |
| ----- | ------ | ----------------------------------------------------------------------- |
| AC-01 | PASS   | M01 tag/HEAD preserved; core 36/36.                                     |
| AC-02 | PASS   | Manifest identity, desktop-only scope, and static gate pass.            |
| AC-03 | PASS   | Exact 1.7.4 and official-current 1.13.6 identities and smoke pass.      |
| AC-04 | PASS   | 20 startup samples per runtime; p95 15.9/24.2 ms.                       |
| AC-05 | PASS   | Command, one-view reuse, reveal, and focus pass on both.                |
| AC-06 | PASS   | ZIP picker including near-limit input passes on both.                   |
| AC-07 | PASS   | JSON picker, malformed, and over-limit behavior pass on both.           |
| AC-08 | PASS   | Partial multi-JSON and exact 16-file result pass on both.               |
| AC-09 | PASS   | Unsupported/mixed inputs rejected before parsing.                       |
| AC-10 | PASS   | Valid drop, folder rejection, and mixed drop parity pass.               |
| AC-11 | PASS   | Bundled M01 importer remains authority; 36/36 regression pass.          |
| AC-12 | PASS   | State mapping tests and both native smoke matrices pass.                |
| AC-13 | PASS   | Replacement, Clear-during-run, cancellation, and stale fencing pass.    |
| AC-14 | PASS   | Total ordering tests and cached-order regression pass.                  |
| AC-15 | PASS   | 20 filters per runtime; p95 <=35 ms; rows <=200.                        |
| AC-16 | PASS   | Conversation/message pagination and preview bounds pass.                |
| AC-17 | PASS   | Imported/hostile content rendered inertly as text.                      |
| AC-18 | PASS   | Display whitelist enforced; final marker scans zero.                    |
| AC-19 | PASS   | Warning ZIP and partial-success warnings visible safely.                |
| AC-20 | PASS   | 20 diagnostic operations; rows/text bounded; final item reachable.      |
| AC-21 | PASS   | Only exact two-field settings object persists and affects paging.       |
| AC-22 | PASS   | Privileged trace, sink tripwires, storage snapshots, and zero markers.  |
| AC-23 | PASS   | Only `data.json` target write; no unauthorized vault/external write.    |
| AC-24 | PASS   | Layer A zero violations; Layer B zero egress rows; static worker clean. |
| AC-25 | PASS   | No telemetry dependency, call, event, or process egress.                |
| AC-26 | PASS   | Clear/close/disable/re-enable cleanup and content-free restore pass.    |
| AC-27 | PASS   | All 12 traces meet 100 ms task and 250 ms busy limits.                  |
| AC-28 | PASS   | Fresh final `pnpm verify` green; 36 core + 33 plugin tests.             |
| AC-29 | PASS   | Complete runtime smoke green on exact 1.7.4 and exact 1.13.6.           |
| AC-30 | PASS   | Keyboard, focus, themes, 360 px, wrap, overlap, and zoom pass both.     |
| AC-31 | PASS   | README/privacy disclosure matches observed local file access.           |
| AC-32 | PASS   | M02-only diff; future milestones and publication boundaries preserved.  |

## 16. Failures, remediations, and reruns

Historical worker-path and cross-origin failures remain documented in `docs/10_M02_RUNTIME_GATE_REPORT.md`. Closure additionally found renderer amplification from transferable input cloning, monolithic diagnostic result delivery, repeated 10,000-row sorting, and narrow zoom layout. Each defect was preserved in prior evidence, remediated within M02, and covered by targeted tests. The complete repository verification and every affected runtime performance/smoke trace were rerun against the final hashes on both exact versions.

One final local harness invocation initially failed with `EPERM` when the restricted command sandbox denied loopback access to `127.0.0.1:9227/9236`. The identical read-only harness was rerun with local-loopback permission and passed. This was an execution-environment restriction, not a plugin failure.

The first final `pnpm verify` stopped at format checking because the newly edited document index and implementation notes needed Prettier. Those two files were formatted; the complete aggregate verification was rerun and passed.

## 17. Evidence manifest

Evidence is temporary, synthetic, non-sensitive, and outside the repository:

- root: `/tmp/chat2vault-m02-runtime-closure`
- fixtures/marker authority: `/tmp/chat2vault-m02-runtime-gate/fixtures`
- privileged windows: `evidence/privileged-final/{exact,stable}-{baseline-1,baseline-2,baseline-3,enabled}`
- definitive performance: `evidence/definitive-{startup,filter,diagnostics}-*.json`
- definitive traces: `evidence/definitive-*-trace-*.json` plus `.summary.json`
- tripwire summaries: `evidence/definitive-tripwire-*.json`
- browser storage/coverage: `evidence/definitive-{browser-storage,coverage}-*.json`
- final marker scans: `evidence/definitive-marker-scan-*.json`

Selected evidence hashes:

| Evidence         | 1.7.4 SHA-256                                                      | 1.13.6 SHA-256                                                     |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Startup          | `c064b5e8d9b6a10da8a80ec489b8df3ea95e2239b59857a5c3a689ff21182ad2` | `92aa9f4f8364a10edb1168ba1bc4fcb829a16e0396eef8ae425a222953803203` |
| Filter           | `8a031c049c98119ca82c9eb3704028a54af3dddff15b476a15520c150501c156` | `a921f85095535e3be699a13a936726dad40b8f1e34b9b0621b0d9ee84db3ab5a` |
| Diagnostics      | `4d3ad3cf3391d32c1632a325bc8e821f17f36c594603b1bf3aea44cbb45b76cb` | `4b19134b14d08df47b05a72751a80058c2c1e5a831a34650a9265aedeea581d8` |
| Tripwire summary | `21779658f898aca9a9919948dff114cc49c185ca3ca2f404ab2617ab9b12e42a` | `2d3494adc381aff7d2b618fdff0a381e70826341501deff14a6d8dfe1af0f861` |
| Marker scan      | `f2ea95079f7ce278e58ccb0261d955716b3e9595f90849d70ac0588abf6b77ec` | `440a6bb33899c4aa4d40f257e0a143b4f820f426bcac11b6903990ce0918979d` |

Each trace summary includes its trace path, trace SHA-256, operation outcome, task/busy maxima, and PASS result. Temporary evidence may be removed by the operating system; this report preserves the decision-critical results and hashes.

## 18. Scope review

Completed scope: amended 1.7.4 reconciliation, final-artifact build/verification, exact-minimum and official-current runtime smoke, privileged filesystem proof, complete network backstops, performance p95s, renderer traces, persistence scans, accessibility/layout verification, implementation notes, document index, and this closure report.

Explicit non-goals preserved: M03 synthesis/writes, real vaults/exports, provider or LLM integration, telemetry, sync, mobile, marketplace submission, packaging/release, deployment, publication, and broad refactoring.

## 19. Repository and publication state

- Root: `/Users/adam/Developer/Chat2Vault`
- Branch: `codex/milestone-02`
- Base/HEAD: `1f03110b03e07bccba5503303c510518c86773bd`
- Added in the uncommitted M02 set: `apps/obsidian-plugin/**`, `docs/M02_SPEC.md`, `docs/09_M02_IMPLEMENTATION_NOTES.md`, `docs/10_M02_RUNTIME_GATE_REPORT.md`, and `docs/11_M02_RUNTIME_CLOSURE_REPORT.md`
- Modified in the uncommitted M02 set: `.prettierignore`, `README.md`, `docs/00_DOCUMENT_INDEX.md`, `eslint.config.mjs`, `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`
- Worktree: intentionally dirty with the uncommitted M02 implementation, tests, generated production bundles, lockfile/workspace changes, README, specification, implementation notes, historical runtime report, index, and this closure report
- Removed files: none
- Commit: not created
- Push/tag/PR/merge: not performed
- Deploy/release/publish/submit: not performed

## 20. Independent-review handoff and next gate

The next action is a fresh independent whole-implementation and runtime-evidence review. The reviewer should verify the entire M02 diff against `docs/M02_SPEC.md`, confirm the final artifact hashes and AC ledger, examine the privileged/tripwire/trace summaries, and preserve reviewer independence by not remediating findings during that review.

Only a later explicit `GO — M02 COMMIT READY` authorizes the M02 baseline commit. Do not begin M03.
