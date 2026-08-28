# M05 OpenAI-Compatible Cloud Distillation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one explicitly configured, macOS-Keychain-backed OpenAI-compatible HTTPS adapter that sends the exact M04 prompt and installs only strictly validated, in-memory candidates.

**Architecture:** Pure configuration, address, envelope, and response contracts live in `@chat2vault/core`. The Obsidian plugin owns a dedicated native Keychain adapter, a single strict HTTPS transport, a generation-fenced provider controller, settings persistence, and accessible UI integration. Static and attributed runtime gates prove one explicit network surface, zero provider-driven vault mutation, no secret/content persistence, and complete M01–M04 regression safety.

**Tech Stack:** TypeScript strict mode, Node.js 24 LTS, pnpm 11, Vitest 3, Node `https`/`dns`, macOS Security/CoreFoundation frameworks through N-API C++, Obsidian API, esbuild, Prettier, ESLint.

## Global Constraints

- Implement only the independently approved exact bytes of `docs/M05_SPEC.md`; the current candidate hash is `da950f5d4d704dfe5a2fbd077a677e1a207c6226875d1c5b96a74484b5f0f611` and must be replaced in this plan if review changes the specification.
- Baseline is M04 closure merge `2ac8f194adeca6de5cf2c227ca8213013455573e`.
- Production eligibility is exactly macOS desktop x86_64.
- Support one canonical HTTPS `/v1/chat/completions` endpoint, one model, and one fixed Keychain account.
- Reuse the exact M04 request builder, prompt renderer, result validator, and inert preview.
- No new production dependency or provider SDK.
- No HTTP, redirect, proxy, local/private-network endpoint, streaming, retry, batching, background traffic, or model discovery.
- No secret, prompt, response, candidate, usage-history, or provider-error-body persistence or logging.
- Provider code receives no vault mutation capability; M03 source save remains separate.
- No Ollama adapter, M06 behavior, release, deployment, paid provider smoke, or unsupported-platform claim.
- Use TDD. Do not begin a later task while focused tests for the current task fail.

---

## File map

- `packages/core/src/provider/contracts.ts`: M05 limits, settings-independent provider types, closed diagnostics, request/response projections.
- `packages/core/src/provider/config.ts`: endpoint, model, key, timeout, and output-cap validation.
- `packages/core/src/provider/address.ts`: exhaustive public IPv4/IPv6 parsing and classification.
- `packages/core/src/provider/envelope.ts`: golden request serialization and duplicate-aware response projection.
- `packages/core/test/provider-config.test.ts`: endpoint/model/key and inclusive limit tables.
- `packages/core/test/provider-address.test.ts`: address-boundary and mapped-address tables.
- `packages/core/test/provider-envelope.test.ts`: golden bytes, adversarial envelopes, and usage behavior.
- `apps/obsidian-plugin/native/keychain.cc`: dedicated Security-framework N-API module.
- `apps/obsidian-plugin/scripts/build-native.mjs`: compile both independent native modules with the required frameworks.
- `apps/obsidian-plugin/src/keychain.ts`: exact native-shape validation and production fixed-account wrapper.
- `apps/obsidian-plugin/test/keychain.test.ts`: fake native-shape and production-account contract tests.
- `apps/obsidian-plugin/test/native-keychain.test.ts`: synthetic native lifecycle with verified cleanup.
- `apps/obsidian-plugin/src/provider-transport.ts`: one pinned-DNS HTTPS request surface.
- `apps/obsidian-plugin/test/provider-transport.test.ts`: synthetic TLS, DNS, status, size, timeout, and cancellation cases.
- `apps/obsidian-plugin/src/provider-controller.ts`: operation ownership, stale fences, previous-preview preservation, and usage state.
- `apps/obsidian-plugin/test/provider-controller.test.ts`: every §13 race and invalidation boundary.
- `apps/obsidian-plugin/src/settings-model.ts`: exact v2-to-v3 migration and serialized provider-setting saves.
- `apps/obsidian-plugin/src/settings.ts`: disclosure, endpoint/model/cap/timeout, password, and key deletion UI.
- `apps/obsidian-plugin/src/main.ts`: narrow Keychain/transport wiring and invalidators.
- `apps/obsidian-plugin/src/view.ts`: provider preflight, execute/cancel, usage, and M04 fallback UI.
- `apps/obsidian-plugin/styles.css`: scoped provider-panel responsive/accessibility styles.
- `apps/obsidian-plugin/scripts/check-m05-boundaries.mjs`: one-network-surface, no-write, no-secret, no-test-bypass static gate.
- `apps/obsidian-plugin/test/m05-boundaries.test.ts`: runtime capability tripwires.
- `apps/obsidian-plugin/scripts/check-m05-runtime.mjs`: deterministic attributed simulator/Keychain runtime gate.
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

