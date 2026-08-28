# M05 OpenAI-Compatible Cloud Distillation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one explicitly configured, macOS-Keychain-backed OpenAI-compatible HTTPS adapter that sends the exact M04 prompt and installs only strictly validated, in-memory candidates.

**Architecture:** Pure configuration, address, envelope, and response contracts live in `@chat2vault/core`. The Obsidian plugin owns a dedicated native Keychain adapter, a single strict HTTPS transport, a generation-fenced provider controller, settings persistence, and accessible UI integration. Static and attributed runtime gates prove one explicit network surface, zero provider-driven vault mutation, no secret/content persistence, and complete M01–M04 regression safety.

**Tech Stack:** TypeScript strict mode, Node.js 24 LTS, pnpm 11, Vitest 3, Node `https`/`dns`, macOS Security/CoreFoundation frameworks through N-API C++, Obsidian API, esbuild, Prettier, ESLint.

## Global Constraints

- Implement only the independently approved exact bytes of `docs/M05_SPEC.md`; the remediated v0.7 candidate SHA-256 is `9a480a9d3149ca9305dcff0f85f65c3bada93ff9de481374e86a1a7b2e084541` and must be replaced if review changes the specification.
- Baseline is M04 closure merge `2ac8f194adeca6de5cf2c227ca8213013455573e`.
- Production eligibility is exactly macOS desktop x86_64.
- Support one canonical DNS-hostname HTTPS `/v1/chat/completions` endpoint over pinned public IPv4, one model, and one credential derived from the persisted plugin-installation UUID.
- Reuse the exact M04 request builder, prompt renderer, result validator, and inert preview.
- No new production dependency or provider SDK.
- No HTTP, redirect, proxy, local/private-network endpoint, streaming, retry, batching, background traffic, or model discovery.
- Apply the closed §6 persistence allowlist: one API key may persist only in macOS Keychain; canonical endpoint/model and the other exact v3 fields may persist only in local settings; prompts, responses, candidates, provider errors, usage, account values, and real endpoint/model values remain absent from logs, reports, retained evidence, fixtures, telemetry, and Git artifacts. Deterministic visibly synthetic test fixtures and the exact reserved runtime screenshot values are permitted only under §§6/20–21.
- Provider code receives no vault mutation capability; M03 source save remains separate.
- No Ollama adapter, M06 behavior, release, deployment, paid provider smoke, or unsupported-platform claim.
- Use TDD. Do not begin a later task while focused tests for the current task fail.
- Do not create implementation commits until exact `GO — M05 COMMIT READY` and separate Product Owner commit authorization; task checkpoints remain worktree diffs.

---

## File map

- `packages/core/src/provider/contracts.ts`: M05 limits, settings-independent provider types, closed diagnostics, request/response projections.
- `packages/core/src/provider/config.ts`: endpoint, model, key, timeout, and output-cap validation.
- `packages/core/src/provider/address.ts`: exact IPv4 parsing and frozen denied-CIDR classification; every IPv6 form fails.
- `packages/core/src/provider/envelope.ts`: golden request serialization and duplicate-aware response projection.
- `packages/core/test/provider-config.test.ts`: endpoint/model/key and inclusive limit tables.
- `packages/core/test/provider-address.test.ts`: address-boundary and mapped-address tables.
- `packages/core/test/provider-envelope.test.ts`: golden bytes, adversarial envelopes, and usage behavior.
- `apps/obsidian-plugin/native/keychain.cc`: dedicated Security-framework N-API module.
- `apps/obsidian-plugin/scripts/build-native.mjs`: compile both independent native modules with the required frameworks.
- `apps/obsidian-plugin/src/keychain.ts`: exact ABI-1 native-shape validation, derived installation account, and pre-call generation invalidation.
- `apps/obsidian-plugin/test/keychain.test.ts`: fake native-shape and production-account contract tests.
- `apps/obsidian-plugin/test/native-keychain.test.ts`: synthetic native lifecycle with verified cleanup.
- `apps/obsidian-plugin/src/provider-transport.ts`: one pinned-DNS HTTPS request surface.
- `apps/obsidian-plugin/test/provider-transport.test.ts`: synthetic TLS, DNS, status, size, timeout, and cancellation cases.
- `apps/obsidian-plugin/src/provider-controller.ts`: operation ownership, stale fences, previous-preview preservation, and usage state.
- `apps/obsidian-plugin/test/provider-controller.test.ts`: every §13 race and invalidation boundary.
- `apps/obsidian-plugin/src/settings-model.ts`: field-level v3 recovery, exact v1/v2 migration, identity persistence, and the preserved binary non-queuing settings mutex.
- `apps/obsidian-plugin/src/settings.ts`: identity initialization/retry, disclosure, endpoint/model/cap/timeout, password, and key deletion UI.
- `apps/obsidian-plugin/src/main.ts`: narrow Keychain/transport wiring and invalidators.
- `apps/obsidian-plugin/src/view.ts`: provider preflight, execute/cancel, usage, and M04 fallback UI.
- `apps/obsidian-plugin/styles.css`: scoped provider-panel responsive/accessibility styles.
- `apps/obsidian-plugin/scripts/check-m05-boundaries.mjs`: one-network-surface, no-write, no-secret, no-test-bypass static gate.
- `apps/obsidian-plugin/test/m05-boundaries.test.ts`: runtime capability tripwires.
- `apps/obsidian-plugin/scripts/check-m05-runtime.mjs`: deterministic attributed simulator/Keychain runtime gate.
- `apps/obsidian-plugin/src/runtime-test-entry.ts` plus runtime network/Keychain seams: strictly delimited runtime-only inputs that execute the unchanged production HTTPS transport and are excluded from production.
- `package.json`: add M05 static/runtime checks to the repository gate.
- `README.md`, `docs/00_DOCUMENT_INDEX.md`, `docs/18_M05_IMPLEMENTATION_NOTES.md`, `docs/19_M05_RUNTIME_GATE_REPORT.md`: scope, traceability, evidence, and truthful readiness.

