# M02 Runtime Gate Report

Status: **runtime execution performed on exact 1.13.4; required evidence remains blocked/unproven**  
Date: 2026-08-09  
Milestone: M02 — local Obsidian import preview

## 1. Decision

Exact Obsidian 1.13.4 completed the disposable-vault smoke, lifecycle, settings, accessibility, and principal privacy/performance exercises. Mandatory filesystem tracing and required performance p95/main-thread trace evidence remain blocked or unproven. Exact Obsidian 1.7.2 was not found locally; it was an early-access/Catalyst build and no substitute is authorized. The decision permitted by the missing exact minimum-version binary is:

`CONDITIONAL GO — M02 CODE VERIFIED; EXACT 1.7.2 COMPATIBILITY GATE BLOCKED BY BINARY ACCESS`

## 2. Repository/spec/artifact identity

- Repository: `/Users/adam/Developer/Chat2Vault`
- Branch: `codex/milestone-02`
- HEAD: `1f03110b03e07bccba5503303c510518c86773bd`
- M01 tag `chat2vault-m01-complete-v0.1`: `1f03110b03e07bccba5503303c510518c86773bd`
- Reviewed M02 spec SHA-256: `52a0c3bda7e328ca27c0556bc3220a8f219737c1af457ddb0553aaeeb0e96095` — matched.
- `main.js`: `cb13f32cff3f0ceda4606e12dfd9d856a9ab1472df28e62fb07fbea7e01bdf6c`
- `worker.js`: `c3278c18641deffc9be34b4631c67109e12106b72e8aaa6f48732042bd3d2563`
- `manifest.json`: `3e354892729f675bbfe9013cd472551da22da8ac3957c146a5cf23c7c753e096`
- `styles.css`: `0a35dbaf7d510bd7ca54ce7abd9264938be49111b3c2b9a51bd018ca25b9015a`

## 3. Test machine

- macOS 15.7.7 (24G720), x86_64
- Intel Core i7 2.7 GHz, 4 cores, 16 GB RAM
- Node.js v24.16.0
- pnpm 11.7.0
- Machine serial number and hardware UUID intentionally excluded from evidence.

## 4. Obsidian 1.7.2 identity/evidence

**BLOCKED — exact binary access.** No exact 1.7.2 application archive, app bundle, installer, or disk image was found in the inspected local paths. Obsidian’s official changelog identifies desktop 1.7.2 as a Catalyst/early-access release dated 2024-09-19. No other version will be substituted. AC-03 and AC-29 cannot be completed for this row without the exact binary.

## 5. Obsidian 1.13.4 identity/evidence

- Loaded application archive: `/Users/adam/Library/Application Support/obsidian/obsidian-1.13.4.asar`
- Archive SHA-256: `51218495ad940a8515b202d380bde638be6570a198e121f7ca6d484a8a158917`
- Process evidence: the running Obsidian main process holds this archive open.
- Outer desktop shell: `/Applications/Obsidian.app`, bundle version 1.12.7, shell build 0.14.8.
- Disposable-vault capture: Obsidian API version 1.13.4; `app.vault.configDir` is `.obsidian`; Electron 39.8.3; Chromium 142.0.7444.265; Node 22.22.1. This build exposes `app.version` as `undefined`; the exact API version was captured through Obsidian's API module.

## 6. Automated preflight

| Command                                                               | Result | Evidence                                                                             |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `git status --short --branch`                                         | PASS   | Expected uncommitted M02 work on `codex/milestone-02`; no publication performed.     |
| `git rev-parse HEAD`                                                  | PASS   | `1f03110b03e07bccba5503303c510518c86773bd`                                           |
| `git rev-parse chat2vault-m01-complete-v0.1^{commit}`                 | PASS   | Same M01 base commit.                                                                |
| `shasum -a 256 docs/M02_SPEC.md`                                      | PASS   | Exact reviewed hash matched.                                                         |
| `pnpm install --frozen-lockfile`                                      | PASS   | Lockfile accepted; no dependency update.                                             |
| `pnpm verify`                                                         | PASS   | Format, lint, typecheck, core 36/36, plugin 29/29, build, static gate, worker smoke. |
| `pnpm check:plugin`                                                   | PASS   | Plugin proof gate passed.                                                            |
| `node /tmp/chat2vault-m02-runtime-gate/harness/validate-fixtures.mjs` | PASS   | 12/12 fixture boundary and parser validations.                                       |