export type M05DiagnosticCode =
  | "PROVIDER_SETTINGS_INVALID"
  | "PROVIDER_DISCLOSURE_REQUIRED"
  | "KEYCHAIN_MISSING"
  | "KEYCHAIN_UNAVAILABLE"
  | "PROVIDER_DNS_UNSAFE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_CANCELLED"
  | "PROVIDER_NETWORK_FAILED"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_RESULT_INVALID"
  | "PROVIDER_STALE";
```

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

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/provider packages/core/src/index.ts packages/core/test/provider-config.test.ts
git commit -m "feat(core): validate M05 provider configuration"
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
  ["2001:4860:4860::8888", true],
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

Add response cases for duplicate keys, `__proto__`, multiple choices, null content, BOM, invalid UTF-8, excessive nesting, and valid/malformed usage.

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
  const ipv6 = parseExactIpv6(address);
  if (ipv6 === undefined || isMappedIpv4(ipv6)) return { ok: false };
  return IPV6_DENY_PREFIXES.some(([network, bits]) =>
    inIpv6Prefix(ipv6, network, bits),
  )
    ? { ok: false }
    : { ok: true, family: 6, address };
}
```

List every denied range from §10 explicitly and test both endpoints adjacent to each range.

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

Extract the duplicate-aware JSON scanner from M04 into an internal shared utility without changing M04 public behavior or golden bytes. `parseProviderResponse(bytes)` must use fatal UTF-8, reject every §16 security condition, require exactly one choice/content string, and omit malformed usage while retaining valid content.

- [ ] **Step 6: Run focused tests plus all core regressions and commit**

```bash
pnpm --filter @chat2vault/core test
git add packages/core/src/provider packages/core/src/distillation packages/core/src/index.ts packages/core/test/provider-*.test.ts packages/core/test/distillation-result.test.ts
git commit -m "feat(core): add bounded M05 provider envelopes"
```

### Task 3: Exact settings v3 migration and save arbitration

**Files:**

- Modify: `apps/obsidian-plugin/src/settings-model.ts`
- Modify: `apps/obsidian-plugin/test/settings-model.test.ts`

**Interfaces:**

- Consumes: core configuration validators.
- Produces: `Chat2VaultSettingsV3`, `DEFAULT_PROVIDER_SETTINGS`, `saveProviderSettings`, provider/credential generations, and provider invalidation hooks.

- [ ] **Step 1: Add failing migration and rollback tests**

```ts
it("migrates exact v2 settings without provider authority", () => {
  expect(
    readSettings({
      schemaVersion: 2,
      previewMessagesPerPage: 25,
      sourceRoot: "Sources/AI",
    }).settings,
  ).toEqual({
    schemaVersion: 3,
    previewMessagesPerPage: 25,
    sourceRoot: "Sources/AI",
    provider: {
      endpoint: "",
      model: "",
      timeoutMs: 60_000,
      maxOutputTokens: 4_096,
      cloudDisclosureAccepted: false,
      credentialAccount: "default",
    },
  });
});
```

Add deferred-persistence tests proving serialized saves, rollback, endpoint-change disclosure revocation, and generation increments only after success.

