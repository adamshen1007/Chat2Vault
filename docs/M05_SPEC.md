# Milestone 05 Specification — OpenAI-Compatible Cloud Distillation

Version: 0.2-candidate

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
- automatic retries, fallback models, background jobs, batching, queueing, or scheduling;
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

No secret, prompt, imported text, response body, candidate body, or provider error body may enter console output, thrown error text exposed to the UI, diagnostics, settings, reports, fixtures, snapshots, telemetry, or Git-tracked artifacts.

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

Each native result must be a null-prototype or ordinary object with exactly the own enumerable data keys shown for its variant, no accessors, no symbols, the exact literal tags/fields, and no inherited authoritative value. TypeScript reads property descriptors before values, rejects any extra/missing/wrong-type field, and validates a `configured` secret against §8. For Set, success permits only `state: "configured"` with effect `created` or `replaced`; for Delete, success permits only `state: "missing"` with effect `deleted` or `already-missing`. Any unexpected native throw, malformed module/export, ABI mismatch, or unexpected result shape maps to `KEYCHAIN_UNAVAILABLE`; a malformed/throwing mutation result is treated as `{ tag: "failed", state: "unknown", stage: "verification", mayHaveChanged: true }`. Native code catches Security/CoreFoundation failures and returns only these closed objects; neither native throws nor returned values expose OS messages, status integers, pointers, or secret bytes except the secret in the successful read variant.

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

Credential mutation arbitration is conservative and exact. Invalid input is rejected before native access and does not change `credentialGeneration`. For every valid Set or Delete request, the wrapper synchronously increments `credentialGeneration`, invalidates every prepared/running provider owner, sets credential state to `unknown`, and only then invokes native code. This occurs even if the native result later reports `mayHaveChanged: false`. Verified success installs `configured` or `missing`; any throw, malformed result, or `failed` result installs `unknown` when `mayHaveChanged` is true and `unavailable` otherwise. A later explicit status/read may re-establish `configured` or `missing` but never decrements generation. Mutation attempts are serialized within the plugin; no second Set/Delete starts until the first settles. Provider execution is unavailable while credential state is `unknown` or a mutation is unsettled.

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

`installationId` is a lowercase RFC 4122 version-4 UUID with variant bits `8`, `9`, `a`, or `b`, generated exactly once from `crypto.randomUUID()` through an injected testable CSPRNG during v2 migration or safe-default creation. It is not user-editable, never regenerated by ordinary reset/migration, and is used only to derive the Keychain account in §7. The default provider values are empty endpoint, empty model, `60_000`, `4_096`, and `false`. `maxOutputTokens` is an integer from 1 through 32,768 inclusive.

Exact v2 settings migrate to v3 with existing M02/M03 values preserved and provider defaults installed. Exact v3 settings are accepted only when every field is present, every object has exactly the specified own keys, strings are well formed, and all values pass validation. Unknown schema versions and malformed values fail to safe defaults with closed diagnostics. Prototype-bearing, accessor-bearing, cyclic, non-JSON, or extra-key objects are rejected.

Endpoint or model changes, disclosure revocation, or provider-setting persistence failure invalidate every prepared or running provider operation. A provider-setting save is serialized with existing setting saves, applied in memory only with rollback on persistence failure, and increments a provider generation only after successful persistence. Source-root invalidation behavior remains unchanged.

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

M05 v0.2 deliberately supports IPv4 transport only. Before each connection, the adapter performs exactly one `dns.resolve4(hostname, { ttl: true })`; it never requests or falls back to AAAA. Empty, malformed, duplicate-address, zero/negative/non-integer TTL, or over-16-answer results fail. Every returned IPv4 address must pass the exact closed classifier below. This deterministic IPv4-only limitation is disclosed next to endpoint configuration; an IPv6-only endpoint is unavailable in M05.

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
- credential generation;
- owner token.

