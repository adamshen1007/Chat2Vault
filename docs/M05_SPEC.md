# Milestone 05 Specification — OpenAI-Compatible Cloud Distillation

Version: 0.5-candidate

Status: **NO-GO — exact specification approval and implementation authorization pending**

## 1. Decision sought and byte freeze

This document defines the complete M05 implementation and acceptance boundary. A genuinely independent, read-only whole-specification review must approve one exact UTF-8 byte sequence and its SHA-256 with:

```text
GO — M05 IMPLEMENTATION AUTHORIZED
```

Any other verdict leaves M05 at NO-GO. After approval, these exact bytes and their SHA-256 become immutable implementation authority. Any byte change voids approval and requires a new hash and independent whole-specification review. Implementation and completion review must recompute the hash and stop on mismatch.

Independent specification approval does not itself authorize implementation. A separate explicit Product Owner authorization is required. Specification approval and implementation authorization do not authorize commit, push, pull request, merge, tag, deployment, release, Community Plugin submission, paid provider use, or M06 work unless the Product Owner separately authorizes those actions.

## 2. Authority and baseline

Authority order:

1. `AGENTS.md` and higher-level platform or user instructions;
2. this specification after exact independent approval and separate Product Owner implementation authorization;
3. M04 closure merge `2ac8f194adeca6de5cf2c227ca8213013455573e`;
4. exact byte-frozen `docs/M04_SPEC.md` at SHA-256 `12a6fdd8346b80e1b015c099b78c2d26c3b736b6d09dfecc55254d648df5193c`;
5. exact independently approved `docs/M03_MACOS_SCOPE_AMENDMENT.md` at SHA-256 `6cd26a318e74e7299376020cbf37608a267bf903d068aacf6debdfdc5bc02dad` for its platform and runtime clauses;
6. `docs/03_ARCHITECTURE.md`;
7. `docs/04_KNOWLEDGE_SCHEMA.md`;
8. `docs/01_PRODUCT_BRIEF.md`;
9. `docs/05_ROADMAP.md`;
10. `docs/06_OPEN_SOURCE_RELEASE_STRATEGY.md`.

M01–M04 behavior is a regression-protected baseline. M05 reuses the exact M04 request builder, prompt renderer, result validator, and inert candidate preview. It does not modify the frozen M04 specification.

## 3. Goal

M05 adds one explicitly configured OpenAI-compatible cloud adapter so a user can send the complete M04 prompt and preview validated candidates with one explicit action. It proves bounded provider execution, secret handling, disclosure, cancellation, timeout, and cost-awareness hooks without adding knowledge-note writes.

M05 remains macOS desktop x86_64 only under the approved M03.1 platform boundary.

## 4. In scope

- one OpenAI-compatible HTTPS Chat Completions endpoint;
- one configured model and one Keychain credential per persisted plugin-installation identity;
- macOS Keychain storage through a dedicated native N-API module;
- schema-versioned non-secret settings and migration;
- explicit cloud disclosure acceptance;
- exact M04 prompt generation for one complete selected conversation;
- explicit `Distill with provider` execution;
- bounded HTTPS request and response processing;
- public-network destination enforcement and redirect rejection;
- cancellation, timeout, stale-operation fencing, and plugin/view invalidation;
- strict provider-envelope extraction followed by the exact M04 result validator;
- inert in-memory candidate preview and bounded usage display;
- deterministic local HTTPS simulator and native Keychain runtime evidence;
- manual M04 copy/paste fallback.

## 5. Explicit non-goals

- Ollama, localhost, private-network, LAN, or HTTP endpoints;
- official provider SDKs or new production dependencies;
- Responses API, Assistants API, streaming, tools, function calling, images, audio, or embeddings;
- multiple provider profiles, multiple credentials, organization/project headers, arbitrary headers, proxies, or custom TLS certificates;
- OAuth, browser login, provider account creation, key issuance, billing, or model discovery;
- automatic retries, fallback models, background jobs, batching, request or settings-operation queueing, or scheduling;
- price tables, currency estimates, billing claims, or provider-specific tokenization;
- prompt, response, candidate, error-body, or usage-history persistence;
- candidate editing, acceptance, rejection, merging, promotion, or vault writing;
- M06 or later behavior;
- Windows, Linux, macOS arm64, or universal-binary support;
- release, deployment, or Community Plugin submission.

## 6. Trust and privacy boundary

Trusted application values are the frozen M04 contract and implementation outputs, validated M05 settings, application constants, locally generated operation identities, validated DNS results, TLS verification results, and local validation outcomes.

Untrusted values include imported conversation data, model output, endpoint/model strings before validation, DNS answers, all HTTP status/header/body values, provider usage values, Keychain errors, and clipboard contents.

Imported conversation content may leave the device only when all of these conditions hold atomically for the active operation:

1. the user accepted the exact cloud disclosure;
2. endpoint, model, timeout, and output cap are valid and settled;
3. a credential is present in Keychain;
4. one conversation remains actively selected;
5. the user explicitly invokes `Distill with provider`;
6. the final pre-connect staleness fence still matches selection, import, settings, request, and plugin/view generations.

M05 sends only the exact M04 rendered prompt inside the fixed request envelope in §14. It does not send vault paths, vault names, source-note paths, settings, local usernames, machine names, plugin directories, diagnostics, or candidate history.

No real/user-derived/provider-derived secret, prompt, imported text, response body, candidate body, provider error body, endpoint, hostname, model, account, or conversation value may enter console output, thrown error text exposed to the UI, diagnostics, settings, reports, fixtures, snapshots, telemetry, or Git-tracked artifacts. Deterministic synthetic test data is expressly permitted in test source, fixtures, golden bytes, snapshots, local-simulator traffic, and the narrowly retained runtime evidence required by §§20–21 only when it was authored solely for Chat2Vault tests, contains no copied/imported/user/provider data, and cannot authenticate or address a real service. Synthetic credential strings must satisfy §8 while being visibly non-provider-shaped; real provider keys remain forbidden everywhere except transient Keychain/native/request memory. This synthetic-data exception never permits production logging or persistence and never weakens the no-real-data rule.

## 7. Platform and native-module boundary

Production eligibility is exactly `process.platform === "darwin" && process.arch === "x64"`. Other platforms render provider execution unavailable and perform no Keychain or network action.

M05 adds `apps/obsidian-plugin/native/keychain.node`, built from a dedicated source file and linked only to the macOS Security and CoreFoundation frameworks. It is separate from `source_observer.node`; neither module may call the other.

The Keychain module exposes only:

```ts
interface NativeKeychain {
  abiVersion: 1;
  credentialStatus(service: string, account: string): NativeCredentialStatus;
  readCredential(service: string, account: string): NativeCredentialRead;
  setCredential(
    service: string,
    account: string,
    secret: string,
  ): NativeCredentialMutation;
  deleteCredential(service: string, account: string): NativeCredentialMutation;
}

type NativeCredentialStatus =
  { tag: "configured" } | { tag: "missing" } | { tag: "unavailable" };

type NativeCredentialRead =
  | { tag: "configured"; secret: string }
  | { tag: "missing" }
  | { tag: "unavailable" };

type NativeCredentialMutation =
  | {
      tag: "success";
      state: "configured" | "missing";
      effect: "created" | "replaced" | "deleted" | "already-missing";
    }
  | {
      tag: "failed";
      state: "unknown";
      stage: "mutation" | "verification";
      mayHaveChanged: boolean;
    };
```

Each native result must be a null-prototype or ordinary object with exactly the own enumerable data keys shown for its variant, no accessors, no symbols, the exact literal tags/fields, and no inherited authoritative value. TypeScript reads property descriptors before values, rejects any extra/missing/wrong-type field, and validates a `configured` secret against §8. For Set, success permits only `state: "configured"` with effect `created` or `replaced`; for Delete, success permits only `state: "missing"` with effect `deleted` or `already-missing`. A malformed module/export or ABI mismatch maps to `KEYCHAIN_UNAVAILABLE`. An unexpected status/read throw or malformed status/read result also maps to `KEYCHAIN_UNAVAILABLE`; an unexpected mutation throw or malformed mutation result is instead treated as `{ tag: "failed", state: "unknown", stage: "verification", mayHaveChanged: true }` and follows §8's verification-failure transition. Native code catches Security/CoreFoundation failures and returns only these closed objects; neither native throws nor returned values expose OS messages, status integers, pointers, or secret bytes except the secret in the successful read variant.

The fixed Keychain service and derived account are:

```text
service = com.chat2vault.obsidian.openai-compatible
account = installation/<installationId>
```