---

### Task 1: Pure provider contracts and configuration validation

**Files:**

- Create: `packages/core/src/provider/contracts.ts`
- Create: `packages/core/src/provider/config.ts`
- Create: `packages/core/test/provider-config.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: existing well-formed-string and UTF-8 helpers.
- Produces: `validateProviderEndpoint`, `validateProviderModel`, `validateProviderSecret`, `validateProviderTimeout`, `validateProviderOutputCap`, `M05ProviderConfig`, and fixed M05 diagnostics/limits.

- [ ] **Step 1: Write failing public-contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  validateProviderEndpoint,
  validateProviderModel,
  validateProviderOutputCap,
  validateProviderSecret,
  validateProviderTimeout,
} from "../src/index.js";

describe("M05 provider configuration", () => {
  it("canonicalizes only the allowed HTTPS endpoint differences", () => {
    expect(
      validateProviderEndpoint(
        "https://API.Example.com:443/v1/chat/completions",
      ),
    ).toEqual({
      ok: true,
      endpoint: "https://api.example.com/v1/chat/completions",
      hostname: "api.example.com",
      port: 443,
    });
  });

  it.each([
    "http://api.example.com/v1/chat/completions",
    "https://user:pass@api.example.com/v1/chat/completions",
    "https://api.example.com/v1/chat/completions?x=1",
    "https://api.example.com/v1/responses",
  ])("rejects unsafe endpoint %s", (value) => {
    expect(validateProviderEndpoint(value)).toMatchObject({ ok: false });
  });

  it("enforces inclusive scalar limits", () => {
    expect(validateProviderSecret("x")).toEqual({ ok: true, secret: "x" });
    expect(validateProviderSecret("x".repeat(4097))).toMatchObject({
      ok: false,
    });
    expect(validateProviderModel("gpt-5")).toEqual({
      ok: true,
      model: "gpt-5",
    });
    expect(validateProviderTimeout(60_000)).toEqual({
      ok: true,
      timeoutMs: 60_000,
    });
    expect(validateProviderOutputCap(32_768)).toEqual({
      ok: true,
      maxOutputTokens: 32_768,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm --filter @chat2vault/core exec vitest run test/provider-config.test.ts`

Expected: FAIL because the provider exports do not exist.

- [ ] **Step 3: Add exact contracts and closed diagnostics**

```ts
export const M05_ENDPOINT_MAX_UTF8_BYTES = 2_048;
export const M05_MODEL_MAX_UTF16 = 200;
export const M05_MODEL_MAX_UTF8_BYTES = 400;
export const M05_SECRET_MAX_ASCII = 4_096;
export const M05_REQUEST_MAX_UTF8_BYTES = 300_000;
export const M05_RESPONSE_MAX_UTF8_BYTES = 1_048_576;
export const M05_OUTPUT_TOKEN_MAX = 32_768;
export const M05_TIMEOUTS = [10_000, 30_000, 60_000, 120_000] as const;

export interface M05ProviderConfig {
  endpoint: string;
  hostname: string;
  port: number;
  model: string;
  timeoutMs: (typeof M05_TIMEOUTS)[number];
  maxOutputTokens: number;
}

export const M05_DIAGNOSTICS = {
  // Transcribe every §17 row byte-exactly: code, severity, fixed message,
  // triggering stage, precedence, provider state, and controller result.
} as const satisfies Record<string, M05DiagnosticDefinition>;

export type M05DiagnosticCode = keyof typeof M05_DIAGNOSTICS;
```

No additional M05 diagnostic is permitted. Add a golden table test that enumerates every §17 code/message/severity and every trigger/state/result mapping.

- [ ] **Step 4: Implement the validators without coercion**

```ts
export function validateProviderTimeout(value: unknown): TimeoutResult {
  return M05_TIMEOUTS.some((item) => item === value)
    ? { ok: true, timeoutMs: value as M05ProviderTimeout }
    : invalidConfig();
}

export function validateProviderOutputCap(value: unknown): OutputCapResult {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= M05_OUTPUT_TOKEN_MAX
    ? { ok: true, maxOutputTokens: value }
    : invalidConfig();
}

export function validateProviderSecret(value: unknown): SecretResult {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= M05_SECRET_MAX_ASCII &&
    /^[\x21-\x7e]+$/u.test(value)
    ? { ok: true, secret: value }
    : invalidConfig();
}
```

Implement `validateProviderEndpoint` with `URL`, exact path/query/fragment/credential rules, A-label validation, canonical round-trip, and exact byte limit. Implement `validateProviderModel` by iterating Unicode scalars, requiring NFC and rejecting every category specified by §11.

- [ ] **Step 5: Add limit−1/limit/limit+1 and Unicode tables, then run core tests**

Run: `pnpm --filter @chat2vault/core test`

Expected: all core tests PASS.

- [ ] **Step 6: Record the worktree checkpoint**

```bash
git diff --check
```

### Task 2: Public address classification and provider envelopes

**Files:**

