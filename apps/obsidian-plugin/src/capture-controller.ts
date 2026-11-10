import {
  parseStagingCapture,
  sha256,
  validateCapture,
  type CaptureDraft,
} from "@chat2vault/core";
import type {
  CapturePlanInput,
  CaptureSaveResult,
  CaptureVaultAdapter,
  CaptureWritePlan,
} from "./capture-vault-adapter.js";
import type { NativeTemporaryArtifact } from "./native-observer.js";

const encoder = new TextEncoder();

export interface CaptureActiveFileAuthority {
  path: string;
  identity: string;
}

export interface CaptureControllerCurrent {
  loaded: boolean;
  lifecycleGeneration: number;
  settingsGeneration: number;
  sourceRoot: string;
  sourceRootPending: boolean;
  activeFile?: CaptureActiveFileAuthority;
}

export type CaptureInvalidationReason =
  | "active-file-edit"
  | "active-file-switch"
  | "paste-edit"
  | "url-edit"
  | "settings"
  | "view-close"
  | "plugin-unload";

interface CaptureAuthorityToken {
  invalidationGeneration: number;
  lifecycleGeneration: number;
  settingsGeneration: number;
  sourceRoot: string;
  sourceRootPending: false;
  activeFile?: CaptureActiveFileAuthority;
}

type ReadyCaptureWritePlan = Exclude<
  CaptureWritePlan,
  { disposition: "blocked" }
>;

interface InstalledCapturePlan {
  token: CaptureAuthorityToken;
  mode: "staging" | "manual";
  input: CapturePlanInput;
  plan: ReadyCaptureWritePlan;
  planBytes: string;
}

export type CaptureControllerSnapshot =
  | { status: "idle" }
  | { status: "previewing"; mode: "staging" | "manual" }
  | {
      status: "ready";
      mode: "staging" | "manual";
      draft: CaptureDraft;
      plan: ReadyCaptureWritePlan;
    }
  | {
      status: "saving";
      mode: "staging" | "manual";
      draft: CaptureDraft;
      plan: ReadyCaptureWritePlan;
    }
  | {
      status: "saved";
      mode: "staging" | "manual";
      draft: CaptureDraft;
      path: string;
      disposition: "saved" | "existing-identical";
      authorityChanged: boolean;
    }
  | { status: "blocked"; code: string; effect?: "temporary" | "published" }
  | {
      status: "reconciliation-required";
      code: string;
      effect: "published";
      targetPath: string;
    }
  | {
      status: "reconciliation-required";
      code: string;
      effect: "temporary";
      targetPath: string;
      temporaryArtifact: NativeTemporaryArtifact;
    }
  | {
      status: "reconciliation-required";
      code: string;
      effect: "durable";
      reconciliationState:
        "prepared" | "published-uncertain" | "temporary-uncertain";
      targetPathDigest: string;
      targetLocator: string;
      sourceRootPathDigest: string;
      sourceRootIdentity: { device: string; inode: string };
      sourceRootChanged: boolean;
      temporaryCandidate?: {
        name: string;
        ownership: "unverified";
        identity?: { device: string; inode: string };
      };
    }
  | {
      status: "reconciliation-required";
      code:
        | "CAPTURE_RECONCILIATION_LOAD_FAILED"
        | "CAPTURE_RECONCILIATION_PREPARE_FAILED";
      effect: "durable-unavailable";
    };

type ReconciliationSnapshot = Extract<
  CaptureControllerSnapshot,
  { status: "reconciliation-required" }
>;

export type CapturePreviewResult =
  | {
      status: "ready";
      draft: CaptureDraft;
      plan: ReadyCaptureWritePlan;
    }
  | { status: "blocked"; code: string }
  | { status: "busy"; code: "CAPTURE_PREVIEW_IN_PROGRESS" }
  | { status: "stale"; code: "CAPTURE_PREVIEW_STALE" };

export type CaptureControllerSaveResult =
  | CaptureSaveResult
  | { status: "busy"; code: "CAPTURE_SAVE_IN_PROGRESS" }
  | { status: "blocked"; code: "CAPTURE_PLAN_REQUIRED" }
  | { status: "stale"; code: "CAPTURE_SAVE_STALE" };

