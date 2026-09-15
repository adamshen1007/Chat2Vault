# Milestone 05 Implementation Notes

Version: 0.1-candidate
Date: 2026-09-15
Decision: **NO-GO — independent M05 review pending**

## Authority and repository state

- Repository root: Chat2Vault repository checkout (local absolute path withheld under the M05 evidence privacy boundary)
- Branch: `codex/milestone-05-spec`
- Baseline and merge base: `2ac8f194adeca6de5cf2c227ca8213013455573e`
- Current uncommitted HEAD: `7b3cb18704380c882987c9a15c5522f89ec126e8`
- Upstream: `origin/main`
- Approved M05 specification SHA-256: `895504880bc369bfbe64d60f60f675064f538458a563b2476fb9cf2e9c4876fd`
- Approved file-Keychain amendment SHA-256: `0f3f24e43343705ec411730453b2e92acab75c32cb283d5737fc441163b4ba78`
- Frozen M04 specification SHA-256: `12a6fdd8346b80e1b015c099b78c2d26c3b736b6d09dfecc55254d648df5193c`
- Approved M03.1 amendment SHA-256: `6cd26a318e74e7299376020cbf37608a267bf903d068aacf6debdfdc5bc02dad`
- Worktree: dirty with the complete uncommitted M05 candidate; unrelated user work was not discarded or rewritten
- Publication: no M05 commit, push, PR, merge, tag, deployment, release, Community submission, paid-provider run, or M06 work

The exact M05 specification was independently approved and the Product Owner subsequently supplied `M05 IMPLEMENTATION AUTHORIZED`. Those actions authorize implementation only. Commit readiness still requires the exact independent verdict `GO — M05 COMMIT READY`.

## Objective and implemented scope

M05 adds one explicitly configured OpenAI-compatible HTTPS cloud-distillation path while preserving the complete local-first M01–M04 baseline. The candidate implements:

- exact v3 settings migration, field recovery, pending installation identity, rollback, retry, and the unchanged binary non-queuing settings mutex;
- an ABI-1 macOS file-Keychain native module and strict TypeScript wrapper with one exact service/account identity, status/read/set/delete verification, collision isolation, and no secret-bearing result or diagnostic;
- canonical HTTPS endpoint/model/timeout/output-cap/disclosure validation and closed readiness/diagnostic contracts;
- A-only DNS validation, frozen public-IPv4 classification, first-answer pinning, secure-peer equality, normal TLS/hostname verification, fresh socket use, seven fixed headers, bounded body/response handling, and no retry;
- strict provider-envelope projection into the frozen M04 raw-result validator;
- a provider controller with exact ownership, generation, cancellation, timeout, stale-settlement, and manual-M04 arbitration behavior;
- password/disclosure/settings and candidate-view integration with persistent live regions, exact focus transitions, bounded usage display, and inert candidates;
- static production-boundary checks, runtime-only artifact-separated test seams, and an attributed two-version macOS host gate.

## Explicit non-goals preserved

The candidate adds no Ollama or local-network adapter, IPv6 transport, provider SDK, model discovery, capability inference, pricing lookup, token estimation, automatic retry, background request, proxy support, custom CA, global Agent, browser automation, candidate edit/accept/reject/merge/promotion, M05 vault write, M06 behavior, unsupported-platform claim, release, deployment, or billing/cost claim. M03 source-note saving remains a separate explicit user action; manual M04 distillation remains available.

## Candidate file inventory

Added:

- `apps/obsidian-plugin/native/keychain.cc`
- `apps/obsidian-plugin/native/keychain.node`
- `apps/obsidian-plugin/scripts/check-m05-boundaries.mjs`
- `apps/obsidian-plugin/scripts/check-m05-runtime.mjs`
- `apps/obsidian-plugin/scripts/compare-m05-runtime-artifact.mjs`
- `apps/obsidian-plugin/src/keychain.ts`
- `apps/obsidian-plugin/src/provider-controller.ts`
- `apps/obsidian-plugin/src/provider-transport.ts`
- `apps/obsidian-plugin/src/runtime-test-entry.ts`
- `apps/obsidian-plugin/src/runtime-test-keychain.ts`
- `apps/obsidian-plugin/src/runtime-test-network-seam.ts`
- `apps/obsidian-plugin/test/keychain.test.ts`
- `apps/obsidian-plugin/test/m05-boundaries.test.ts`
- `apps/obsidian-plugin/test/native-keychain.test.ts`
- `apps/obsidian-plugin/test/provider-controller.test.ts`
- `apps/obsidian-plugin/test/provider-transport.test.ts`
- `docs/18_M05_IMPLEMENTATION_NOTES.md`
- `docs/19_M05_RUNTIME_GATE_REPORT.md`
- `docs/M05_FILE_KEYCHAIN_AMENDMENT.md`
- `docs/M05_SPEC.md`
- `docs/M05_SPEC_REVIEW_LEDGER.md`
- `docs/superpowers/plans/2026-08-28-m05-openai-compatible-cloud.md`
- `packages/core/src/internal/strict-json.ts`
- `packages/core/src/provider/address.ts`
- `packages/core/src/provider/config.ts`
- `packages/core/src/provider/contracts.ts`
- `packages/core/src/provider/envelope.ts`
- `packages/core/test/provider-address.test.ts`
- `packages/core/test/provider-config.test.ts`
- `packages/core/test/provider-envelope.test.ts`
- `scripts/build-m05-review-packet.mjs`

