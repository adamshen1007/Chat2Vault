import {
  M05_DIAGNOSTICS,
  normalizeSourceRoot,
  validateProviderEndpoint,
  validateProviderModel,
  validateProviderOutputCap,
  validateProviderTimeout,
} from "@chat2vault/core";

export type PreviewMessagesPerPage = 10 | 25 | 50;
export interface Chat2VaultSettingsV1 {
  schemaVersion: 1;
  previewMessagesPerPage: PreviewMessagesPerPage;
}
export interface Chat2VaultSettingsV2 {
  schemaVersion: 2;
  previewMessagesPerPage: PreviewMessagesPerPage;
  sourceRoot: string;
}
export interface ProviderSettings {
  endpoint: string;
  model: string;
  timeoutMs: 10_000 | 30_000 | 60_000 | 120_000;
  maxOutputTokens: number;
  cloudDisclosureAccepted: boolean;
}
export interface Chat2VaultSettingsV3 {
  schemaVersion: 3;
  installationId: string;
  previewMessagesPerPage: PreviewMessagesPerPage;
  sourceRoot: string;
  provider: ProviderSettings;
}

/** Frozen M03 default, retained for the explicit future-schema v2 save path. */
export const DEFAULT_SETTINGS: Chat2VaultSettingsV2 = {
  schemaVersion: 2,
  previewMessagesPerPage: 25,
  sourceRoot: "",
};
export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  endpoint: "",
  model: "",
  timeoutMs: 60_000,
  maxOutputTokens: 4_096,
  cloudDisclosureAccepted: false,
};

export type SettingsLoadDiagnosticCode =
  | "INVALID_PERSISTED_SOURCE_ROOT"
  | "INVALID_PERSISTED_SETTINGS"
  | "UNSUPPORTED_SETTINGS_SCHEMA";
export interface SettingsLoadDiagnostic {
  code: SettingsLoadDiagnosticCode;
  severity: "warning";
  message: string;
}
export interface ProviderSettingsLoadDiagnostic {
  code: "PROVIDER_SETTINGS_INVALID";
  severity: "error";
  message: string;
}
export type AnySettingsLoadDiagnostic =
  SettingsLoadDiagnostic | ProviderSettingsLoadDiagnostic;
export type IdentityState = "authoritative" | "pending" | "unsupported-future";
export type ProviderReadiness =
  | { state: "unavailable"; result: "initializing" | "initialization-failed" }
  | { state: "unavailable"; result: "unsupported-settings" }
  | { state: "unavailable"; result: "credential-unknown" }
  | {
      state: "unconfigured";
      result: "saving" | "not-ready" | "settings-failed";
    };
export interface SettingsLoadResult {
  settings: Chat2VaultSettingsV3;
  diagnostics: AnySettingsLoadDiagnostic[];
  identityState: IdentityState;
  pendingProviderBasis?: ProviderSettings;
  providerReadiness: ProviderReadiness;
}
export type SettingsSaveResult =
  | { status: "saved" }
  | { status: "unchanged" }
  | {
      status: "in-progress";
      message: "A Chat2Vault setting is already being saved.";
    }
  | {
      status: "invalid";
      message:
        "The preview setting is invalid." | "The source folder is invalid.";
    }
  | {
      status: "failed";
      message:
        | "The preview setting could not be saved."
        | "The source folder setting could not be saved.";
    };