export interface CaptureControllerServices {
  current(): CaptureControllerCurrent;
  adapter: CaptureVaultAdapter;
}

function sameActiveFile(
  left: CaptureActiveFileAuthority | undefined,
  right: CaptureActiveFileAuthority | undefined,
): boolean {
  return (
    left?.path === right?.path &&
    left?.identity === right?.identity &&
    (left === undefined) === (right === undefined)
  );
}

export class CaptureController {
  private invalidationGeneration = 0;
  private ownerSequence = 0;
  private previewOwner: number | undefined;
  private saving = false;
  private installed: InstalledCapturePlan | undefined;
  private reconciliation: ReconciliationSnapshot | undefined;
  private currentSnapshot: CaptureControllerSnapshot = { status: "idle" };

  public constructor(private readonly services: CaptureControllerServices) {
    this.syncServiceReconciliation();
  }

  public get snapshot(): CaptureControllerSnapshot {
    this.syncServiceReconciliation();
    if (
      this.installed !== undefined &&
      !this.authorityCurrent(this.installed.token)
    )
      this.clear();
    return this.currentSnapshot;
  }

  public invalidate(reason: CaptureInvalidationReason): void {
    void reason;
    this.invalidationGeneration += 1;
    this.previewOwner = undefined;
    this.clear();
    this.syncServiceReconciliation();
  }

  private clear(): void {
    this.installed = undefined;
    this.currentSnapshot = this.reconciliation ?? { status: "idle" };
  }

  public async acknowledgeReconciliation(): Promise<
    Awaited<ReturnType<CaptureVaultAdapter["acknowledgeReconciliation"]>>
  > {
    const result = await this.services.adapter.acknowledgeReconciliation();
    if (result.status === "failed") {
      this.syncServiceReconciliation();
      return result;
    }
    this.invalidationGeneration += 1;
    this.previewOwner = undefined;
    this.installed = undefined;
    this.reconciliation = undefined;
    this.currentSnapshot = { status: "idle" };
    return result;
  }

  private syncServiceReconciliation(): boolean {
    const durable = this.services.adapter.reconciliation();
    if (durable.status === "clear") {
      if (
        this.reconciliation?.effect === "durable" ||
        this.reconciliation?.effect === "durable-unavailable"
      ) {
        this.reconciliation = undefined;
        this.currentSnapshot = { status: "idle" };
      }
      return false;
    }
    this.installed = undefined;
    if (durable.status === "failed") {
      this.reconciliation = {
        status: "reconciliation-required",
        code: durable.code,
        effect: "durable-unavailable",
      };
      this.currentSnapshot = this.reconciliation;
      return true;
    }
    if (
      this.reconciliation?.effect === "published" ||
      this.reconciliation?.effect === "temporary"
    ) {
      this.currentSnapshot = this.reconciliation;
      return true;
    }
    const record = durable.record;
    this.reconciliation = {
      status: "reconciliation-required",
      code: "CAPTURE_RECONCILIATION_REQUIRED",
      effect: "durable",
      reconciliationState: record.state,
      targetPathDigest: record.targetPathDigest,
      targetLocator: record.targetLocator,
      sourceRootPathDigest: record.sourceRootPathDigest,
      sourceRootIdentity: { ...record.sourceRootIdentity },
      sourceRootChanged:
        sha256(encoder.encode(this.services.current().sourceRoot)) !==
        record.sourceRootPathDigest,
      ...(record.state === "temporary-uncertain"
        ? { temporaryCandidate: record.temporaryCandidate }
        : {}),
    };
    this.currentSnapshot = this.reconciliation;
    return true;
  }

  private reconciliationBlocked(): CapturePreviewResult | undefined {
    this.syncServiceReconciliation();
    if (this.reconciliation === undefined) return undefined;
    this.currentSnapshot = this.reconciliation;
    return { status: "blocked", code: "CAPTURE_RECONCILIATION_REQUIRED" };
  }