The service and `installation/` prefix are application constants. `installationId` is the exact persisted UUID from §9 and is never accepted from an editable setting. This defines one credential per persisted plugin-installation identity. Copying the complete plugin-data file intentionally copies the logical installation identity; two copies on the same macOS Keychain context therefore share that credential by definition. Clearing plugin data loses the account reference and can orphan the corresponding Keychain item; the UI must disclose this before credential creation and provide explicit Delete while the identity is available. No vault name or path enters the account.

The item uses a generic-password class and `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Status/read use `SecItemCopyMatching`. Set first determines missing/configured, then uses `SecItemAdd` or `SecItemUpdate`; delete uses `SecItemDelete`. Delete of a missing item is `{ tag: "success", state: "missing", effect: "already-missing" }`. Set success requires a second Security-framework read whose bytes exactly equal the requested bytes. Delete success requires a second absence query. A mutation Security call that returns failure before a successful change returns `stage: "mutation", mayHaveChanged: false`; a successful change followed by failed/mismatched verification returns `stage: "verification", mayHaveChanged: true`. The native module performs no rollback because a rollback can overwrite a concurrent external Keychain change.

The native build must fail if the Keychain module cannot be compiled for the eligible production platform. At runtime, missing/malformed/ABI-incompatible `keychain.node` disables only the M05 provider subsystem and maps to `KEYCHAIN_UNAVAILABLE`; M01–M04, including manual distillation, remain available. The existing M03 `source_observer.node` eligibility/failure boundary remains unchanged and independent. M05 claims detection only of missing exports, unexpected descriptors/shapes, and exact `abiVersion !== 1`; detecting a same-ABI malicious local binary substitution is outside the threat model. Final package hashes and runtime rows bind the intended native bytes.

## 8. Credential contract

The API key is a well-formed string containing 1–4096 visible ASCII characters U+0021 through U+007E. Space, tabs, line breaks, NUL, non-ASCII, unpaired surrogates, and longer values are rejected before native access. The key is never trimmed, normalized, masked into a reversible form, or stored outside Keychain.

The UI accepts a key only in a password control with autocomplete disabled. Saving clears the control value in a `finally` path. UI and settings state expose only `unknown`, `configured`, `missing`, or `unavailable`. Reading the secret is permitted only inside an already authorized provider operation, immediately before request-envelope creation. The adapter must drop its only JS reference in a `finally` path after request setup; M05 makes no stronger memory-erasure claim for JavaScript or OS-managed memory.

Credential observation is a closed synchronous state machine. State begins `unknown` only after §9 has established an exact durably persisted installation identity; before that point the provider subsystem is in initialization rather than credential state and no Keychain method is callable. The wrapper calls `credentialStatus()` exactly on plugin load after that persisted identity becomes authoritative, on candidate-view open, and on explicit `Refresh Keychain status`. Status/mutation calls share one non-queuing mutex; refresh or mutation entry while it is owned returns `KEYCHAIN_OPERATION_IN_PROGRESS`. Provider entry is prohibited while state is `unknown` or that mutex is owned and renders `KEYCHAIN_STATUS_UNKNOWN`. A status result installs `configured`, `missing`, or `unavailable`. Whenever an observation differs from cached state, the wrapper first increments `credentialGeneration`, invalidates/releases any Provider owner, aborts transport, then installs and renders the observed readiness state; the initial `unknown` transition follows the same rule. An unchanged observation does not increment generation or invalidate. Native status is synchronous, so no stale status settlement exists after the call returns.

Credential mutation arbitration is conservative and exact. Invalid Set input returns `KEYCHAIN_INPUT_INVALID` before native access with no mutex acquisition, Keychain access, generation change, or state change. For every valid Set or Delete request, the wrapper acquires the credential mutex, captures the prior state, synchronously increments `credentialGeneration`, invalidates every prepared/running provider owner, sets credential state to `unknown`, and only then invokes native code. This occurs even if the native result later reports `mayHaveChanged: false`. Verified success installs `configured` or `missing`. A well-formed `failed` result with `mayHaveChanged: false` restores the captured prior state and returns `KEYCHAIN_SAVE_FAILED` or `KEYCHAIN_DELETE_FAILED`. A `failed` result with `mayHaveChanged: true`, unexpected throw, or malformed result preserves `unknown` and returns `KEYCHAIN_VERIFICATION_FAILED`; only a later explicit Refresh can re-establish state. The mutex is then released exactly once. No second Set/Delete/Refresh starts until the first settles.

Inside an accepted Provider operation, `readCredential()` is itself an authoritative observation before DNS. A valid configured secret leaves cached state/generation unchanged and execution continues. Missing, unavailable, malformed, throwing, or secret-grammar-invalid read first applies the same changed-observation generation increment/invalidation transition, installs `missing` or `unavailable`, renders `KEYCHAIN_MISSING` or `KEYCHAIN_UNAVAILABLE`, releases Provider ownership, and makes that operation's eventual completion `stale`/return-only. Thus a Keychain read failure is never ambiguously classified as an accepted-operation `failed` result. A configured read whose operation became stale before request construction drops the secret and returns `stale` without changing credential state.

Tests and runtime evidence use only synthetic non-provider strings satisfying the credential grammar. A runtime-test entry point may inject a unique, run-scoped account only under the artifact rules in §21; the production entry point always derives `installation/<installationId>` and contains no callable alternate-account selector. Real provider keys must never appear in fixtures or reports.

## 9. Persisted settings v3

M05 migrates settings to this exact shape:

```ts
interface Chat2VaultSettingsV3 {
  schemaVersion: 3;
  installationId: string;
  previewMessagesPerPage: 10 | 25 | 50;
  sourceRoot: string;
  provider: {
    endpoint: string;
    model: string;
    timeoutMs: 10_000 | 30_000 | 60_000 | 120_000;
    maxOutputTokens: number;
    cloudDisclosureAccepted: boolean;
  };
}
```

`installationId` is a lowercase RFC 4122 version-4 UUID with variant bits `8`, `9`, `a`, or `b`, generated from `crypto.randomUUID()` through an injected testable CSPRNG during v2 migration or safe-default creation. Once durably authoritative it is not user-editable and is never regenerated by ordinary reset/migration; an unpersisted pending UUID is not yet `installationId` authority and follows the restart rule below. The authoritative value is used only to derive the Keychain account in §7. The default provider values are empty endpoint, empty model, `60_000`, `4_096`, and `false`. `maxOutputTokens` is an integer from 1 through 32,768 inclusive.

Installation identity initialization is a closed persistence transaction. An exact loaded v3 object already containing a valid `installationId` is durably authoritative without another write. For exact v2 migration or safe-default creation, initialization calls the CSPRNG exactly once, constructs one complete exact v3 candidate, retains that candidate and UUID as `pendingIdentity` in memory, and synchronously acquires the existing binary non-queuing settings mutex before any settings control can initiate an action. Startup ordering makes another mutex owner structurally impossible; a test must fail if initialization can observe an owned mutex. While persistence is pending, credential state is not initialized, Provider state is `unavailable`, all Keychain/network entry is prohibited, and the UI renders `PROVIDER_IDENTITY_SAVING`. Persistence fulfillment makes that exact UUID authoritative, clears pending state, initializes credential state to `unknown`, and immediately performs the one plugin-load `credentialStatus()` observation from §8. No other initialization side effect precedes fulfillment. The mutex is released exactly once in `finally` after fulfillment or rejection.

If initial persistence rejects or throws—including an outcome that may have written durably but did not fulfill—the process keeps the same `pendingIdentity` and exact v3 candidate for the remainder of that loaded plugin instance, renders `PROVIDER_IDENTITY_SAVE_FAILED`, and performs zero Keychain/network access. It does not automatically retry, generate another UUID, or treat the candidate as authoritative. The settings pane exposes `Retry provider initialization`; each activation first tries the same non-queuing settings mutex. Mutex rejection returns `PROVIDER_SETTINGS_OPERATION_IN_PROGRESS` with no persistence, UUID, identity-state, focus, Keychain, network, generation, or authority effect. Acquisition persists the same pending candidate/UUID. Another persistence failure preserves the same pending identity/diagnostic and returns focus to Retry; fulfillment follows the success path above and the §21 focus transition. Plugin unload discards an unpersisted pending identity without Keychain access. On a later load, a v3 object with a valid stored identity under the field-level rules below—including a prior ambiguous-write success—is authoritative and reuses its UUID; otherwise initialization may generate a fresh pending UUID because the prior one was never used to address Keychain or network. Restart tests must prove no Keychain access for either unpersisted identity and therefore no credential orphaning. M01–M04 remain available throughout initialization failure.

Exact v1/v2 loading first follows the frozen M03 §6 table, including its root-only recovery, and then migrates the resulting M03 settings to v3 with provider defaults. M05 does not reinterpret an M03 load category or diagnostic.

V3 loading is field-by-field and never discards one valid authority merely because another field is invalid. A safe own JSON object with numeric `schemaVersion === 3` is projected onto the five recognized top-level keys. A valid lowercase UUID remains authoritative even when another top-level field, the Provider subtree, or the top-level key set is invalid; a missing/invalid identity emits `INVALID_PERSISTED_SETTINGS` and creates one pending UUID/candidate from the independently recovered fields. A valid preview size is preserved independently; an invalid/missing preview becomes `25` and emits `INVALID_PERSISTED_SETTINGS`. A string source root follows frozen M03 normalization: configured and empty values are preserved in normalized form; a non-empty lexically invalid value becomes `""` with `INVALID_PERSISTED_SOURCE_ROOT`; a missing or non-string root becomes `""` with `INVALID_PERSISTED_SETTINGS`. An exact valid Provider subtree is preserved; an invalid/missing/extra-key Provider subtree resets only all five Provider fields to their defaults and emits `PROVIDER_SETTINGS_INVALID`. A valid identity causes no load-time write. A non-exact top-level key set emits `INVALID_PERSISTED_SETTINGS`, ignores extra keys, and still applies these recognized-field rules. A structurally unsafe top level—non-object, array, object whose prototype is neither `Object.prototype` nor `null`, accessor-bearing, symbol-bearing, cyclic, or non-JSON—cannot be projected and instead yields M03 defaults plus Provider defaults, emits `INVALID_PERSISTED_SETTINGS`, and begins the new pending-identity transaction. A safe integer schema `>= 4` yields those same defaults, emits only `UNSUPPORTED_SETTINGS_SCHEMA`, and begins the transaction. Every other non-v1/v2/v3 schema case yields those same defaults, emits only `INVALID_PERSISTED_SETTINGS`, and begins the transaction.

The three frozen settings-load diagnostics remain separate from the closed M05 table in §17 and retain these exact definitions:

| Code                            | Severity  | Exact message                                                                               |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `INVALID_PERSISTED_SOURCE_ROOT` | `warning` | `The saved source folder is invalid and was disabled in memory.`                            |
| `INVALID_PERSISTED_SETTINGS`    | `warning` | `The saved Chat2Vault settings are invalid; safe defaults were loaded in memory.`           |
| `UNSUPPORTED_SETTINGS_SCHEMA`   | `warning` | `The saved Chat2Vault settings schema is unsupported; safe defaults were loaded in memory.` |

For one v3 load, diagnostics are de-duplicated and ordered `INVALID_PERSISTED_SETTINGS`, `INVALID_PERSISTED_SOURCE_ROOT`, then `PROVIDER_SETTINGS_INVALID`. Baseline settings-load warnings remain visible in their existing settings diagnostic region and may coexist with the §17 provider status; they neither replace nor participate in provider-readiness precedence. Thus, for example, valid identity plus invalid source root plus invalid Provider retains the identity and preview, disables only the root, defaults only Provider, shows the exact source-root warning, and resolves provider readiness to `PROVIDER_SETTINGS_INVALID`. If identity is invalid, the same load warnings coexist with `PROVIDER_IDENTITY_SAVING` or `PROVIDER_IDENTITY_SAVE_FAILED` until identity persistence settles.

Mandatory load fixtures cover: every frozen M03 category; valid v3; malformed/unsupported schema; invalid source root; invalid preview; invalid identity; invalid/missing/extra-key Provider fields; extra/missing top-level keys; valid identity plus each invalid non-provider field; valid non-provider fields plus invalid Provider; combined independent failures; and every unsafe-object category. They assert recovered values, exact ordered diagnostics, whether identity persistence occurs, and zero Keychain/network access before identity authority.

Provider controls edit a non-authoritative draft. Only explicit `Save provider settings` can change authority. The saved field set is exactly endpoint, model, timeout, output cap, and disclosure acceptance; changing endpoint in the draft forces disclosure false before validation. After mutex acquisition, invalid draft entry returns `PROVIDER_SETTINGS_INVALID` with no persistence, generation, invalidation, or authoritative-memory change.

M05 preserves the frozen M03 binary non-queuing settings mutex; it adds no queue and does not change preview-page or source-root action outcomes. Every settings action first attempts that same mutex before validation or equality checking. A rejected M01–M04 action returns the existing exact `{ status: "in-progress", message: "A Chat2Vault setting is already being saved." }`. A rejected M05 Retry or Provider Save returns `PROVIDER_SETTINGS_OPERATION_IN_PROGRESS`. Every mutex rejection has no persistence, generation, invalidation, draft, identity, focus, or authority effect.

| Current mutex owner          | Initial identity persistence    | Retry identity persistence                  | Provider Save                               | Preview-page Save                       | Source-root Save                        |
| ---------------------------- | ------------------------------- | ------------------------------------------- | ------------------------------------------- | --------------------------------------- | --------------------------------------- |
| none                         | accepted before UI registration | accepted only with retained failed identity | acquire, then validate and follow algorithm | exact frozen M03 behavior               | exact frozen M03 behavior               |
| initial identity persistence | structurally impossible         | M05 busy result; no effects                 | M05 busy result; no effects                 | existing in-progress result; no effects | existing in-progress result; no effects |
| Retry identity persistence   | structurally impossible         | M05 busy result; no effects                 | M05 busy result; no effects                 | existing in-progress result; no effects | existing in-progress result; no effects |
| Provider Save                | structurally impossible         | M05 busy result; no effects                 | M05 busy result; no effects                 | existing in-progress result; no effects | existing in-progress result; no effects |
| Preview-page Save            | structurally impossible         | M05 busy result; no effects                 | M05 busy result; no effects                 | existing in-progress result; no effects | existing in-progress result; no effects |
| Source-root Save             | structurally impossible         | M05 busy result; no effects                 | M05 busy result; no effects                 | existing in-progress result; no effects | existing in-progress result; no effects |

After Provider Save acquires the mutex, an invalid draft releases it and returns `PROVIDER_SETTINGS_INVALID` with no other effect. An accepted valid Save synchronously increments `providerSaveGeneration`, invalidates/releases every Provider owner, aborts transport, installs `unconfigured` plus `PROVIDER_SETTINGS_SAVING`, and prohibits Provider entry until persistence settles. It captures the then-current complete settings object and persists exactly that object with only the five validated Provider fields replaced. Persistence success atomically installs those five values, increments `providerSettingsGeneration`, releases pending-save state, and recomputes readiness. Persistence failure retains the complete prior authoritative settings, does not increment `providerSettingsGeneration`, releases pending-save state, and installs `PROVIDER_SETTINGS_SAVE_FAILED`; the already incremented `providerSaveGeneration` means old work remains stale. Every accepted Save, including an exact-value Save, follows this algorithm. Provider capture includes both generations. Timeout/output/disclosure changes therefore use exactly the same invalidation timing as endpoint/model changes. Because no second settings action is accepted while this transaction owns the mutex, rollback cannot revert an independently successful setting, and source-root generation/invalidation behavior remains byte-for-byte unchanged.

The API key and derived Keychain account are not persisted as provider fields. Credential mutation follows the pre-call generation and fail-closed state transition in §8.

## 10. Endpoint contract

The user enters one exact endpoint URL. Validation uses the platform URL parser, then requires all of the following:

- scheme is exactly `https:`;
- username and password are empty;
- hostname is a non-empty ASCII DNS domain name; IP literals are forbidden;
- port is absent or an integer from 1 through 65,535;
- pathname is exactly `/v1/chat/completions`;
- query and fragment are empty;
- serialized canonical URL round-trips exactly after permitting only ASCII host lowercasing and removal of the default `:443` port;
- total canonical URL is at most 2,048 UTF-8 bytes.

Internationalized hostnames must already be supplied in canonical ASCII A-label form. A hostname with a trailing dot, empty label, label over 63 bytes, total DNS name over 253 bytes, underscore, percent escape, zone identifier, or non-ASCII scalar is rejected. The endpoint is stored only in canonical form.

M05 v0.5 deliberately supports IPv4 transport only. Before each connection, the adapter performs exactly one `dns.resolve4(hostname, { ttl: true })`; it never requests or falls back to AAAA. Empty, malformed, duplicate-address, zero/negative/non-integer TTL, or over-16-answer results fail. Every returned IPv4 address must pass the exact closed classifier below. This deterministic IPv4-only limitation is disclosed next to endpoint configuration; an IPv6-only endpoint is unavailable in M05.

An IPv4 address is public for M05 if and only if its canonical four-decimal-octet value is in `0.0.0.0/0` and is not in any of these denied CIDRs. The table is normative and complete for M05; first/last-address boundary tests are required for every row. No registry refresh, OS heuristic, DNS library classification, or future allocation can widen it without a newly reviewed specification:

```text
0.0.0.0/8
10.0.0.0/8
100.64.0.0/10
127.0.0.0/8
169.254.0.0/16
172.16.0.0/12
192.0.0.0/24
192.0.2.0/24
192.31.196.0/24
192.52.193.0/24
192.88.99.0/24
192.168.0.0/16
192.175.48.0/24
198.18.0.0/15
198.51.100.0/24
203.0.113.0/24
224.0.0.0/3
```

All IPv6, IPv4-mapped IPv6, NAT64, 6to4, Teredo, zone-bearing, transition/tunneling, multicast, reserved, future/unclassified, and non-canonical numeric forms fail because M05 accepts neither IPv6 DNS answers nor endpoint IP literals. After validating every A answer in verbatim resolver order, the adapter pins the first address through the HTTPS request's custom lookup callback with family `4`; the callback must never invoke DNS. The request performs no second lookup. TLS SNI and `checkServerIdentity` use the canonical DNS hostname while the socket connects to the pinned address.

## 11. Model contract

The configured model is a well-formed, NFC-normalized string of 1–200 UTF-16 code units and at most 400 UTF-8 bytes. It may contain visible Unicode but no control, format, separator, private-use, surrogate, or noncharacter scalar. Leading or trailing whitespace is invalid; the value is not trimmed automatically.

M05 does not discover, validate remotely, price, rename, or infer capabilities from the model. Provider rejection is reported as a closed request failure.

## 12. Disclosure and preflight UI

Before §9 identity initialization succeeds, M05 renders only the exact initialization diagnostic in settings and candidate surfaces; ordinary provider settings, credential, preflight, and execution controls are absent or disabled. On failure, settings additionally exposes the one explicit `Retry provider initialization` action. M01–M04 controls and manual distillation remain available and unchanged.

The settings UI must present this disclosure adjacent to the acceptance control:

```text
Cloud distillation sends the complete selected conversation to the configured provider endpoint. The provider may retain, process, or bill for this data under its own terms. Chat2Vault does not verify the provider's identity, privacy policy, prices, or model behavior.
```

It must also present these exact non-acceptance notices adjacent to the endpoint and credential controls:

```text
M05 connects only to DNS hostnames that resolve entirely to permitted public IPv4 addresses. IPv6-only, IP-literal, local, and private-network endpoints are unavailable.

