# Milestone 05 Runtime Gate Report

Version: 0.1-candidate
Date: 2026-09-15
Decision: **PASS — independent M05 whole-candidate review pending**

## Objective and qualified candidate

This report records the exact two-row macOS x86_64 host qualification required by the approved M05 specification. It qualifies the uncommitted candidate only; it does not authorize commit, publication, provider spend, release, deployment, or M06.

- Branch: `codex/milestone-05-spec`
- Baseline: `2ac8f194adeca6de5cf2c227ca8213013455573e`
- Uncommitted HEAD: `7b3cb18704380c882987c9a15c5522f89ec126e8`
- macOS: 15.7.9 (build 24G830), x86_64
- M05 specification: `895504880bc369bfbe64d60f60f675064f538458a563b2476fb9cf2e9c4876fd`
- File-Keychain amendment: `0f3f24e43343705ec411730453b2e92acab75c32cb283d5737fc441163b4ba78`
- Frozen M04 specification: `12a6fdd8346b80e1b015c099b78c2d26c3b736b6d09dfecc55254d648df5193c`
- Approved M03.1 amendment: `6cd26a318e74e7299376020cbf37608a267bf903d068aacf6debdfdc5bc02dad`
- Production bundle: `1dccae24aa6ca3ae822c173c8945d0dee2a5c9c78a0c907359175e3f68701321`
- Runtime-only bundle: `8910e365f332fdedace0fda85da124275a44763e8efb3e28e641dcc7abdb7c44`

## Runtime matrix

| Row     | Observed host identity                                                              | Scenarios    | Network/persistence                                                                  | UI and zoom                                                 | Screenshot                                                                        | Result |
| ------- | ----------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Minimum | Obsidian 1.7.4; Electron 31.6.0; Chromium 126.0.6478.234; Node 20.17.0; darwin x64  | 14/14 groups | 9 expected TCP attempts; 0 background; 0 vault mutations; 0 unauthorized persistence | settings 358..360; candidate 360; exact focus; zoom 1/1/2/1 | Exact final-run raw PNG and SHA-256 are generated inside the frozen review packet | PASS   |
| Stable  | Obsidian 1.13.7; Electron 39.8.3; Chromium 142.0.7444.265; Node 22.22.1; darwin x64 | 14/14 groups | 9 expected TCP attempts; 0 background; 0 vault mutations; 0 unauthorized persistence | settings 358..360; candidate 360; exact focus; zoom 1/1/2/1 | Exact final-run raw PNG and SHA-256 are generated inside the frozen review packet | PASS   |

Both rows loaded identical final `main.js`, `worker.js`, `manifest.json`, `styles.css`, `source_observer.node`, and `keychain.node` bytes. The runtime-only graph retained source/byte-identical production provider transport and differed only by the approved test entry, network seam, and alternate synthetic Keychain account seam.

During the same gate execution, the harness fetched `desktop-releases.json` from the official `obsidianmd/obsidian-releases` repository, validated its closed HTTPS release-asset shape, and required its public `latestVersion` to equal the observed stable row, Obsidian 1.13.7. The packet-bound machine-readable result records the fetch time, metadata byte count/SHA-256, official release hash and asset name, both source application `Info.plist` and Electron-framework identities, the stable ASAR identity, macOS product/build values, and all four authority-file identities. The packet freezer fails if the report's macOS, stable-version, M05, M04, or M03.1 values differ from those same-run measurements.

## Exact scenario ledger

All 14 groups returned `success` on both rows:

1. `settings-v3-recovery-mutex-identity`
2. `keychain-default-secondary-collision-cleanup`
3. `readiness-and-credential-transitions`
4. `transport-success`
5. `redirect-auth-rate-limit-size-metadata`
6. `unsafe-dns`
7. `pinned-peer-mismatch`
8. `tls-hostname-proxy-agent-socket`
9. `controller-arbitration-cancel-timeout-stale`
10. `response-envelope-depth-validation`
11. `manual-fallback-zero-mutation-persistence-retry`
12. `settings-focus-live-region`
13. `candidate-focus-live-region`
14. `host-zoom-geometry-screenshot`

Closed transport observations matched on both rows: success; `PROVIDER_DNS_UNSAFE` for unsafe DNS and secure-peer mismatch; `PROVIDER_REDIRECT_REJECTED`; `PROVIDER_AUTH_REJECTED`; `PROVIDER_RATE_LIMITED`; `PROVIDER_RESPONSE_TOO_LARGE`; and `PROVIDER_RESPONSE_METADATA_INVALID`.