## 7. Baseline control windows

Three 12-sample plugin-disabled control windows completed on exact 1.13.4. Each recursive disposable-vault before/after manifest had zero added, removed, or changed entries. Each per-process `nettop` capture contained only sample headers and no external connection rows for the scoped Obsidian main, network-service, and disposable-vault renderer PIDs. The probe log contained only its own `probe.onload` identity record and no Chat2Vault-attributed API events. Exact 1.7.2 controls are blocked by binary access.

## 8. Picker/drop smoke results

Exact 1.13.4 native picker passed for valid JSON, valid ZIP, two-file numbered JSON, warning ZIP, malformed JSON, and mixed ZIP+JSON rejection. Physical drag/drop passed for a valid JSON file and rejected a folder with the fixed `Folders are not supported.` error. The first valid JSON attempt exposed the worker-transport defect documented in §17; the final same-origin Blob-worker artifact passed the affected rerun with `SUCCESS`, one conversation, and zero diagnostics.

## 9. Lifecycle results

Native enable, reload, keyboard command open, single-view rendering/reuse, replacement, Clear, close cleanup, reopen, and repeated imports passed on exact 1.13.4. Focus moved to the import control on command/Clear and to results after success. No stale imported content was restored.

## 10. Privacy persistence marker results

The deterministic marker set was generated from raw sentinels plus the actual M01 output: source fingerprint, conversation fingerprints, message fingerprints, and every emitted diagnostic identifier. It also includes SHA-256 derivatives of every exact marker. After all native runs and the final settings save, the byte-level scan of the entire disposable vault/config root and `/Users/adam/Library/Application Support/obsidian` returned zero findings and zero read errors.

## 11. Filesystem tracing

Three disabled controls and the clean post-remediation picker window produced no disposable-vault changes. The performance window changed only the test probe JSONL, Obsidian workspace state, and an empty `Untitled/Untitled.md` visibly created through native UI during the run; it contained no markers and no Chat2Vault stack attribution. The probe JSONL writes are instrumentation-owned. The static workspace change is Obsidian-owned and marker-free. `fs_usage` was attempted but macOS required root; `sudo -n` confirmed no cached authorization. Mandatory OS-level filesystem tracing therefore remains **BLOCKED by local elevated-access requirements**; recursive manifests and in-process tripwires are substitute evidence, not a claimed pass.

## 12. Network tracing

Browser, Obsidian, and Electron/Node network tripwires recorded no Chat2Vault-attributed network event. Three disabled controls plus post-remediation picker and performance windows produced no external rows in scoped `nettop` captures. The final worker source passed the static no-network gate and is embedded locally.

This does not satisfy the full AC-24 proof contract. The test-only probe did not cover remote `Worker`/`SharedWorker`, navigation/resource assignment, or all Electron net/shell/navigation surfaces, and worker bootstrap interception was disabled after the Electron renderer isolation failure. Process-level `nettop` is valid Layer B evidence but cannot replace the incomplete Layer A coverage. AC-24 therefore remains unproven.

## 13. Clipboard

Clipboard write/copy/cut tripwires recorded no Chat2Vault-attributed event during picker, drag/drop, privacy, 10k, and 50k runs.

## 14. Startup/performance measurements

The final artifact completed 20 exact-1.13.4 plugin-enable samples: median 4.200 ms, p95 16.000 ms, maximum 21.300 ms. This passes the median <=50 ms and p95 <=100 ms thresholds. The earlier pre-remediation startup samples were invalidated after the production bundle changed.