- Create: `packages/core/src/provider/address.ts`
- Create: `packages/core/src/provider/envelope.ts`
- Create: `packages/core/test/provider-address.test.ts`
- Create: `packages/core/test/provider-envelope.test.ts`
- Modify: `packages/core/src/provider/contracts.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: M05 limits, exact M04 stable-JSON rules, installed M04 prompt.
- Produces: `classifyPublicAddress`, `buildProviderRequest`, `parseProviderResponse`, `ProviderUsage`, and exact serialized body bytes.

- [ ] **Step 1: Write failing address-boundary tests**

```ts
it.each([
  ["8.8.8.8", true],
  ["127.0.0.1", false],
  ["10.0.0.1", false],
  ["169.254.1.1", false],
  ["192.0.2.1", false],
  ["2001:4860:4860::8888", false],
  ["::1", false],
  ["fc00::1", false],
  ["::ffff:8.8.8.8", false],
])("classifies %s", (address, allowed) => {
  expect(classifyPublicAddress(address)).toEqual(
    allowed ? { ok: true } : { ok: false },
  );
});
```

- [ ] **Step 2: Write failing golden-envelope tests**

```ts
const request = buildProviderRequest({
  model: "gpt-5",
  prompt: "exact prompt\n",
  maxOutputTokens: 4096,
});
expect(request).toEqual({
  ok: true,
  body: '{"model":"gpt-5","messages":[{"role":"user","content":"exact prompt\\n"}],"response_format":{"type":"json_object"},"max_tokens":4096,"stream":false}',
  utf8Bytes: 147,
});
```

Add response cases for duplicate keys, `__proto__`, multiple choices, null/array/missing content, BOM, invalid UTF-8, exact pure/mixed container depths 31/32/33, ignored provider-specific extras (including refusal/tool/function-call fields), and valid/malformed usage.

- [ ] **Step 3: Run both focused files and confirm failure**

Run: `pnpm --filter @chat2vault/core exec vitest run test/provider-address.test.ts test/provider-envelope.test.ts`

Expected: FAIL because address and envelope modules do not exist.

- [ ] **Step 4: Implement exhaustive numeric address classification**

```ts
export function classifyPublicAddress(address: string): AddressResult {
  const ipv4 = parseExactIpv4(address);
  if (ipv4 !== undefined)
    return IPV4_DENY_RANGES.some(([network, mask]) =>
      inIpv4Range(ipv4, network, mask),
    )
      ? { ok: false }
      : { ok: true, family: 4, address };
  return { ok: false };
}
```

List the exact §10 IPv4 denied-CIDR table and test each first/last address plus both adjacent complement boundaries. Reject IP literals at endpoint validation and every IPv6, mapped, NAT64, 6to4, Teredo, zone-bearing, and non-canonical numeric input.

- [ ] **Step 5: Implement stable request serialization and guarded response projection**

```ts
export function buildProviderRequest(
  input: ProviderRequestInput,
): ProviderRequestResult {
  const body = stableJson({
    model: input.model,
    messages: [{ role: "user", content: input.prompt }],
    response_format: { type: "json_object" },
    max_tokens: input.maxOutputTokens,
    stream: false,
  });
  const utf8Bytes = new TextEncoder().encode(body).length;
  return utf8Bytes > M05_REQUEST_MAX_UTF8_BYTES
    ? providerFailure("PROVIDER_REQUEST_TOO_LARGE")
    : { ok: true, body, utf8Bytes };
}
```

Extract the duplicate-aware JSON scanner from M04 into an internal shared utility without changing M04 public behavior or golden bytes. `parseProviderResponse(bytes)` must use fatal UTF-8, reject every §16 security condition and entry into container depth 33, require exactly one choice/content string, ignore all provider-specific extra fields after global validation, and omit malformed usage while retaining valid content.

- [ ] **Step 6: Run focused tests plus all core regressions and record the worktree checkpoint**

```bash
pnpm --filter @chat2vault/core test
git diff --check
```

### Task 3: Exact settings v3 identity initialization and save arbitration

**Files:**

- Modify: `apps/obsidian-plugin/src/settings-model.ts`
- Modify: `apps/obsidian-plugin/test/settings-model.test.ts`

**Interfaces:**

- Consumes: core configuration validators.
- Produces: `Chat2VaultSettingsV3`, `DEFAULT_PROVIDER_SETTINGS`, `saveProviderSettings`, provider/credential generations, and provider invalidation hooks.

- [ ] **Step 1: Add failing identity transaction, migration, and rollback tests**

```ts
it("migrates exact v2 settings with an injected installation identity", () => {
  expect(
    readSettings(
      {
        schemaVersion: 2,
        previewMessagesPerPage: 25,
        sourceRoot: "Sources/AI",
      },
      () => "123e4567-e89b-42d3-a456-426614174000",
    ).settings,
  ).toEqual({
    schemaVersion: 3,
    installationId: "123e4567-e89b-42d3-a456-426614174000",
    previewMessagesPerPage: 25,
    sourceRoot: "Sources/AI",
    provider: {
      endpoint: "",
      model: "",
      timeoutMs: 60_000,
      maxOutputTokens: 4_096,
      cloudDisclosureAccepted: false,
    },
  });
});
```

Add initialization tests proving valid-identity v3 load performs no write; every frozen M03 load category and diagnostic is preserved through migration; v3 recovery is field-by-field with the exact ordered diagnostic composition; malformed schema, invalid root, invalid preview/identity, invalid/missing/extra-key Provider, extra/missing top-level keys, combined failures, and unsafe-object categories follow §9 exactly; and eligible migration/safe-default creation generates exactly one pending UUID with zero Keychain/network access before persistence fulfillment. Prove failure retains the same pending UUID, explicit Retry rebases a complete v3 candidate onto the latest authoritative M03 fields, ambiguous-write reload reuses a stored valid identity, clean restart may generate a new never-used identity, and M01–M04 remain available. For authoritative v3, prove preview/source saves persist complete v3 snapshots changing only their selected field and preserve identity plus Provider authority. Add every failure → M03 edit → Retry interleaving, including ambiguous persistence and reload. For safe integer schema `>= 4`, prove the distinct `unsupportedFutureSettings` state, exact `unavailable`/`unsupported-settings` Provider readiness, zero UUID/saveData/Keychain/provider work, byte-identical load/unload persistence, frozen-M03 explicit preview/source Save semantics, no same-instance M05 initialization, and ordinary v2 migration only after a later reload.

Add the complete §9 settings-mutex matrix. Prove the existing binary mutex never queues; every rejected M01–M04 action returns its exact baseline in-progress result; every rejected Retry/Provider Save returns `PROVIDER_SETTINGS_OPERATION_IN_PROGRESS` with zero effects; validation follows acquisition; each accepted Provider Save synchronously advances `providerSaveGeneration`; Provider entry is prohibited while pending; success advances `providerSettingsGeneration`; failure retains the complete prior settings; exact-value saves follow the same path; and endpoint draft changes revoke disclosure.

- [ ] **Step 2: Run and confirm focused failure**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/settings-model.test.ts`