  private captureToken(
    activeFile?: CaptureActiveFileAuthority,
  ): CaptureAuthorityToken | undefined {
    const current = this.services.current();
    if (
      !current.loaded ||
      current.sourceRootPending ||
      current.sourceRoot.length === 0
    )
      return undefined;
    return {
      invalidationGeneration: this.invalidationGeneration,
      lifecycleGeneration: current.lifecycleGeneration,
      settingsGeneration: current.settingsGeneration,
      sourceRoot: current.sourceRoot,
      sourceRootPending: false,
      ...(activeFile === undefined ? {} : { activeFile: { ...activeFile } }),
    };
  }

  private authorityCurrent(token: CaptureAuthorityToken): boolean {
    const current = this.services.current();
    return (
      current.loaded &&
      !current.sourceRootPending &&
      this.invalidationGeneration === token.invalidationGeneration &&
      current.lifecycleGeneration === token.lifecycleGeneration &&
      current.settingsGeneration === token.settingsGeneration &&
      current.sourceRoot === token.sourceRoot &&
      (token.activeFile === undefined ||
        (current.activeFile !== undefined &&
          sameActiveFile(token.activeFile, current.activeFile)))
    );
  }

  private stalePreview(owner: number): CapturePreviewResult {
    if (this.previewOwner === owner) this.clear();
    return { status: "stale", code: "CAPTURE_PREVIEW_STALE" };
  }

  private blockedPreview(code: string): CapturePreviewResult {
    this.installed = undefined;
    this.currentSnapshot = { status: "blocked", code };
    return { status: "blocked", code };
  }

  private async installPreview(
    owner: number,
    mode: "staging" | "manual",
    token: CaptureAuthorityToken,
    input: CapturePlanInput,
  ): Promise<CapturePreviewResult> {
    let plan: CaptureWritePlan;
    try {
      plan = await this.services.adapter.plan(input);
    } catch {
      if (!this.previewCurrent(owner, token)) return this.stalePreview(owner);
      return this.blockedPreview("CAPTURE_PLAN_FAILED");
    }
    if (!this.previewCurrent(owner, token)) return this.stalePreview(owner);
    if (plan.disposition === "blocked") return this.blockedPreview(plan.code);
    const installed: InstalledCapturePlan = {
      token,
      mode,
      input,
      plan,
      planBytes: JSON.stringify(plan),
    };
    this.installed = installed;
    this.currentSnapshot = {
      status: "ready",
      mode,
      draft: input.draft,
      plan,
    };
    return { status: "ready", draft: input.draft, plan };
  }

  private previewCurrent(owner: number, token: CaptureAuthorityToken): boolean {
    return this.previewOwner === owner && this.authorityCurrent(token);
  }

  public async previewStaging(
    path: string,
    authority?: CaptureActiveFileAuthority,
  ): Promise<CapturePreviewResult> {
    const reconciliation = this.reconciliationBlocked();
    if (reconciliation !== undefined) return reconciliation;
    if (this.previewOwner !== undefined)
      return { status: "busy", code: "CAPTURE_PREVIEW_IN_PROGRESS" };
    if (this.saving)
      return { status: "busy", code: "CAPTURE_PREVIEW_IN_PROGRESS" };
    const owner = ++this.ownerSequence;
    this.previewOwner = owner;
    this.installed = undefined;
    this.currentSnapshot = { status: "previewing", mode: "staging" };
    try {
      const activeFile = authority ?? this.services.current().activeFile;
      const token =
        activeFile?.path === path ? this.captureToken(activeFile) : undefined;
      if (token === undefined)
        return this.blockedPreview("CAPTURE_ACTIVE_FILE_REQUIRED");
      let observed: { bytes: Uint8Array; digest: string } | { code: string };
      try {
        observed = await this.services.adapter.readActiveStaging(path);
      } catch {
        if (!this.previewCurrent(owner, token)) return this.stalePreview(owner);
        return this.blockedPreview("CAPTURE_STAGING_READ_FAILED");
      }
      if (!this.previewCurrent(owner, token)) return this.stalePreview(owner);
      if ("code" in observed) return this.blockedPreview(observed.code);
      const parsed = parseStagingCapture(observed.bytes);
      if (!parsed.ok) return this.blockedPreview(parsed.code);
      return await this.installPreview(owner, "staging", token, {
        draft: parsed.draft,
        source: { kind: "staging", path, digest: observed.digest },
      });
    } finally {
      if (this.previewOwner === owner) this.previewOwner = undefined;
    }
  }

