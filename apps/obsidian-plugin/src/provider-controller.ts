import {
  M05_DIAGNOSTICS,
  buildProviderRequest,
  m04Diagnostic,
  parseProviderResponse,
  validateDistillationResult,
  type DistillationRequest,
  type DistillationValidationResult,
  type M04Diagnostic,
  type M05DiagnosticCode,
  type M05ProviderConfig,
  type PreviewCandidate,
  type ProviderRequestResult,
  type ProviderResponseResult,
  type ProviderUsage,
} from "@chat2vault/core";
import type { CredentialReadResult } from "./keychain.js";
import type { ProviderSettingsStatusCode } from "./settings-model.js";
import {
  type ProviderTransportInput,
  type ProviderTransportResult,
} from "./provider-transport.js";

export type ProviderState =
  | "unavailable"
  | "unconfigured"
  | "ready"
  | "sending"
  | "valid"
  | "invalid"
  | "cancelled"
  | "failed";
export type ProviderCredentialState =
  "unknown" | "configured" | "missing" | "unavailable";
export type ProviderFenceStage =
  | "keychain"
  | "dns"
  | "pre-connect"
  | "headers"
  | "chunk"
  | "envelope"
  | "validation"
  | "publish";
export type ProviderFence = (stage: ProviderFenceStage) => boolean;
export type ProviderInvalidationReason =
  | "selection-change"
  | "import-replacement"
  | "import-clear"
  | "m04-request-replacement"
  | "provider-settings-save"
  | "credential-change"
  | "manual-input"
  | "view-close"
  | "plugin-unload";

/**
 * Task 6/Task 5 integration contract. The production transport invokes this
 * fence after DNS, immediately before request creation, after headers, and
 * after every body chunk; a false result is terminal and aborts the transport.
 */
export interface ProviderControllerTransportInput extends ProviderTransportInput {
  lifecycleFence: ProviderFence;
}

export interface ProviderDiagnostic {
  severity: "error" | "info" | "warning";
  code: M05DiagnosticCode;
  message: string;
}

export interface ProviderCurrent {
  platformEligible: boolean;
  unsupportedFutureSettings: boolean;
  identityState: "authoritative" | "saving" | "failed";
  credentialState: ProviderCredentialState;
  credentialOperationInProgress: boolean;
  providerSettingsSaving: boolean;
  providerSettingsStatusCode?: ProviderSettingsStatusCode;
  cloudDisclosureAccepted: boolean;
  pluginGeneration: number;
  viewGeneration: number;
  importGeneration: number;
  selectionGeneration: number;
  conversationFingerprint?: string;
  request?: DistillationRequest;
  prompt?: string;
  promptBytes?: number;
  providerSettingsGeneration: number;
  providerSaveGeneration: number;
  credentialGeneration: number;
  config?: M05ProviderConfig;
  manualOwner?: { kind: "Prepare" | "Copy" | "Validate"; token: number };
}

export interface ProviderControllerServices {
  current(): ProviderCurrent;
  readCredential(operationCurrent: () => boolean): CredentialReadResult;
  buildRequest?(input: {
    model: string;
    prompt: string;
    maxOutputTokens: number;
  }): ProviderRequestResult;
  transport(
    input: ProviderControllerTransportInput,
  ): Promise<ProviderTransportResult>;
  parseResponse?(bytes: Uint8Array): ProviderResponseResult;
  validateResult?(
    raw: string,
    request: DistillationRequest,
  ): DistillationValidationResult | Promise<DistillationValidationResult>;
}

export interface ProviderSnapshot {
  readonly status: ProviderState;
  readonly result: string;
  readonly ownerToken: number | undefined;
  readonly host: string | undefined;
  readonly model: string | undefined;
  readonly promptBytes: number | undefined;
  readonly maxOutputTokens: number | undefined;
  readonly credentialState: ProviderCredentialState;
  readonly disclosureAccepted: boolean;
  readonly candidates: readonly PreviewCandidate[];
  readonly usage: Readonly<ProviderUsage> | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly diagnostic: Readonly<ProviderDiagnostic> | undefined;
}

export interface ProviderOperationResult {
  status:
    | "valid"
    | "invalid"
    | "failed"
    | "stale"
    | "busy"
    | "not-ready"
    | "cancelled"
    | "timeout";
  diagnostic?: ProviderDiagnostic;
}

