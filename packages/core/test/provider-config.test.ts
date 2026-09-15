import { describe, expect, it } from "vitest";

import {
  M05_DIAGNOSTICS,
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
    ["https://api.example.com:1/v1/chat/completions", 1],
    ["https://api.example.com:65535/v1/chat/completions", 65_535],
  ])("preserves a valid non-default port for %s", (value, port) => {
    expect(validateProviderEndpoint(value)).toEqual({
      ok: true,
      endpoint: value,
      hostname: "api.example.com",
      port,
    });
  });

  it("accepts a grammatically valid single-label ASCII hostname", () => {
    expect(
      validateProviderEndpoint("https://provider/v1/chat/completions"),
    ).toEqual({
      ok: true,
      endpoint: "https://provider/v1/chat/completions",
      hostname: "provider",
      port: 443,
    });
  });

  it.each([
    "http://api.example.com/v1/chat/completions",
    "https://user:pass@api.example.com/v1/chat/completions",
    "https://api.example.com/v1/chat/completions?x=1",
    "https://api.example.com/v1/responses",
    "https://127.0.0.1/v1/chat/completions",
    "https://api.example.com./v1/chat/completions",
    "https://api_example.com/v1/chat/completions",
    "HTTPS://api.example.com/v1/chat/completions",
    "https://m\u00fcnich.example/v1/chat/completions",
    "https://api.example.com:0/v1/chat/completions",
    "https://api.example.com:65536/v1/chat/completions",
  ])("rejects unsafe endpoint %s", (value) => {
    expect(validateProviderEndpoint(value)).toEqual({ ok: false });
  });

  it("enforces inclusive scalar limits without coercion", () => {
    expect(validateProviderSecret("x")).toEqual({ ok: true, secret: "x" });
    expect(validateProviderSecret("x".repeat(4095))).toEqual({
      ok: true,
      secret: "x".repeat(4095),
    });
    expect(validateProviderSecret("x".repeat(4096))).toEqual({
      ok: true,
      secret: "x".repeat(4096),
    });
    expect(validateProviderSecret("x".repeat(4097))).toEqual({ ok: false });
    expect(validateProviderSecret(" contains-space")).toEqual({ ok: false });
    expect(validateProviderModel("gpt-5")).toEqual({
      ok: true,
      model: "gpt-5",
    });
    expect(validateProviderTimeout(60_000)).toEqual({
      ok: true,
      timeoutMs: 60_000,
    });
    expect(validateProviderTimeout("60000")).toEqual({ ok: false });
    expect(validateProviderOutputCap(1)).toEqual({
      ok: true,
      maxOutputTokens: 1,
    });
    expect(validateProviderOutputCap(32_768)).toEqual({
      ok: true,
      maxOutputTokens: 32_768,
    });
    expect(validateProviderOutputCap(32_767)).toEqual({
      ok: true,
      maxOutputTokens: 32_767,
    });
    expect(validateProviderOutputCap(32_769)).toEqual({ ok: false });
    expect(validateProviderOutputCap(1.5)).toEqual({ ok: false });
  });

  it.each([
    ["visible NFC Unicode", "m\u00f6del", true],
    ["non-NFC Unicode", "mo\u0308del", false],
    ["control scalar", "model\n", false],
    ["format scalar", "model\u200d", false],
    ["separator scalar", "model\u00a0", false],
    ["private-use scalar", "model\ue000", false],
    ["noncharacter scalar", "model\ufdd0", false],
    ["leading whitespace", " model", false],
    ["trailing whitespace", "model ", false],
  ])("validates model $0", (_name, value, expected) => {
    expect(validateProviderModel(value).ok).toBe(expected);
  });

  it("enforces model UTF-16 and UTF-8 boundaries", () => {
    expect(validateProviderModel("a".repeat(199))).toMatchObject({ ok: true });
    expect(validateProviderModel("a".repeat(200))).toMatchObject({ ok: true });
    expect(validateProviderModel("a".repeat(201))).toEqual({ ok: false });
    expect(validateProviderModel("\u{1f600}".repeat(100))).toMatchObject({
      ok: true,
    });
    expect(validateProviderModel("\u{1f600}".repeat(101))).toEqual({
      ok: false,
    });
    expect(validateProviderModel("\u754c".repeat(134))).toEqual({ ok: false });
  });

  it("exposes the exact closed M05 diagnostic catalogue", () => {
    expect(M05_DIAGNOSTICS).toEqual({
      PROVIDER_UNSUPPORTED_PLATFORM: {
        severity: "error",
        message: "Cloud provider execution is unavailable on this platform.",
        trigger: "eligibility before native/network access",
        providerState: "unavailable",
        controllerResult: "not-ready",
      },
      PROVIDER_IDENTITY_SAVING: {
        severity: "info",
        message: "Provider installation identity is being saved.",
        trigger: "initial v3 persistence pending",
        providerState: "unavailable",
        controllerResult: "initializing",
      },
      PROVIDER_IDENTITY_SAVE_FAILED: {
        severity: "error",
        message: "Provider installation identity could not be saved.",
        trigger: "initial v3 persistence rejection/throw",
        providerState: "unavailable",
        controllerResult: "initialization-failed",
      },
      KEYCHAIN_UNAVAILABLE: {
        severity: "error",
        message: "The macOS Keychain credential service is unavailable.",
        trigger: "module/ABI/status/read unavailable or malformed observation",
        providerState: "unavailable",
        controllerResult: "not-ready",
      },
      KEYCHAIN_STATUS_UNKNOWN: {
        severity: "warning",
        message: "Refresh macOS Keychain status before sending.",
        trigger: "unknown state at readiness",
        providerState: "unavailable",
        controllerResult: "not-ready",
      },
      KEYCHAIN_INPUT_INVALID: {
        severity: "error",
        message: "Enter an API key using 1 to 4096 visible ASCII characters.",
        trigger: "Set input fails §8 grammar before mutex/native access",
        providerState: "unchanged",
        controllerResult: "credential-invalid",
      },
      KEYCHAIN_OPERATION_IN_PROGRESS: {
        severity: "warning",
        message:
          "Another Keychain credential operation is already in progress.",
        trigger: "Set/Delete/Refresh entry while credential mutex is owned",
        providerState: "unchanged",
        controllerResult: "busy",
      },
      PROVIDER_SETTINGS_INVALID: {
        severity: "error",
        message:
          "Configure a valid provider endpoint, model, timeout, and output limit.",
        trigger: "exact settings validation",
        providerState: "unconfigured",
        controllerResult: "not-ready",
      },
      PROVIDER_SETTINGS_OPERATION_IN_PROGRESS: {
        severity: "warning",
        message: "Another Chat2Vault setting is already being saved.",
        trigger: "M05 settings action while the global settings mutex is owned",
        providerState: "unchanged",
        controllerResult: "busy",
      },
      PROVIDER_DISCLOSURE_REQUIRED: {
        severity: "warning",
        message: "Accept the cloud data disclosure before sending.",
        trigger: "disclosure readiness",
        providerState: "unconfigured",
        controllerResult: "not-ready",
      },
      KEYCHAIN_MISSING: {
        severity: "warning",
        message: "Save a provider API key in macOS Keychain before sending.",
        trigger: "verified missing status/read",
        providerState: "unconfigured",
        controllerResult: "not-ready",
      },
      KEYCHAIN_SAVE_FAILED: {
        severity: "error",
        message: "The provider API key was not saved.",
        trigger: "Set stage: mutation, mayHaveChanged: false",
        providerState: "restored prior state",
        controllerResult: "credential-failed",
      },
      KEYCHAIN_VERIFICATION_FAILED: {
        severity: "error",
        message: "The provider API key change could not be verified.",
        trigger: "mayHaveChanged: true, malformed result, or mutation throw",
        providerState: "unavailable",
        controllerResult: "credential-indeterminate",
      },
      KEYCHAIN_DELETE_FAILED: {
        severity: "error",
        message: "The provider API key was not deleted.",
        trigger: "Delete stage: mutation, mayHaveChanged: false",
        providerState: "restored prior state",
        controllerResult: "credential-failed",
      },
      PROVIDER_NO_ACTIVE_REQUEST: {
        severity: "warning",
        message: "Prepare a current distillation request before sending.",
        trigger: "no exact current M04 request",
        providerState: "unconfigured",
        controllerResult: "not-ready",
      },
      PROVIDER_OPERATION_IN_PROGRESS: {
        severity: "warning",
        message: "Another distillation operation is already in progress.",
        trigger: "cross-controller entry rejection",
        providerState: "unchanged",
        controllerResult: "busy",
      },
      PROVIDER_SETTINGS_SAVING: {
        severity: "info",
        message: "Provider settings are being saved.",
        trigger: "accepted provider-settings Save before persistence",
        providerState: "unconfigured",
        controllerResult: "saving",
      },
      PROVIDER_SETTINGS_SAVE_FAILED: {
        severity: "error",
        message: "Provider settings could not be saved.",
        trigger: "provider-settings persistence failure",
        providerState: "recomputed prior state",
        controllerResult: "settings-failed",
      },
      PROVIDER_READY: {
        severity: "info",
        message: "The provider is ready to send the current request.",
        trigger: "all readiness conditions settled",
        providerState: "ready",
        controllerResult: "ready",
      },
      PROVIDER_SENDING: {
        severity: "info",
        message: "The provider request is in progress.",
        trigger: "accepted Provider entry",
        providerState: "sending",
        controllerResult: "started",
      },
      PROVIDER_VALID: {
        severity: "info",
        message: "The provider result was validated.",
        trigger: "current envelope and M04 validation success",
        providerState: "valid",
        controllerResult: "valid",
      },
      PROVIDER_DNS_UNSAFE: {
        severity: "error",
        message:
          "The provider destination is not permitted by the public-network policy.",
        trigger: "malformed/empty/duplicate/over-limit/denied DNS answer set",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_DNS_FAILED: {
        severity: "error",
        message: "The provider destination could not be resolved.",
        trigger: "resolver throw/failure without exposing its value",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_REQUEST_TOO_LARGE: {
        severity: "error",
        message: "The provider request exceeds the allowed size.",
        trigger: "request body exceeds §14",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_TIMEOUT: {
        severity: "error",
        message: "The provider request timed out.",
        trigger: "winning timeout event",
        providerState: "failed",
        controllerResult: "timeout",
      },
      PROVIDER_CANCELLED: {
        severity: "info",
        message: "The provider request was cancelled.",
        trigger: "winning explicit Cancel",
        providerState: "cancelled",
        controllerResult: "cancelled",
      },
      PROVIDER_TLS_FAILED: {
        severity: "error",
        message:
          "A secure connection to the provider could not be established.",
        trigger: "TLS negotiation/certificate/hostname failure",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_NETWORK_FAILED: {
        severity: "error",
        message:
          "The provider request failed before a valid response was received.",
        trigger: "other connect/socket/request/response transport failure",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_REDIRECT_REJECTED: {
        severity: "error",
        message:
          "The provider returned a redirect, which Chat2Vault does not follow.",
        trigger: "HTTP 300–399",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_AUTH_REJECTED: {
        severity: "error",
        message: "The provider rejected the configured credential.",
        trigger: "HTTP 401 or 403",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_RATE_LIMITED: {
        severity: "warning",
        message: "The provider rate limit was reached.",
        trigger: "HTTP 429",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_REQUEST_REJECTED: {
        severity: "error",
        message: "The provider rejected the request.",
        trigger: "other HTTP 400–499",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_SERVICE_FAILED: {
        severity: "error",
        message: "The provider reported a service failure.",
        trigger: "HTTP 500–599",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_STATUS_INVALID: {
        severity: "error",
        message: "The provider returned an unsupported HTTP status.",
        trigger: "any other status",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_RESPONSE_TOO_LARGE: {
        severity: "error",
        message: "The provider response exceeds the allowed size.",
        trigger: "declared or observed body limit",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_RESPONSE_METADATA_INVALID: {
        severity: "error",
        message: "The provider response metadata is invalid.",
        trigger: "encoding/content-type/content-length/header ambiguity",
        providerState: "failed",
        controllerResult: "failed",
      },
      PROVIDER_ENVELOPE_INVALID: {
        severity: "error",
        message:
          "The provider response is not a valid Chat2Vault provider envelope.",
        trigger: "UTF-8/JSON/projection failure",
        providerState: "invalid",
        controllerResult: "invalid",
      },
      PROVIDER_RESULT_INVALID: {
        severity: "error",
        message:
          "The provider result did not satisfy the distillation contract.",
        trigger: "frozen M04 validation failure",
        providerState: "invalid",
        controllerResult: "invalid",
      },
      PROVIDER_STALE: {
        severity: "info",
        message: "The provider operation became stale and was discarded.",
        trigger:
          "stale fence; return-only and never rendered over winning state",
        providerState: "unchanged",
        controllerResult: "stale",
      },
    });
  });
});
