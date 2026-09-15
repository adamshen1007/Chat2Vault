export const M05_ENDPOINT_MAX_UTF8_BYTES = 2_048;
export const M05_MODEL_MAX_UTF16 = 200;
export const M05_MODEL_MAX_UTF8_BYTES = 400;
export const M05_SECRET_MAX_ASCII = 4_096;
export const M05_REQUEST_MAX_UTF8_BYTES = 300_000;
export const M05_RESPONSE_MAX_UTF8_BYTES = 1_048_576;
export const M05_OUTPUT_TOKEN_MAX = 32_768;
export const M05_TIMEOUTS = [10_000, 30_000, 60_000, 120_000] as const;

export type M05ProviderTimeout = (typeof M05_TIMEOUTS)[number];
export type M05DiagnosticSeverity = "error" | "info" | "warning";

export interface M05ProviderConfig {
  endpoint: string;
  hostname: string;
  port: number;
  model: string;
  timeoutMs: M05ProviderTimeout;
  maxOutputTokens: number;
}

export interface ProviderRequestInput {
  model: string;
  prompt: string;
  maxOutputTokens: number;
}

export type ProviderRequestResult =
  | { ok: true; body: string; utf8Bytes: number }
  | { ok: false; code: "PROVIDER_REQUEST_TOO_LARGE" };

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type ProviderResponseResult =
  | { ok: true; content: string; usage?: ProviderUsage }
  | { ok: false; code: "PROVIDER_ENVELOPE_INVALID" };

export interface M05DiagnosticDefinition {
  severity: M05DiagnosticSeverity;
  message: string;
  trigger: string;
  providerState: string;
  controllerResult: string;
}

type DiagnosticRow = readonly [
  M05DiagnosticSeverity,
  string,
  string,
  string,
  string,
];