Expected: FAIL because schema v3 is unsupported.

- [ ] **Step 3: Implement exact settings v3**

```ts
export interface Chat2VaultSettingsV3 {
  schemaVersion: 3;
  installationId: string;
  previewMessagesPerPage: PreviewMessagesPerPage;
  sourceRoot: string;
  provider: ProviderSettings;
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  endpoint: "",
  model: "",
  timeoutMs: 60_000,
  maxOutputTokens: 4_096,
  cloudDisclosureAccepted: false,
};
```

Reuse the existing safe-own-JSON traversal and frozen M03 load diagnostics. Add descriptor-safe recognized-field projection, exact lowercase RFC 4122 v4/variant UUID validation, and injected `crypto.randomUUID()` generation only when no valid identity survives migration/recovery. Recover valid identity, preview, source root, and exact Provider subtree independently; default only invalid fields/subtrees and emit the exact ordered diagnostics. Implement `pendingIdentity` as one in-memory retained UUID plus the current initialization transaction. Fulfillment makes the UUID and exact persisted v3 snapshot authoritative and triggers the first status observation. Failure keeps the UUID; only explicit Retry can reacquire the mutex, rebase a complete v3 candidate onto the latest authoritative M03 fields, and submit it. In authoritative-v3 mode, wrap frozen M03 preview/source validation, result, generation, and invalidation behavior with complete-v3 persistence that preserves identity and Provider fields. Plugin unload discards an unpersisted identity without Keychain/network access.

- [ ] **Step 4: Implement the exact draft/save and two-generation algorithm**

```ts
public async saveProviderSettings(draft: ProviderSettings): Promise<SettingsSaveResult> {
  if (!this.tryAcquire()) return this.providerSettingsBusyWithoutEffects();
  try {
    const validated = validateProviderDraft(draft);
    if (!validated.ok) return this.settingsInvalidWithoutSideEffects();
    const previous = this.settings;
    const saveGeneration = ++this.providerSaveGeneration;
    this.invalidateProviderOwnerAndAbort();
    this.installProviderSettingsSaving();
    try {
      await this.persist({ ...previous, provider: validated.value });
      return this.installPersistedProviderSettings(validated.value, saveGeneration);
    } catch {
      return this.installProviderSettingsSaveFailed(previous, saveGeneration);
    }
  } finally {
    this.releaseSettingsMutex();
  }
}
```

The five controls modify only a draft; changing its endpoint forces draft disclosure false. No invalid draft or draft-only edit persists, increments a generation, or invalidates work. Capture both provider generations. Keep source-root save invalidation separate.

- [ ] **Step 5: Run all settings tests and record the worktree checkpoint**

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/settings-model.test.ts
git diff --check
```

### Task 4: Dedicated macOS Keychain module and wrapper

**Files:**

- Create: `apps/obsidian-plugin/native/keychain.cc`
- Modify: `apps/obsidian-plugin/scripts/build-native.mjs`
- Create: `apps/obsidian-plugin/src/keychain.ts`
- Create: `apps/obsidian-plugin/test/keychain.test.ts`
- Create: `apps/obsidian-plugin/test/native-keychain.test.ts`

**Interfaces:**

- Consumes: validated visible-ASCII secret.
- Produces: `configureKeychain`, `credentialStatus`, `readCredentialForOperation`, `setCredential`, `deleteCredential`, fixed service/derived-account contracts, the observation/mutation mutex and state machine, exact ABI-1 validation, credential generation invalidation, and closed results.

- [ ] **Step 1: Write failing wrapper-shape tests**

```ts
const fake = {
  abiVersion: 1,
  credentialStatus: vi.fn(() => ({ tag: "configured" })),
  readCredential: vi.fn(() => ({ tag: "configured", secret: "synthetic-key" })),
  setCredential: vi.fn(() => ({
    tag: "success",
    state: "configured",
    effect: "created",
  })),
  deleteCredential: vi.fn(() => ({
    tag: "success",
    state: "missing",
    effect: "deleted",
  })),
};
expect(
  configureKeychainForTest(fake, "123e4567-e89b-42d3-a456-426614174000"),
).toBe(true);
expect(credentialStatus()).toEqual({ status: "configured" });
expect(readCredentialForOperation()).toEqual({
  ok: true,
  secret: "synthetic-key",
});
expect(fake.readCredential).toHaveBeenCalledWith(
  "com.chat2vault.obsidian.openai-compatible",
  "installation/123e4567-e89b-42d3-a456-426614174000",
);
```

- [ ] **Step 2: Run wrapper tests and confirm failure**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/keychain.test.ts`

Expected: FAIL because the Keychain wrapper does not exist.

- [ ] **Step 3: Implement the production derived-account wrapper and conservative mutation fence**

```ts
export const KEYCHAIN_SERVICE = "com.chat2vault.obsidian.openai-compatible";
export const KEYCHAIN_ACCOUNT_PREFIX = "installation/";

export function readCredentialForOperation(): CredentialReadResult {
  if (nativeKeychain === undefined)
    return { ok: false, code: "KEYCHAIN_UNAVAILABLE" };
  try {
    const value = nativeKeychain.readCredential(
      KEYCHAIN_SERVICE,
      deriveKeychainAccount(settings.installationId),
    );
    return exactFound(value) && validateProviderSecret(value.secret).ok
      ? { ok: true, secret: value.secret }
      : exactMissing(value)
        ? { ok: false, code: "KEYCHAIN_MISSING" }
        : { ok: false, code: "KEYCHAIN_UNAVAILABLE" };
  } catch {
    return { ok: false, code: "KEYCHAIN_UNAVAILABLE" };
  }
}
```

