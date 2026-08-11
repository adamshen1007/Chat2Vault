# Milestone 02 Implementation Notes

Version: 0.2.0  
Status: Implemented; runtime closure evidence recorded in `11_M02_RUNTIME_CLOSURE_REPORT.md`

## Boundary

M02 adds `apps/obsidian-plugin`, a desktop-only, read-only import preview. It delegates parsing to the unchanged M01 core. It does not write files or vault data, create notes, call a network or AI provider, use provider APIs, synthesize knowledge, or implement an M03 feature.

The command `Import ChatGPT export` opens or reuses one `ItemView`, reveals the leaf before accessing the concrete view, and focuses its file chooser. Startup only registers the view, command, and setting. A restored view is idle.

## Input and lifecycle

The adapter validates the complete selection before reading: one ZIP up to 64 MiB, one JSON up to 64 MiB, or up to sixteen JSON files with 64 MiB per-file and 128 MiB aggregate limits. Mixed, unsupported, and folder-like selections are rejected. Drag/drop and the native file chooser use the same controller.

The controller exposes idle, reading, parsing, success, success-with-warnings, partial-success, and error states. A monotonic generation invalidates stale completion after Clear or close. Parsing runs in a local bundled worker so near-limit input does not synchronously block the Obsidian renderer; Clear, close, and unload abort and terminate active worker work. Concurrent imports are rejected and file-picker cancellation preserves the previous terminal state.

Input buffers are transferred into the browser worker rather than copied on the renderer. High-volume diagnostic replies return in bounded, paced chunks and are assembled in memory before the terminal state is published. The view caches deterministic conversation ordering by immutable result-list identity, contains offscreen row rendering, and uses leaf-width container queries so the same bounded DOM remains responsive under narrow panes and 200% zoom.

## Display and privacy bounds

- Conversation pages mount at most 200 rows. Message pages mount 10, 25, or 50 items. Diagnostic pages mount exactly 25 items.
- Queries are limited to 240 UTF-16 code units and use trim, NFKC normalization, lowercasing, and title-only substring matching.
- Titles are bounded to 240; content blocks to 16,384; active preview text to 131,072; diagnostic codes to 128; messages to 2,000; and the current diagnostic page aggregate to 65,536 characters.
- C0/C1 controls are replaced except tab, line feed, and carriage return. Imported strings are assigned only through text-content/native text helpers. URLs remain plain text and code is inert `pre > code` text.
- The view displays only bounded titles, provider, timestamps, counts, roles, content, and diagnostic severity/code/message. It never displays core IDs, fingerprints, metadata, source paths, or diagnostic identifiers.
- Only versioned `previewMessagesPerPage` settings are saved through Obsidian `Plugin.saveData`. Import results remain in memory and are cleared on Clear, view close, and unload.

The production static gate parses the TypeScript AST for forbidden network, storage, file-write, Electron, and unsafe-HTML APIs, validates the manifest, and scans the minified bundle. This is defense-in-depth evidence, not a substitute for runtime tracing.

## Compatibility evidence

`minAppVersion` is 1.7.4, the earliest public Obsidian desktop release containing every M02-required API and behavior. Deferred views were introduced in the 1.7.2 Catalyst/early-access cycle; that version is historical introduction evidence only and is not an M02 runtime target. Obsidian recommends revealing a leaf before checking its view instance, and the implementation follows that sequence. It also keeps expensive work out of plugin `onload` and uses native HTML elements and Obsidian CSS variables.

The required runtime compatibility matrix is exact Obsidian desktop 1.7.4 plus the exact public stable desktop version reported by official release metadata at execution time. On 2026-08-11 in Asia/Shanghai, the official `desktop-releases.json` public `latestVersion` and beta `latestVersion` were both 1.13.6, so the closure run targets exact 1.7.4 and exact public 1.13.6.

Sources:

- <https://docs.obsidian.md/plugins/guides/defer-views>
- <https://docs.obsidian.md/plugins/guides/load-time>
- <https://docs.obsidian.md/Plugins/User%20interface/HTML%20elements>
- <https://obsidian.md/changelog/2024-10-16-desktop-v1.7.4/>
- <https://github.com/obsidianmd/obsidian-releases/blob/master/desktop-releases.json>

## Build and disposable-vault smoke procedure