Post-remediation measured native cases:

- 63 MiB near-limit JSON: Reading paint 19.7 ms, worker 575.8 ms, terminal paint 11.5 ms, one mounted row.
- 10,000 conversations: Reading paint 7.5 ms, worker 541.6 ms, terminal paint 38.3 ms, exactly 200 mounted rows; required title filtering passed by observation.
- Real M01-path amplification: Reading paint 3.9 ms, worker 881.3 ms, terminal paint 12.5 ms, one conversation, 50,002 diagnostics, exactly 25 mounted diagnostics.
- Synthetic 50,000-diagnostic `ImportResult`: test-only live injection showed exactly one row and 25 mounted diagnostics.
- Near-limit stored ZIP: Reading paint 3.7 ms, Parsing paint 2.9 ms, worker 3,637.7 ms, terminal paint 11.0 ms, one conversation, zero diagnostics.
- Exact 16-file aggregate: worker 1,171.5 ms, `inputCount: 16`, 16 conversations, zero diagnostics; native result rendered `SUCCESS` with all 16 rows.

An earlier attempted 16-file picker run selected only two inputs (`inputCount: 2`) and was invalidated. The rerun used a dedicated directory containing exactly the required 16 files and passed.

These measurements prove startup, reading-state paint, mounted-row caps, and individual terminal paints. They do not include the required Chromium/Electron main-thread task traces for every representative near-limit import, 20-search filter repaint p95, or 20-page diagnostics-navigation p95/full-reachability evidence. AC-15, AC-20, and AC-27 therefore remain unproven despite the successful individual observations.

## 15. Accessibility/theme/zoom/360px

The exact-1.13.4 manual gate passed for keyboard-only command/open/reuse/Clear flow, visible deterministic focus, loading and error discoverability, non-color-only status, default light and dark themes, approximately 360 CSS-pixel pane width, and one zoom-in and zoom-out step. Controls remained reachable, long text wrapped, and no page-level horizontal overflow or overlap was observed. Exact 1.7.2 remains blocked by binary access.

## 16. AC-01–AC-32 matrix