No production export accepts service/account parameters. Implement the exact §8 state machine: initial/load, view-open, and explicit-refresh observations; one non-queuing status/mutation mutex; invalid Set input with zero mutex/native/generation/state effects; pre-native generation invalidation for every valid mutation; prior-state restoration only for well-formed `mayHaveChanged: false`; and unknown state for indeterminate mutation outcomes until explicit Refresh. Treat the accepted-operation read as authoritative before DNS: changed missing/unavailable/malformed/throw/invalid-secret observations advance generation, invalidate/release the owner, and settle the old operation stale. Validate exact own data descriptors/keys/tags and Set/Delete effect cross-products. Cover every throw, extra/missing/accessor/symbol/prototype/wrong-ABI shape and both `mayHaveChanged` paths. Keep alternate-account binding only in the runtime-test source graph and statically exclude it from production.

- [ ] **Step 4: Implement Security-framework operations**

In `keychain.cc`, build exact `CFDictionaryRef` queries for `kSecClassGenericPassword`, UTF-8 service/account data, `kSecUseDataProtectionKeychain = true`, and `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Never set `kSecAttrSynchronizable`; all operations must address the same non-synchronizable data-protection Keychain domain. Status/absence queries omit `kSecReturnData`. Return only application tags. For set, use `SecItemUpdate` or `SecItemAdd`, then perform the sole native-internal post-Set `SecItemCopyMatching` data read and constant-time byte comparison without returning those bytes across the ABI. For delete, call `SecItemDelete`, permit `errSecItemNotFound`, then verify absence without retrieving data. Assert the selector on add, update selection, status, Provider read, delete, and both verification queries.

Export exact numeric data property `abiVersion = 1` plus four N-API functions:

```cpp
napi_property_descriptor descriptors[] = {
    {"credentialStatus", nullptr, CredentialStatus, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readCredential", nullptr, ReadCredential, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setCredential", nullptr, SetCredential, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"deleteCredential", nullptr, DeleteCredential, nullptr, nullptr, nullptr, napi_default, nullptr},
};
```

- [ ] **Step 5: Extend native build and add lifecycle test**

Compile `keychain.cc` separately with `-framework Security -framework CoreFoundation`. The native test uses a unique synthetic runtime account, every success/failure/verification result, and a `finally` deletion/absence assertion. Native mutation failure before change reports `mayHaveChanged: false`; post-change verification failure reports `mayHaveChanged: true`; no rollback is attempted.

- [ ] **Step 6: Run native/wrapper tests, verify both binaries, and record the worktree checkpoint**

```bash
pnpm --filter @chat2vault/obsidian-plugin build:native
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/keychain.test.ts test/native-keychain.test.ts
file apps/obsidian-plugin/native/source_observer.node apps/obsidian-plugin/native/keychain.node
git diff --check
```

### Task 5: Pinned-DNS HTTPS transport

**Files:**

- Create: `apps/obsidian-plugin/src/provider-transport.ts`
- Create: `apps/obsidian-plugin/test/provider-transport.test.ts`

**Interfaces:**

- Consumes: canonical config, secret, exact body, `AbortSignal`, injected resolver/request seams.
- Produces: `sendOpenAICompatibleRequest(input): Promise<ProviderTransportResult>` with closed status/metadata/body bytes.

- [ ] **Step 1: Write failing DNS pinning and header-golden tests**

```ts
const resolve4 = vi.fn(async () => [{ address: "8.8.8.8", ttl: 300 }]);
const request = vi.fn(fakeHttpsSuccess(validEnvelopeBytes));
const result = await sendOpenAICompatibleRequest(input, {
  resolve4,
  request,
});
expect(result.ok).toBe(true);
expect(resolve4).toHaveBeenCalledOnce();
expect(request).toHaveBeenCalledWith(
  expect.objectContaining({
    method: "POST",
    hostname: "api.example.com",
    agent: false,
    setHost: false,
    lookup: expect.any(Function),
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    headers: expectedHeaders,
  }),
  expect.any(Function),
);
```

- [ ] **Step 2: Add failing transport matrix**

Cover empty DNS, 17 answers, duplicate/invalid-TTL/denied answers, resolver failure, IP-literal/IPv6 endpoint rejection, zero/second lookup, non-pinned connected peer, TLS failure, global/proxy Agent and environment-proxy attempts, pooled-socket reuse, automatic/extra headers, 3xx, 401, 403, 429 with valid/invalid retry, 4xx, 5xx, content encoding, content type, oversized declared/chunked body, invalid UTF-8, explicit cancellation, each timeout phase, and late stream events.

- [ ] **Step 3: Run focused transport tests and confirm failure**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/provider-transport.test.ts`

Expected: FAIL because the transport does not exist.

- [ ] **Step 4: Implement one validated resolver and pinned lookup**

```ts
async function resolvePinned(
  hostname: string,
  resolve4: Resolver,
): Promise<PinnedAddressResult> {
  const answers = await resolve4(hostname, { ttl: true });
  if (answers.length < 1 || answers.length > 16) return unsafeDns();
  const checked = answers.map(({ address, ttl }) => ({
    address,
    ttl,
    checked: classifyPublicAddress(address),
  }));
  if (
    checked.some(
      (item) =>
        !item.checked.ok || !Number.isSafeInteger(item.ttl) || item.ttl <= 0,
    )
  )
    return unsafeDns();
  if (new Set(checked.map((item) => item.address)).size !== checked.length)
    return unsafeDns();
  return { ok: true, address: checked[0]!.address, family: 4 as const };
}
```

