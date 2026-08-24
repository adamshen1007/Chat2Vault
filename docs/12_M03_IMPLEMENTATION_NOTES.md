# Milestone 03 Implementation Notes

Version: 0.9.0  
Status: M03.1 macOS-only scope amendment approved and implementation/runtime aligned; final independent review pending

## Authority and boundary

The implementation is based on M02 commit `e7350887f8da44d931a648a0f30a9aac87ffce6f` and the independently approved, byte-frozen `docs/M03_SPEC.md` with SHA-256 `ad8f548e1ca264c569c75030a7f3f0fb6430ceee3838b08e4071c6400b672791`. The Product Owner selected a macOS x86_64-only M03.1 direction on 2026-08-24. `docs/M03_MACOS_SCOPE_AMENDMENT.md` with independently approved SHA-256 `6cd26a318e74e7299376020cbf37608a267bf903d068aacf6debdfdc5bc02dad` is the authority for the explicitly superseded platform/runtime/AC clauses after the exact verdict `GO — M03.1 SPEC AMENDMENT APPROVED`.

M03 adds only the source registry and explicit create-only source-note writer. The approved amendment narrows production support to macOS desktop x86_64 and defers Windows plus non-x86_64 macOS packaging to a separately approved compatibility milestone. It does not add knowledge extraction, AI/provider calls, browser automation, knowledge-note mutation, mobile/Linux source writing, telemetry, publication automation, or M04 behavior.

## Core contracts

`packages/core/src/source-writer` contains Obsidian-independent policy for:

- total well-formed Unicode conversion and canonical timestamp validation;
- portable source-root and title normalization;
- stable case/NFC collision keys and deterministic filename allocation;
- deterministic, inert, branch-aware source-note Markdown rendering;
- bounded raw-Markdown Preview display without splitting surrogate pairs;
- fatal UTF-8 registry parsing, malformed-entry classification, duplicate/version classification, and structural plan comparison.

The M01 canonical importer remains the source of selected conversation content and fingerprints.

## Plugin architecture

The plugin settings model migrates valid settings v1 to exact settings v2 and serializes page-size and source-root persistence. A proposed root is staged while persistence is pending and becomes authoritative only after fulfillment. Source state and installed plans are invalidated on import, selection, Clear, root settlement, view close, and unload.

`SourceWriteController` owns the non-queuing Preview mutex, the Save mutex, cross-action exclusion, operation generations, tokens, and UI-winner rules. `executeSourceWrite` performs a fresh structural replan, parent-first folder creation, synchronous last-point fences before every mutation, final target checks, create-only note creation, and post-create verification without destructive rollback.

`ObsidianSourceMutationAdapter` confines Vault `createFolder` and `create` calls. Registry enumeration and note reads are direct-child and read-only. On desktop, each Obsidian visibility listing is paired one-to-one with a read-only native directory listing so an existing object's exact raw Unicode spelling remains its resolved I/O address even when Obsidian normalizes the returned path. Any Vault/native enumeration mismatch fails closed. The adapter maintains canonical logical paths separately from raw/resolved I/O paths, checks physical containment before trust, verifies required parents at checkpoints A/B/C, observes the created note, compares exact bytes/hash, and rediscovers the created registry entry before returning `saved`.

The final ingress-order remediation validates the listing parent, Vault-returned paths, native base path, and every native `readdir()` name as well-formed strings before normalization, concatenation, collision comparison, or later path use. Malformed pairing inputs retain the exact `SOURCE_EXTERNAL_PATH_INVALID_UNICODE` diagnostic rather than collapsing into a generic enumeration failure. A production pairing-boundary regression covers valid raw-NFD matching plus malformed Vault, native, and parent strings.

The remediation pass additionally makes every precondition precede its forbidden I/O, rejects inherited or unknown graph/block structures, uses numeric Unicode code-point ordering, rechecks registry candidates after reads, treats native-only final targets as occupied, and performs a genuinely fresh post-create registry discovery. Writer self-trust covers provider, provider conversation identity, content fingerprint, and import fingerprint.

## Native containment observer

The N-API observer is intentionally narrow and read-only. The active M03.1 source and build contain only the macOS implementation:

- macOS calls `getattrlist(2)` with `ATTR_CMN_RETURNED_ATTRS`, `ATTR_VOL_INFO | ATTR_VOL_MOUNTPOINT`, and `FSOPT_NOFOLLOW_ANY | FSOPT_REPORT_FULLSIZE`, validates the returned attribute set and bounded mount-path reference, fatally decodes UTF-8, and reports only the closed mount-point result;
- the addon exposes no filesystem mutation, shell, child-process, mount, or unmount authority.

The macOS addon is built locally with Node N-API headers and `clang++`. Production eligibility is exactly `process.platform === "darwin" && process.arch === "x64"`; all other OS/architecture pairs fail closed before source writing. The active build rejects non-macOS-x86_64 environments and has no Windows/MSVC branch. Platform-neutral Windows-invalid lexical rules and synthetic reparse contracts remain covered, but do not establish Windows support. The retained candidate binary is Mach-O x86_64 and is neither an arm64/universal native observer nor a cross-platform release artifact. A universal Obsidian/Electron host running its x86_64 slice is eligible; host-bundle format alone does not determine eligibility.

## UI behavior

The preservation panel displays the configured-root state, `Preview source note`, and `Save source note`. Writable plans show a bounded inert raw-Markdown prefix in `pre > code`; truncation affects display only, never durable note bytes or hashes. Busy/pending states disable incompatible actions and expose closed status text.

## Static boundaries

The plugin gate checks that:

- native filesystem access is limited to read-only containment observation and the paired raw direct-child enumeration required to preserve resolved path spelling;
- Vault source mutation is confined to the source writer adapter/executor;
- no Node filesystem write, shell/child-process, network client, unsafe HTML sink, or unrelated persistence surface enters the production bundle;
- the native observer source contains the required read-only constants and no mount/unmount or `setattrlist` authority.

## Verification status

The final local aggregate gate passes:

```text
CI=true pnpm verify
core: 120/120 tests
plugin: 243/243 tests
aggregate: 363/363 tests
plugin static gate: PASS (15 source files; main.js=82,436 bytes; worker.js=13,180 bytes)
bundled worker smoke: PASS
M03 runtime helper contract: 28/28 assertions
```

The 363-test aggregate (120 core + 243 plugin) also covers stateless repeated root validation, actual load-only settings-byte fixtures, unsupported-future-schema explicit-save fulfillment/rejection, every persisted-settings schema family, all four fulfilled sequential page/root transaction orders, page/root pending same-value and different-value reentry under fulfillment and rejection, the five Save-start stages crossed with fulfilled/rejected root persistence, root-persistence versus Preview/Save invalidation, every named awaiting-Preview lifecycle invalidator, Preview/Save terminal-plan ownership including `post-create-stale`, full-note Save despite truncated display, own-property graph validation, positive branching/overlap/empty-ID/orphan/duplicate-ID topology, hostile block discriminators, the complete title/content-block lone-surrogate field matrix, U+2028/U+2029 frontmatter/body goldens, fatal UTF-8 malformed-registry predicates, invalid/extended registry timestamps, the exact near-16,384-byte registry trust boundary, provenance differential and allowed-collision fixtures, JSON metadata containing `": "`, numeric code-point ordering, topology-before-duplicate ordering, pre-registry gate precedence, component/path limits, NFC-equivalent target occupancy, no-I/O invalid-fingerprint precedence, exact native error-code normalization, adapter-level capability unavailability, lstat/realpath/platform-observation permission/I/O/capability/unknown outcome matrices, alias/type precedence, raw-NFD resolved addressing, root collision families, exact lowercase registry filtering, logical-path collision, created-child invalid-ingress blocking, registry realpath faults, contained registry aliases, post-read and classification-change detection, native-only target occupancy, target-probe indeterminacy, 12/20/32/64 suffix allocation and exhaustion, final collision-key occupancy, deterministic fulfilled/rejected folder and rejected-note classifiers, final Vault-operation settlement, pre/post-folder and final-note invalidation fences, post-create A/B/C macOS-mount/Windows-reparse/indeterminate/POSIX-symlink/escape injections with actual fulfilled creates, current/stale platform-race settlement, invalid external-path ingress families, config-directory collision keys, lifecycle-closed verification, post-create fresh rediscovery, production DataAdapter raw-path use, exact macOS-x86_64 eligibility, and raw-preview overflow containment.

The external zoom harness pass predicate is now a reusable module with a mandatory standalone automated contract executed by `pnpm check:plugin`. Its expanded 28 assertions cover the inclusive 358/362 width edges and outside failures, zoom readback tolerance, two-RAF requirement, outer-overflow tolerance, non-zero in-bounds rectangles, enabled Save presence, Preview/Save non-overlap, actual `Tab` transitions to both controls, restore readback, approved-document binding, exact screenshot targeting, and raw main-process call-log retention. Runtime JSON generation now embeds byte counts and SHA-256 values for `main.js`, `worker.js`, `manifest.json`, `styles.css`, the native observer, the frozen specification, and the approved amendment.

The superseding independent v4 review accepted the supplied local aggregate for AC-29 and found no remaining locally executable implementation/evidence blocker under the original spec other than the then-external Windows/host-zoom qualification. The later exact verdict `GO — M03.1 SPEC AMENDMENT APPROVED` replaced Windows qualification with the two macOS-x86_64 rows. Final independent whole-candidate review under that approved amendment remains required.

## Known limitations

- Windows and non-x86_64 macOS environments are deferred and must not be represented as supported or qualified.
- Every retained macOS runtime scenario was repeated on exact Obsidian 1.7.4 and stable 1.13.7 against the final production bytes: ordinary write/readback/duplicate, contained mount, exhaustive deep execution with complete privileged pathname capture, and exact host zoom. All rows bind the frozen specification and approved amendment.
- Exact host-level Electron main-process zoom is verified on Obsidian 1.7.4 and 1.13.7 using disposable instrumented application copies. The harness set/read 1.0 → 2.0 → 1.0, retained a 360-CSS-pixel view after two RAF turns, proved no outer overflow and in-bounds/non-overlapping controls, performed actual Tab transitions to Preview and Save, captured screenshots, verified focus, and restored zoom. The installed Obsidian application was not modified.
- Automated settings interleaving, native fault-injection, registry instability, post-create alias-race, invalid-ingress, rendering, provenance, platform-gate, and overflow coverage is materially expanded to 363 passing tests plus the 28-assertion runtime-helper contract; final independent review remains pending.
- The native addon is emitted as a path-clean Mach-O bundle. The static gate rejects embedded repository/plugin-root, `/Users/`, or `/home/` paths; earlier path-bearing binaries and traces were rejected and are excluded from final evidence.
- Runtime mutation, privacy/storage, clipboard-call, two-layer network, near-limit rendering, large-registry, and complete unfiltered privileged native-process pathname evidence is retained for both macOS versions. Fresh independent review under the approved amendment remains the sole readiness authority.

No M03 commit, push, tag, release, deployment, Community Plugin submission, or M04 work is authorized by these implementation notes.