| AC    | Requirement                                   | Status                            | Evidence                                                      |
| ----- | --------------------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| AC-01 | M01 baseline preserved                        | PASS (local)                      | Base identity and core 36/36.                                 |
| AC-02 | Manifest identity and desktop scope valid     | PASS (local)                      | Static/build gate.                                            |
| AC-03 | Minimum/current version evidence valid        | PASS on 1.13.4 / BLOCKED on 1.7.2 | Exact 1.13.4 API/runtime captured; exact 1.7.2 unavailable.   |
| AC-04 | Plugin loads within startup budget            | PASS on 1.13.4 / BLOCKED on 1.7.2 | Final 20 samples: median 4.200 ms, p95 16.000 ms.             |
| AC-05 | Command contract correct                      | PASS on 1.13.4                    | Native keyboard command, focus, reuse, close/reopen.          |
| AC-06 | ZIP picker import                             | PASS on 1.13.4                    | Valid and near-limit ZIP native picker runs.                  |
| AC-07 | JSON picker import                            | PASS on 1.13.4                    | Valid/limit/malformed native picker runs.                     |
| AC-08 | Multi-JSON envelope and mapping               | PASS on 1.13.4                    | Numbered pair and exact 16-file native runs.                  |
| AC-09 | Mixed/unsupported input rejected              | PASS on 1.13.4                    | Native mixed and unsupported rejection.                       |
| AC-10 | Drag/drop parity                              | PASS on 1.13.4                    | Physical file drop and folder rejection.                      |
| AC-11 | Core authority preserved                      | PASS (local)                      | Worker uses M01 parser; static and tests green.               |
| AC-12 | Exhaustive result-state mapping               | PASS on 1.13.4                    | Automated tests plus native state fixtures.                   |
| AC-13 | Replacement/stale-run semantics deterministic | PASS on 1.13.4                    | Automated tests plus native replacement/lifecycle.            |
| AC-14 | Conversation ordering total deterministic     | PASS (local)                      | Automated tests.                                              |
| AC-15 | Large list/filter bounded                     | UNPROVEN                          | 10k/200-row observation passed; 20-search p95 absent.         |
| AC-16 | Preview bounded                               | PASS on 1.13.4                    | Native pagination plus automated DOM/text bounds.             |
| AC-17 | Imported content inert                        | PASS on 1.13.4                    | Hostile synthetic state rendered as text.                     |
| AC-18 | Display whitelist / identifier hidden         | PASS on 1.13.4                    | Native DOM observation and zero-marker final scan.            |
| AC-19 | Branch warnings safely visible                | PASS on 1.13.4                    | Native warning fixture.                                       |
| AC-20 | Diagnostics bounded/private/reachable         | UNPROVEN                          | 25-row cap passed; 20-page p95/full reachability absent.      |
| AC-21 | Settings exact/non-dormant                    | PASS on 1.13.4                    | Native 50→10 save; exact two-field `data.json`.               |
| AC-22 | No source-derived persistence                 | BLOCKED (OS tracer)               | Marker scan clean; mandatory filesystem trace unavailable.    |
| AC-23 | No unauthorized writes                        | BLOCKED (OS tracer)               | Manifests/tripwires clean; mandatory `fs_usage` needs root.   |
| AC-24 | No network                                    | UNPROVEN                          | `nettop` clean; required direct-tripwire coverage incomplete. |
| AC-25 | No telemetry                                  | PASS on 1.13.4                    | Tripwires/traces/static proof clean.                          |
| AC-26 | Lifecycle cleanup                             | PASS on 1.13.4                    | Native close/reopen/reuse/reload/Clear observations.          |
| AC-27 | Renderer responsiveness                       | UNPROVEN                          | Paints/caps passed; main-thread traces and p95 runs absent.   |
| AC-28 | Automated repository verification green       | PASS                              | Fresh `pnpm verify`.                                          |
| AC-29 | Runtime smoke green                           | PASS on 1.13.4 / BLOCKED on 1.7.2 | Exact 1.13.4 native gate; exact 1.7.2 unavailable.            |
| AC-30 | Accessibility/theme/narrow pane               | PASS on 1.13.4 / BLOCKED on 1.7.2 | Manual keyboard/theme/360 px/zoom gate.                       |
| AC-31 | External-access/privacy disclosure accurate   | PASS on 1.13.4                    | README/static proof plus runtime corroboration.               |
| AC-32 | Scope boundary clean                          | PASS (local)                      | No M03/provider/vault-write implementation found.             |

## 17. Failures/remediations/reruns

The first test-probe load failed because the harness joined `tripwire-events.jsonl` to Obsidian's relative `manifest.dir` without resolving it through the vault adapter. That harness-only path defect was corrected and rerun successfully.

The first valid JSON import then failed at the probe's attempted `node:worker_threads` bootstrap because Electron renderer V8 rejected worker construction. Worker interception was removed while retaining the remaining tripwires. The same valid fixture still failed through the unmodified production transport, establishing an in-scope runtime defect: Obsidian 1.13.4's renderer cannot create the Node worker used by the original runner. The failing screenshots and invalidated enabled window were preserved.

The first remediation replaced the production transport with a local browser `Worker` URL derived through Obsidian's vault adapter. Its native rerun failed with a captured Chromium `SecurityError`: Obsidian's hashed `app://` resource host is cross-origin from `app://obsidian.md`, so the worker script was blocked before execution. That attempt was preserved and superseded.

The second remediation embeds the already-built local worker source in `main.js` and creates a same-origin Blob worker. It performs no filesystem read, fetch, remote URL access, or persistence. The separate release `worker.js` remains present and Node-smokeable. Two runner lifecycle tests cover completion and abort cleanup. Fresh `pnpm verify && pnpm check:plugin` passed again: format, lint, typecheck, core 36/36, plugin 29/29, build, static gate, and bundled worker smoke. Rebuilt artifacts were copied and hash-verified in the disposable vault. The affected native import rerun passed with `SUCCESS`, one conversation, and zero diagnostics. Exact 1.7.2 remains an external binary-access blocker.