Pass a lookup callback that returns only this captured address with family 4 and increments a counter; fail unless invoked exactly once. Preserve canonical DNS hostname for SNI and explicit `checkServerIdentity`.

- [ ] **Step 5: Implement bounded request/response lifecycle**

Use `https.request` with `agent: false`, `setHost: false`, explicit SNI/hostname verification, the exact seven headers (including explicit `Host` and `Connection: close`), no proxy/global Agent or pool, and one total timer. Create the request without `write`/`end`; after `secureConnect`, prove `remoteFamily` is IPv4 and the canonical peer address equals the pinned address, then call `end(exactBody)` exactly once. Prove no secret, Authorization header, or prompt bytes leave before that check. Reject non-200 before attaching data consumers; call `response.resume()` only after installing a bounded discard handler that never stores the body. For 200, validate headers first, then accumulate at most 1,048,576 bytes. Destroy streams on cancel, timeout, stale callback, remote mismatch, or overflow. Return only closed codes and allowed bounded metadata.

- [ ] **Step 6: Run focused tests, typecheck, and record the worktree checkpoint**

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/provider-transport.test.ts
pnpm --filter @chat2vault/obsidian-plugin typecheck
git diff --check
```

### Task 6: Provider controller and stale-operation fencing

**Files:**

- Create: `apps/obsidian-plugin/src/provider-controller.ts`
- Create: `apps/obsidian-plugin/test/provider-controller.test.ts`

**Interfaces:**

- Consumes: M04 installed request/prompt and validator, provider settings/generations, Keychain reader, request builder, HTTPS transport.
- Produces: `ProviderController`, `ProviderSnapshot`, `preflight`, `distill`, `cancel`, and `invalidate`.

- [ ] **Step 1: Write failing success and previous-preview tests**

```ts
const controller = new ProviderController(services);
expect(controller.preflight()).toMatchObject({
  status: "ready",
  host: "api.example.com",
  model: "gpt-5",
  promptBytes: expectedPromptBytes,
  maxOutputTokens: 4096,
});
expect((await controller.distill()).status).toBe("valid");
const previous = controller.snapshot.candidates;
services.transport.mockResolvedValueOnce({
  ok: false,
  code: "PROVIDER_TIMEOUT",
});
expect((await controller.distill()).status).toBe("failed");
expect(controller.snapshot.candidates).toEqual(previous);
```

- [ ] **Step 2: Add the full §13 cross-controller and settlement matrix**

Test every Provider × M04 Prepare/Copy/Validate/manual-input cell, rejected entry, accepted entry, preview winner, and ownership release. At Keychain read, DNS, pre-connect, headers, chunk, envelope parse, M04 validation, and final publish, mutate each captured generation independently and assert `stale`, transport abort when present, no late request/preview/diagnostic/focus/UI replacement, and matching-token internal owner release exactly once. Include mismatches with no preceding external invalidation plus immediate fresh entry, and prove an old stale token never clears a newer owner. Cover cancel-first/timeout-first/transport-first event orders and repeated cancel.

- [ ] **Step 3: Run and confirm focused failure**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/provider-controller.test.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 4: Implement immutable snapshot and complete capture**

```ts
interface ProviderCapture {
  ownerToken: number;
  pluginGeneration: number;
  viewGeneration: number;
  importGeneration: number;
  selectionGeneration: number;
  conversationFingerprint: string;
  requestId: string;
  prompt: string;
  promptBytes: number;
  providerSettingsGeneration: number;
  providerSaveGeneration: number;
  credentialGeneration: number;
  config: M05ProviderConfig;
}

private captureCurrent(capture: ProviderCapture): boolean {
  const current = this.services.current();
  return this.owner?.token === capture.ownerToken &&
    current.pluginGeneration === capture.pluginGeneration &&
    current.viewGeneration === capture.viewGeneration &&
    current.importGeneration === capture.importGeneration &&
    current.selectionGeneration === capture.selectionGeneration &&
    current.request?.requestId === capture.requestId &&
    current.prompt === capture.prompt &&
    current.providerSettingsGeneration === capture.providerSettingsGeneration &&
    current.providerSaveGeneration === capture.providerSaveGeneration &&
    current.credentialGeneration === capture.credentialGeneration &&
    providerConfigEqual(current.config, capture.config);
}
```

- [ ] **Step 5: Implement explicit execution and cancellation**

Read Keychain only after durably authoritative identity plus ownership/readiness capture and apply its authoritative observation transition before DNS. Build exact body, call transport with an operation `AbortController`, parse envelope, call frozen M04 validator, and publish candidates only after the final fence. Drop the local secret variable in `finally`. Capture/recheck both provider generations. Implement the exact shared entry guard and total settlement algorithm. A stale mismatch may clear only its own still-installed matching owner and is return-only for request/preview/diagnostic/focus/UI state. `cancel()` and timeout synchronously win only for the matching sending owner, abort once, preserve candidates, install their exact diagnostic/state, and release exactly once; every later event is stale/no-op.

- [ ] **Step 6: Run focused tests and record the worktree checkpoint**

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/provider-controller.test.ts
git diff --check
```

### Task 7: Settings and candidate-view integration

**Files:**

- Modify: `apps/obsidian-plugin/src/settings.ts`
- Modify: `apps/obsidian-plugin/src/main.ts`
- Modify: `apps/obsidian-plugin/src/view.ts`
- Modify: `apps/obsidian-plugin/styles.css`
- Modify: `apps/obsidian-plugin/test/main.test.ts`
- Modify: `apps/obsidian-plugin/test/view.test.ts`
- Modify: `apps/obsidian-plugin/test/styles.test.ts`

**Interfaces:**

- Consumes: settings controller, Keychain wrapper, provider controller, frozen manual controller.
- Produces: exact disclosure/settings controls, preflight, execute/cancel, usage, diagnostics, and unchanged manual fallback.