Modified:

- `apps/obsidian-plugin/main.js`
- `apps/obsidian-plugin/scripts/build-native.mjs`
- `apps/obsidian-plugin/scripts/check-plugin.mjs`
- `apps/obsidian-plugin/src/main.ts`
- `apps/obsidian-plugin/src/settings-model.ts`
- `apps/obsidian-plugin/src/settings.ts`
- `apps/obsidian-plugin/src/view.ts`
- `apps/obsidian-plugin/styles.css`
- `apps/obsidian-plugin/test/main.test.ts`
- `apps/obsidian-plugin/test/settings-model.test.ts`
- `apps/obsidian-plugin/test/styles.test.ts`
- `apps/obsidian-plugin/test/view.test.ts`
- `apps/obsidian-plugin/worker.js`
- `docs/00_DOCUMENT_INDEX.md`
- `package.json`
- `packages/core/src/distillation/result.ts`
- `packages/core/src/index.ts`
- `README.md`

No candidate file is removed. The frozen `docs/M05_SPEC.md` bytes are unchanged.

## Deterministic identities

| Artifact                      |  Bytes | SHA-256                                                            |
| ----------------------------- | -----: | ------------------------------------------------------------------ |
| `main.js`                     | 181143 | `1dccae24aa6ca3ae822c173c8945d0dee2a5c9c78a0c907359175e3f68701321` |
| `worker.js`                   |  19259 | `bbdb3d96b461dc452d3b506df31823887fdce4c84949f0eaaae3ee61bde373fb` |
| `manifest.json`               |    251 | `e5fb0e963c510919e4206bbb5d873d75813f1e3d40bbe6e41a2d8fb5a242dfd9` |
| `styles.css`                  |   5001 | `96a7d50d9ee55863e7982c13a9c646971dac15442112fb35dd2dbacfbe242591` |
| `native/source_observer.node` |  41352 | `ce334cb2dae22bb803bb0b9e5ef0b44b2359795e53b19c4852e837bfb04418f5` |
| `native/keychain.node`        |  66376 | `3751f72aa872aa3baae527d3242df2f1750f8c6e13fc91b4ca1b6aad70459c1a` |
| runtime-only bundle           | 213991 | `8910e365f332fdedace0fda85da124275a44763e8efb3e28e641dcc7abdb7c44` |

The frozen M04 request golden remains `sha256:15a7ab54e53002992592ffcf69c61e48ba9af1a88f398d54c98adf0908ca79c2`; its rendered prompt remains 2933 UTF-8 bytes with SHA-256 `sha256:7b2140a1e10ce1597760e027db1bd0d944a229aa34701fe7f4be35ccca2af323`. M05 wraps that exact prompt in the fixed provider envelope.

## Verification before independent review