const diagnosticRows = {
  PROVIDER_UNSUPPORTED_PLATFORM: [
    "error",
    "Cloud provider execution is unavailable on this platform.",
    "eligibility before native/network access",
    "unavailable",
    "not-ready",
  ],
  PROVIDER_IDENTITY_SAVING: [
    "info",
    "Provider installation identity is being saved.",
    "initial v3 persistence pending",
    "unavailable",
    "initializing",
  ],
  PROVIDER_IDENTITY_SAVE_FAILED: [
    "error",
    "Provider installation identity could not be saved.",
    "initial v3 persistence rejection/throw",
    "unavailable",
    "initialization-failed",
  ],
  KEYCHAIN_UNAVAILABLE: [
    "error",
    "The macOS Keychain credential service is unavailable.",
    "module/ABI/status/read unavailable or malformed observation",
    "unavailable",
    "not-ready",
  ],
  KEYCHAIN_STATUS_UNKNOWN: [
    "warning",
    "Refresh macOS Keychain status before sending.",
    "unknown state at readiness",
    "unavailable",
    "not-ready",
  ],
  KEYCHAIN_INPUT_INVALID: [
    "error",
    "Enter an API key using 1 to 4096 visible ASCII characters.",
    "Set input fails §8 grammar before mutex/native access",
    "unchanged",
    "credential-invalid",
  ],
  KEYCHAIN_OPERATION_IN_PROGRESS: [
    "warning",
    "Another Keychain credential operation is already in progress.",
    "Set/Delete/Refresh entry while credential mutex is owned",
    "unchanged",
    "busy",
  ],
  PROVIDER_SETTINGS_INVALID: [
    "error",
    "Configure a valid provider endpoint, model, timeout, and output limit.",
    "exact settings validation",
    "unconfigured",
    "not-ready",
  ],
  PROVIDER_SETTINGS_OPERATION_IN_PROGRESS: [
    "warning",
    "Another Chat2Vault setting is already being saved.",
    "M05 settings action while the global settings mutex is owned",
    "unchanged",
    "busy",
  ],
  PROVIDER_DISCLOSURE_REQUIRED: [
    "warning",
    "Accept the cloud data disclosure before sending.",
    "disclosure readiness",
    "unconfigured",
    "not-ready",
  ],
  KEYCHAIN_MISSING: [
    "warning",
    "Save a provider API key in macOS Keychain before sending.",
    "verified missing status/read",
    "unconfigured",
    "not-ready",
  ],
  KEYCHAIN_SAVE_FAILED: [
    "error",
    "The provider API key was not saved.",
    "Set stage: mutation, mayHaveChanged: false",
    "restored prior state",
    "credential-failed",
  ],
  KEYCHAIN_VERIFICATION_FAILED: [
    "error",
    "The provider API key change could not be verified.",
    "mayHaveChanged: true, malformed result, or mutation throw",
    "unavailable",
    "credential-indeterminate",
  ],
  KEYCHAIN_DELETE_FAILED: [
    "error",
    "The provider API key was not deleted.",
    "Delete stage: mutation, mayHaveChanged: false",
    "restored prior state",
    "credential-failed",
  ],
  PROVIDER_NO_ACTIVE_REQUEST: [
    "warning",
    "Prepare a current distillation request before sending.",
    "no exact current M04 request",
    "unconfigured",
    "not-ready",
  ],
  PROVIDER_OPERATION_IN_PROGRESS: [
    "warning",
    "Another distillation operation is already in progress.",
    "cross-controller entry rejection",
    "unchanged",
    "busy",
  ],
  PROVIDER_SETTINGS_SAVING: [
    "info",
    "Provider settings are being saved.",
    "accepted provider-settings Save before persistence",
    "unconfigured",
    "saving",
  ],
  PROVIDER_SETTINGS_SAVE_FAILED: [
    "error",
    "Provider settings could not be saved.",
    "provider-settings persistence failure",
    "recomputed prior state",
    "settings-failed",
  ],
  PROVIDER_READY: [
    "info",
    "The provider is ready to send the current request.",
    "all readiness conditions settled",
    "ready",
    "ready",
  ],
  PROVIDER_SENDING: [
    "info",
    "The provider request is in progress.",
    "accepted Provider entry",
    "sending",
    "started",
  ],
  PROVIDER_VALID: [
    "info",
    "The provider result was validated.",
    "current envelope and M04 validation success",
    "valid",
    "valid",
  ],
  PROVIDER_DNS_UNSAFE: [
    "error",
    "The provider destination is not permitted by the public-network policy.",
    "malformed/empty/duplicate/over-limit/denied DNS answer set",
    "failed",
    "failed",
  ],
  PROVIDER_DNS_FAILED: [
    "error",
    "The provider destination could not be resolved.",
    "resolver throw/failure without exposing its value",
    "failed",
    "failed",
  ],
  PROVIDER_REQUEST_TOO_LARGE: [
    "error",
    "The provider request exceeds the allowed size.",
    "request body exceeds §14",
    "failed",
    "failed",
  ],
  PROVIDER_TIMEOUT: [
    "error",
    "The provider request timed out.",
    "winning timeout event",
    "failed",
    "timeout",
  ],
  PROVIDER_CANCELLED: [
    "info",
    "The provider request was cancelled.",
    "winning explicit Cancel",
    "cancelled",
    "cancelled",
  ],
  PROVIDER_TLS_FAILED: [
    "error",
    "A secure connection to the provider could not be established.",
    "TLS negotiation/certificate/hostname failure",
    "failed",
    "failed",
  ],
  PROVIDER_NETWORK_FAILED: [
    "error",
    "The provider request failed before a valid response was received.",
    "other connect/socket/request/response transport failure",
    "failed",
    "failed",
  ],
  PROVIDER_REDIRECT_REJECTED: [
    "error",
    "The provider returned a redirect, which Chat2Vault does not follow.",
    "HTTP 300–399",
    "failed",
    "failed",
  ],
  PROVIDER_AUTH_REJECTED: [
    "error",
    "The provider rejected the configured credential.",
    "HTTP 401 or 403",
    "failed",
    "failed",
  ],
  PROVIDER_RATE_LIMITED: [
    "warning",
    "The provider rate limit was reached.",
    "HTTP 429",
    "failed",
    "failed",
  ],
  PROVIDER_REQUEST_REJECTED: [
    "error",
    "The provider rejected the request.",
    "other HTTP 400–499",
    "failed",
    "failed",
  ],
  PROVIDER_SERVICE_FAILED: [
    "error",
    "The provider reported a service failure.",
    "HTTP 500–599",
    "failed",
    "failed",
  ],
  PROVIDER_STATUS_INVALID: [
    "error",
    "The provider returned an unsupported HTTP status.",
    "any other status",
    "failed",
    "failed",
  ],
  PROVIDER_RESPONSE_TOO_LARGE: [
    "error",
    "The provider response exceeds the allowed size.",
    "declared or observed body limit",
    "failed",
    "failed",
  ],
  PROVIDER_RESPONSE_METADATA_INVALID: [
    "error",
    "The provider response metadata is invalid.",
    "encoding/content-type/content-length/header ambiguity",
    "failed",
    "failed",
  ],
  PROVIDER_ENVELOPE_INVALID: [
    "error",
    "The provider response is not a valid Chat2Vault provider envelope.",
    "UTF-8/JSON/projection failure",
    "invalid",
    "invalid",
  ],
  PROVIDER_RESULT_INVALID: [
    "error",
    "The provider result did not satisfy the distillation contract.",
    "frozen M04 validation failure",
    "invalid",
    "invalid",
  ],
  PROVIDER_STALE: [
    "info",
    "The provider operation became stale and was discarded.",
    "stale fence; return-only and never rendered over winning state",
    "unchanged",
    "stale",
  ],
} as const satisfies Record<string, DiagnosticRow>;

export const M05_DIAGNOSTICS = Object.fromEntries(
  Object.entries(diagnosticRows).map(
    ([code, [severity, message, trigger, providerState, controllerResult]]) => [
      code,
      { severity, message, trigger, providerState, controllerResult },
    ],
  ),
) as {
  readonly [Code in keyof typeof diagnosticRows]: M05DiagnosticDefinition;
};

export type M05DiagnosticCode = keyof typeof M05_DIAGNOSTICS;
