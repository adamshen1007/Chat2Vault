import {
  M04_RESULT_MAX_UTF8_BYTES,
  buildDistillationRequest,
  m04Diagnostic,
  renderDistillationPrompt,
  validateDistillationResult,
  type CanonicalConversation,
  type DistillationRequest,
  type DistillationValidationResult,
  type M04Diagnostic,
  type PreviewCandidate,
  type PromptRenderResult,
  type RequestBuildResult,
} from "@chat2vault/core";

export type ManualOperationKind = "Prepare" | "Copy" | "Validate";

export interface ManualDistillationContext {
  loaded: boolean;
  selectionGeneration: number;
  importGeneration: number;
  conversation?: CanonicalConversation;
}

export interface ManualDistillationOwner {
  kind: ManualOperationKind;
  token: number;
}

export type ManualDistillationStatus =
  | "empty"
  | "preparing"
  | "prepared"
  | "copying"
  | "copied"
  | "validating"
  | "valid"
  | "invalid";

export interface ManualDistillationSnapshot {
  status: ManualDistillationStatus;
  owner: ManualDistillationOwner | undefined;
  request: DistillationRequest | undefined;
  prompt: string | undefined;
  promptBytes: number | undefined;
  paste: string;
  pasteBytes: number;
  pasteOverLimit: boolean;
  candidates: PreviewCandidate[];
  diagnostics: M04Diagnostic[];
}

export interface ManualOperationResult {
  status:
    | "prepared"
    | "copied"
    | "valid"
    | "invalid"
    | "no-selection"
    | "request-invalid"
    | "prompt-too-large"
    | "prepare-in-progress"
    | "copy-in-progress"
    | "validate-in-progress"
    | "no-active-request"
    | "clipboard-denied"
    | "clipboard-failed"
    | "stale";
  diagnostics: M04Diagnostic[];
}

type MaybePromise<T> = T | Promise<T>;

export interface ManualDistillationServices {
  current(): ManualDistillationContext;
  writeClipboard(text: string): MaybePromise<void>;
  buildRequest?(
    conversation: CanonicalConversation,
  ): MaybePromise<RequestBuildResult>;
  renderPrompt?(request: DistillationRequest): MaybePromise<PromptRenderResult>;
  validateResult?(
    raw: string,
    request: DistillationRequest,
  ): MaybePromise<DistillationValidationResult>;
}

interface OperationCapture {
  owner: ManualDistillationOwner;
  loaded: boolean;
  selectionGeneration: number;
  importGeneration: number;
  conversationFingerprint: string | undefined;
  requestGeneration: number;
  requestId?: string;
  prompt?: string;
  pasteGeneration?: number;
  paste?: string;
}

function isPromise<T>(value: MaybePromise<T>): value is Promise<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function result(
  status: ManualOperationResult["status"],
  diagnostics: M04Diagnostic[] = [],
): ManualOperationResult {
  return { status, diagnostics };
}

export class ManualDistillationController {
  private token = 0;
  private requestGeneration = 0;
  private pasteGeneration = 0;
  private activeOwner: ManualDistillationOwner | undefined;
  private activeConversationFingerprint: string | undefined;
  private currentSnapshot: ManualDistillationSnapshot = {
    status: "empty",
    owner: undefined,
    request: undefined,
    prompt: undefined,
    promptBytes: undefined,
    paste: "",
    pasteBytes: 0,
    pasteOverLimit: false,
    candidates: [],
    diagnostics: [],
  };

  public constructor(private readonly services: ManualDistillationServices) {}

  public get snapshot(): ManualDistillationSnapshot {
    return this.currentSnapshot;
  }

  private publish(
    patch: Partial<ManualDistillationSnapshot>,
  ): ManualDistillationSnapshot {
    this.currentSnapshot = {
      ...this.currentSnapshot,
      ...patch,
      ...(this.activeOwner === undefined
        ? { owner: undefined }
        : { owner: { ...this.activeOwner } }),
    };
    return this.currentSnapshot;
  }

  private rejected(
    kind: ManualOperationKind,
  ): ManualOperationResult | undefined {
    if (this.activeOwner === undefined) return undefined;
    if (kind === "Prepare")
      return result("prepare-in-progress", [
        m04Diagnostic("DISTILLATION_PREPARE_IN_PROGRESS"),
      ]);
    if (kind === "Copy")
      return result("copy-in-progress", [
        m04Diagnostic("DISTILLATION_COPY_IN_PROGRESS"),
      ]);
    return result("validate-in-progress", [
      m04Diagnostic("DISTILLATION_VALIDATE_IN_PROGRESS"),
    ]);
  }

  private start(kind: ManualOperationKind): OperationCapture {
    const context = this.services.current();
    const owner = { kind, token: ++this.token };
    this.activeOwner = owner;
    this.activeConversationFingerprint =
      context.conversation?.contentFingerprint;
    return {
      owner,
      loaded: context.loaded,
      selectionGeneration: context.selectionGeneration,
      importGeneration: context.importGeneration,
      conversationFingerprint: context.conversation?.contentFingerprint,
      requestGeneration: this.requestGeneration,
    };
  }