Chat2Vault stores one API key in macOS Keychain for this persisted plugin-installation identity. Copies of the same plugin data on this Mac share that identity. Delete the key before clearing the plugin data to avoid leaving an orphaned Keychain item.
```

Acceptance defaults false and is revoked whenever the endpoint changes. Model-only changes do not revoke it. The acceptance control cannot be set true while the endpoint is invalid.

Endpoint, model, timeout, output cap, and acceptance controls edit only the §9 draft. `Save provider settings` is the sole persistence action. Credential controls are separate: `Save API key`, `Delete API key`, and `Refresh Keychain status` follow §8 and never persist a secret/account in settings.

The candidate view displays, before execution:

- canonical destination host and explicit port when non-default;
- configured model;
- exact M04 prompt UTF-8 byte count;
- configured maximum output tokens;
- credential state;
- disclosure state;
- readiness diagnostics.

`Distill with provider` is enabled only when all readiness conditions are met and the exact M04 request/prompt is installed for the current conversation. Clicking it is the sole authorization for one network request. No repetitive confirmation dialog is added.

While pending, the UI exposes `Cancel provider request`, disables provider execution plus M04 Prepare/Copy/Validate buttons, leaves the manual textarea editable, and announces bounded state changes through the exact accessible live-region contract in §21. A textarea input synchronously invalidates the provider operation before the unchanged M04 input transition. Existing pagination and inert rendering guarantees remain regression-protected.

## 13. Operation ownership and stale fences

Provider operation state is one of `unavailable`, `unconfigured`, `ready`, `sending`, `valid`, `invalid`, `cancelled`, or `failed`. M05 adds a provider owner coordinated with, but not substituted for, the frozen M04 owner. Entry decisions are synchronous, non-queuing, and follow this complete cross-controller table:

| Current owner | Requested Provider                                                                | Requested M04 Prepare/Copy/Validate                                                                                        | Manual textarea input                                                                                  |
| ------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| none          | start only if every §6/§12 readiness condition passes; otherwise exact diagnostic | delegate unchanged to the frozen M04 arbitration table                                                                     | delegate unchanged to M04                                                                              |
| M04 owner     | reject `PROVIDER_OPERATION_IN_PROGRESS`; do not invalidate M04                    | delegate unchanged to the frozen M04 arbitration table                                                                     | delegate unchanged to M04; its existing Validate-only invalidation applies                             |
| Provider      | reject `PROVIDER_OPERATION_IN_PROGRESS`; do not replace owner                     | reject with the frozen requested-action in-progress diagnostic; do not mutate either owner, request, preview, or clipboard | invalidate/release Provider synchronously, abort transport, then delegate the exact input event to M04 |

The requested-action M04 diagnostics are `DISTILLATION_PREPARE_IN_PROGRESS`, `DISTILLATION_COPY_IN_PROGRESS`, and `DISTILLATION_VALIDATE_IN_PROGRESS`. UI disabling is not authority; controller entry enforces every cell. Provider and M04 operations are never queued, replayed, or auto-started.

The operation captures:

- plugin loaded generation;
- view generation;
- import generation;
- conversation fingerprint;
- M04 request ID and prompt bytes;
- provider settings generation and exact canonical settings;
- provider save generation;
- credential generation;
- owner token.

It rechecks the complete capture before Keychain read, after Keychain read, after DNS resolution, immediately before HTTPS connection creation, after response headers, after every response chunk, before envelope parsing, before M04 validation, and before publishing state. Any mismatch aborts transport when present and returns `stale`. A stale fence is return-only with respect to request, preview, diagnostics, focus, and every user-visible/UI state, but it clears its own internal owner exactly once if and only if the installed owner token still equals the stale operation's token. It never clears or mutates a newer owner. Thus a mismatch with no preceding external invalidation cannot deadlock later entry, while a late old token cannot disturb the winning state.

Selection change, import replacement/clear, M04 request replacement, accepted provider-settings Save, credential mutation/changed-observation event, manual textarea input, view close, or plugin unload is an external invalidation. Draft-only provider edits are not authority and do not invalidate. An external invalidation synchronously increments its exact generation under §§8–9, marks the Provider token invalid, aborts any transport, releases Provider ownership only when the installed token matches, and applies the winning event's exact state: view close/plugin unload removes all M05 UI and state; pending provider Save becomes `unconfigured`; missing active request becomes `unconfigured`; unsupported platform or unknown/unavailable credential becomes `unavailable`; invalid saved settings, rejected disclosure, or missing credential becomes `unconfigured`; otherwise the current exact request becomes `ready`. Manual textarea input then performs the unchanged M04 preview-clearing transition. Late completion is `stale` and return-only: it cannot replace the preview, diagnostics, owner, focus, or winning state.

Provider start allocates one monotonically increasing token, installs it before the first asynchronous boundary, renders `sending`, and keeps the prior valid preview. All completion paths apply this total settlement algorithm exactly once:

1. compare token and every captured field before interpreting the completion; a mismatch applies the exact stale-owner rule above and otherwise returns `stale` with no request/preview/diagnostic/focus/UI mutation;
2. if current, atomically classify one synchronous return/throw or asynchronous fulfillment/rejection, install its one permitted result/state/diagnostic/preview transition, and release ownership only if the installed token equals the settling token;
3. a valid provider/M04 result installs `valid` and replaces the preview; an invalid provider envelope or M04 result installs `invalid` and preserves the prior valid preview; every other current failure installs `failed` and preserves it;
4. only current settlement, an external invalidation/winning controller event, or the stale operation's matching-token internal release may clear an owner; every path clears its own matching token at most once, and a late token never clears a newer owner.

Explicit Cancel and timeout are winning controller events, not ordinary transport rejections. Each first checks that the matching token still owns `sending`. Cancel wins by synchronously invalidating the token, aborting transport once, installing `cancelled` plus `PROVIDER_CANCELLED`, preserving the preview, and releasing ownership. Timeout wins identically but installs `failed` plus `PROVIDER_TIMEOUT`. JavaScript event-loop order is the tie-breaker: the first winning event settles; a later cancel/timeout/transport settlement observes no matching owner and is stale/no-op. Repeated Cancel is idempotent and produces no new diagnostic. A user action that performs an external invalidation before Cancel/timeout wins uses the external event state and makes both later events stale.

The previous valid candidate preview remains visible during a new request and after cancelled, stale, transport-failed, provider-envelope-invalid, or M04-invalid results. It is replaced only by a newly validated result owned by the current operation. The unchanged M04 rule still clears preview on an accepted Validate entry or textarea input; those events cannot occur concurrently with a current Provider owner except the textarea-input invalidation path above.

## 14. Exact provider request

M05 uses one HTTPS `POST` to the canonical endpoint. It sends exactly these application headers:

```text
Accept: application/json
Authorization: Bearer <Keychain secret>
Connection: close
Content-Type: application/json; charset=utf-8
Content-Length: <exact ASCII decimal byte count>
Host: <canonical DNS hostname plus :port only when non-default>
User-Agent: Chat2Vault/0.1.0
```

These seven headers are the complete transmitted header set, compared case-insensitively by name but with the exact values above. The adapter supplies `Host` itself and sets `setHost: false`; Node-added `Host`, `Connection`, `Transfer-Encoding`, proxy, or other headers are forbidden. Cookies, referrers, origin, arbitrary provider headers, organization/project identifiers, `Proxy-Authorization`, and `Accept-Encoding` are forbidden.

The body is stable minified JSON in this exact key order:

```ts
interface OpenAICompatibleRequest {
  model: string;
  messages: [
    {
      role: "user";
      content: string;
    },
  ];
  response_format: {
    type: "json_object";
  };
  max_tokens: number;
  stream: false;
}
```

`content` is the exact installed M04 prompt without modification. `max_tokens` is the configured output cap. The stable serializer follows the frozen M04 string and scalar rules. The complete request body must not exceed 300,000 UTF-8 bytes.

For every operation the adapter calls `https.request` with `agent: false`, `setHost: false`, the exact headers, system trust, `rejectUnauthorized: true`, minimum TLS 1.2, canonical DNS `servername`, explicit `checkServerIdentity(canonicalHostname, certificate)`, and the pinned custom lookup. It never reads proxy environment variables, uses `https.globalAgent`, accepts an injected/global/proxy Agent, reuses a socket, sends `CONNECT`, or follows 3xx. No client certificate, custom CA, disabled verification, decompression, or socket pool exists.

The request is created without calling `write` or `end`. On its one socket, the adapter waits for successful `secureConnect`, then requires `socket.remoteFamily === "IPv4"` and the canonical parsed `socket.remoteAddress` to equal the operation's pinned IPv4 exactly. A mismatch destroys the request with `PROVIDER_DNS_UNSAFE`. Only after this current-operation check may it call `request.end(exactBody)` once, causing the header/body bytes to leave the process. Therefore no Authorization header, secret, or prompt bytes are transmitted before the connected peer is proved to be the pinned address. The custom lookup must be invoked exactly once; zero or multiple invocations fail closed. Socket, headers, and total operation deadlines are all bounded by the configured timeout; the earliest limit wins.

## 15. Response transport contract

The adapter accepts only status 200. It does not parse or retain non-200 bodies. Closed mappings distinguish authentication/authorization (401/403), rate limit (429), redirect (300–399), provider rejection (other 400–499), provider failure (500–599), and unexpected status.

`Content-Encoding` must be absent or exactly `identity`. `Content-Type`, when present, must be `application/json` with no parameter except optional `charset=utf-8` matched case-insensitively. Multiple or ambiguous values fail. A valid decimal `Content-Length` over 1,048,576 bytes fails before body reading. Chunked or absent-length bodies are counted incrementally and destroyed immediately when the same inclusive limit is exceeded.

The response timeout covers DNS, connect, TLS, headers, and body. Explicit cancel and timeout destroy the request and response streams. Transport errors become closed diagnostics without embedding hostnames, IPs, OS errors, certificate text, headers, or bodies.

The adapter may expose only these bounded informational values:

- HTTP status category;
- `Retry-After` as either a non-negative integer number of seconds no greater than 86,400 or absent;
- provider request ID from one `x-request-id` header only when it is 1–200 visible ASCII characters;
- validated usage from §16.

These values are untrusted display metadata. They never trigger retries, writes, or authorization.

## 16. Provider response envelope

The successful body must be one UTF-8 JSON object. UTF-8 decoding is fatal. BOM, duplicate decoded member names at any depth, prototype-related member names (`__proto__`, `prototype`, `constructor`), unpaired surrogates, comments, trailing data, non-finite numbers, and excessive nesting fail. Container depth is mathematical and exact: the root object has depth 1; entering each child object or array increments depth by 1; scalar values do not add depth; entering any container at depth 33 fails before allocating that container. Containers at depths 31 and 32 are permitted subject to all other rules. Exact pure-object, pure-array-below-root, and mixed object/array fixtures cover accepted depth 31/32 and rejected depth 33.

The parser permits provider-specific extra fields but reads only own data properties from these paths:

```ts
interface OpenAICompatibleResponseProjection {
  choices: [
    {
      message: {
        content: string;
      };
    },
  ];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
```

`choices` must contain exactly one element. `message.content` must be a string and is passed byte-for-byte as decoded UTF-16 to the frozen M04 raw-result validator; it is never trimmed, repaired, fence-stripped, concatenated, or coerced. Null, array, multipart, or missing `content` fails closed. Every provider-specific extra field—including `message.refusal`, `message.tool_calls`, `message.function_call`, choice finish metadata, and parallel content-part fields—is ignored after global duplicate/prototype/depth/Unicode validation, regardless of presence, type, or value. A valid string `content` is therefore decisive even when refusal/tool-call extras coexist; M05 never reads or rejects those extras semantically.

Usage is optional. Each recognized usage value, when present, must be a non-negative safe integer. If all three are present, `total_tokens` must equal `prompt_tokens + completion_tokens`. Malformed usage causes usage to be omitted but does not invalidate otherwise valid candidate content. Extra usage keys are ignored after duplicate/security validation. Display labels state that provider-reported token counts are unverified and may not reflect billing.

## 17. Diagnostics

An M05 diagnostic has exactly `{ severity, code, message }`, no extra keys, and one row from this normative table. No other M05 code or message is permitted.

| Code                                      | Severity  | Exact fixed message                                                       | Trigger/stage                                                  | Provider state/result                      |
| ----------------------------------------- | --------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| `PROVIDER_UNSUPPORTED_PLATFORM`           | `error`   | `Cloud provider execution is unavailable on this platform.`               | eligibility before native/network access                       | `unavailable` / `not-ready`                |
| `PROVIDER_IDENTITY_SAVING`                | `info`    | `Provider installation identity is being saved.`                          | initial v3 persistence pending                                 | `unavailable` / `initializing`             |
| `PROVIDER_IDENTITY_SAVE_FAILED`           | `error`   | `Provider installation identity could not be saved.`                      | initial v3 persistence rejection/throw                         | `unavailable` / `initialization-failed`    |
| `KEYCHAIN_UNAVAILABLE`                    | `error`   | `The macOS Keychain credential service is unavailable.`                   | module/ABI/status/read unavailable or malformed observation    | `unavailable` / `not-ready`                |
| `KEYCHAIN_STATUS_UNKNOWN`                 | `warning` | `Refresh macOS Keychain status before sending.`                           | unknown state at readiness                                     | `unavailable` / `not-ready`                |
| `KEYCHAIN_INPUT_INVALID`                  | `error`   | `Enter an API key using 1 to 4096 visible ASCII characters.`              | Set input fails §8 grammar before mutex/native access          | unchanged / `credential-invalid`           |
| `KEYCHAIN_OPERATION_IN_PROGRESS`          | `warning` | `Another Keychain credential operation is already in progress.`           | Set/Delete/Refresh entry while credential mutex is owned       | unchanged / `busy`                         |
| `PROVIDER_SETTINGS_INVALID`               | `error`   | `Configure a valid provider endpoint, model, timeout, and output limit.`  | exact settings validation                                      | `unconfigured` / `not-ready`               |
| `PROVIDER_SETTINGS_OPERATION_IN_PROGRESS` | `warning` | `Another Chat2Vault setting is already being saved.`                      | M05 settings action while the global settings mutex is owned   | unchanged / `busy`                         |
| `PROVIDER_DISCLOSURE_REQUIRED`            | `warning` | `Accept the cloud data disclosure before sending.`                        | disclosure readiness                                           | `unconfigured` / `not-ready`               |
| `KEYCHAIN_MISSING`                        | `warning` | `Save a provider API key in macOS Keychain before sending.`               | verified missing status/read                                   | `unconfigured` / `not-ready`               |
| `KEYCHAIN_SAVE_FAILED`                    | `error`   | `The provider API key was not saved.`                                     | Set `stage: mutation`, `mayHaveChanged: false`                 | restored prior state / `credential-failed` |
| `KEYCHAIN_VERIFICATION_FAILED`            | `error`   | `The provider API key change could not be verified.`                      | `mayHaveChanged: true`, malformed result, or mutation throw    | `unavailable` / `credential-indeterminate` |
| `KEYCHAIN_DELETE_FAILED`                  | `error`   | `The provider API key was not deleted.`                                   | Delete `stage: mutation`, `mayHaveChanged: false`              | restored prior state / `credential-failed` |
| `PROVIDER_NO_ACTIVE_REQUEST`              | `warning` | `Prepare a current distillation request before sending.`                  | no exact current M04 request                                   | `unconfigured` / `not-ready`               |
| `PROVIDER_OPERATION_IN_PROGRESS`          | `warning` | `Another distillation operation is already in progress.`                  | cross-controller entry rejection                               | unchanged / `busy`                         |
| `PROVIDER_SETTINGS_SAVING`                | `info`    | `Provider settings are being saved.`                                      | accepted provider-settings Save before persistence             | `unconfigured` / `saving`                  |
| `PROVIDER_SETTINGS_SAVE_FAILED`           | `error`   | `Provider settings could not be saved.`                                   | provider-settings persistence failure                          | recomputed prior state / `settings-failed` |
| `PROVIDER_READY`                          | `info`    | `The provider is ready to send the current request.`                      | all readiness conditions settled                               | `ready` / `ready`                          |
| `PROVIDER_SENDING`                        | `info`    | `The provider request is in progress.`                                    | accepted Provider entry                                        | `sending` / `started`                      |
| `PROVIDER_VALID`                          | `info`    | `The provider result was validated.`                                      | current envelope and M04 validation success                    | `valid` / `valid`                          |
| `PROVIDER_DNS_UNSAFE`                     | `error`   | `The provider destination is not permitted by the public-network policy.` | malformed/empty/duplicate/over-limit/denied DNS answer set     | `failed` / `failed`                        |
| `PROVIDER_DNS_FAILED`                     | `error`   | `The provider destination could not be resolved.`                         | resolver throw/failure without exposing its value              | `failed` / `failed`                        |
| `PROVIDER_REQUEST_TOO_LARGE`              | `error`   | `The provider request exceeds the allowed size.`                          | request body exceeds §14                                       | `failed` / `failed`                        |
| `PROVIDER_TIMEOUT`                        | `error`   | `The provider request timed out.`                                         | winning timeout event                                          | `failed` / `timeout`                       |
| `PROVIDER_CANCELLED`                      | `info`    | `The provider request was cancelled.`                                     | winning explicit Cancel                                        | `cancelled` / `cancelled`                  |
| `PROVIDER_TLS_FAILED`                     | `error`   | `A secure connection to the provider could not be established.`           | TLS negotiation/certificate/hostname failure                   | `failed` / `failed`                        |
| `PROVIDER_NETWORK_FAILED`                 | `error`   | `The provider request failed before a valid response was received.`       | other connect/socket/request/response transport failure        | `failed` / `failed`                        |
| `PROVIDER_REDIRECT_REJECTED`              | `error`   | `The provider returned a redirect, which Chat2Vault does not follow.`     | HTTP 300–399                                                   | `failed` / `failed`                        |
| `PROVIDER_AUTH_REJECTED`                  | `error`   | `The provider rejected the configured credential.`                        | HTTP 401 or 403                                                | `failed` / `failed`                        |
| `PROVIDER_RATE_LIMITED`                   | `warning` | `The provider rate limit was reached.`                                    | HTTP 429                                                       | `failed` / `failed`                        |
| `PROVIDER_REQUEST_REJECTED`               | `error`   | `The provider rejected the request.`                                      | other HTTP 400–499                                             | `failed` / `failed`                        |
| `PROVIDER_SERVICE_FAILED`                 | `error`   | `The provider reported a service failure.`                                | HTTP 500–599                                                   | `failed` / `failed`                        |
| `PROVIDER_STATUS_INVALID`                 | `error`   | `The provider returned an unsupported HTTP status.`                       | any other status                                               | `failed` / `failed`                        |
| `PROVIDER_RESPONSE_TOO_LARGE`             | `error`   | `The provider response exceeds the allowed size.`                         | declared or observed body limit                                | `failed` / `failed`                        |
| `PROVIDER_RESPONSE_METADATA_INVALID`      | `error`   | `The provider response metadata is invalid.`                              | encoding/content-type/content-length/header ambiguity          | `failed` / `failed`                        |
| `PROVIDER_ENVELOPE_INVALID`               | `error`   | `The provider response is not a valid Chat2Vault provider envelope.`      | UTF-8/JSON/projection failure                                  | `invalid` / `invalid`                      |
| `PROVIDER_RESULT_INVALID`                 | `error`   | `The provider result did not satisfy the distillation contract.`          | frozen M04 validation failure                                  | `invalid` / `invalid`                      |
| `PROVIDER_STALE`                          | `info`    | `The provider operation became stale and was discarded.`                  | stale fence; return-only and never rendered over winning state | unchanged / `stale`                        |

Readiness precedence is unsupported platform, installation-identity saving/failure, Keychain unavailable, Keychain unknown, pending provider-settings Save, settings invalid, disclosure required, Keychain missing, no active request, then ready. An existing distillation owner makes `PROVIDER_OPERATION_IN_PROGRESS` the entry result before evaluating a new request's readiness; an existing credential owner makes `KEYCHAIN_OPERATION_IN_PROGRESS` the credential-action result; an existing settings owner makes `PROVIDER_SETTINGS_OPERATION_IN_PROGRESS` the rejected M05 settings-action result without replacing the settled readiness state. `PROVIDER_IDENTITY_SAVING`, `PROVIDER_SETTINGS_SAVING`, `PROVIDER_READY`, `PROVIDER_SENDING`, and `PROVIDER_VALID` are application-authored status diagnostics, not failures. Identity initialization precedes and prohibits every Keychain/provider action. Invalid credential input precedes mutex/native access only after identity initialization succeeds. Credential mutation failures use `mayHaveChanged` plus attempted method: Set/false maps to save failure and restores prior state; Delete/false maps to delete failure and restores prior state; true/malformed/throw maps to verification failure and unknown state.

For an accepted operation, the §13 stale comparison occurs before interpreting every completion. If current, detection order is Keychain read/observation, request size, DNS policy, timeout/cancel event order, TLS/pinned-socket/transport, HTTP status, response metadata/size, UTF-8/JSON/envelope, then M04 validation; the first detected failure is the only diagnostic. A changed Keychain read observation is the winning external event from §8 and makes Provider settlement stale rather than failed. Diagnostics never interpolate untrusted or sensitive values. The UI separately displays already-validated endpoint host and model in dedicated fields, not inside diagnostic text.

## 18. Cost-awareness hooks

M05 cost awareness is deliberately provider-neutral:

- preflight displays exact prompt UTF-8 bytes and configured output-token cap;
- the request always includes the cap;
- postflight displays validated provider-reported token usage when available;
- rate-limit retry seconds may be shown when valid;
- the UI states that Chat2Vault does not know or verify provider pricing and that token usage may differ from billing.

M05 performs no token estimation, price lookup, currency conversion, budget enforcement, or cost claim.

## 19. No-write and no-persistence guarantee

The provider subsystem receives no vault mutation capability. Static dependency gates must prove that M05 core/provider modules do not import Obsidian APIs, source writer modules, filesystem mutation APIs, child-process APIs, shell APIs, clipboard reads, browser automation, telemetry, or persistence callbacks other than the narrow settings controller and Keychain adapter where explicitly specified.

Production Provider-operation prompts, responses, candidates, usage, operation state, and diagnostics remain in application memory only. Settings persistence contains only the exact v3 non-secret shape. Keychain persistence contains only the one credential. The deterministic synthetic test-source/fixture/screenshot artifacts expressly permitted by §6 are verification inputs/evidence, never values captured from a production Provider operation and never application persistence. M03 source-note save remains a separate explicit user action. M06 knowledge-note promotion does not exist in M05.

## 20. Automated verification

Required automated evidence includes:

1. v2-to-v3 migration and safe-default identity initialization success, persistence failure, same-identity retry, ambiguous-write reload, clean restart, zero pre-authority Keychain/network access, exact v3 validation, draft/save mutex, both provider generation timelines, rollback, serialization, every field invalidation, and provider-entry prohibition while pending;
2. endpoint/model/key validation and every limit boundary, including invalid-key zero-native/zero-generation assertions;
3. every exact IPv4 denied-CIDR boundary, public complements, and rejection of every IPv6/IP-literal form;
4. controlled A-only DNS resolution, denied/duplicate/malformed answer rejection, verbatim-order pinning, and no second lookup;
5. exact seven request headers/body golden bytes and absence of every forbidden/automatic header;
6. local synthetic TLS success with hostname verification, `agent: false`, exactly one lookup, post-`secureConnect` remote-address equality, and no bytes sent before that equality;
7. TLS failure, redirect, timeout, cancellation, response-limit, encoding, content-type, and status mappings;
8. duplicate/security-aware provider-envelope parsing, depth-31/32/33 pure/mixed fixtures, ignored refusal/tool-call extras, and exact content forwarding;
9. usage validation and omission behavior;
10. every exact Keychain ABI shape, initial/view/explicit status refresh, mutex cell, cached/read observation transition, invalid input, mutation/verification/indeterminate path, generation transition, and synthetic native credential lifecycle;
11. every cross-controller arbitration cell, synchronous/asynchronous settlement, cancel/timeout/event-order pair, and stale fence in §13, including a mismatch with no prior external invalidation that clears only its own matching owner;
12. previous-preview preservation, textarea invalidation, and manual M04 fallback;
13. exact settings/candidate-view focus, live-region, host-zoom, password-control, disclosure, and inert-rendering assertions;
14. static no-write, no-secret, dependency-direction, single-network-surface, no-global-Agent, no-proxy-env, no-socket-reuse, and no-extra-header checks;
15. complete M01–M04 regression suite, build, bundled worker smoke, and native-module verification.

Network unit and integration tests must use only the deterministic synthetic local fixtures and injected seams permitted by §6. They must never contact a public provider, require a real credential, or copy any user/provider value. Golden request/response/candidate bodies are Git-trackable only as visibly synthetic test literals and must pass a scan excluding provider-shaped credentials and real conversation exports.

Transport negative tests replace `https.globalAgent`, enable Node environment-proxy configuration, set `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`, offer a reusable pooled socket, return zero/two lookup calls, and connect to a non-pinned remote address. Every case must prove no proxy/CONNECT, no reuse, no sensitive bytes before the pinned-address check, and the exact closed failure.

## 21. Runtime acceptance matrix

Runtime qualification is macOS desktop x86_64 on exactly two rows:

1. exact Obsidian `1.7.4`;
2. the official public stable Obsidian desktop version resolved from official release metadata on the execution date.

If official stable equals `1.7.4`, the second row uses the next independently verified official stable required by the Product Owner; one execution cannot count twice. Both rows use identical final production `main.js`, `worker.js`, `manifest.json`, `styles.css`, `source_observer.node`, and `keychain.node` bytes and record each SHA-256 and byte count. Both rows also bind this approved M05 hash, frozen M04 hash, approved M03.1 amendment hash, Obsidian version/source metadata, macOS version/build, architecture, Electron, Chromium, and Node component identities.

Runtime acceptance uses a disposable synthetic Obsidian vault and deterministic local HTTPS server. The separate `runtime-test-entry.ts` bundle executes the exact production provider controller and exact production HTTPS transport module. It injects only (a) a runtime network-test seam and (b) a unique run-scoped Keychain account. The network-test seam controls resolver answers, the public-policy decision for the one reserved `.invalid` simulator hostname, and—only for the pinned-mismatch scenario—the socket destination. It does not construct a response, report a transport outcome, replace `https.request`, intercept headers/body, replace TLS or hostname verification, suppress `secureConnect`, change `agent: false`, change timeout/response handling, or decide any production diagnostic. All ordinary and negative outcomes flow through the unchanged production transport.

For ordinary success/failure scenarios the seam resolves `m05.invalid` to the simulator's exact loopback address and permits only that exact address; production code still constructs the pinned custom lookup and compares the actual post-`secureConnect` remote family/address with that pin before `end(exactBody)`. Before each Obsidian process starts, the harness creates one ephemeral synthetic CA and an `m05.invalid` server certificate, launches that row with `NODE_EXTRA_CA_CERTS` pointing only to the CA certificate, and records the certificate hashes. The production bundle neither reads nor sets that environment variable and passes no `ca`; `rejectUnauthorized: true`, SNI, and the exact production `checkServerIdentity` path remain mandatory. Both rows use identical CA/server-certificate bytes, and the private key, CA, and server state are deleted and independently proven absent in `finally`. This is a runtime-harness trust input only, not a production custom-CA feature. The mismatch scenario alone supplies a distinct socket destination so the unchanged comparison rejects it before sensitive bytes are sent. Unsafe-DNS scenarios run the unchanged production public-address classifier against deterministic denied answers; the runtime-only loopback allowance is not used for them. Proxy environment, replaced global Agent, reusable-socket offers, TLS, hostname, header, body, timeout, status, size, and response scenarios all execute the exact production `https.request` path.

The runtime-test artifact may differ from production only in its entry module, the runtime network-test seam, the runtime Keychain adapter, and bundler reachability metadata caused solely by those modules. It may not replace or branch the production controller, production transport, request/envelope validators, settings model, diagnostics, rendering, ownership logic, TLS/hostname verifier, header/body builder, or response handling.

Each row records the runtime-test bundle hash and a machine-readable esbuild metafile containing normalized source paths, input-byte identities, output contribution, build options, and entry point. A comparison gate must prove the production provider-transport source bytes and output contribution are identical in both artifacts, prove identical hashes for every other shared input module, and reject any unexpected input, conditional constant, alias, define, loader, plugin, external, or build-option difference. The production bundle must pass a static graph/string gate proving it contains no runtime-test entry/seam, loopback-policy allowance, alternate-account selector, sentinel parser, socket-destination override, conditional branch, or callable runtime-test resolver path. The production composition root binds the transport only to the production resolver/policy/socket adapter; no production export or UI path can select or inject the test seam. The test bundle is evidence only and is never copied into the production package.

Every required scenario runs on both rows. The gate must prove:

- native Keychain initial/view/explicit status refresh; invalid-key zero-access; synthetic set/read/replace/delete/absence; every observation/generation/mutex/indeterminate transition; and cleanup verified in a `finally` path;
- settings migration and safe-default initialization success, identity-persistence failure, same-pending-identity retry, ambiguous-write reload, restart with zero access for any unpersisted identity, per-installation identity, cross-identity credential isolation, every draft/save/persistence success/failure generation transition, provider-entry prohibition while pending, and disclosure behavior;
- exact host/model/bytes/cap preflight;
- one explicit successful provider operation through the simulator;
- strict M04 validation and inert preview;
- every §13 cross-controller arbitration cell; cancel/timeout ordering; textarea invalidation; stale mismatch without prior external invalidation and matching-owner release; immediate fresh entry after release; late old-token settlement after a newer owner; and every Keychain/settings/selection/import/request/view/plugin stale boundary;
- redirect, authentication, rate-limit, oversized response, malformed metadata/envelope, depth boundaries, ignored refusal/tool extras, invalid candidate, unsafe DNS, pinned-remote mismatch, TLS, generic-network, proxy-environment, global-Agent, and socket-reuse outcomes;
- zero vault mutations from every M05 path;
- zero application/settings/log/telemetry persistence of any prompt, response, candidate, or secret; retained deterministic synthetic test artifacts are only the §6 evidence exception;
- exactly the expected network attempts and zero background/retry traffic;
- manual M04 fallback remains functional;
- exact accessibility and zoom procedures below.

Before installation identity authority exists, all ordinary M05 controls are absent or disabled. While initial persistence is running there is no M05 focusable control; after failure the sole M05 focusable control is `Retry provider initialization`. After identity initialization succeeds, the settings pane keyboard order is endpoint text input, model text input, timeout selector, maximum-output-token number input, disclosure checkbox, `Save provider settings`, API-key password input, `Save API key`, `Delete API key`, then `Refresh Keychain status`. Disabled or absent controls are skipped by native sequential focus rules. The candidate view order extends the frozen M04 sequence as: `Prepare`, `Copy prompt`, textarea, `Validate result`, `Distill with provider`, `Cancel provider request` only while sending, then existing `Previous page` and `Next page` controls when enabled. Provider preflight values, credential state, usage, and diagnostics are non-focusable text.

Activating Distill moves focus to Cancel after it is inserted. Async completion never steals focus unless Cancel held focus when removed, in which case focus moves to Distill. Activating Cancel moves focus to Distill. An external invalidation applies the same rule. Initialization Retry, provider-settings Save, and credential Save/Delete/Refresh return focus to their triggering button after settlement when that button remains present and never place secret text in an announcement. Successful Retry removes itself and moves focus to the endpoint input. One persistent `role="status" aria-live="polite" aria-atomic="true"` region announces exactly the fixed §17 message for readiness/result transitions; repeated identical state does not reannounce. Transport completion, cancellation, timeout, invalid response, and valid-candidate installation each receive runtime assertions against the exact visible/live text.

On each runtime row, an external Electron-main-process harness must identify the exact Chat2Vault `webContents`, record/read back host zoom `1.0`, set/read back `2.0`, await two `requestAnimationFrame` turns, then restore/read back `1.0`, each within ±0.01. At zoom `2.0`, the Chat2Vault content `clientWidth` must be `358..362` CSS pixels. The harness records non-zero rectangles for every enabled settings control, exact disclosure, password control, provider preflight/status, Distill, pending Cancel, manual M04 controls, candidate preview, and pagination. Pass requires `scrollWidth <= clientWidth + 1`, every rectangle inside horizontal bounds within 1 CSS pixel, no actionable-control overlap, no hidden status/disclosure, internal textarea/body vertical scrolling only, and actual Tab/Shift-Tab transitions matching both exact focus orders. Each row retains one raw, unredacted 200% screenshot, raw focus transitions, rectangles, zoom call log, two-RAF proof, and restoration evidence. The screenshot uses exactly `https://m05.invalid/v1/chat/completions` / `m05.invalid` and model `synthetic-m05-model`, plus only deterministic synthetic request/candidate display content from committed test fixtures. These reserved `.invalid` values cannot address a real provider and are the only endpoint/hostname/model literals permitted in retained screenshots. OS scaling, CSS zoom, text zoom, pinch zoom, browser emulation, or unit tests do not substitute.

The gate must attribute process, operation, candidate vault, simulator, network attempt count, hashed Keychain account identity, artifact set, and mutation sentinel. Machine-readable reports contain only scenario IDs, counts, hashes, rectangles, timings, closed outcomes, and the explicitly reserved synthetic host/model literals above; they contain no secret, raw account, vault path/name, username, machine name, real hostname/endpoint/model, or raw prompt/response/candidate/conversation content. The retained screenshot may contain the reserved synthetic host/model and deterministic synthetic displayed prompt/candidate fixture content under §6; no redaction is applied, so it directly proves the tested UI. Failure to clean up the synthetic Keychain item is NO-GO.

A real-provider smoke is optional and requires separate explicit authorization for credential use, provider disclosure, and potential cost. It is not required for M05 implementation approval or commit readiness.

## 22. Acceptance criteria

| ID    | Criterion                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | The exact approved specification hash matches before implementation and completion review.                                                                                                                                                                                                                                                                                              |
| AC-02 | Only macOS desktop x86_64 is production-eligible; all other platforms fail before native or network access.                                                                                                                                                                                                                                                                             |
| AC-03 | The exact ABI-1 native/TypeScript boundary implements the total credential observation/mutex/read/mutation state machine for each durably authoritative installation identity without exposing secret/error bytes; initialization failure and invalid input perform zero native access, and every valid mutation advances generation before native access.                              |
| AC-04 | Settings preserve every frozen M03 load/recovery diagnostic, migrate v1/v2 to v3, recover v3 field-by-field without collateral authority loss, use the unchanged binary non-queuing settings mutex for every action, persist no secret/account, and implement the exact identity and Provider save/rollback/two-generation algorithms.                                                  |
| AC-05 | Endpoint validation enforces the exact canonical HTTPS Chat Completions policy.                                                                                                                                                                                                                                                                                                         |
| AC-06 | A-only DNS and the frozen IPv4 CIDR classifier reject every denied/malformed/duplicate/IPv6/IP-literal result, pin the first validated answer, and perform no second lookup.                                                                                                                                                                                                            |
| AC-07 | Model, key, timeout, output-token, request-body, and response-body limits pass inclusive boundary tests.                                                                                                                                                                                                                                                                                |
| AC-08 | Cloud disclosure is exact, defaults false, revokes on endpoint change, and gates execution.                                                                                                                                                                                                                                                                                             |
| AC-09 | Preflight shows validated host, model, exact prompt bytes, output cap, credential state, disclosure state, and readiness.                                                                                                                                                                                                                                                               |
| AC-10 | One explicit click produces exactly one bounded fresh-socket HTTPS request with the exact seven headers and golden body only after secure peer address equals the operation's pinned IPv4.                                                                                                                                                                                              |
| AC-11 | System TLS and hostname verification remain enabled; global/proxy Agents, environment proxies, socket reuse, extra headers, redirects, compression, custom trust, and HTTP are unavailable.                                                                                                                                                                                             |
| AC-12 | Every Provider × M04/manual-input arbitration cell and cancellation/timeout/event-order settlement terminates transport, releases only its matching ownership exactly once, and obeys complete stale fences without mutating winning UI state.                                                                                                                                          |
| AC-13 | Every initialization, readiness, settings-save, credential observation/input/mutex/mutation/read, DNS, HTTP, transport, response, envelope, result, cancel, timeout, and stale outcome maps by exact precedence to the closed §17 table without reading/exposing provider error bodies.                                                                                                 |
| AC-14 | Successful response transport enforces status, content metadata, fatal UTF-8, size, and the exact container-depth resource limit.                                                                                                                                                                                                                                                       |
| AC-15 | Provider envelope parsing rejects duplicates/security hazards, ignores every provider-specific extra including refusal/tool-call fields, and forwards exactly one string content unchanged to the frozen M04 validator.                                                                                                                                                                 |
| AC-16 | Valid candidates use the existing inert in-memory M04 preview; invalid or stale outcomes preserve the previous valid preview.                                                                                                                                                                                                                                                           |
| AC-17 | Usage and retry metadata are bounded, untrusted, informational only, and never trigger retries or writes.                                                                                                                                                                                                                                                                               |
| AC-18 | The provider subsystem has no vault mutation capability and M03 source saving remains separate.                                                                                                                                                                                                                                                                                         |
| AC-19 | Real/user/provider secrets, prompts, responses, candidates, endpoints, models, usage history, and errors are absent from settings, logs, reports, fixtures, and Git artifacts; only the narrowly defined deterministic synthetic test/evidence values from §§6/20–21 are permitted.                                                                                                     |
| AC-20 | Initialization, settings, and provider UI pass the exact focus order, focus-winner, live-region, password/disclosure, rectangle/overflow, reserved-synthetic screenshot, and external 100%→200%→100% host-zoom procedures on both rows.                                                                                                                                                 |
| AC-21 | Native, unit, integration, static, build, worker, production-transport identity, test-artifact-delta, two-row runtime, and complete M01–M04 regression gates pass with exact recorded commands and results.                                                                                                                                                                             |
| AC-22 | Both required Obsidian rows bind identical production hashes and approved authorities; the strictly delimited test bundle executes the byte/source-identical production HTTPS transport and proves identity initialization, synthetic Keychain/CA cleanup, expected network attempts, zero M05 vault mutation, zero application persistence of secret/content, and every required path. |
| AC-23 | Manual M04 mode remains available and byte-compatible with its frozen contract.                                                                                                                                                                                                                                                                                                         |
| AC-24 | No Ollama/local-network adapter, M06 behavior, release, deployment, or unsupported-platform claim is implemented.                                                                                                                                                                                                                                                                       |

## 23. Completion and publication gates

Implementation completion requires:

1. exact frozen-spec hash confirmation;
2. complete changed/untracked file inventory;
3. all AC-01 through AC-24 mapped to implementation and evidence;
4. exact automated commands and actual outcomes;
5. complete attributed exact-1.7.4/current-stable macOS x86_64 runtime evidence with production/test artifact-delta binding;
6. real/user/provider secret/content redaction, an exact inventory of every permitted deterministic synthetic fixture/screenshot artifact, and a repository scan proving the §6 boundary;
7. whole-branch diff review against baseline `2ac8f194adeca6de5cf2c227ca8213013455573e`;
8. a frozen review packet with SHA-256, size, inventory, and archive-integrity evidence;
9. genuinely independent whole-candidate review returning exactly:

```text
GO — M05 COMMIT READY
```

Any missing, failed, unproven, contaminated, or non-independent gate is NO-GO. Green local tests alone do not authorize commit or publication.

After `GO — M05 COMMIT READY`, commit, push, pull request, merge, tag, deployment, release, paid provider use, Community submission, and M06 remain separate Product Owner decisions unless already explicitly authorized by the current task.

## 24. Required completion report

The report must include decision; objective and scope; non-goals; root, branch, base, upstream, HEAD, and worktree state; changed files; implementation summary; AC mapping; exact verification table; native/runtime evidence; frozen hashes; independent verdict; review findings and remediations; risks and limitations; manual actions; and separate commit/push/PR/merge/tag/deploy/release/M06 states.

The report must explicitly confirm:

- no real credential or conversation export entered repository or evidence;
- synthetic Keychain evidence was cleaned up;
- provider execution performed zero vault writes;
- no automatic retries or background requests occurred;
- no Ollama/local-network adapter or M06 behavior was implemented;
- no unsupported platform, release, deployment, privacy, cost, or billing claim was made.