It rechecks the complete capture before Keychain read, after Keychain read, after DNS resolution, immediately before HTTPS connection creation, after response headers, after every response chunk, before envelope parsing, before M04 validation, and before publishing state. Any mismatch aborts the transport when present, releases ownership, returns `stale`, and publishes no late state.

Selection change, import replacement/clear, M04 request replacement, endpoint/model/timeout/output/disclosure change, credential mutation attempt, manual textarea input, view close, or plugin unload is an external invalidation. It synchronously increments the applicable generation, marks the Provider token invalid, aborts any transport, releases Provider ownership only when the installed token matches, and applies the winning event's exact state: view close/plugin unload removes all M05 UI and state; missing active request becomes `unconfigured`; unsupported platform or unknown/unavailable credential becomes `unavailable`; invalid settings, rejected disclosure, or missing credential becomes `unconfigured`; otherwise the current exact request becomes `ready`. Manual textarea input then performs the unchanged M04 preview-clearing transition. Late completion is `stale` and return-only: it cannot replace the preview, diagnostics, owner, focus, or winning state.

Provider start allocates one monotonically increasing token, installs it before the first asynchronous boundary, renders `sending`, and keeps the prior valid preview. All completion paths apply this total settlement algorithm exactly once:

1. compare token and every captured field before interpreting the completion; a mismatch returns `stale` with no UI/state mutation;
2. if current, atomically classify one synchronous return/throw or asynchronous fulfillment/rejection, install its one permitted result/state/diagnostic/preview transition, and release ownership only if the installed token equals the settling token;
3. a valid provider/M04 result installs `valid` and replaces the preview; an invalid provider envelope or M04 result installs `invalid` and preserves the prior valid preview; every other current failure installs `failed` and preserves it;
4. no other completion path clears an owner, and a late token never clears a newer owner.

Explicit Cancel and timeout are winning controller events, not ordinary transport rejections. Each first checks that the matching token still owns `sending`. Cancel wins by synchronously invalidating the token, aborting transport once, installing `cancelled` plus `PROVIDER_CANCELLED`, preserving the preview, and releasing ownership. Timeout wins identically but installs `failed` plus `PROVIDER_TIMEOUT`. JavaScript event-loop order is the tie-breaker: the first winning event settles; a later cancel/timeout/transport settlement observes no matching owner and is stale/no-op. Repeated Cancel is idempotent and produces no new diagnostic. A user action that performs an external invalidation before Cancel/timeout wins uses the external event state and makes both later events stale.

The previous valid candidate preview remains visible during a new request and after cancelled, stale, transport-failed, provider-envelope-invalid, or M04-invalid results. It is replaced only by a newly validated result owned by the current operation. The unchanged M04 rule still clears preview on an accepted Validate entry or textarea input; those events cannot occur concurrently with a current Provider owner except the textarea-input invalidation path above.

## 14. Exact provider request

M05 uses one HTTPS `POST` to the canonical endpoint. It sends exactly these application headers:

```text
Accept: application/json
Authorization: Bearer <Keychain secret>
Content-Type: application/json; charset=utf-8
Content-Length: <exact ASCII decimal byte count>
User-Agent: Chat2Vault/0.1.0
```

Connection-managed headers added by Node are permitted. Cookies, referrers, origin, arbitrary provider headers, organization/project identifiers, and `Accept-Encoding` are forbidden.

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

The adapter uses `https.request` with system trust, hostname verification, minimum TLS 1.2, pinned custom lookup, `redirect: error` semantics implemented by never following 3xx, no client certificate, no custom CA, no disabled verification, and no decompression. Socket, headers, and total operation deadlines are all bounded by the configured timeout; the earliest limit wins.

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

The successful body must be one UTF-8 JSON object. UTF-8 decoding is fatal. BOM, duplicate decoded member names at any depth, prototype-related member names (`__proto__`, `prototype`, `constructor`), unpaired surrogates, comments, trailing data, non-finite numbers, and excessive nesting over 32 levels fail.

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