export type ProviderSettingsSaveResult =
  | { status: "saved" }
  | { status: "invalid"; code: "PROVIDER_SETTINGS_INVALID" }
  | { status: "failed"; code: "PROVIDER_SETTINGS_SAVE_FAILED" }
  | { status: "in-progress"; code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS" }
  | {
      status: "unavailable";
      code:
        | "PROVIDER_IDENTITY_SAVING"
        | "PROVIDER_IDENTITY_SAVE_FAILED"
        | "UNSUPPORTED_SETTINGS_SCHEMA";
    };
export type ProviderInitializationResult =
  | { status: "saved" }
  | { status: "unchanged" }
  | { status: "failed"; code: "PROVIDER_IDENTITY_SAVE_FAILED" }
  | { status: "in-progress"; code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS" }
  | { status: "unavailable"; code: "UNSUPPORTED_SETTINGS_SCHEMA" };
export type SourceRootPersistenceState =
  | { status: "settled" }
  | { status: "pending"; previousRoot: string; proposedRoot: string };
export type ProviderSettingsPersistenceState =
  | { status: "settled" }
  | { status: "saving"; saveGeneration: number }
  | { status: "failed"; saveGeneration: number };
export type ProviderSettingsStatusCode =
  "PROVIDER_SETTINGS_SAVING" | "PROVIDER_SETTINGS_SAVE_FAILED" | undefined;

const MESSAGES: Record<SettingsLoadDiagnosticCode, string> = {
  INVALID_PERSISTED_SOURCE_ROOT:
    "The saved source folder is invalid and was disabled in memory.",
  INVALID_PERSISTED_SETTINGS:
    "The saved Chat2Vault settings are invalid; safe defaults were loaded in memory.",
  UNSUPPORTED_SETTINGS_SCHEMA:
    "The saved Chat2Vault settings schema is unsupported; safe defaults were loaded in memory.",
};
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const V1_KEYS = ["schemaVersion", "previewMessagesPerPage"] as const;
const V2_KEYS = [
  "schemaVersion",
  "previewMessagesPerPage",
  "sourceRoot",
] as const;
const V3_KEYS = [
  "schemaVersion",
  "installationId",
  "previewMessagesPerPage",
  "sourceRoot",
  "provider",
] as const;
const PROVIDER_KEYS = [
  "endpoint",
  "model",
  "timeoutMs",
  "maxOutputTokens",
  "cloudDisclosureAccepted",
] as const;

function diagnostic(code: SettingsLoadDiagnosticCode): SettingsLoadDiagnostic {
  return { code, severity: "warning", message: MESSAGES[code] };
}
function providerDiagnostic(): ProviderSettingsLoadDiagnostic {
  return {
    code: "PROVIDER_SETTINGS_INVALID",
    severity: "error",
    message: M05_DIAGNOSTICS.PROVIDER_SETTINGS_INVALID.message,
  };
}
type SafeJsonObject = Record<string, unknown>;
type SafeJsonArray = unknown[];
const INVALID_JSON_VALUE = Symbol("invalid-json-value");
type ProjectedJsonValue =
  | null
  | string
  | boolean
  | number
  | SafeJsonObject
  | SafeJsonArray
  | typeof INVALID_JSON_VALUE;

/**
 * Builds a detached data-only snapshot without ever reading an imported field
 * by property access. Once this returns, every consumer touches only the
 * snapshot, so a Proxy `get` trap or later revocation cannot affect recovery.
 */
function projectJsonObject(
  value: unknown,
  seen = new Set<object>(),
): SafeJsonObject | undefined {
  if (value === null || typeof value !== "object" || seen.has(value))
    return undefined;
  try {
    if (Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(value).length !== 0
    )
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.getOwnPropertyNames(value);
    if (names.length !== Object.keys(value).length) return undefined;
    seen.add(value);
    const projection: SafeJsonObject = Object.create(null) as SafeJsonObject;
    for (const name of names) {
      const descriptor = descriptors[name];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        seen.delete(value);
        return undefined;
      }
      const projected = projectJsonValue(descriptor.value, seen);
      if (projected === INVALID_JSON_VALUE) {
        seen.delete(value);
        return undefined;
      }
      Object.defineProperty(projection, name, {
        value: projected,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    seen.delete(value);
    return projection;
  } catch {
    return undefined;
  }
}

function projectJsonValue(
  value: unknown,
  seen: Set<object>,
): ProjectedJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : INVALID_JSON_VALUE;
  if (Array.isArray(value))
    return projectJsonArray(value, seen) ?? INVALID_JSON_VALUE;
  return projectJsonObject(value, seen) ?? INVALID_JSON_VALUE;
}

/**
 * Settings roots must be objects, while JSON arrays remain valid nested data.
 * This descriptor-only projection lets an invalid Provider array fail alone
 * and lets an ignored extra array remain safe without firing indexed `get`.
 */
function projectJsonArray(
  value: unknown[],
  seen: Set<object>,
): SafeJsonArray | undefined {
  if (seen.has(value)) return undefined;
  try {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0
    )
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.getOwnPropertyNames(value);
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      length === undefined ||
      !("value" in length) ||
      length.enumerable ||
      length.configurable ||
      !length.writable
    )
      return undefined;
    const arrayLength: unknown = length.value;
    if (
      typeof arrayLength !== "number" ||
      !Number.isSafeInteger(arrayLength) ||
      arrayLength < 0 ||
      names.length !== arrayLength + 1
    )
      return undefined;
    seen.add(value);
    const projection: SafeJsonArray = [];
    for (let index = 0; index < arrayLength; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        !descriptor.configurable ||
        !descriptor.writable
      ) {
        seen.delete(value);
        return undefined;
      }
      const projected = projectJsonValue(descriptor.value, seen);
      if (projected === INVALID_JSON_VALUE) {
        seen.delete(value);
        return undefined;
      }
      Object.defineProperty(projection, String(index), {
        value: projected,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    seen.delete(value);
    return projection;
  } catch {
    return undefined;
  }
}
function exactKeys(
  value: SafeJsonObject,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function validPage(value: unknown): value is PreviewMessagesPerPage {
  return value === 10 || value === 25 || value === 50;
}
function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}
function copyProvider(provider: ProviderSettings): ProviderSettings {
  return { ...provider };
}
function defaultV3(installationId: string): Chat2VaultSettingsV3 {
  return {
    schemaVersion: 3,
    installationId,
    previewMessagesPerPage: 25,
    sourceRoot: "",
    provider: copyProvider(DEFAULT_PROVIDER_SETTINGS),
  };
}
function persistedProvider(value: unknown): ProviderSettings | undefined {
  const record = projectJsonObject(value);
  if (record === undefined || !exactKeys(record, PROVIDER_KEYS))
    return undefined;
  const {
    endpoint,
    model,
    timeoutMs,
    maxOutputTokens,
    cloudDisclosureAccepted,
  } = record;
  const validShared =
    validateProviderTimeout(timeoutMs).ok &&
    validateProviderOutputCap(maxOutputTokens).ok;
  const exactDefault =
    endpoint === "" &&
    model === "" &&
    cloudDisclosureAccepted === false &&
    validShared;
  const fullyConfigured =
    validateProviderEndpoint(endpoint).ok &&
    validateProviderModel(model).ok &&
    typeof cloudDisclosureAccepted === "boolean" &&
    validShared;
  if (!exactDefault && !fullyConfigured) return undefined;
  return {
    endpoint: endpoint as string,
    model: model as string,
    timeoutMs: timeoutMs as ProviderSettings["timeoutMs"],
    maxOutputTokens: maxOutputTokens as number,
    cloudDisclosureAccepted,
  };
}
function validateProviderDraft(
  value: unknown,
): { ok: true; value: ProviderSettings } | { ok: false } {
  const record = projectJsonObject(value);
  if (record === undefined || !exactKeys(record, PROVIDER_KEYS))
    return { ok: false };
  const endpoint = validateProviderEndpoint(record.endpoint);
  const model = validateProviderModel(record.model);
  const timeout = validateProviderTimeout(record.timeoutMs);
  const output = validateProviderOutputCap(record.maxOutputTokens);
  if (
    !endpoint.ok ||
    !model.ok ||
    !timeout.ok ||
    !output.ok ||
    typeof record.cloudDisclosureAccepted !== "boolean"
  )
    return { ok: false };
  return {
    ok: true,
    value: {
      endpoint: endpoint.endpoint,
      model: model.model,
      timeoutMs: timeout.timeoutMs,
      maxOutputTokens: output.maxOutputTokens,
      cloudDisclosureAccepted: record.cloudDisclosureAccepted,
    },
  };
}

interface M03Load {
  settings: Chat2VaultSettingsV2;
  diagnostics: SettingsLoadDiagnostic[];
  future: boolean;
}
function readM03(value: unknown): M03Load {
  if (value === undefined || value === null)
    return {
      settings: { ...DEFAULT_SETTINGS },
      diagnostics: [],
      future: false,
    };
  const record = projectJsonObject(value);
  if (record === undefined)
    return {
      settings: { ...DEFAULT_SETTINGS },
      diagnostics: [diagnostic("INVALID_PERSISTED_SETTINGS")],
      future: false,
    };
  const schema = record.schemaVersion;
  if (typeof schema === "number" && Number.isSafeInteger(schema) && schema >= 4)
    return {
      settings: { ...DEFAULT_SETTINGS },
      diagnostics: [diagnostic("UNSUPPORTED_SETTINGS_SCHEMA")],
      future: true,
    };
  if (
    schema === 1 &&
    exactKeys(record, V1_KEYS) &&
    validPage(record.previewMessagesPerPage)
  )
    return {
      settings: {
        schemaVersion: 2,
        previewMessagesPerPage: record.previewMessagesPerPage,
        sourceRoot: "",
      },
      diagnostics: [],
      future: false,
    };
  if (
    schema === 2 &&
    exactKeys(record, V2_KEYS) &&
    validPage(record.previewMessagesPerPage) &&
    typeof record.sourceRoot === "string"
  ) {
    const root = normalizeSourceRoot(record.sourceRoot);
    if (root.status === "configured")
      return {
        settings: {
          schemaVersion: 2,
          previewMessagesPerPage: record.previewMessagesPerPage,
          sourceRoot: root.sourceRoot,
        },
        diagnostics: [],
        future: false,
      };
    if (root.status === "unconfigured")
      return {
        settings: {
          schemaVersion: 2,
          previewMessagesPerPage: record.previewMessagesPerPage,
          sourceRoot: "",
        },
        diagnostics: [],
        future: false,
      };
    return {
      settings: {
        schemaVersion: 2,
        previewMessagesPerPage: record.previewMessagesPerPage,
        sourceRoot: "",
      },
      diagnostics: [diagnostic("INVALID_PERSISTED_SOURCE_ROOT")],
      future: false,
    };
  }
  return {
    settings: { ...DEFAULT_SETTINGS },
    diagnostics: [diagnostic("INVALID_PERSISTED_SETTINGS")],
    future: false,
  };
}
function pending(
  settings: Chat2VaultSettingsV3,
  diagnostics: AnySettingsLoadDiagnostic[],
): SettingsLoadResult {
  return {
    settings,
    diagnostics,
    identityState: "pending",
    pendingProviderBasis: copyProvider(settings.provider),
    providerReadiness: { state: "unavailable", result: "initializing" },
  };
}

/** Pure read/recovery. Persistence starts only through SettingsController.initializeIdentity. */
export function readSettings(
  value: unknown,
  randomUuid: () => string = () => crypto.randomUUID(),
): SettingsLoadResult {
  const record = projectJsonObject(value);
  if (record?.schemaVersion === 3) {
    const diagnostics: AnySettingsLoadDiagnostic[] = [];
    const exact = exactKeys(record, V3_KEYS);
    if (!exact) diagnostics.push(diagnostic("INVALID_PERSISTED_SETTINGS"));
    const installationId = validUuid(record.installationId)
      ? record.installationId
      : randomUuid();
    if (
      !validUuid(record.installationId) &&
      !diagnostics.some((item) => item.code === "INVALID_PERSISTED_SETTINGS")
    )
      diagnostics.push(diagnostic("INVALID_PERSISTED_SETTINGS"));
    const page = validPage(record.previewMessagesPerPage)
      ? record.previewMessagesPerPage
      : 25;
    if (
      !validPage(record.previewMessagesPerPage) &&
      !diagnostics.some((item) => item.code === "INVALID_PERSISTED_SETTINGS")
    )
      diagnostics.push(diagnostic("INVALID_PERSISTED_SETTINGS"));
    let sourceRoot = "";
    if (typeof record.sourceRoot !== "string") {
      if (
        !diagnostics.some((item) => item.code === "INVALID_PERSISTED_SETTINGS")
      )
        diagnostics.push(diagnostic("INVALID_PERSISTED_SETTINGS"));
    } else {
      const root = normalizeSourceRoot(record.sourceRoot);
      if (root.status === "configured") sourceRoot = root.sourceRoot;
      else if (root.status === "invalid")
        diagnostics.push(diagnostic("INVALID_PERSISTED_SOURCE_ROOT"));
    }
    const recoveredProvider = persistedProvider(record.provider);
    const provider =
      recoveredProvider !== undefined
        ? copyProvider(recoveredProvider)
        : copyProvider(DEFAULT_PROVIDER_SETTINGS);
    if (recoveredProvider === undefined) diagnostics.push(providerDiagnostic());
    const settings: Chat2VaultSettingsV3 = {
      schemaVersion: 3,
      installationId,
      previewMessagesPerPage: page,
      sourceRoot,
      provider,
    };
    return validUuid(record.installationId)
      ? {
          settings,
          diagnostics,
          identityState: "authoritative",
          providerReadiness: {
            state: "unavailable",
            result: "credential-unknown",
          },
        }
      : pending(settings, diagnostics);
  }
  const inherited = readM03(value);
  if (inherited.future)
    return {
      settings: defaultV3(""),
      diagnostics: inherited.diagnostics,
      identityState: "unsupported-future",
      providerReadiness: {
        state: "unavailable",
        result: "unsupported-settings",
      },
    };
  return pending(
    {
      schemaVersion: 3,
      installationId: randomUuid(),
      previewMessagesPerPage: inherited.settings.previewMessagesPerPage,
      sourceRoot: inherited.settings.sourceRoot,
      provider: copyProvider(DEFAULT_PROVIDER_SETTINGS),
    },
    inherited.diagnostics,
  );
}

function m03Equal(
  a: Pick<Chat2VaultSettingsV3, "previewMessagesPerPage" | "sourceRoot">,
  b: Pick<Chat2VaultSettingsV3, "previewMessagesPerPage" | "sourceRoot">,
): boolean {
  return (
    a.previewMessagesPerPage === b.previewMessagesPerPage &&
    a.sourceRoot === b.sourceRoot
  );
}
export interface SettingsControllerHooks {
  /** Called only after a complete v3 snapshot has fulfilled persistence. */
  onIdentityAuthorized?: (installationId: string) => void;
  /** Provider integration supplies its own cancellation/owner invalidation here. */
  invalidateProviderOwnerAndAbort?: () => void;
}

/**
 * Task 7 integration surface: construct from `readSettings`, call
 * `initializeIdentity` once at plugin load, and call
 * `discardUnpersistedIdentityOnUnload` on unload. This model intentionally
 * exposes no Keychain or network capability; the post-authority hook is the
 * only handoff point for that later layer.
 */
export class SettingsController {
  private saving = false;
  private lifecycleGeneration = 0;
  private pendingIdentity:
    { installationId: string; providerBasis: ProviderSettings } | undefined;
  public settings: Chat2VaultSettingsV3;
  public identityState: IdentityState | "saving" | "failed";
  public providerReadiness: ProviderReadiness;
  public providerDraft: ProviderSettings;
  public providerSettingsPersistenceState: ProviderSettingsPersistenceState = {
    status: "settled",
  };
  public providerSettingsStatusCode: ProviderSettingsStatusCode;
  public providerSaveGeneration = 0;
  public providerSettingsGeneration = 0;
  public sourceWriteGeneration = 0;
  public sourceRootPersistenceState: SourceRootPersistenceState = {
    status: "settled",
  };
  public constructor(
    loaded: SettingsLoadResult | Chat2VaultSettingsV3,
    private readonly persist: (
      settings: Chat2VaultSettingsV3 | Chat2VaultSettingsV2,
    ) => Promise<void>,
    private readonly invalidateSourceState: () => void,
    private readonly hooks: SettingsControllerHooks = {},
  ) {
    const load = "settings" in loaded ? loaded : pending(loaded, []);
    this.settings = load.settings;
    this.identityState = load.identityState;
    this.providerReadiness = load.providerReadiness;
    this.providerDraft = copyProvider(load.settings.provider);
    if (load.identityState === "pending")
      this.pendingIdentity = {
        installationId: load.settings.installationId,
        providerBasis: copyProvider(
          load.pendingProviderBasis ?? load.settings.provider,
        ),
      };
  }
  public get isSaving(): boolean {
    return this.saving;
  }
  private tryAcquire(): boolean {
    if (this.saving) return false;
    this.saving = true;
    return true;
  }
  private releaseSettingsMutex(): void {
    this.saving = false;
  }
  private inProgress(): SettingsSaveResult {
    return {
      status: "in-progress",
      message: "A Chat2Vault setting is already being saved.",
    };
  }
  private providerBusy(): ProviderSettingsSaveResult {
    return {
      status: "in-progress",
      code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS",
    };
  }
  private initializationBusy(): ProviderInitializationResult {
    return {
      status: "in-progress",
      code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS",
    };
  }
  private candidate(
    page = this.settings.previewMessagesPerPage,
    root = this.settings.sourceRoot,
  ): Chat2VaultSettingsV3 {
    const pendingIdentity = this.pendingIdentity;
    return pendingIdentity === undefined
      ? { ...this.settings, previewMessagesPerPage: page, sourceRoot: root }
      : {
          schemaVersion: 3,
          installationId: pendingIdentity.installationId,
          previewMessagesPerPage: page,
          sourceRoot: root,
          provider: copyProvider(pendingIdentity.providerBasis),
        };
  }
  private installIdentity(candidate: Chat2VaultSettingsV3): void {
    this.settings = candidate;
    this.providerDraft = copyProvider(candidate.provider);
    this.pendingIdentity = undefined;
    this.identityState = "authoritative";
    this.providerReadiness = {
      state: "unavailable",
      result: "credential-unknown",
    };
    // The later Keychain observer is intentionally an after-authority hook.
    // It cannot turn a fulfilled persistence transaction into an identity failure.
    try {
      this.hooks.onIdentityAuthorized?.(candidate.installationId);
    } catch {
      /* observer owns its failure state */
    }
  }
  public async initializeIdentity(): Promise<ProviderInitializationResult> {
    return this.persistIdentity(false);
  }
  public async retryProviderInitialization(): Promise<ProviderInitializationResult> {
    return this.persistIdentity(true);
  }
  private async persistIdentity(
    retry: boolean,
  ): Promise<ProviderInitializationResult> {
    if (this.identityState === "authoritative") return { status: "unchanged" };
    if (this.identityState === "unsupported-future")
      return { status: "unavailable", code: "UNSUPPORTED_SETTINGS_SCHEMA" };
    if (!this.tryAcquire()) return this.initializationBusy();
    const retained = this.pendingIdentity;
    if (retained === undefined) {
      this.releaseSettingsMutex();
      return { status: "unchanged" };
    }
    // An initial call and explicit Retry share the same retained UUID/basis; Retry only rebases M03 fields.
    void retry;
    this.identityState = "saving";
    this.providerReadiness = { state: "unavailable", result: "initializing" };
    const next = this.candidate();
    const lifecycleGeneration = this.lifecycleGeneration;
    try {
      await this.persist(next);
      if (this.lifecycleGeneration !== lifecycleGeneration)
        return { status: "failed", code: "PROVIDER_IDENTITY_SAVE_FAILED" };
      this.installIdentity(next);
      return { status: "saved" };
    } catch {
      this.identityState = "failed";
      this.providerReadiness = {
        state: "unavailable",
        result: "initialization-failed",
      };
      return { status: "failed", code: "PROVIDER_IDENTITY_SAVE_FAILED" };
    } finally {
      this.releaseSettingsMutex();
    }
  }
  public discardUnpersistedIdentityOnUnload(): void {
    if (
      this.identityState !== "authoritative" &&
      this.identityState !== "unsupported-future"
    ) {
      this.lifecycleGeneration += 1;
      this.pendingIdentity = undefined;
      this.identityState = "failed";
      this.providerReadiness = {
        state: "unavailable",
        result: "initialization-failed",
      };
    }
  }
  public setProviderDraft(draft: ProviderSettings): void {
    const endpointChanged = draft.endpoint !== this.providerDraft.endpoint;
    this.providerDraft = {
      ...draft,
      cloudDisclosureAccepted: endpointChanged
        ? false
        : draft.cloudDisclosureAccepted,
    };
  }
  public captureProviderGenerations(): {
    providerSaveGeneration: number;
    providerSettingsGeneration: number;
  } {
    return {
      providerSaveGeneration: this.providerSaveGeneration,
      providerSettingsGeneration: this.providerSettingsGeneration,
    };
  }
  public async saveProviderSettings(
    draft: ProviderSettings,
  ): Promise<ProviderSettingsSaveResult> {
    if (!this.tryAcquire()) return this.providerBusy();
    try {
      if (this.identityState === "unsupported-future")
        return { status: "unavailable", code: "UNSUPPORTED_SETTINGS_SCHEMA" };
      if (this.identityState !== "authoritative")
        return {
          status: "unavailable",
          code:
            this.identityState === "failed"
              ? "PROVIDER_IDENTITY_SAVE_FAILED"
              : "PROVIDER_IDENTITY_SAVING",
        };
      const validated = validateProviderDraft(draft);
      if (!validated.ok)
        return { status: "invalid", code: "PROVIDER_SETTINGS_INVALID" };
      const previous = this.settings;
      const saveGeneration = ++this.providerSaveGeneration;
      this.providerSettingsPersistenceState = {
        status: "saving",
        saveGeneration,
      };
      this.providerSettingsStatusCode = "PROVIDER_SETTINGS_SAVING";
      this.providerReadiness = { state: "unconfigured", result: "saving" };
      this.hooks.invalidateProviderOwnerAndAbort?.();
      const next = { ...previous, provider: validated.value };
      try {
        await this.persist(next);
        this.settings = next;
        this.providerDraft = copyProvider(validated.value);
        ++this.providerSettingsGeneration;
        this.providerSettingsPersistenceState = { status: "settled" };
        this.providerSettingsStatusCode = undefined;
        this.providerReadiness = {
          state: "unavailable",
          result: "credential-unknown",
        };
        return { status: "saved" };
      } catch {
        this.settings = previous;
        this.providerSettingsPersistenceState = {
          status: "failed",
          saveGeneration,
        };
        this.providerSettingsStatusCode = "PROVIDER_SETTINGS_SAVE_FAILED";
        this.providerReadiness = {
          state: "unconfigured",
          result: "settings-failed",
        };
        return { status: "failed", code: "PROVIDER_SETTINGS_SAVE_FAILED" };
      }
    } finally {
      this.releaseSettingsMutex();
    }
  }
  public async savePreviewMessagesPerPage(
    value: unknown,
  ): Promise<SettingsSaveResult> {
    if (!this.tryAcquire()) return this.inProgress();
    try {
      if (!validPage(value))
        return {
          status: "invalid",
          message: "The preview setting is invalid.",
        };
      const previous = this.settings;
      const next = this.candidate(value, previous.sourceRoot);
      if (
        this.identityState !== "unsupported-future" &&
        m03Equal(previous, next)
      )
        return { status: "unchanged" };
      if (this.identityState === "unsupported-future") {
        try {
          await this.persist({
            schemaVersion: 2,
            previewMessagesPerPage: value,
            sourceRoot: previous.sourceRoot,
          });
          this.settings = { ...previous, previewMessagesPerPage: value };
          return { status: "saved" };
        } catch {
          return {
            status: "failed",
            message: "The preview setting could not be saved.",
          };
        }
      }
      this.settings = next;
      try {
        await this.persist(next);
        if (this.pendingIdentity !== undefined) this.installIdentity(next);
        return { status: "saved" };
      } catch {
        this.settings = previous;
        return {
          status: "failed",
          message: "The preview setting could not be saved.",
        };
      }
    } finally {
      this.releaseSettingsMutex();
    }
  }
  public async saveSourceRoot(value: unknown): Promise<SettingsSaveResult> {
    if (!this.tryAcquire()) return this.inProgress();
    try {
      const normalized = normalizeSourceRoot(value);
      if (normalized.status === "invalid")
        return { status: "invalid", message: "The source folder is invalid." };
      const root =
        normalized.status === "configured" ? normalized.sourceRoot : "";
      const previous = this.settings;
      const next = this.candidate(previous.previewMessagesPerPage, root);
      if (
        this.identityState !== "unsupported-future" &&
        m03Equal(previous, next)
      )
        return { status: "unchanged" };
      this.sourceWriteGeneration += 1;
      this.invalidateSourceState();
      this.sourceRootPersistenceState = {
        status: "pending",
        previousRoot: previous.sourceRoot,
        proposedRoot: root,
      };
      if (this.identityState === "unsupported-future") {
        try {
          await this.persist({
            schemaVersion: 2,
            previewMessagesPerPage: previous.previewMessagesPerPage,
            sourceRoot: root,
          });
          this.settings = { ...previous, sourceRoot: root };
          return { status: "saved" };
        } catch {
          return {
            status: "failed",
            message: "The source folder setting could not be saved.",
          };
        } finally {
          this.sourceRootPersistenceState = { status: "settled" };
        }
      }
      try {
        await this.persist(next);
        this.settings = next;
        if (this.pendingIdentity !== undefined) this.installIdentity(next);
        return { status: "saved" };
      } catch {
        return {
          status: "failed",
          message: "The source folder setting could not be saved.",
        };
      } finally {
        this.sourceRootPersistenceState = { status: "settled" };
      }
    } finally {
      this.releaseSettingsMutex();
    }
  }
}
