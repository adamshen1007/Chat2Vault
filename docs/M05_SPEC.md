# Milestone 05 Specification — OpenAI-Compatible Cloud Distillation

Version: 0.1-candidate

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
5. `docs/03_ARCHITECTURE.md`;
6. `docs/04_KNOWLEDGE_SCHEMA.md`;
7. `docs/01_PRODUCT_BRIEF.md`;
8. `docs/05_ROADMAP.md`;
9. `docs/06_OPEN_SOURCE_RELEASE_STRATEGY.md`.

M01–M04 behavior is a regression-protected baseline. M05 reuses the exact M04 request builder, prompt renderer, result validator, and inert candidate preview. It does not modify the frozen M04 specification.

## 3. Goal

M05 adds one explicitly configured OpenAI-compatible cloud adapter so a user can send the complete M04 prompt and preview validated candidates with one explicit action. It proves bounded provider execution, secret handling, disclosure, cancellation, timeout, and cost-awareness hooks without adding knowledge-note writes.

M05 remains macOS desktop x86_64 only under the approved M03.1 platform boundary.

## 4. In scope

- one OpenAI-compatible HTTPS Chat Completions endpoint;
- one configured model and one Keychain credential per plugin installation;
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
  credentialStatus(service: string, account: string): NativeCredentialStatus;
  readCredential(service: string, account: string): NativeCredentialRead;
  setCredential(
    service: string,
    account: string,
    secret: string,
  ): NativeCredentialMutation;
  deleteCredential(service: string, account: string): NativeCredentialMutation;
}
```

Every returned value is an exact tagged object validated by TypeScript before use. Unexpected native throws or shapes become `KEYCHAIN_UNAVAILABLE`. Native errors expose only closed status tags, never OS messages or secret bytes.

The fixed Keychain identifiers are:

```text
service = com.chat2vault.obsidian.openai-compatible
account = default
```

They are application constants and are not user-controlled. The item uses a generic-password class and a this-device-only accessibility class available after first unlock. Add/update, read, status, and delete are fail-closed. Delete of a missing item is idempotent success. A set operation must verify the exact stored bytes through a second Security-framework read before reporting success. A delete must verify absence before reporting success.

The native build must fail if the Keychain module cannot be compiled for the eligible production platform. The plugin must fail closed if either required native module is missing, malformed, substituted, or incompatible.

## 8. Credential contract

The API key is a well-formed string containing 1–4096 visible ASCII characters U+0021 through U+007E. Space, tabs, line breaks, NUL, non-ASCII, unpaired surrogates, and longer values are rejected before native access. The key is never trimmed, normalized, masked into a reversible form, or stored outside Keychain.

The UI accepts a key only in a password control with autocomplete disabled. Saving clears the control value in a `finally` path. UI and settings state expose only `unknown`, `configured`, `missing`, or `unavailable`. Reading the secret is permitted only inside an already authorized provider operation, immediately before request-envelope creation. The adapter must drop its only JS reference in a `finally` path after request setup; M05 makes no stronger memory-erasure claim for JavaScript or OS-managed memory.

Tests and runtime evidence use only synthetic non-provider strings satisfying the credential grammar. A test-build wrapper may use a unique, run-scoped account name only while an explicit runtime-test sentinel is present; the production wrapper must accept only the fixed `default` account and must contain no callable test sentinel. Real provider keys must never appear in fixtures or reports.

## 9. Persisted settings v3

M05 migrates settings to this exact shape:

```ts
interface Chat2VaultSettingsV3 {
  schemaVersion: 3;
  previewMessagesPerPage: 10 | 25 | 50;
  sourceRoot: string;
  provider: {
    endpoint: string;
    model: string;
    timeoutMs: 10_000 | 30_000 | 60_000 | 120_000;
    maxOutputTokens: number;
    cloudDisclosureAccepted: boolean;
    credentialAccount: "default";
  };
}
```

The default provider values are empty endpoint, empty model, `60_000`, `4_096`, `false`, and `"default"`. `maxOutputTokens` is an integer from 1 through 32,768 inclusive.

Exact v2 settings migrate to v3 with existing M02/M03 values preserved and provider defaults installed. Exact v3 settings are accepted only when every field is present, every object has exactly the specified own keys, strings are well formed, and all values pass validation. Unknown schema versions and malformed values fail to safe defaults with closed diagnostics. Prototype-bearing, accessor-bearing, cyclic, non-JSON, or extra-key objects are rejected.

Endpoint or model changes, disclosure revocation, or provider-setting persistence failure invalidate every prepared or running provider operation. A provider-setting save is serialized with existing setting saves, applied in memory only with rollback on persistence failure, and increments a provider generation only after successful persistence. Source-root invalidation behavior remains unchanged.

The API key is not part of settings. Deleting or replacing it increments a separate credential generation and invalidates running or prepared provider operations only after the native operation is verified successful.

## 10. Endpoint contract

The user enters one exact endpoint URL. Validation uses the platform URL parser, then requires all of the following:

- scheme is exactly `https:`;
- username and password are empty;
- hostname is a non-empty ASCII domain name or IP literal;
- port is absent or an integer from 1 through 65,535;
- pathname is exactly `/v1/chat/completions`;
- query and fragment are empty;
- serialized canonical URL round-trips exactly after permitting only ASCII host lowercasing and removal of the default `:443` port;
- total canonical URL is at most 2,048 UTF-8 bytes.

Internationalized hostnames must already be supplied in canonical ASCII A-label form. A hostname with a trailing dot, empty label, label over 63 bytes, total DNS name over 253 bytes, underscore, percent escape, zone identifier, or non-ASCII scalar is rejected. The endpoint is stored only in canonical form.

Literal IPs and every DNS answer must be globally routable unicast. The adapter rejects unspecified, loopback, private, shared-address, link-local, multicast, documentation, benchmarking, protocol-assignment, carrier-grade NAT, reserved, broadcast, IPv4-mapped IPv6, unique-local IPv6, deprecated site-local IPv6, and any address not affirmatively classified as public. Classification is implemented as pure code with exhaustive boundary tests.

Before each connection, the adapter resolves the canonical hostname once with all addresses requested and verbatim ordering. Empty, mixed-public/private, malformed, or over-16-answer results fail. Every answer must be public and share one address family selected for that operation. The first validated answer is pinned through the HTTPS request's custom lookup callback; the request must not perform a second DNS lookup. TLS Server Name Indication and hostname verification continue to use the canonical hostname, never the numeric address.

## 11. Model contract

The configured model is a well-formed, NFC-normalized string of 1–200 UTF-16 code units and at most 400 UTF-8 bytes. It may contain visible Unicode but no control, format, separator, private-use, surrogate, or noncharacter scalar. Leading or trailing whitespace is invalid; the value is not trimmed automatically.

M05 does not discover, validate remotely, price, rename, or infer capabilities from the model. Provider rejection is reported as a closed request failure.

## 12. Disclosure and preflight UI

The settings UI must present this disclosure adjacent to the acceptance control:

```text
Cloud distillation sends the complete selected conversation to the configured provider endpoint. The provider may retain, process, or bill for this data under its own terms. Chat2Vault does not verify the provider's identity, privacy policy, prices, or model behavior.
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