`choices` must contain exactly one element. `message.content` must be a string and is passed byte-for-byte as decoded UTF-16 to the frozen M04 raw-result validator; it is never trimmed, repaired, fence-stripped, concatenated, or coerced. A null, array, multipart, refusal, tool call, or missing content fails closed.

Usage is optional. Each recognized usage value, when present, must be a non-negative safe integer. If all three are present, `total_tokens` must equal `prompt_tokens + completion_tokens`. Malformed usage causes usage to be omitted but does not invalidate otherwise valid candidate content. Extra usage keys are ignored after duplicate/security validation. Display labels state that provider-reported token counts are unverified and may not reflect billing.

## 17. Diagnostics

An M05 diagnostic has exactly `{ severity, code, message }`, no extra keys, and one row from this normative table. No other M05 code or message is permitted.

| Code                                 | Severity  | Exact fixed message                                                       | Trigger/stage                                                  | Provider state/result                      |
| ------------------------------------ | --------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| `PROVIDER_UNSUPPORTED_PLATFORM`      | `error`   | `Cloud provider execution is unavailable on this platform.`               | eligibility before native/network access                       | `unavailable` / `not-ready`                |
| `KEYCHAIN_UNAVAILABLE`               | `error`   | `The macOS Keychain credential service is unavailable.`                   | module/ABI/status/read unavailable or malformed                | `unavailable` / `not-ready` or `failed`    |
| `PROVIDER_SETTINGS_INVALID`          | `error`   | `Configure a valid provider endpoint, model, timeout, and output limit.`  | exact settings validation                                      | `unconfigured` / `not-ready`               |
| `PROVIDER_DISCLOSURE_REQUIRED`       | `warning` | `Accept the cloud data disclosure before sending.`                        | disclosure readiness                                           | `unconfigured` / `not-ready`               |
| `KEYCHAIN_MISSING`                   | `warning` | `Save a provider API key in macOS Keychain before sending.`               | verified missing status/read                                   | `unconfigured` / `not-ready`               |
| `KEYCHAIN_SAVE_FAILED`               | `error`   | `The provider API key was not saved.`                                     | Set `stage: mutation`                                          | `unavailable` / `credential-failed`        |
| `KEYCHAIN_VERIFICATION_FAILED`       | `error`   | `The provider API key change could not be verified.`                      | Set/Delete `stage: verification` or indeterminate shape/throw  | `unavailable` / `credential-indeterminate` |
| `KEYCHAIN_DELETE_FAILED`             | `error`   | `The provider API key was not deleted.`                                   | Delete `stage: mutation`                                       | `unavailable` / `credential-failed`        |
| `PROVIDER_NO_ACTIVE_REQUEST`         | `warning` | `Prepare a current distillation request before sending.`                  | no exact current M04 request                                   | `unconfigured` / `not-ready`               |
| `PROVIDER_OPERATION_IN_PROGRESS`     | `warning` | `Another distillation operation is already in progress.`                  | cross-controller entry rejection                               | unchanged / `busy`                         |
| `PROVIDER_READY`                     | `info`    | `The provider is ready to send the current request.`                      | all readiness conditions settled                               | `ready` / `ready`                          |
| `PROVIDER_SENDING`                   | `info`    | `The provider request is in progress.`                                    | accepted Provider entry                                        | `sending` / `started`                      |
| `PROVIDER_VALID`                     | `info`    | `The provider result was validated.`                                      | current envelope and M04 validation success                    | `valid` / `valid`                          |
| `PROVIDER_DNS_UNSAFE`                | `error`   | `The provider destination is not permitted by the public-network policy.` | malformed/empty/duplicate/over-limit/denied DNS answer set     | `failed` / `failed`                        |
| `PROVIDER_DNS_FAILED`                | `error`   | `The provider destination could not be resolved.`                         | resolver throw/failure without exposing its value              | `failed` / `failed`                        |
| `PROVIDER_REQUEST_TOO_LARGE`         | `error`   | `The provider request exceeds the allowed size.`                          | request body exceeds §14                                       | `failed` / `failed`                        |
| `PROVIDER_TIMEOUT`                   | `error`   | `The provider request timed out.`                                         | winning timeout event                                          | `failed` / `timeout`                       |
| `PROVIDER_CANCELLED`                 | `info`    | `The provider request was cancelled.`                                     | winning explicit Cancel                                        | `cancelled` / `cancelled`                  |
| `PROVIDER_TLS_FAILED`                | `error`   | `A secure connection to the provider could not be established.`           | TLS negotiation/certificate/hostname failure                   | `failed` / `failed`                        |
| `PROVIDER_NETWORK_FAILED`            | `error`   | `The provider request failed before a valid response was received.`       | other connect/socket/request/response transport failure        | `failed` / `failed`                        |
| `PROVIDER_REDIRECT_REJECTED`         | `error`   | `The provider returned a redirect, which Chat2Vault does not follow.`     | HTTP 300–399                                                   | `failed` / `failed`                        |
| `PROVIDER_AUTH_REJECTED`             | `error`   | `The provider rejected the configured credential.`                        | HTTP 401 or 403                                                | `failed` / `failed`                        |
| `PROVIDER_RATE_LIMITED`              | `warning` | `The provider rate limit was reached.`                                    | HTTP 429                                                       | `failed` / `failed`                        |
| `PROVIDER_REQUEST_REJECTED`          | `error`   | `The provider rejected the request.`                                      | other HTTP 400–499                                             | `failed` / `failed`                        |
| `PROVIDER_SERVICE_FAILED`            | `error`   | `The provider reported a service failure.`                                | HTTP 500–599                                                   | `failed` / `failed`                        |
| `PROVIDER_STATUS_INVALID`            | `error`   | `The provider returned an unsupported HTTP status.`                       | any other status                                               | `failed` / `failed`                        |
| `PROVIDER_RESPONSE_TOO_LARGE`        | `error`   | `The provider response exceeds the allowed size.`                         | declared or observed body limit                                | `failed` / `failed`                        |
| `PROVIDER_RESPONSE_METADATA_INVALID` | `error`   | `The provider response metadata is invalid.`                              | encoding/content-type/content-length/header ambiguity          | `failed` / `failed`                        |
| `PROVIDER_ENVELOPE_INVALID`          | `error`   | `The provider response is not a valid Chat2Vault provider envelope.`      | UTF-8/JSON/projection failure                                  | `invalid` / `invalid`                      |
| `PROVIDER_RESULT_INVALID`            | `error`   | `The provider result did not satisfy the distillation contract.`          | frozen M04 validation failure                                  | `invalid` / `invalid`                      |
| `PROVIDER_STALE`                     | `info`    | `The provider operation became stale and was discarded.`                  | stale fence; return-only and never rendered over winning state | unchanged / `stale`                        |