- [ ] **Step 1: Add failing settings UI tests**

Assert initialization-pending controls are absent/disabled, persistence failure exposes only `Retry provider initialization`, retry failure preserves focus/same UUID, retry success moves focus to endpoint, and M01–M04 remain available. Then assert all three exact §12 disclosure/limitation texts, password input with `type=password` and `autocomplete=off`, five draft controls plus explicit `Save provider settings`, endpoint-draft disclosure revocation, configured/missing/unknown/unavailable status only, set-key clearing in both success/failure, explicit Delete and Refresh actions, installation-account non-editability, every new closed diagnostic, and the exact settled settings focus order/focus-return rules.

- [ ] **Step 2: Add failing candidate-view tests**

```ts
for (const text of [
  "Destination",
  "Model",
  "Prompt bytes",
  "Maximum output tokens",
  "Distill with provider",
  "Cancel provider request",
])
  expect(container.textContent).toContain(text);
for (const forbidden of [
  "Accept candidate",
  "Edit candidate",
  "Save candidate",
])
  expect(container.textContent).not.toContain(forbidden);
```

Add tests for every §13 UI arbitration cell, textarea invalidation, disabled readiness, one click/one transport call, cancel/timeout focus winners, view close/unload, usage disclaimer, every exact closed diagnostic/live announcement, the exact candidate focus order, 200% geometry/overflow predicates, and manual M04 fallback.

- [ ] **Step 3: Run UI tests and confirm failure**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/main.test.ts test/view.test.ts test/styles.test.ts`

Expected: FAIL on missing provider controls.

- [ ] **Step 4: Wire narrow services in `main.ts`**

Configure both native modules from exact plugin paths. Inject only credential status/set/delete/read, current settings/generations, and `sendOpenAICompatibleRequest`. Register provider invalidation alongside existing source/manual invalidators and invoke it on plugin unload.

- [ ] **Step 5: Render accessible settings and provider panel**

Use Obsidian `Setting` controls and `textContent` only. Never render, read back, or persist the key after save. Preflight shows only validated host/model/bytes/cap/status. Keep the previous candidate DOM while sending/failing. Render usage as untrusted text with the required disclaimer. Preserve all manual controls and apply the exact pending disable/edit rules, focus transfers, persistent polite/atomic live region, and fixed §17 text.

- [ ] **Step 6: Add scoped styles and run UI/build tests**

Use `.c2v-provider-*` selectors, flexible wrapping, `min-width: 0`, `overflow-wrap: anywhere`, visible focus, and no inline styles.

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/main.test.ts test/view.test.ts test/styles.test.ts
pnpm --filter @chat2vault/obsidian-plugin build
```

- [ ] **Step 7: Record the worktree checkpoint**

```bash
git diff --check
```

### Task 8: Static boundaries and deterministic runtime gate

**Files:**

- Create: `apps/obsidian-plugin/scripts/check-m05-boundaries.mjs`
- Create: `apps/obsidian-plugin/scripts/check-m05-runtime.mjs`
- Create: `apps/obsidian-plugin/test/m05-boundaries.test.ts`
- Create: `apps/obsidian-plugin/src/runtime-test-entry.ts`
- Create: `apps/obsidian-plugin/src/runtime-test-network-seam.ts`
- Create: `apps/obsidian-plugin/src/runtime-test-keychain.ts`
- Create: `apps/obsidian-plugin/scripts/compare-m05-runtime-artifact.mjs`
- Modify: `apps/obsidian-plugin/scripts/check-plugin.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: production/test sources, bundles, esbuild metafiles, synthetic native account seam, narrow resolver/policy/socket-destination seam, ephemeral synthetic CA/local HTTPS server, disposable vault mutation sentinel, and the two exact Obsidian rows.
- Produces: byte/source-identical production-transport proof, exact shared-input/delta proof, single-network-surface, no-bypass, no-write, no-secret/persistence, native/CA cleanup, accessibility/zoom, and both-row runtime-scenario evidence.

- [ ] **Step 1: Write failing runtime capability tripwires**

Stub every forbidden vault mutation, persistence, clipboard read, background timer, second transport, and retry surface with throwing spies. Execute success, failure, cancellation, and stale flows through the public controller; assert exactly expected transport counts and zero forbidden calls.

- [ ] **Step 2: Implement the production static gate**

```js
const allowedNetworkFile = "apps/obsidian-plugin/src/provider-transport.ts";
const forbiddenOutsideTransport = [
  "node:https",
  "node:http",
  "fetch(",
  "requestUrl(",
  "XMLHttpRequest",
  "WebSocket",
];
const forbiddenEverywhere = [
  "rejectUnauthorized: false",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "Accept-Encoding",
  "node:child_process",
  "exec(",
  "spawn(",
  "Ollama",
];
```

Assert only the transport imports `node:https`/`node:dns`; only Keychain wrapper loads `keychain.node`; production graph contains no runtime-test entry/adapter, loopback bypass, sentinel, alternate-account selector, unsafe resolver path, conditional define, or alias; M05 modules cannot reach source writer/vault mutation; settings serialization contains no secret/account field; and the bundle has one `Authorization` construction site.

- [ ] **Step 3: Implement attributed native/simulator runtime script**

Build production and runtime-test entry points with identical options and machine-readable metafiles. Prove the production provider-transport source bytes/output contribution are identical and compare every other shared input hash; permit only the exact entry/runtime-network/runtime-Keychain reachability delta. Create an ephemeral synthetic CA and `m05.invalid` certificate before launching each Obsidian row with `NODE_EXTRA_CA_CERTS`; this is intentionally inherited host-process trust configuration. The bundle may neither read/set that variable nor pass `ca`, add/replace trust anchors, or expose a custom-trust setting. Run a local HTTPS server, drive deterministic resolver/public-policy inputs, and use a socket-destination override only for the mismatch scenario while the unchanged production `https.request`, TLS, hostname, header/body, pin, timeout, and response paths execute. Record only scenario IDs, operation tokens, process ID, candidate-vault hash, attempt/mutation counts, synthetic account/certificate/artifact hashes, timings, and closed outcomes. In `finally`, delete and independently assert absence of Keychain, CA, private-key, server, and vault artifacts; exit nonzero on cleanup failure. Never copy the test bundle into a production package.

- [ ] **Step 4: Add exact scenarios**

Run every scenario on exact Obsidian 1.7.4 and execution-time official stable against identical final production hashes. Include every v3 field-recovery/diagnostic fixture; the complete non-queuing settings-mutex matrix; identity migration, failure, same-UUID rebased retry, M03-edit interleavings, authoritative-v3 field preservation, ambiguous-write reload, clean restart, and zero pre-authority Keychain/network access; all readiness diagnostics; complete credential transitions; proof that every native operation uses the same non-synchronizable data-protection Keychain domain; per-identity isolation; every draft/save/two-generation path; all cross-controller cells; stale-owner cases; cancel/timeout event orders; redirect; 401; 429; oversized bodies; production-classifier unsafe DNS; actual connected-peer mismatch; production-path effective-default-CA/TLS/hostname/network/proxy/global-Agent/socket-reuse/header checks; invalid response/envelope/M04 results; depth 31/32/33; every stale race; focus/live-region/zoom evidence; manual fallback; zero mutation; exact Keychain/CA/private-key cleanup; zero application persistence outside the closed §6 allowlist and narrow synthetic verification artifacts; and zero retry/background traffic.

- [ ] **Step 5: Append gates to root verification and run them**

```json
{
  "check:plugin": "node apps/obsidian-plugin/scripts/check-plugin.mjs && node apps/obsidian-plugin/scripts/check-worker.mjs && node apps/obsidian-plugin/scripts/check-m03-runtime-contracts.mjs && node apps/obsidian-plugin/scripts/check-m04-boundaries.mjs && node apps/obsidian-plugin/scripts/check-m05-boundaries.mjs && node apps/obsidian-plugin/scripts/check-m05-runtime.mjs"
}
```

Run:

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/m05-boundaries.test.ts
node apps/obsidian-plugin/scripts/check-m05-boundaries.mjs
node apps/obsidian-plugin/scripts/check-m05-runtime.mjs
```