While pending, the UI exposes `Cancel provider request`, disables conflicting provider actions, keeps manual M04 controls non-mutating, and announces bounded state changes through accessible live regions. Existing zoom, focus, keyboard, pagination, and inert rendering guarantees remain regression-protected.

## 13. Operation ownership and stale fences

Provider operation state is one of `unavailable`, `unconfigured`, `ready`, `sending`, `valid`, `invalid`, `cancelled`, or `failed`. One owner token arbitrates one request.

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

Selection change, import replacement/clear, M04 request replacement, endpoint/model/timeout/output/disclosure change, credential replacement/deletion, view close, plugin unload, timeout, or explicit cancel invalidates the owner. Cancellation is idempotent. A late resolve or rejection after invalidation cannot replace the previous valid candidate preview or diagnostics.

The previous valid candidate preview remains visible during a new request and after cancelled, stale, transport-failed, provider-envelope-invalid, or M04-invalid results. It is replaced only by a newly validated result owned by the current operation.

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

M05 diagnostics are closed application-authored values with severity, code, and fixed message. At minimum they cover:

- unsupported platform or unavailable native module;
- invalid or unsettled settings;
- disclosure required;
- Keychain missing, unavailable, save failure, verification failure, or delete failure;
- no active M04 request;
- request already in progress;
- unsafe or failed DNS;
- request too large;
- timeout or explicit cancellation;
- TLS/network failure;
- redirect, authentication, rate limit, provider rejection, or provider failure;
- response too large or invalid transport metadata;
- invalid provider envelope;
- invalid M04 result;
- stale operation.

Diagnostics never interpolate untrusted or sensitive values. The UI separately displays already-validated endpoint host and model in their dedicated fields, not inside diagnostic text.

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
3. exhaustive public/private IPv4 and IPv6 classification boundaries;
4. controlled DNS resolution, mixed-answer rejection, address pinning, and no second lookup;
5. exact request headers/body golden bytes and absence of forbidden headers;
6. local synthetic TLS success with hostname verification and pinned lookup;
7. TLS failure, redirect, timeout, cancellation, response-limit, encoding, content-type, and status mappings;
8. duplicate/security-aware provider-envelope parsing and exact content forwarding;
9. usage validation and omission behavior;
10. Keychain adapter shape validation and synthetic native credential lifecycle;
11. controller ownership and every stale fence in §13;
12. previous-preview preservation and manual M04 fallback;
13. settings/candidate-view accessibility and inert rendering;
14. static no-write, no-secret, dependency-direction, and single-network-surface checks;
15. complete M01–M04 regression suite, build, bundled worker smoke, and native-module verification.

Network unit and integration tests must use synthetic local fixtures and injected seams. They must never contact a public provider or require a real credential.