Readiness precedence is unsupported platform, Keychain unavailable, settings invalid, disclosure required, Keychain missing, no active request, then ready. An existing owner makes `PROVIDER_OPERATION_IN_PROGRESS` the entry result before evaluating a new request's readiness. `PROVIDER_READY`, `PROVIDER_SENDING`, and `PROVIDER_VALID` are application-authored status diagnostics, not failures. Credential mutation failures use the attempted method plus native stage: Set/mutation maps to save failure; Delete/mutation maps to delete failure; either verification/indeterminate path maps to verification failure.

For an accepted operation, the §13 stale comparison occurs before interpreting every completion. If current, detection order is DNS policy, request size, timeout/cancel event order, TLS/transport, HTTP status, response metadata/size, UTF-8/JSON/envelope, then M04 validation; the first detected failure is the only diagnostic. Diagnostics never interpolate untrusted or sensitive values. The UI separately displays already-validated endpoint host and model in dedicated fields, not inside diagnostic text.

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

Provider prompts, responses, candidates, usage, operation state, and diagnostics remain in memory only. Settings persistence contains only the exact v3 non-secret shape. Keychain persistence contains only the one credential. M03 source-note save remains a separate explicit user action. M06 knowledge-note promotion does not exist in M05.

## 20. Automated verification