interface ProviderCapture {
  ownerToken: number;
  pluginGeneration: number;
  viewGeneration: number;
  importGeneration: number;
  selectionGeneration: number;
  conversationFingerprint: string;
  requestId: string;
  request: DistillationRequest;
  prompt: string;
  promptBytes: number;
  providerSettingsGeneration: number;
  providerSaveGeneration: number;
  credentialGeneration: number;
  config: M05ProviderConfig;
}

interface ProviderOwner {
  token: number;
  abort: AbortController;
  abortIssued: boolean;
  resolveWinner: (result: ProviderOperationResult) => void;
}

function diagnostic(code: M05DiagnosticCode): ProviderDiagnostic {
  const definition = M05_DIAGNOSTICS[code];
  return Object.freeze({
    severity: definition.severity,
    code,
    message: definition.message,
  });
}

function operationResult(
  status: ProviderOperationResult["status"],
  code?: M05DiagnosticCode,
): ProviderOperationResult {
  return code === undefined
    ? { status }
    : { status, diagnostic: diagnostic(code) };
}

function cloneConfig(config: M05ProviderConfig): M05ProviderConfig {
  return { ...config };
}

function configEqual(
  left: M05ProviderConfig | undefined,
  right: M05ProviderConfig,
): boolean {
  return (
    left?.endpoint === right.endpoint &&
    left.hostname === right.hostname &&
    left.port === right.port &&
    left.model === right.model &&
    left.timeoutMs === right.timeoutMs &&
    left.maxOutputTokens === right.maxOutputTokens
  );
}

function cloneCandidate(candidate: PreviewCandidate): PreviewCandidate {
  const sourceRef = candidate.sourceRefs[0];
  const cloned: PreviewCandidate = {
    ...candidate,
    sourceRefs: [
      {
        ...sourceRef,
        messageFingerprints: [...sourceRef.messageFingerprints],
      },
    ],
    suggestedLinks: [...candidate.suggestedLinks],
    suggestedTags: [...candidate.suggestedTags],
  };
  Object.freeze(cloned.sourceRefs[0].messageFingerprints);
  Object.freeze(cloned.sourceRefs[0]);
  Object.freeze(cloned.sourceRefs);
  Object.freeze(cloned.suggestedLinks);
  Object.freeze(cloned.suggestedTags);
  return Object.freeze(cloned);
}

function immutableSnapshot(
  snapshot: Omit<ProviderSnapshot, "candidates"> & {
    candidates: readonly PreviewCandidate[];
  },
): ProviderSnapshot {
  const candidates = Object.freeze(snapshot.candidates.map(cloneCandidate));
  const usage =
    snapshot.usage === undefined
      ? undefined
      : Object.freeze({ ...snapshot.usage });
  return Object.freeze({
    ...snapshot,
    candidates,
    ...(usage === undefined ? {} : { usage }),
  });
}

function currentSafely(services: ProviderControllerServices): ProviderCurrent {
  try {
    return services.current();
  } catch {
    return {
      platformEligible: false,
      unsupportedFutureSettings: false,
      identityState: "failed",
      credentialState: "unavailable",
      credentialOperationInProgress: false,
      providerSettingsSaving: false,
      cloudDisclosureAccepted: false,
      pluginGeneration: 0,
      viewGeneration: 0,
      importGeneration: 0,
      selectionGeneration: 0,
      providerSettingsGeneration: 0,
      providerSaveGeneration: 0,
      credentialGeneration: 0,
    };
  }
}