- [ ] **Step 2: Run and confirm focused failure**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/settings-model.test.ts`

Expected: FAIL because schema v3 is unsupported.

- [ ] **Step 3: Implement exact settings v3**

```ts
export interface Chat2VaultSettingsV3 {
  schemaVersion: 3;
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
  credentialAccount: "default",
};
```

Reuse the existing safe-own-JSON traversal. Add an exact nested-key check and never coerce or partially preserve malformed provider state.

- [ ] **Step 4: Implement atomic provider save**

```ts
public async saveProviderSettings(value: ProviderSettings): Promise<SettingsSaveResult> {
  if (!this.tryAcquire()) return this.inProgress();
  const validated = validateStoredProviderSettings(value);
  if (!validated.ok) return this.invalid("The provider setting is invalid.");
  const previous = this.settings;
  const endpointChanged = previous.provider.endpoint !== validated.value.endpoint;
  const provider = endpointChanged
    ? { ...validated.value, cloudDisclosureAccepted: false }
    : validated.value;
  const next = { ...previous, provider };
  try {
    await this.persist(next);
    this.settings = next;
    this.providerGeneration += 1;
    this.invalidateProviderState();
    return { status: "saved" };
  } catch {
    return { status: "failed", message: "The provider setting could not be saved." };
  } finally {
    this.release();
  }
}
```

- [ ] **Step 5: Run all settings tests and commit**

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/settings-model.test.ts
git add apps/obsidian-plugin/src/settings-model.ts apps/obsidian-plugin/test/settings-model.test.ts
git commit -m "feat(plugin): migrate to M05 provider settings"
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
- Produces: `configureKeychain`, `credentialStatus`, `readCredentialForOperation`, `setCredential`, `deleteCredential`, fixed service/account constants, and closed results.

- [ ] **Step 1: Write failing wrapper-shape tests**

```ts
const fake = {
  credentialStatus: vi.fn(() => ({ kind: "configured" })),
  readCredential: vi.fn(() => ({ kind: "found", secret: "synthetic-key" })),
  setCredential: vi.fn(() => ({ kind: "saved" })),
  deleteCredential: vi.fn(() => ({ kind: "deleted" })),
};
expect(configureKeychainForTest(fake)).toBe(true);
expect(credentialStatus()).toEqual({ status: "configured" });
expect(readCredentialForOperation()).toEqual({
  ok: true,
  secret: "synthetic-key",
});
expect(fake.readCredential).toHaveBeenCalledWith(
  "com.chat2vault.obsidian.openai-compatible",
  "default",
);
```

- [ ] **Step 2: Run wrapper tests and confirm failure**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/keychain.test.ts`

Expected: FAIL because the Keychain wrapper does not exist.

- [ ] **Step 3: Implement the production fixed-account wrapper**

```ts
export const KEYCHAIN_SERVICE = "com.chat2vault.obsidian.openai-compatible";
export const KEYCHAIN_ACCOUNT = "default";

export function readCredentialForOperation(): CredentialReadResult {
  if (nativeKeychain === undefined)
    return { ok: false, code: "KEYCHAIN_UNAVAILABLE" };
  try {
    const value = nativeKeychain.readCredential(
      KEYCHAIN_SERVICE,
      KEYCHAIN_ACCOUNT,
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

No production export accepts service/account parameters. Keep a test-only native binding in the test source graph and statically exclude it from the production bundle.

- [ ] **Step 4: Implement Security-framework operations**

In `keychain.cc`, build exact `CFDictionaryRef` queries for `kSecClassGenericPassword`, UTF-8 service/account data, and `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Return only application tags. For set, use `SecItemUpdate` or `SecItemAdd`, then `SecItemCopyMatching` and constant-time byte comparison. For delete, call `SecItemDelete`, permit `errSecItemNotFound`, then verify `errSecItemNotFound` through a second read.

Export exactly four N-API functions:

```cpp
napi_property_descriptor descriptors[] = {
    {"credentialStatus", nullptr, CredentialStatus, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readCredential", nullptr, ReadCredential, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setCredential", nullptr, SetCredential, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"deleteCredential", nullptr, DeleteCredential, nullptr, nullptr, nullptr, napi_default, nullptr},
};
```

- [ ] **Step 5: Extend native build and add lifecycle test**

Compile `keychain.cc` separately with `-framework Security -framework CoreFoundation`. The native test uses `chat2vault-runtime-${process.pid}-${randomUUID()}` as its account, synthetic values only, and a `finally` deletion/absence assertion.

- [ ] **Step 6: Run native/wrapper tests, verify both binaries, and commit**

```bash
pnpm --filter @chat2vault/obsidian-plugin build:native
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/keychain.test.ts test/native-keychain.test.ts
file apps/obsidian-plugin/native/source_observer.node apps/obsidian-plugin/native/keychain.node
git add apps/obsidian-plugin/native/keychain.cc apps/obsidian-plugin/native/keychain.node apps/obsidian-plugin/scripts/build-native.mjs apps/obsidian-plugin/src/keychain.ts apps/obsidian-plugin/test/keychain.test.ts apps/obsidian-plugin/test/native-keychain.test.ts
git commit -m "feat(plugin): add verified macOS Keychain adapter"
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
const resolveAll = vi.fn(async () => [
  { address: "8.8.8.8", family: 4 as const },
]);
const request = vi.fn(fakeHttpsSuccess(validEnvelopeBytes));
const result = await sendOpenAICompatibleRequest(input, {
  resolveAll,
  request,
});
expect(result.ok).toBe(true);
expect(resolveAll).toHaveBeenCalledOnce();
expect(request).toHaveBeenCalledWith(
  expect.objectContaining({
    method: "POST",
    hostname: "api.example.com",
    lookup: expect.any(Function),
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    headers: expectedHeaders,
  }),
  expect.any(Function),
);
```