## Native Keychain and cleanup evidence

Each row performed 16 synthetic Keychain operations against unique hashed primary and isolation account identities. The default file-based Keychain was retained for every query/mutation; an exact service/account collision in a secondary search-list Keychain was neither observed nor mutated. Primary and isolation identities were observed absent by the runtime. In the harness `finally` path, the prior user Keychain search list was restored and read back for exact equality, the temporary secondary Keychain was deleted, its path was removed, and filesystem absence was independently observed. Those measured `searchListRestored`, `keychainFileAbsent`, and derived `finalAbsent` values are retained per row and drive the cleanup scenario and final acceptance predicate; none is a literal success assertion.

Each instrumented Obsidian process was observed exited before its row returned. After all rows, the outer `finally` removed the disposable runtime root and failed the command if the root remained. Successful process exit therefore binds these cleanup checks to the same packet-captured gate execution.

No credential value, raw account, Keychain path, username, machine name, vault path/name, prompt, response, or candidate body entered retained machine-readable evidence.

## Focus, live-region, and geometry evidence

The exact enabled settings order passed on both rows:

`Provider endpoint` → `Provider model` → `Provider timeout` → `Maximum output tokens` → `Accept cloud data disclosure` → `Save provider settings` → `Provider API key` → `Save API key` → `Delete API key` → `Refresh Keychain status`; reverse traversal returned to `Delete API key`.

The exact candidate order passed on both rows with disabled Validate skipped:

`Prepare manual prompt` → `Copy prompt` → `Paste strict JSON` → `Distill with provider` → `Candidates per page`; reverse traversal returned to `Distill with provider`.

The persistent settings and candidate status nodes retained `role="status"` and `aria-live="polite"`; pending Cancel received focus during the provider operation. Every required enabled rectangle was nonzero, horizontally contained, non-overlapping, and within a surface whose `scrollWidth <= clientWidth + 1`. Electron-main read-back proved zoom `1.0 → 2.0 → 1.0`. Native Electron `webContents.capturePage()` produced one raw 200% PNG per row using only the reserved `.invalid` endpoint/model and deterministic synthetic content.

## Network and mutation attribution

Each row observed exactly nine simulator TCP connections: one explicit successful provider action plus the attempts required by the closed transport observation matrix. DNS-invalid cases performed zero connection; secure-peer mismatch reached the synthetic socket and failed before HTTP bytes; no second lookup, redirect follow, retry, proxy, global Agent, socket reuse, or quiet-period background request occurred.

Provider execution recorded zero Vault mutation calls and zero unexpected settings persistence attempts. M03 source-note saving remained separate and was not used by the M05 provider path.

## Retained deterministic synthetic artifacts

The only runtime display/transport content was authored synthetic M05 input, `https://m05.invalid/...`, hostname `m05.invalid`, model `synthetic-m05-model`, an inert non-provider-shaped synthetic credential, generated one-day synthetic CA/server certificates, generated UUID/account hashes, and the two raw screenshots identified above. The complete temporary runtime root, certificates, synthetic vaults, and instrumented host copies were deleted after hashes/counts were emitted. The exact final-run raw screenshots are retained only in the sanitized external review packet; none is committed.

## Limitations and decision

- The gate tests macOS x86_64 only, as authorized. It makes no Windows, Apple Silicon, Linux, mobile, or IPv6 claim.
- The minimum host imposes a 363px leaf floor; after exhausting real Electron-window resizing, the external harness applies a bounded 360px surface-width constraint. This is not CSS zoom or browser emulation, and all descendants remain subject to the same final geometry/overflow checks.
- Stable Obsidian renders plugin settings in a separate renderer; the harness connects to that exact page target for native focus while measuring the registered tab container through the workspace API.
- The disposable minimum vault's localized trust flow is resolved through the structurally first action of an exact two-button dialog, activated by native CDP mouse press/release; it selects restricted browsing, not trust, then closes the opened Community Plugins settings surface.
- No real-provider smoke was run; it is optional and separately authorizable.

The M05 runtime gate is **PASS**. Whole-candidate commit readiness remains **NO-GO** until the exact packet receives `GO — M05 COMMIT READY`. No synthetic Keychain item or runtime process/root remains, provider execution performed zero vault writes, and no automatic retry or background request occurred.