function readinessCode(
  current: ProviderCurrent,
): M05DiagnosticCode | "UNSUPPORTED_SETTINGS_SCHEMA" | undefined {
  if (!current.platformEligible) return "PROVIDER_UNSUPPORTED_PLATFORM";
  if (current.unsupportedFutureSettings) return "UNSUPPORTED_SETTINGS_SCHEMA";
  if (current.identityState === "saving") return "PROVIDER_IDENTITY_SAVING";
  if (current.identityState === "failed")
    return "PROVIDER_IDENTITY_SAVE_FAILED";
  if (current.credentialState === "unavailable") return "KEYCHAIN_UNAVAILABLE";
  if (
    current.credentialState === "unknown" ||
    current.credentialOperationInProgress
  )
    return "KEYCHAIN_STATUS_UNKNOWN";
  if (
    current.providerSettingsSaving ||
    current.providerSettingsStatusCode === "PROVIDER_SETTINGS_SAVING"
  )
    return "PROVIDER_SETTINGS_SAVING";
  if (current.providerSettingsStatusCode === "PROVIDER_SETTINGS_SAVE_FAILED")
    return "PROVIDER_SETTINGS_SAVE_FAILED";
  if (current.config === undefined) return "PROVIDER_SETTINGS_INVALID";
  if (!current.cloudDisclosureAccepted) return "PROVIDER_DISCLOSURE_REQUIRED";
  if (current.credentialState === "missing") return "KEYCHAIN_MISSING";
  if (
    current.request === undefined ||
    current.prompt === undefined ||
    current.promptBytes === undefined ||
    current.conversationFingerprint === undefined ||
    current.request.conversationFingerprint !== current.conversationFingerprint
  )
    return "PROVIDER_NO_ACTIVE_REQUEST";
  return undefined;
}

export class ProviderController {
  private nextToken = 0;
  private owner: ProviderOwner | undefined;
  private currentSnapshot: ProviderSnapshot = immutableSnapshot({
    status: "unavailable",
    result: "not-ready",
    ownerToken: undefined,
    host: undefined,
    model: undefined,
    promptBytes: undefined,
    maxOutputTokens: undefined,
    credentialState: "unknown",
    disclosureAccepted: false,
    candidates: [],
    usage: undefined,
    requestId: undefined,
    retryAfterSeconds: undefined,
    diagnostic: diagnostic("PROVIDER_UNSUPPORTED_PLATFORM"),
  });

  public constructor(private readonly services: ProviderControllerServices) {}

  public get snapshot(): ProviderSnapshot {
    return this.currentSnapshot;
  }

  private publish(
    patch: Partial<Omit<ProviderSnapshot, "candidates">> & {
      candidates?: readonly PreviewCandidate[];
    },
  ): ProviderSnapshot {
    this.currentSnapshot = immutableSnapshot({
      ...this.currentSnapshot,
      ...patch,
      candidates: patch.candidates ?? this.currentSnapshot.candidates,
    });
    return this.currentSnapshot;
  }

  public preflight(): ProviderSnapshot {
    if (this.owner !== undefined) return this.currentSnapshot;
    const current = currentSafely(this.services);
    const code = readinessCode(current);
    const shared = {
      ownerToken: undefined,
      credentialState: current.credentialState,
      disclosureAccepted: current.cloudDisclosureAccepted,
      host:
        current.config === undefined
          ? undefined
          : current.config.port === 443
            ? current.config.hostname
            : `${current.config.hostname}:${String(current.config.port)}`,
      model: current.config?.model,
      maxOutputTokens: current.config?.maxOutputTokens,
      promptBytes: current.promptBytes,
    };
    if (code === "UNSUPPORTED_SETTINGS_SCHEMA")
      return this.publish({
        ...shared,
        status: "unavailable",
        result: "unsupported-settings",
        diagnostic: undefined,
      });
    if (code !== undefined) {
      const state =
        code === "PROVIDER_UNSUPPORTED_PLATFORM" ||
        code === "PROVIDER_IDENTITY_SAVING" ||
        code === "PROVIDER_IDENTITY_SAVE_FAILED" ||
        code === "KEYCHAIN_UNAVAILABLE" ||
        code === "KEYCHAIN_STATUS_UNKNOWN"
          ? "unavailable"
          : "unconfigured";
      return this.publish({
        ...shared,
        status: state,
        result:
          code === "PROVIDER_IDENTITY_SAVING"
            ? "initializing"
            : code === "PROVIDER_IDENTITY_SAVE_FAILED"
              ? "initialization-failed"
              : code === "PROVIDER_SETTINGS_SAVING"
                ? "saving"
                : code === "PROVIDER_SETTINGS_SAVE_FAILED"
                  ? "settings-failed"
                  : "not-ready",
        diagnostic: diagnostic(code),
      });
    }
    return this.publish({
      ...shared,
      status: "ready",
      result: "ready",
      diagnostic: diagnostic("PROVIDER_READY"),
    });
  }