- [ ] **Step 2: Add failing transport matrix**

Cover empty DNS, 17 answers, mixed family, mixed public/private, unsafe literal, second-lookup attempt, TLS failure, 3xx, 401, 403, 429 with valid/invalid retry, 4xx, 5xx, content encoding, content type, oversized declared/chunked body, invalid UTF-8, explicit cancellation, each timeout phase, and late stream events.

- [ ] **Step 3: Run focused transport tests and confirm failure**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/provider-transport.test.ts`

Expected: FAIL because the transport does not exist.

- [ ] **Step 4: Implement one validated resolver and pinned lookup**

```ts
async function resolvePinned(
  hostname: string,
  resolveAll: Resolver,
): Promise<PinnedAddressResult> {
  const answers = await resolveAll(hostname, { all: true, verbatim: true });
  if (answers.length < 1 || answers.length > 16) return unsafeDns();
  const checked = answers.map(({ address, family }) => ({
    address,
    family,
    checked: classifyPublicAddress(address),
  }));
  if (checked.some((item) => !item.checked.ok)) return unsafeDns();
  if (new Set(checked.map((item) => item.family)).size !== 1)
    return unsafeDns();
  return { ok: true, address: checked[0]!.address, family: checked[0]!.family };
}
```

Pass a lookup callback that returns only this captured address/family and increments a counter; fail if invoked more than once.

- [ ] **Step 5: Implement bounded request/response lifecycle**

Use `https.request`, exact application headers, no `Accept-Encoding`, and one total timer. Reject non-200 before attaching data consumers; call `response.resume()` only after installing a bounded discard handler that never stores the body. For 200, validate headers first, then accumulate at most 1,048,576 bytes. Destroy streams on cancel, timeout, stale callback, or overflow. Return only closed codes and allowed bounded metadata.

- [ ] **Step 6: Run focused tests, typecheck, and commit**

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/provider-transport.test.ts
pnpm --filter @chat2vault/obsidian-plugin typecheck
git add apps/obsidian-plugin/src/provider-transport.ts apps/obsidian-plugin/test/provider-transport.test.ts
git commit -m "feat(plugin): add strict M05 HTTPS transport"
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

- [ ] **Step 2: Add one deferred test per §13 fence**

At Keychain read, DNS, pre-connect, headers, chunk, envelope parse, M04 validation, and final publish, mutate each captured generation independently and assert `stale`, transport abort when present, no late diagnostic replacement, and ownership release.

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
  providerGeneration: number;
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
    current.providerGeneration === capture.providerGeneration &&
    current.credentialGeneration === capture.credentialGeneration &&
    providerConfigEqual(current.config, capture.config);
}
```

- [ ] **Step 5: Implement explicit execution and cancellation**

Read Keychain only after ownership/readiness capture. Build exact body, call transport with an operation `AbortController`, parse envelope, call frozen M04 validator, and publish candidates only after the final fence. Drop the local secret variable in `finally`. `cancel()` aborts once, increments token, preserves candidates, and returns the fixed cancelled diagnostic.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/provider-controller.test.ts
git add apps/obsidian-plugin/src/provider-controller.ts apps/obsidian-plugin/test/provider-controller.test.ts
git commit -m "feat(plugin): arbitrate M05 provider operations"
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

Assert exact disclosure copy, password input with `type=password` and `autocomplete=off`, endpoint/model controls, timeout dropdown, output-cap number control, acceptance disabled for invalid endpoint, configured/missing status only, set-key control clearing in both success/failure, and explicit delete-key action.

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

Add tests for disabled readiness, one click/one transport call, cancellation, view close/unload, usage disclaimer, live announcements, 200% zoom, keyboard focus, and manual M04 fallback.

- [ ] **Step 3: Run UI tests and confirm failure**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/main.test.ts test/view.test.ts test/styles.test.ts`

Expected: FAIL on missing provider controls.

- [ ] **Step 4: Wire narrow services in `main.ts`**

Configure both native modules from exact plugin paths. Inject only credential status/set/delete/read, current settings/generations, and `sendOpenAICompatibleRequest`. Register provider invalidation alongside existing source/manual invalidators and invoke it on plugin unload.

- [ ] **Step 5: Render accessible settings and provider panel**

Use Obsidian `Setting` controls and `textContent` only. Never render, read back, or persist the key after save. Preflight shows only validated host/model/bytes/cap/status. Keep the previous candidate DOM while sending/failing. Render usage as untrusted text with the required disclaimer. Preserve all manual controls.

- [ ] **Step 6: Add scoped styles and run UI/build tests**

Use `.c2v-provider-*` selectors, flexible wrapping, `min-width: 0`, `overflow-wrap: anywhere`, visible focus, and no inline styles.

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/main.test.ts test/view.test.ts test/styles.test.ts
pnpm --filter @chat2vault/obsidian-plugin build
```