  private captureCurrent(capture: OperationCapture): boolean {
    const context = this.services.current();
    return (
      this.activeOwner?.token === capture.owner.token &&
      context.loaded === capture.loaded &&
      context.loaded &&
      context.selectionGeneration === capture.selectionGeneration &&
      context.importGeneration === capture.importGeneration &&
      context.conversation?.contentFingerprint ===
        capture.conversationFingerprint &&
      this.requestGeneration === capture.requestGeneration &&
      (capture.requestId === undefined ||
        this.currentSnapshot.request?.requestId === capture.requestId) &&
      (capture.prompt === undefined ||
        this.currentSnapshot.prompt === capture.prompt) &&
      (capture.pasteGeneration === undefined ||
        this.pasteGeneration === capture.pasteGeneration) &&
      (capture.paste === undefined ||
        this.currentSnapshot.paste === capture.paste)
    );
  }

  private release(capture: OperationCapture): void {
    if (this.activeOwner?.token === capture.owner.token) {
      this.activeOwner = undefined;
      this.activeConversationFingerprint = undefined;
    }
  }

  public invalidateIfConversationChanged(): boolean {
    const authoritativeFingerprint =
      this.activeConversationFingerprint ??
      this.currentSnapshot.request?.conversationFingerprint;
    if (authoritativeFingerprint === undefined) return false;
    if (
      this.services.current().conversation?.contentFingerprint ===
      authoritativeFingerprint
    )
      return false;
    this.invalidate();
    return true;
  }

  private captureStale(capture: OperationCapture): boolean {
    return (
      this.invalidateIfConversationChanged() || !this.captureCurrent(capture)
    );
  }

  private settle(
    capture: OperationCapture,
    patch: Partial<ManualDistillationSnapshot>,
    operationResult: ManualOperationResult,
  ): ManualOperationResult {
    if (this.captureStale(capture))
      return result("stale", [m04Diagnostic("DISTILLATION_STALE_OPERATION")]);
    this.release(capture);
    this.publish(patch);
    return operationResult;
  }

  public invalidate(): void {
    this.requestGeneration += 1;
    this.pasteGeneration += 1;
    this.activeOwner = undefined;
    this.activeConversationFingerprint = undefined;
    this.currentSnapshot = {
      status: "empty",
      owner: undefined,
      request: undefined,
      prompt: undefined,
      promptBytes: undefined,
      paste: "",
      pasteBytes: 0,
      pasteOverLimit: false,
      candidates: [],
      diagnostics: [],
    };
  }

  public async prepare(): Promise<ManualOperationResult> {
    const rejected = this.rejected("Prepare");
    if (rejected !== undefined) return rejected;
    this.requestGeneration += 1;
    this.activeOwner = undefined;
    this.publish({
      status: "preparing",
      request: undefined,
      prompt: undefined,
      promptBytes: undefined,
      candidates: [],
      diagnostics: [],
    });
    const capture = this.start("Prepare");
    this.publish({ status: "preparing" });
    const conversation = this.services.current().conversation;
    if (conversation === undefined)
      return this.settle(
        capture,
        {
          status: "invalid",
          diagnostics: [m04Diagnostic("DISTILLATION_NO_SELECTION")],
        },
        result("no-selection", [m04Diagnostic("DISTILLATION_NO_SELECTION")]),
      );
    let built: RequestBuildResult;
    try {
      const maybeBuilt = (
        this.services.buildRequest ?? buildDistillationRequest
      )(conversation);
      built = isPromise(maybeBuilt) ? await maybeBuilt : maybeBuilt;
    } catch {
      if (this.captureStale(capture))
        return result("stale", [m04Diagnostic("DISTILLATION_STALE_OPERATION")]);
      const diagnostics = [m04Diagnostic("DISTILLATION_REQUEST_INVALID")];
      return this.settle(
        capture,
        { status: "invalid", diagnostics },
        result("request-invalid", diagnostics),
      );
    }
    if (this.captureStale(capture))
      return result("stale", [m04Diagnostic("DISTILLATION_STALE_OPERATION")]);
    if (!built.ok)
      return this.settle(
        capture,
        { status: "invalid", diagnostics: built.diagnostics },
        result("request-invalid", built.diagnostics),
      );
    let rendered: PromptRenderResult;
    try {
      const maybeRendered = (
        this.services.renderPrompt ?? renderDistillationPrompt
      )(built.request);
      rendered = isPromise(maybeRendered) ? await maybeRendered : maybeRendered;
    } catch {
      if (this.captureStale(capture))
        return result("stale", [m04Diagnostic("DISTILLATION_STALE_OPERATION")]);
      const diagnostics = [m04Diagnostic("DISTILLATION_PROMPT_TOO_LARGE")];
      return this.settle(
        capture,
        { status: "invalid", diagnostics },
        result("prompt-too-large", diagnostics),
      );
    }
    if (this.captureStale(capture))
      return result("stale", [m04Diagnostic("DISTILLATION_STALE_OPERATION")]);
    if (!rendered.ok)
      return this.settle(
        capture,
        { status: "invalid", diagnostics: rendered.diagnostics },
        result("prompt-too-large", rendered.diagnostics),
      );
    return this.settle(
      capture,
      {
        status: "prepared",
        request: built.request,
        prompt: rendered.text,
        promptBytes: rendered.utf8Bytes,
        diagnostics: [],
      },
      result("prepared"),
    );
  }