  private capture(
    ownerToken: number,
    current: ProviderCurrent,
  ): ProviderCapture | undefined {
    const { conversationFingerprint, request, prompt, promptBytes, config } =
      current;
    if (
      conversationFingerprint === undefined ||
      request === undefined ||
      prompt === undefined ||
      promptBytes === undefined ||
      config === undefined
    )
      return undefined;
    return {
      ownerToken,
      pluginGeneration: current.pluginGeneration,
      viewGeneration: current.viewGeneration,
      importGeneration: current.importGeneration,
      selectionGeneration: current.selectionGeneration,
      conversationFingerprint,
      requestId: request.requestId,
      request,
      prompt,
      promptBytes,
      providerSettingsGeneration: current.providerSettingsGeneration,
      providerSaveGeneration: current.providerSaveGeneration,
      credentialGeneration: current.credentialGeneration,
      config: cloneConfig(config),
    };
  }

  private captureCurrent(capture: ProviderCapture): boolean {
    try {
      const current = currentSafely(this.services);
      return (
        this.owner?.token === capture.ownerToken &&
        current.pluginGeneration === capture.pluginGeneration &&
        current.viewGeneration === capture.viewGeneration &&
        current.importGeneration === capture.importGeneration &&
        current.selectionGeneration === capture.selectionGeneration &&
        current.conversationFingerprint === capture.conversationFingerprint &&
        current.request?.requestId === capture.requestId &&
        current.request.conversationFingerprint ===
          capture.conversationFingerprint &&
        current.prompt === capture.prompt &&
        current.promptBytes === capture.promptBytes &&
        current.providerSettingsGeneration ===
          capture.providerSettingsGeneration &&
        current.providerSaveGeneration === capture.providerSaveGeneration &&
        current.credentialGeneration === capture.credentialGeneration &&
        configEqual(current.config, capture.config)
      );
    } catch {
      return false;
    }
  }

  private abort(owner: ProviderOwner): void {
    if (owner.abortIssued) return;
    owner.abortIssued = true;
    owner.abort.abort();
  }

  private release(token: number): void {
    if (this.owner?.token === token) this.owner = undefined;
  }

  private stale(capture: ProviderCapture): ProviderOperationResult {
    const owner = this.owner;
    if (owner?.token === capture.ownerToken) {
      this.abort(owner);
      this.release(capture.ownerToken);
    }
    return operationResult("stale", "PROVIDER_STALE");
  }

  private fence(capture: ProviderCapture, stage: ProviderFenceStage): boolean {
    void stage;
    if (this.captureCurrent(capture)) return true;
    this.stale(capture);
    return false;
  }

  private settleFailure(
    capture: ProviderCapture,
    code: M05DiagnosticCode,
    transport?: ProviderTransportResult,
  ): ProviderOperationResult {
    if (!this.captureCurrent(capture)) return this.stale(capture);
    this.release(capture.ownerToken);
    this.publish({
      status: "failed",
      result: code === "PROVIDER_TIMEOUT" ? "timeout" : "failed",
      diagnostic: diagnostic(code),
      ownerToken: undefined,
      usage: undefined,
      requestId:
        transport !== undefined && "requestId" in transport
          ? transport.requestId
          : undefined,
      retryAfterSeconds:
        transport !== undefined && "retryAfterSeconds" in transport
          ? transport.retryAfterSeconds
          : undefined,
    });
    return operationResult(
      code === "PROVIDER_TIMEOUT" ? "timeout" : "failed",
      code,
    );
  }

  private settleInvalid(
    capture: ProviderCapture,
    code: "PROVIDER_ENVELOPE_INVALID" | "PROVIDER_RESULT_INVALID",
    metadata?: {
      requestId?: string;
      usage?: ProviderUsage;
    },
  ): ProviderOperationResult {
    if (!this.captureCurrent(capture)) return this.stale(capture);
    this.release(capture.ownerToken);
    this.publish({
      status: "invalid",
      result: "invalid",
      ownerToken: undefined,
      diagnostic: diagnostic(code),
      usage: metadata?.usage,
      requestId: metadata?.requestId,
      retryAfterSeconds: undefined,
    });
    return operationResult("invalid", code);
  }