Expected: every gate PASS, synthetic Keychain item confirmed absent, exact expected attempt counts, and zero mutations/persistence.

- [ ] **Step 6: Record the worktree checkpoint**

```bash
git diff --check
```

### Task 9: Whole-candidate verification, evidence, and independent review

**Files:**

- Create: `docs/18_M05_IMPLEMENTATION_NOTES.md`
- Create: `docs/19_M05_RUNTIME_GATE_REPORT.md`
- Modify: `README.md`
- Modify: `docs/00_DOCUMENT_INDEX.md`

**Interfaces:**

- Consumes: final implementation inventory, exact automated/runtime outputs, frozen spec hash, review-packet inventory.
- Produces: AC-01–AC-24 traceability, truthful readiness decision, and independently reconstructable packet.

- [ ] **Step 1: Record implementation notes and pre-review runtime report**

Include exact root/branch/base/upstream/HEAD, files, architecture, native hashes, request golden hash, test counts, runtime scenario ledger, Keychain cleanup proof, real-data/credential scan, exact permitted-synthetic-artifact inventory, risks, limitations, and separate publication states. Decision remains `NO-GO — independent M05 review pending`.

- [ ] **Step 2: Run the complete fresh gate**

Run: `CI=true pnpm verify`

Expected: Prettier, ESLint, strict typecheck, every core/plugin test, both builds, worker smoke, M03 helpers, M04 boundary gate, M05 static gate, and M05 attributed runtime gate PASS.

- [ ] **Step 3: Verify exact scope, frozen authority, and secrets hygiene**

```bash
git status --short
git ls-files --others --exclude-standard
git diff --check
shasum -a 256 docs/M05_SPEC.md apps/obsidian-plugin/main.js apps/obsidian-plugin/worker.js apps/obsidian-plugin/native/keychain.node
git diff --stat 2ac8f194adeca6de5cf2c227ca8213013455573e...HEAD
git diff --name-status 2ac8f194adeca6de5cf2c227ca8213013455573e...HEAD
```

Run a repository-wide scan proving no real conversation export, real endpoint/model outside local runtime settings, raw evidence body, or provider-shaped credential exists. Permit only the exact deterministic synthetic fixtures and reserved screenshot literals frozen by §§6/20–21; synthetic credential strings must remain visibly inert and non-provider-shaped.

- [ ] **Step 4: Complete implementation evidence without committing**

```bash
git diff --check
```

- [ ] **Step 5: Freeze the review packet**

Create an archive from the exact candidate with spec, full diff, tracked/untracked inventory, command logs, AC ledger, native/runtime evidence, artifact hashes, static gate results, and redacted metadata. Record SHA-256, byte size, regular-file count, directory count, and `unzip -t` result. Exclude `.git`, dependencies, real vaults, real credentials, usernames, machine paths, and raw conversation content.

- [ ] **Step 6: Run the independent browser remediation loop**

Submit the exact packet to the independent reviewer. Apply only in-scope findings, rerun all affected and whole-candidate gates, regenerate the packet/hash/inventory, and resubmit. Stop at any human product decision. Do not claim commit readiness until the exact verdict is observed:

```text
GO — M05 COMMIT READY
```

- [ ] **Step 7: Stop at the publication boundary**

After the exact verdict, report implementation commit readiness separately from Product Owner commit/publication authorization. Do not commit, push, open/merge a PR, tag, deploy, release, use a paid provider, submit to Community Plugins, or begin M06 without applicable explicit authorization.