| Command                                                                    | Result | Evidence                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @chat2vault/obsidian-plugin typecheck`                      | PASS   | strict TypeScript check                                                                                                                                   |
| focused M05/plugin Vitest command                                          | PASS   | 9 files; 284 tests                                                                                                                                        |
| `node apps/obsidian-plugin/scripts/check-m05-boundaries.mjs`               | PASS   | 20 production modules; one HTTPS transport; one Keychain loader; zero runtime seams or M05 vault mutations                                                |
| `pnpm --filter @chat2vault/obsidian-plugin build`                          | PASS   | both native modules, worker, and production main built; only the disclosed macOS Keychain deprecation warning                                             |
| `node apps/obsidian-plugin/scripts/check-m05-runtime.mjs --artifacts-only` | PASS   | production/runtime identities above; production graph byte/source identity preserved                                                                      |
| `node apps/obsidian-plugin/scripts/check-m05-runtime.mjs`                  | PASS   | exact 1.7.4 and stable 1.13.7 rows; all 14 scenario groups each                                                                                           |
| `CI=true pnpm verify`                                                      | PASS   | Prettier, ESLint, both strict typechecks, core 262/262, plugin 522/522, both builds, worker smoke, M03/M04/M05 gates, and repeated two-row runtime matrix |
| `git diff --check`                                                         | PASS   | no whitespace errors                                                                                                                                      |

The repository-wide hygiene scan, review-packet identity, and independent verdict remain the final pre-publication evidence steps.

## Acceptance mapping

| Criteria    | Implementation and evidence                                                                                                                                    | State                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| AC-01–AC-04 | frozen hashes; platform fence; ABI-1 native wrapper; v3 identity/settings migration, recovery, mutex, rollback, retry, and future-schema tests                 | LOCAL PASS                                    |
| AC-05–AC-07 | endpoint/model/secret/limit validators, frozen IPv4 classifier, pinned A-only DNS, boundary suites                                                             | LOCAL PASS                                    |
| AC-08–AC-09 | disclosure revocation/gating and exact preflight values in settings/view/controller tests and runtime surfaces                                                 | LOCAL PASS                                    |
| AC-10–AC-11 | one fresh-socket HTTPS path, seven headers, peer pin, normal TLS/hostname trust, and closed proxy/Agent/redirect/compression behavior                          | PASS — unit/static/two-row runtime            |
| AC-12–AC-13 | provider/manual ownership matrix, cancellation, timeout, stale fencing, credential/settings/readiness precedence and closed diagnostics                        | PASS — controller tests and both runtime rows |
| AC-14–AC-17 | bounded response metadata/body/depth, duplicate-safe envelope projection, frozen M04 validation, preview preservation, bounded untrusted metadata              | PASS — unit/runtime                           |
| AC-18–AC-19 | no provider vault capability; closed settings/Keychain persistence; zero runtime mutation/persistence violations; repository hygiene scan pending final packet | CONDITIONAL                                   |
| AC-20       | exact settings/candidate focus, persistent live regions, 358..362px geometry, 1x/2x/1x host zoom, raw screenshots                                              | PASS — both runtime rows                      |
| AC-21–AC-22 | native/unit/integration/static/build/artifact and exact two-row matrix; fresh full `CI=true pnpm verify` passed 784 tests and repeated both host rows          | PASS                                          |
| AC-23–AC-24 | frozen manual M04 remains available; no Ollama/local-network/M06/release/deployment/unsupported-platform work                                                  | LOCAL PASS                                    |

## Review findings and remediations

Task-level review and runtime remediation closed strict-envelope classification, secret handoff lifetime, hostile dependency fences, settings persistence ordering, pending-identity rebasing, native default-file-Keychain selection, secondary-Keychain collisions, stale owner release, stable Obsidian 1.13 settings rendering, separate settings-renderer focus traversal, localized restricted-mode setup, real host width qualification, TCP-attempt accounting, bounded CDP/RAF lifecycle, native screenshot capture, and exact cleanup. The first independent whole-candidate review additionally identified and remediation closed a request-ID visible-ASCII lower-bound error, a non-fail-closed review-packet inventory, hard-coded packet evidence, and an inaccurate candidate-file list. The independent final-packet verdict is still pending and remains authoritative only as evidence to verify.

## Risks, limitations, and manual actions

- M05 is macOS desktop x86_64 only. Windows, Apple Silicon packaging, Linux, mobile, and IPv6 are not supported by this milestone.
- `SecKeychainCopyDefault` is required by the approved amendment and produces a known SDK deprecation warning; the implementation intentionally does not select a Keychain path or data-protection domain.
- Provider-reported usage/retry metadata is untrusted and informational. Chat2Vault makes no pricing, cost, budget, or billing claim.
- A real-provider smoke is optional, not required for commit readiness, and was not authorized or run.
- No human manual action is currently required. A human decision is required only after independent review if publication, paid-provider use, release, deployment, Community submission, or M06 is desired.

## Current decision and publication boundary

The implementation and runtime evidence are locally green, but the truthful decision remains **NO-GO — independent M05 review pending**. Commit, push, PR, merge, tag, deploy, release, paid-provider use, Community submission, and M06 are each separately unauthorized and have not occurred.