Required automated evidence includes:

1. v2-to-v3 settings migration, exact v3 validation, rollback, serialization, and invalidation;
2. endpoint/model/key validation and every limit boundary;
3. every exact IPv4 denied-CIDR boundary, public complements, and rejection of every IPv6/IP-literal form;
4. controlled A-only DNS resolution, denied/duplicate/malformed answer rejection, verbatim-order pinning, and no second lookup;
5. exact request headers/body golden bytes and absence of forbidden headers;
6. local synthetic TLS success with hostname verification and pinned lookup;
7. TLS failure, redirect, timeout, cancellation, response-limit, encoding, content-type, and status mappings;
8. duplicate/security-aware provider-envelope parsing and exact content forwarding;
9. usage validation and omission behavior;
10. every exact Keychain ABI shape, mutation/verification/indeterminate path, generation transition, and synthetic native credential lifecycle;
11. every cross-controller arbitration cell, synchronous/asynchronous settlement, cancel/timeout/event-order pair, and stale fence in §13;
12. previous-preview preservation, textarea invalidation, and manual M04 fallback;
13. exact settings/candidate-view focus, live-region, host-zoom, password-control, disclosure, and inert-rendering assertions;
14. static no-write, no-secret, dependency-direction, and single-network-surface checks;
15. complete M01–M04 regression suite, build, bundled worker smoke, and native-module verification.

Network unit and integration tests must use synthetic local fixtures and injected seams. They must never contact a public provider or require a real credential.

## 21. Runtime acceptance matrix

Runtime qualification is macOS desktop x86_64 on exactly two rows:

1. exact Obsidian `1.7.4`;
2. the official public stable Obsidian desktop version resolved from official release metadata on the execution date.

If official stable equals `1.7.4`, the second row uses the next independently verified official stable required by the Product Owner; one execution cannot count twice. Both rows use identical final production `main.js`, `worker.js`, `manifest.json`, `styles.css`, `source_observer.node`, and `keychain.node` bytes and record each SHA-256 and byte count. Both rows also bind this approved M05 hash, frozen M04 hash, approved M03.1 amendment hash, Obsidian version/source metadata, macOS version/build, architecture, Electron, Chromium, and Node component identities.

Runtime acceptance uses a disposable synthetic Obsidian vault and deterministic local HTTPS simulator. Production endpoint policy rejects loopback, so the actual simulator paths execute from a separate `runtime-test-entry.ts` bundle. That entry imports the exact production provider controller, transport interface, request/envelope validators, M04 validator, UI components, and native-wrapper validators, but injects only (a) a loopback simulator transport implementation and (b) a unique run-scoped Keychain account. The runtime-test artifact may differ from production only in its entry module, the two injected adapter modules, and bundler reachability metadata caused solely by those modules. It may not replace or branch the production controller, validators, settings model, diagnostics, rendering, or ownership logic.

Each row records the runtime-test bundle hash and a machine-readable esbuild metafile containing normalized source paths, input-byte identities, output contribution, build options, and entry point. A comparison gate must prove identical hashes for every shared input module and reject any unexpected input, conditional constant, alias, define, loader, plugin, external, or build-option difference. The production bundle must pass a static graph/string gate proving it contains no runtime-test entry, simulator implementation, loopback-policy bypass, alternate-account selector, sentinel parser, or callable unsafe resolver path. The test bundle is evidence only and is never copied into the production package.

Every required scenario runs on both rows. The gate must prove:

- native Keychain synthetic set/read/replace/delete/absence with cleanup verified in a `finally` path;
- settings migration, per-installation identity, cross-identity credential isolation, and disclosure behavior;
- exact host/model/bytes/cap preflight;
- one explicit successful provider operation through the simulator;
- strict M04 validation and inert preview;
- every §13 cross-controller arbitration cell; cancel/timeout ordering; textarea invalidation; immediate fresh entry after release; late old-token settlement after a newer owner; and every Keychain/settings/selection/import/request/view/plugin stale boundary;
- redirect, authentication, rate-limit, oversized response, malformed metadata/envelope, invalid candidate, unsafe DNS, TLS, and generic-network outcomes;
- zero vault mutations from every M05 path;
- zero prompt/response/secret persistence;
- exactly the expected network attempts and zero background/retry traffic;
- manual M04 fallback remains functional;
- exact accessibility and zoom procedures below.

The settings pane keyboard order is endpoint text input, model text input, timeout selector, maximum-output-token number input, disclosure checkbox, API-key password input, `Save API key`, then `Delete API key`. Disabled or absent controls are skipped by native sequential focus rules. The candidate view order extends the frozen M04 sequence as: `Prepare`, `Copy prompt`, textarea, `Validate result`, `Distill with provider`, `Cancel provider request` only while sending, then existing candidate pagination controls. Provider preflight values, credential state, usage, and diagnostics are non-focusable text.

Activating Distill moves focus to Cancel after it is inserted. Async completion never steals focus unless Cancel held focus when removed, in which case focus moves to Distill. Activating Cancel moves focus to Distill. An external invalidation applies the same rule. Settings save/delete returns focus to the triggering button after settlement and never places secret text in an announcement. One persistent `role="status" aria-live="polite" aria-atomic="true"` region announces exactly the fixed §17 message for readiness/result transitions; repeated identical state does not reannounce. Transport completion, cancellation, timeout, invalid response, and valid-candidate installation each receive runtime assertions against the exact visible/live text.

On each runtime row, an external Electron-main-process harness must identify the exact Chat2Vault `webContents`, record/read back host zoom `1.0`, set/read back `2.0`, await two `requestAnimationFrame` turns, then restore/read back `1.0`, each within ±0.01. At zoom `2.0`, the Chat2Vault content `clientWidth` must be `358..362` CSS pixels. The harness records non-zero rectangles for every enabled settings control, exact disclosure, password control, provider preflight/status, Distill, pending Cancel, manual M04 controls, candidate preview, and pagination. Pass requires `scrollWidth <= clientWidth + 1`, every rectangle inside horizontal bounds within 1 CSS pixel, no actionable-control overlap, no hidden status/disclosure, internal textarea/body vertical scrolling only, and actual Tab/Shift-Tab transitions matching both exact focus orders. Each row retains one 200% screenshot, raw focus transitions, rectangles, zoom call log, two-RAF proof, and restoration evidence. OS scaling, CSS zoom, text zoom, pinch zoom, browser emulation, or unit tests do not substitute.

The gate must attribute process, operation, candidate vault, simulator, network attempt count, hashed Keychain account identity, artifact set, and mutation sentinel. Evidence must contain no secret, raw account, vault path/name, username, machine name, hostname, endpoint, model, prompt, response, candidate content, or conversation content. Failure to clean up the synthetic Keychain item is NO-GO.

A real-provider smoke is optional and requires separate explicit authorization for credential use, provider disclosure, and potential cost. It is not required for M05 implementation approval or commit readiness.

## 22. Acceptance criteria