## 18. Evidence manifest with hashes and temporary paths

- Evidence root: `/tmp/chat2vault-m02-runtime-gate`
- Fixture manifest: `/tmp/chat2vault-m02-runtime-gate/fixtures/fixture-manifest.json`; SHA-256 `82d49e24535ef14bc605da8916bccbc812ef1767456bd482226b234575ed7ce8`
- Forbidden marker set: `/tmp/chat2vault-m02-runtime-gate/fixtures/forbidden-persistence-marker-set.json`; SHA-256 `2730fc1bbaa51e369896e64f73d9c91f4baac2562d14af99dcbe116083990008`
- Final marker scan: `/tmp/chat2vault-m02-runtime-gate/summary/final-marker-scan.json`; SHA-256 `8d442a4a036f389654c6c0d48ca9d767a2e68fc853414f5ebe99af3f4536fcae`; zero findings and zero read errors.
- Fixture validation: `/tmp/chat2vault-m02-runtime-gate/summary/fixture-validation.json`
- Installed 1.13.4 production bundle: `/tmp/chat2vault-m02-runtime-gate/obsidian-1.13.4/vault/.obsidian/plugins/chat-to-vault`; copied artifact hashes matched the repository production hashes above.
- Test-only probe: `/tmp/chat2vault-m02-runtime-gate/obsidian-1.13.4/vault/.obsidian/plugins/chat2vault-runtime-probe`; latest installed `main.js` SHA-256 `2fb3c2dfa3bab759807978231e47d48b7d2dca0bc4cc39d90278e1c24a292919`.
- Generated fixture count: 34; aggregate size: 426,126,602 bytes.
- Real diagnostic-amplification result: 50,002 diagnostics from a 4,801,671-byte valid M01 input.
- Persisted settings: `/tmp/chat2vault-m02-runtime-gate/obsidian-1.13.4/vault/.obsidian/plugins/chat-to-vault/data.json`; SHA-256 `de4f6faa65ad290311d866070f41f847962d6b35ec4e73b8039e49eb01be9a4f`; exact value `{ "schemaVersion": 1, "previewMessagesPerPage": 10 }`.

## 19. Scope review

Only M02 runtime-gate preparation and evidence work is in scope. No M03 behavior, provider access, vault mutation feature, network feature, telemetry, release packaging, or production instrumentation was added. Runtime instrumentation lives outside the repository under `/tmp`.

## 20. Repository mutation/publication state

This report is the only runtime-gate repository addition. Existing uncommitted M02 implementation changes remain present and protected. No commit, push, tag, merge, PR, release, deployment, or publication was performed.

## 21. Final decision

`CONDITIONAL GO — M02 CODE VERIFIED; EXACT 1.7.2 COMPATIBILITY GATE BLOCKED BY BINARY ACCESS`

This is not full runtime GO. Exact 1.7.2 compatibility remains unverified; mandatory macOS `fs_usage` evidence is blocked by unavailable local administrator authorization; complete direct network-tripwire coverage is unproven; and the required filter/diagnostics p95 plus representative main-thread traces were not captured. Strong substitute evidence on exact 1.13.4 found no direct Chat2Vault write beyond the exact settings file, marker persistence, or observed process egress, but substitute evidence is not represented as the missing mandatory proof.

## 22. Next gate

Obtain exact Obsidian 1.7.2 and run the same gate; collect privileged macOS filesystem tracing; complete the direct network-tripwire matrix; and capture the required 20-operation p95 and Chromium/Electron main-thread trace evidence. Then repeat the independent final M02 whole-implementation plus runtime-evidence review. Do not begin M03 and do not commit until that reviewer returns an explicit commit-ready GO.