  private win(
    token: number,
    status: "cancelled" | "timeout",
  ): ProviderOperationResult {
    const owner = this.owner;
    if (owner?.token !== token)
      return operationResult("stale", "PROVIDER_STALE");
    const result = operationResult(
      status,
      status === "cancelled" ? "PROVIDER_CANCELLED" : "PROVIDER_TIMEOUT",
    );
    this.abort(owner);
    this.release(token);
    this.publish({
      status: status === "cancelled" ? "cancelled" : "failed",
      result: status,
      ownerToken: undefined,
      diagnostic: result.diagnostic,
      usage: undefined,
      requestId: undefined,
      retryAfterSeconds: undefined,
    });
    owner.resolveWinner(result);
    return result;
  }

  public cancel(): ProviderOperationResult {
    const owner = this.owner;
    return owner === undefined
      ? operationResult("stale", "PROVIDER_STALE")
      : this.win(owner.token, "cancelled");
  }

  public invalidate(reason: ProviderInvalidationReason): void {
    const owner = this.owner;
    if (owner !== undefined) {
      this.abort(owner);
      this.release(owner.token);
      owner.resolveWinner(operationResult("stale", "PROVIDER_STALE"));
    }
    if (reason === "view-close" || reason === "plugin-unload") {
      this.publish({
        status: "unavailable",
        result: "not-ready",
        ownerToken: undefined,
        host: undefined,
        model: undefined,
        promptBytes: undefined,
        maxOutputTokens: undefined,
        credentialState: "unknown",
        disclosureAccepted: false,
        candidates: [],
        usage: undefined,
        requestId: undefined,
        retryAfterSeconds: undefined,
        diagnostic: undefined,
      });
      return;
    }
    if (
      reason === "selection-change" ||
      reason === "import-replacement" ||
      reason === "import-clear" ||
      reason === "m04-request-replacement" ||
      reason === "manual-input"
    )
      this.publish({ candidates: [] });
    this.preflight();
  }

  public guardManualOperation(
    kind: "Prepare" | "Copy" | "Validate",
  ): { ok: true } | { ok: false; diagnostic: M04Diagnostic } {
    if (this.owner === undefined) return { ok: true };
    const code =
      kind === "Prepare"
        ? "DISTILLATION_PREPARE_IN_PROGRESS"
        : kind === "Copy"
          ? "DISTILLATION_COPY_IN_PROGRESS"
          : "DISTILLATION_VALIDATE_IN_PROGRESS";
    return { ok: false, diagnostic: m04Diagnostic(code) };
  }

  public manualOperationAccepted(kind: "Prepare" | "Copy" | "Validate"): void {
    if (this.owner !== undefined || kind === "Copy") return;
    this.publish({ candidates: [] });
    this.preflight();
  }

  public manualInput(delegate: () => void): void {
    this.invalidate("manual-input");
    delegate();
  }