  public async previewPaste(
    text: string,
    sourceUrl?: string,
  ): Promise<CapturePreviewResult> {
    const reconciliation = this.reconciliationBlocked();
    if (reconciliation !== undefined) return reconciliation;
    if (this.previewOwner !== undefined || this.saving)
      return { status: "busy", code: "CAPTURE_PREVIEW_IN_PROGRESS" };
    const owner = ++this.ownerSequence;
    this.previewOwner = owner;
    this.installed = undefined;
    this.currentSnapshot = { status: "previewing", mode: "manual" };
    try {
      const token = this.captureToken();
      if (token === undefined)
        return this.blockedPreview("CAPTURE_ROOT_REQUIRED");
      const validated = validateCapture({
        method: "manual-paste",
        text,
        ...(sourceUrl === undefined || sourceUrl === "" ? {} : { sourceUrl }),
      });
      if (!validated.ok) return this.blockedPreview(validated.code);
      return await this.installPreview(owner, "manual", token, {
        draft: validated.draft,
        source: {
          kind: "manual",
          fingerprint: validated.draft.fingerprint,
        },
      });
    } finally {
      if (this.previewOwner === owner) this.previewOwner = undefined;
    }
  }

  public async save(): Promise<CaptureControllerSaveResult> {
    this.syncServiceReconciliation();
    if (this.reconciliation !== undefined) {
      this.currentSnapshot = this.reconciliation;
      return {
        status: "blocked",
        code: "CAPTURE_RECONCILIATION_REQUIRED",
      };
    }
    if (this.saving)
      return { status: "busy", code: "CAPTURE_SAVE_IN_PROGRESS" };
    if (this.previewOwner !== undefined)
      return { status: "blocked", code: "CAPTURE_PLAN_REQUIRED" };
    const installed = this.installed;
    if (
      installed === undefined ||
      !this.authorityCurrent(installed.token) ||
      JSON.stringify(installed.plan) !== installed.planBytes
    ) {
      this.clear();
      return { status: "blocked", code: "CAPTURE_PLAN_REQUIRED" };
    }
    this.saving = true;
    this.installed = undefined;
    this.currentSnapshot = {
      status: "saving",
      mode: installed.mode,
      draft: installed.input.draft,
      plan: installed.plan,
    };
    try {
      let result: CaptureSaveResult;
      try {
        result = await this.services.adapter.save(
          installed.plan,
          installed.input,
        );
      } catch {
        if (!this.authorityCurrent(installed.token)) {
          this.clear();
          return { status: "stale", code: "CAPTURE_SAVE_STALE" };
        }
        result = { status: "blocked", code: "CAPTURE_SAVE_FAILED" };
      }
      if (result.status === "blocked") {
        if (result.effect === "published") {
          this.reconciliation = {
            status: "reconciliation-required",
            code: result.code,
            effect: "published",
            targetPath: installed.plan.targetPath,
          };
          this.currentSnapshot = this.reconciliation;
        } else if (result.effect === "temporary") {
          this.reconciliation = {
            status: "reconciliation-required",
            code: result.code,
            effect: "temporary",
            targetPath: installed.plan.targetPath,
            temporaryArtifact: result.temporaryArtifact,
          };
          this.currentSnapshot = this.reconciliation;
        } else {
          if (!this.syncServiceReconciliation())
            this.currentSnapshot = {
              status: "blocked",
              code: result.code,
            };
        }
        return result;
      }
      const authorityChanged = !this.authorityCurrent(installed.token);
      this.currentSnapshot = {
        status: "saved",
        mode: installed.mode,
        draft: installed.input.draft,
        path: result.path,
        disposition: result.status,
        authorityChanged,
      };
      return result;
    } finally {
      this.saving = false;
    }
  }
}