1. Use Node 24 and pnpm 11; run `pnpm install` and `pnpm verify`.
2. Create a disposable vault and set its actual `configDir` if it differs from the default. Create `<configDir>/plugins/chat-to-vault/`.
3. Copy `apps/obsidian-plugin/main.js`, `worker.js`, `manifest.json`, and `styles.css` into that directory. Do not use a real vault or real conversation export.
4. Start exact Obsidian desktop 1.7.4, enable the plugin, invoke `Chat2Vault: Import ChatGPT export`, and use only synthetic fixtures.
5. Repeat on the exact public stable Obsidian desktop version reported by official release metadata at execution time. Check light/dark themes, keyboard navigation, screen-reader labels, zoom, and a 360 px pane.
6. Exercise valid ZIP/JSON, numbered JSON, malformed input, warnings, partial success, oversize and exact-limit selections, drag/drop, cancel, overlapping import, Clear during import, view close, unload/reload, and restored workspace state.
7. With three disabled-plugin baselines, instrument browser network APIs, Obsidian requests, Electron networking/shell, Node networking, File System Access/OPFS, browser storage, vault adapter writes, Node filesystem writes, console, clipboard, and process/OS filesystem and egress traces. Compare baseline and enabled runs and verify no imported marker reaches disk, logs, clipboard, storage, or network.
8. Record startup over twenty runs, reading-state latency, main-thread long tasks, 10,000-conversation initial render/filter p95, and 50,000-diagnostic initial render/page p95 against `M02_SPEC.md` thresholds.

Expected result: the command opens one reusable preview, supported synthetic exports render deterministically, bounds remain enforced, Clear/close/unload remove imported state, only the exact settings object persists, and all tripwires remain silent. Any network, filesystem/vault write, unsafe DOM insertion, identifier display, stale result, unresponsive task, or threshold miss is a runtime failure.

The procedure was executed in isolated disposable vaults for exact Obsidian 1.7.4 and public stable 1.13.6. Commands, artifact identities, smoke results, privacy/process traces, Chromium traces, performance measurements, limitations, and the final decision are recorded in `11_M02_RUNTIME_CLOSURE_REPORT.md`. The historical findings in `10_M02_RUNTIME_GATE_REPORT.md` remain unchanged and are superseded only where the closure report provides newer evidence.

## Automated contract ledger

The §18.2 areas are covered as follows; M01 regression remains a separate 36-test suite.

| Areas                                                                                    | Automated evidence                                                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1–4 settings/default/persistence/no-future-setting                                       | `settings-model.test.ts`, `main.test.ts`                                                         |
| 5–10 ZIP/JSON/multi-file boundaries and invalid input                                    | `input.test.ts`, folder-drop case in `view.test.ts`                                              |
| 11–16 cancel/replacement/failure/overlap/reset/stale completion                          | `controller.test.ts`                                                                             |
| 17 result-state truth table                                                              | `model.test.ts`                                                                                  |
| 18–19 total order/ordinal and invalid timestamps                                         | `model.test.ts`                                                                                  |
| 20 list DOM/page bound                                                                   | `view.test.ts`                                                                                   |
| 21 10/25/50 message pages                                                                | `view.test.ts`                                                                                   |
| 22–23 field and total preview bounds                                                     | `view.test.ts`                                                                                   |
| 24–25 inert hostile rendering and C0/C1 transform                                        | `render.test.ts`, `view.test.ts`, `model.test.ts`                                                |
| 26–29 provider/graph/fingerprint/diagnostic identifier exclusion and safe branch display | `view.test.ts`, `model.test.ts`                                                                  |
| 30–31 diagnostic 25-row and 65,536 bounds                                                | `view.test.ts`                                                                                   |
| 32 50,000-diagnostic reachability                                                        | `performance.test.ts`                                                                            |
| 33 clipboard/network/filesystem absence                                                  | AST, dependency, final-bundle checks, and runtime evidence in `11_M02_RUNTIME_CLOSURE_REPORT.md` |
| 34 close/unload cleanup                                                                  | `view.test.ts`, `main.test.ts`, `controller.test.ts`                                             |
| 35 content-free custom view state                                                        | `view.test.ts`                                                                                   |
| 36 drag/drop prevention and pre-read validation parity                                   | `view.test.ts`, `input.test.ts`                                                                  |
| 37 command/single-view reuse                                                             | `main.test.ts`                                                                                   |
| 38 deferred-view-safe reveal/instance order                                              | `main.test.ts`                                                                                   |