  public async copy(): Promise<ManualOperationResult> {
    const rejected = this.rejected("Copy");
    if (rejected !== undefined) return rejected;
    const request = this.currentSnapshot.request;
    const prompt = this.currentSnapshot.prompt;
    if (request === undefined || prompt === undefined)
      return result("no-active-request", [
        m04Diagnostic("DISTILLATION_NO_ACTIVE_REQUEST"),
      ]);
    const capture = this.start("Copy");
    capture.requestId = request.requestId;
    capture.conversationFingerprint = request.conversationFingerprint;
    this.activeConversationFingerprint = request.conversationFingerprint;
    capture.prompt = prompt;
    this.publish({ status: "copying", diagnostics: [] });
    if (this.captureStale(capture))
      return result("stale", [m04Diagnostic("DISTILLATION_STALE_OPERATION")]);
    try {
      const pending = this.services.writeClipboard(prompt);
      if (isPromise(pending)) await pending;
    } catch (error) {
      if (this.captureStale(capture))
        return result("stale", [m04Diagnostic("DISTILLATION_STALE_OPERATION")]);
      const denied =
        typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "NotAllowedError";
      const code = denied
        ? "DISTILLATION_CLIPBOARD_DENIED"
        : "DISTILLATION_CLIPBOARD_FAILED";
      return this.settle(
        capture,
        { status: "invalid", diagnostics: [m04Diagnostic(code)] },
        result(denied ? "clipboard-denied" : "clipboard-failed", [
          m04Diagnostic(code),
        ]),
      );
    }
    return this.settle(
      capture,
      { status: "copied", diagnostics: [] },
      result("copied"),
    );
  }

  public setPaste(value: string): void {
    this.pasteGeneration += 1;
    if (this.activeOwner?.kind === "Validate") this.activeOwner = undefined;
    const pasteBytes = new TextEncoder().encode(value).length;
    if (pasteBytes > M04_RESULT_MAX_UTF8_BYTES) {
      this.publish({
        status: "invalid",
        paste: "",
        pasteBytes: 0,
        pasteOverLimit: true,
        candidates: [],
        diagnostics: [m04Diagnostic("DISTILLATION_RESULT_TOO_LARGE")],
      });
      return;
    }
    this.publish({
      status: this.currentSnapshot.request === undefined ? "empty" : "prepared",
      paste: value,
      pasteBytes,
      pasteOverLimit: false,
      candidates: [],
      diagnostics: [],
    });
  }

  public async validate(): Promise<ManualOperationResult> {
    const rejected = this.rejected("Validate");
    if (rejected !== undefined) return rejected;
    const request = this.currentSnapshot.request;
    if (request === undefined)
      return result("no-active-request", [
        m04Diagnostic("DISTILLATION_NO_ACTIVE_REQUEST"),
      ]);
    const paste = this.currentSnapshot.paste;
    const capture = this.start("Validate");
    capture.requestId = request.requestId;
    capture.conversationFingerprint = request.conversationFingerprint;
    this.activeConversationFingerprint = request.conversationFingerprint;
    capture.pasteGeneration = this.pasteGeneration;
    capture.paste = paste;
    this.publish({ status: "validating", candidates: [], diagnostics: [] });
    let validated: DistillationValidationResult;
    try {
      const pending = (
        this.services.validateResult ?? validateDistillationResult
      )(paste, request);
      validated = isPromise(pending) ? await pending : pending;
    } catch {
      if (this.captureStale(capture))
        return result("stale", [m04Diagnostic("DISTILLATION_STALE_OPERATION")]);
      const diagnostics = [m04Diagnostic("DISTILLATION_JSON_INVALID")];
      return this.settle(
        capture,
        { status: "invalid", candidates: [], diagnostics },
        result("invalid", diagnostics),
      );
    }
    if (this.captureStale(capture))
      return result("stale", [m04Diagnostic("DISTILLATION_STALE_OPERATION")]);
    if (!validated.ok)
      return this.settle(
        capture,
        {
          status: "invalid",
          candidates: [],
          diagnostics: validated.diagnostics,
        },
        result("invalid", validated.diagnostics),
      );
    return this.settle(
      capture,
      { status: "valid", candidates: validated.candidates, diagnostics: [] },
      result("valid"),
    );
  }
}