## 21. Runtime acceptance matrix

Runtime acceptance uses a disposable synthetic Obsidian vault and deterministic local HTTPS simulator. Because production endpoint policy rejects loopback, the runtime harness may inject the already-tested transport seam and a unique run-scoped Keychain account only when an explicit test-build sentinel is present. Production bundles must statically prove that no bypass sentinel, alternate Keychain account, or unsafe resolver path exists.

The macOS x86_64 runtime gate must prove:

- native Keychain synthetic set/read/replace/delete/absence with cleanup verified in a `finally` path;
- settings migration and disclosure behavior;
- exact host/model/bytes/cap preflight;
- one explicit successful provider operation through the simulator;
- strict M04 validation and inert preview;
- cancellation, timeout, redirect, authentication, rate-limit, oversized response, malformed envelope, invalid candidate, and stale-race outcomes;
- zero vault mutations from every M05 path;
- zero prompt/response/secret persistence;
- exactly the expected network attempts and zero background/retry traffic;
- manual M04 fallback remains functional.

The gate must attribute process, operation, candidate vault, simulator, network attempt count, Keychain account, and mutation sentinel. Evidence must contain no secret or conversation content. Failure to clean up the synthetic Keychain item is NO-GO.

A real-provider smoke is optional and requires separate explicit authorization for credential use, provider disclosure, and potential cost. It is not required for M05 implementation approval or commit readiness.

## 22. Acceptance criteria

| ID    | Criterion                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | The exact approved specification hash matches before implementation and completion review.                                                                                              |
| AC-02 | Only macOS desktop x86_64 is production-eligible; all other platforms fail before native or network access.                                                                             |
| AC-03 | A dedicated native module stores, verifies, reads, replaces, deletes, and verifies absence of the one Keychain credential without exposing secret/error bytes.                          |
| AC-04 | Settings migrate exactly from v2 to v3, persist no secret, reject malformed/extra state, serialize saves, roll back failures, and invalidate provider work correctly.                   |
| AC-05 | Endpoint validation enforces the exact canonical HTTPS Chat Completions policy.                                                                                                         |
| AC-06 | DNS and address validation affirmatively allow only public unicast, reject mixed/unsafe answers, pin one validated address, and perform no second lookup.                               |
| AC-07 | Model, key, timeout, output-token, request-body, and response-body limits pass inclusive boundary tests.                                                                                |
| AC-08 | Cloud disclosure is exact, defaults false, revokes on endpoint change, and gates execution.                                                                                             |
| AC-09 | Preflight shows validated host, model, exact prompt bytes, output cap, credential state, disclosure state, and readiness.                                                               |
| AC-10 | One explicit click produces exactly one bounded HTTPS request with the exact allowed headers and golden request body.                                                                   |
| AC-11 | System TLS and hostname verification remain enabled; redirects, compression, custom trust, proxy/custom headers, and HTTP are unavailable.                                              |
| AC-12 | Cancellation and timeout terminate transport and every asynchronous boundary obeys complete stale fences.                                                                               |
| AC-13 | Non-200 responses and transport failures map to closed diagnostics without reading or exposing provider error bodies.                                                                   |
| AC-14 | Successful response transport enforces status, content metadata, fatal UTF-8, size, and parsing limits.                                                                                 |
| AC-15 | Provider envelope parsing rejects duplicates/security hazards and forwards exactly one content string unchanged to the frozen M04 validator.                                            |
| AC-16 | Valid candidates use the existing inert in-memory M04 preview; invalid or stale outcomes preserve the previous valid preview.                                                           |
| AC-17 | Usage and retry metadata are bounded, untrusted, informational only, and never trigger retries or writes.                                                                               |
| AC-18 | The provider subsystem has no vault mutation capability and M03 source saving remains separate.                                                                                         |
| AC-19 | Prompts, responses, candidates, usage history, errors, and keys are absent from settings, logs, reports, fixtures, and Git artifacts.                                                   |
| AC-20 | Settings and provider UI meet keyboard, focus, zoom, status-announcement, password-control, and disclosure accessibility requirements.                                                  |
| AC-21 | Native, unit, integration, static, build, worker, and complete M01–M04 regression gates pass with exact recorded commands and results.                                                  |
| AC-22 | Runtime evidence proves synthetic Keychain cleanup, expected network-attempt counts, zero M05 vault mutation, zero secret/content persistence, and required success/failure/race paths. |
| AC-23 | Manual M04 mode remains available and byte-compatible with its frozen contract.                                                                                                         |
| AC-24 | No Ollama/local-network adapter, M06 behavior, release, deployment, or unsupported-platform claim is implemented.                                                                       |

## 23. Completion and publication gates

Implementation completion requires:

1. exact frozen-spec hash confirmation;
2. complete changed/untracked file inventory;
3. all AC-01 through AC-24 mapped to implementation and evidence;
4. exact automated commands and actual outcomes;
5. attributed macOS x86_64 runtime evidence;
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