| ID    | Criterion                                                                                                                                                                                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | The exact approved specification hash matches before implementation and completion review.                                                                                                                                                                                                                    |
| AC-02 | Only macOS desktop x86_64 is production-eligible; all other platforms fail before native or network access.                                                                                                                                                                                                   |
| AC-03 | The exact ABI-1 native/TypeScript boundary stores, verifies, reads, replaces, deletes, and verifies absence of each installation identity's credential without exposing secret/error bytes; every mutation attempt advances the generation before native access and settles fail closed.                      |
| AC-04 | Settings migrate exactly from v2 to v3 with one non-editable installation UUID, persist no secret/account, reject malformed/extra state, serialize saves, roll back failures, and invalidate provider work correctly.                                                                                         |
| AC-05 | Endpoint validation enforces the exact canonical HTTPS Chat Completions policy.                                                                                                                                                                                                                               |
| AC-06 | A-only DNS and the frozen IPv4 CIDR classifier reject every denied/malformed/duplicate/IPv6/IP-literal result, pin the first validated answer, and perform no second lookup.                                                                                                                                  |
| AC-07 | Model, key, timeout, output-token, request-body, and response-body limits pass inclusive boundary tests.                                                                                                                                                                                                      |
| AC-08 | Cloud disclosure is exact, defaults false, revokes on endpoint change, and gates execution.                                                                                                                                                                                                                   |
| AC-09 | Preflight shows validated host, model, exact prompt bytes, output cap, credential state, disclosure state, and readiness.                                                                                                                                                                                     |
| AC-10 | One explicit click produces exactly one bounded HTTPS request with the exact allowed headers and golden request body.                                                                                                                                                                                         |
| AC-11 | System TLS and hostname verification remain enabled; redirects, compression, custom trust, proxy/custom headers, and HTTP are unavailable.                                                                                                                                                                    |
| AC-12 | Every Provider × M04/manual-input arbitration cell and cancellation/timeout/event-order settlement terminates transport, releases ownership exactly once, and obeys complete stale fences.                                                                                                                    |
| AC-13 | Every readiness, credential, DNS, HTTP, transport, response, envelope, result, cancel, timeout, and stale outcome maps by exact precedence to the closed §17 diagnostic table without reading or exposing provider error bodies.                                                                              |
| AC-14 | Successful response transport enforces status, content metadata, fatal UTF-8, size, and parsing limits.                                                                                                                                                                                                       |
| AC-15 | Provider envelope parsing rejects duplicates/security hazards and forwards exactly one content string unchanged to the frozen M04 validator.                                                                                                                                                                  |
| AC-16 | Valid candidates use the existing inert in-memory M04 preview; invalid or stale outcomes preserve the previous valid preview.                                                                                                                                                                                 |
| AC-17 | Usage and retry metadata are bounded, untrusted, informational only, and never trigger retries or writes.                                                                                                                                                                                                     |
| AC-18 | The provider subsystem has no vault mutation capability and M03 source saving remains separate.                                                                                                                                                                                                               |
| AC-19 | Prompts, responses, candidates, usage history, errors, and keys are absent from settings, logs, reports, fixtures, and Git artifacts.                                                                                                                                                                         |
| AC-20 | Settings and provider UI pass the exact two-view focus order, focus-winner, live-region, password/disclosure, rectangle/overflow, and external 100%→200%→100% host-zoom procedures on both rows.                                                                                                              |
| AC-21 | Native, unit, integration, static, build, worker, test-artifact-delta, two-row runtime, and complete M01–M04 regression gates pass with exact recorded commands and results.                                                                                                                                  |
| AC-22 | Both required Obsidian rows bind identical production hashes and approved authorities; the strictly delimited test bundle proves synthetic Keychain cleanup, expected network attempts, zero M05 vault mutation, zero secret/content persistence, and every required success/failure/race/accessibility path. |
| AC-23 | Manual M04 mode remains available and byte-compatible with its frozen contract.                                                                                                                                                                                                                               |
| AC-24 | No Ollama/local-network adapter, M06 behavior, release, deployment, or unsupported-platform claim is implemented.                                                                                                                                                                                             |

## 23. Completion and publication gates

Implementation completion requires:

1. exact frozen-spec hash confirmation;
2. complete changed/untracked file inventory;
3. all AC-01 through AC-24 mapped to implementation and evidence;
4. exact automated commands and actual outcomes;
5. complete attributed exact-1.7.4/current-stable macOS x86_64 runtime evidence with production/test artifact-delta binding;
6. secret/content redaction and repository scan;
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