- [ ] **Step 7: Commit**

```bash
git add apps/obsidian-plugin/src/main.ts apps/obsidian-plugin/src/settings.ts apps/obsidian-plugin/src/view.ts apps/obsidian-plugin/styles.css apps/obsidian-plugin/test/main.test.ts apps/obsidian-plugin/test/view.test.ts apps/obsidian-plugin/test/styles.test.ts
git commit -m "feat(plugin): add one-click cloud distillation UI"
```

### Task 8: Static boundaries and deterministic runtime gate

**Files:**

- Create: `apps/obsidian-plugin/scripts/check-m05-boundaries.mjs`
- Create: `apps/obsidian-plugin/scripts/check-m05-runtime.mjs`
- Create: `apps/obsidian-plugin/test/m05-boundaries.test.ts`
- Modify: `apps/obsidian-plugin/scripts/check-plugin.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: production sources/bundle/metafile, synthetic native account seam, local TLS simulator seam, disposable vault mutation sentinel.
- Produces: exact single-network-surface, no-bypass, no-write, no-secret/persistence, native-cleanup, and runtime-scenario evidence.

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

Assert only the transport imports `node:https`/`node:dns`; only Keychain wrapper loads `keychain.node`; production graph contains no runtime-test sentinel or alternate account; M05 modules cannot reach source writer/vault mutation; settings serialization contains no secret field; and the bundle has one `Authorization` construction site.

- [ ] **Step 3: Implement attributed native/simulator runtime script**

Use a disposable directory from `mkdtemp`, a local TLS simulator injected below production endpoint validation, and unique account `chat2vault-runtime-${process.pid}-${randomUUID()}`. Record only scenario IDs, operation tokens, process ID, candidate-vault hash, attempt/mutation counts, synthetic account hash, timings, and closed outcomes. In `finally`, delete and independently assert absence; exit nonzero on cleanup failure.

- [ ] **Step 4: Add exact scenarios**

Include success; disclosure block; missing key; cancel; timeout; redirect; 401; 429; oversized declared/chunked body; invalid content encoding/type/UTF-8/envelope/M04 result; selection/settings/key/view/plugin stale races; manual fallback; zero mutation; zero persistence; and zero retry/background traffic.

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

- [ ] **Step 6: Commit**

```bash
git add package.json apps/obsidian-plugin/scripts apps/obsidian-plugin/test/m05-boundaries.test.ts
git commit -m "test: enforce M05 provider boundaries"
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

Include exact root/branch/base/upstream/HEAD, files, architecture, native hashes, request golden hash, test counts, runtime scenario ledger, Keychain cleanup proof, secret/content scan, risks, limitations, and separate publication states. Decision remains `NO-GO — independent M05 review pending`.

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

Run a repository-wide credential-pattern scan with only inert fragmented fixtures; fail on any contiguous provider-shaped value.

- [ ] **Step 4: Commit implementation evidence**

```bash
git add README.md docs/00_DOCUMENT_INDEX.md docs/18_M05_IMPLEMENTATION_NOTES.md docs/19_M05_RUNTIME_GATE_REPORT.md
git commit -m "docs: record M05 implementation evidence"
```

- [ ] **Step 5: Freeze the review packet**

Create an archive from the exact candidate with spec, full diff, tracked/untracked inventory, command logs, AC ledger, native/runtime evidence, artifact hashes, static gate results, and redacted metadata. Record SHA-256, byte size, regular-file count, directory count, and `unzip -t` result. Exclude `.git`, dependencies, real vaults, real credentials, usernames, machine paths, and raw conversation content.

- [ ] **Step 6: Run the independent browser remediation loop**

Submit the exact packet to the independent reviewer. Apply only in-scope findings, rerun all affected and whole-candidate gates, regenerate the packet/hash/inventory, and resubmit. Stop at any human product decision. Do not claim commit readiness until the exact verdict is observed:

```text
GO — M05 COMMIT READY
```

- [ ] **Step 7: Stop at the publication boundary**

After the exact verdict, report implementation commit readiness separately from Product Owner publication authorization. Do not commit candidate remediation, push, open/merge a PR, tag, deploy, release, use a paid provider, submit to Community Plugins, or begin M06 without applicable explicit authorization.