  public async distill(): Promise<ProviderOperationResult> {
    const current = currentSafely(this.services);
    if (this.owner !== undefined || current.manualOwner !== undefined)
      return operationResult("busy", "PROVIDER_OPERATION_IN_PROGRESS");
    const ready = this.preflight();
    if (ready.status !== "ready")
      return {
        status: "not-ready",
        ...(ready.diagnostic === undefined
          ? {}
          : { diagnostic: { ...ready.diagnostic } }),
      };

    let resolveWinner!: (result: ProviderOperationResult) => void;
    const winner = new Promise<ProviderOperationResult>((resolve) => {
      resolveWinner = resolve;
    });
    const token = ++this.nextToken;
    const capture = this.capture(token, current);
    if (capture === undefined) {
      this.preflight();
      return operationResult("not-ready", "PROVIDER_NO_ACTIVE_REQUEST");
    }
    const owner: ProviderOwner = {
      token,
      abort: new AbortController(),
      abortIssued: false,
      resolveWinner,
    };
    this.owner = owner;
    this.publish({
      status: "sending",
      result: "started",
      ownerToken: owner.token,
      diagnostic: diagnostic("PROVIDER_SENDING"),
      usage: undefined,
      requestId: undefined,
      retryAfterSeconds: undefined,
    });

    const timeout = setTimeout(() => {
      this.win(owner.token, "timeout");
    }, capture.config.timeoutMs);
    const execution = this.execute(capture, owner);
    try {
      return await Promise.race([execution, winner]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async execute(
    capture: ProviderCapture,
    owner: ProviderOwner,
  ): Promise<ProviderOperationResult> {
    let secret: string | undefined;
    try {
      if (!this.fence(capture, "keychain")) return this.stale(capture);
      let credential: CredentialReadResult;
      try {
        credential = this.services.readCredential(() =>
          this.captureCurrent(capture),
        );
      } catch {
        return this.stale(capture);
      }
      if (!credential.ok) return this.stale(capture);
      secret = credential.secret;
      if (!this.fence(capture, "keychain")) return this.stale(capture);

      let built: ProviderRequestResult;
      try {
        built = (this.services.buildRequest ?? buildProviderRequest)({
          model: capture.config.model,
          prompt: capture.prompt,
          maxOutputTokens: capture.config.maxOutputTokens,
        });
      } catch {
        return this.settleFailure(capture, "PROVIDER_REQUEST_TOO_LARGE");
      }
      if (!built.ok) return this.settleFailure(capture, built.code);
      if (!this.captureCurrent(capture)) return this.stale(capture);

      const transportInput: ProviderControllerTransportInput = {
        config: cloneConfig(capture.config),
        secret,
        body: built.body,
        signal: owner.abort.signal,
        lifecycleFence: (stage) => this.fence(capture, stage),
      };
      let transportPromise: Promise<ProviderTransportResult> | undefined;
      try {
        transportPromise = this.services.transport(transportInput);
      } catch {
        transportPromise = undefined;
      } finally {
        secret = undefined;
        transportInput.secret = undefined;
      }
      if (transportPromise === undefined) {
        if (!this.captureCurrent(capture)) return this.stale(capture);
        return this.settleFailure(capture, "PROVIDER_NETWORK_FAILED");
      }
      let transported: ProviderTransportResult;
      try {
        transported = await transportPromise;
      } catch {
        if (!this.captureCurrent(capture)) return this.stale(capture);
        return this.settleFailure(capture, "PROVIDER_NETWORK_FAILED");
      }
      if (!transported.ok && transported.code === "PROVIDER_STALE")
        return this.stale(capture);
      if (!this.captureCurrent(capture)) return this.stale(capture);
      if (!transported.ok && transported.code === "PROVIDER_ENVELOPE_INVALID")
        return this.settleInvalid(capture, transported.code, {
          ...(transported.requestId === undefined
            ? {}
            : { requestId: transported.requestId }),
        });
      if (!transported.ok)
        return this.settleFailure(capture, transported.code, transported);
      if (!this.fence(capture, "envelope")) return this.stale(capture);

      let envelope: ProviderResponseResult;
      try {
        envelope = (this.services.parseResponse ?? parseProviderResponse)(
          transported.body,
        );
      } catch {
        envelope = { ok: false, code: "PROVIDER_ENVELOPE_INVALID" };
      }
      if (!this.captureCurrent(capture)) return this.stale(capture);
      if (!envelope.ok)
        return this.settleInvalid(capture, "PROVIDER_ENVELOPE_INVALID", {
          ...(transported.requestId === undefined
            ? {}
            : { requestId: transported.requestId }),
        });
      if (!this.fence(capture, "validation")) return this.stale(capture);

      let validated: DistillationValidationResult;
      try {
        validated = await (
          this.services.validateResult ?? validateDistillationResult
        )(envelope.content, capture.request);
      } catch {
        validated = { ok: false, diagnostics: [] };
      }
      if (!this.captureCurrent(capture)) return this.stale(capture);
      if (!validated.ok)
        return this.settleInvalid(capture, "PROVIDER_RESULT_INVALID", {
          ...(transported.requestId === undefined
            ? {}
            : { requestId: transported.requestId }),
          ...(envelope.usage === undefined ? {} : { usage: envelope.usage }),
        });
      if (!this.fence(capture, "publish")) return this.stale(capture);
      this.release(capture.ownerToken);
      this.publish({
        status: "valid",
        result: "valid",
        ownerToken: undefined,
        candidates: validated.candidates,
        diagnostic: diagnostic("PROVIDER_VALID"),
        usage: envelope.usage,
        requestId: transported.requestId,
        retryAfterSeconds: undefined,
      });
      return operationResult("valid", "PROVIDER_VALID");
    } finally {
      secret = undefined;
    }
  }
}
