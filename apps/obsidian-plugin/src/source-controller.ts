import {
  sourceMarkdownPreview,
  sourceWriterDiagnostic,
  type SourceMarkdownPreviewDisplay,
  type SourceWritePlan,
  type SourceWriterDiagnostic,
} from "@chat2vault/core";

export interface SourceControllerState {
  loaded: boolean;
  generation: number;
  selectedConversationContentFingerprint: string | undefined;
  settledSourceRoot: string;
  sourceRootPending: boolean;
}

export interface SourceOperationToken {
  operationGeneration: number;
  selectedConversationContentFingerprint: string;
  normalizedSourceRoot: string;
}

export interface InstalledSourcePreview {
  token: SourceOperationToken;
  plan: SourceWritePlan;
  display?: SourceMarkdownPreviewDisplay;
}

export type SourcePreviewResult =
  | { status: "planned"; plan: SourceWritePlan }
  | {
      status:
        | "settings-pending"
        | "preview-in-progress"
        | "write-in-progress"
        | "stale";
      diagnostics: [SourceWriterDiagnostic];
    };

export type SourceWriteExecutionResult =
  | {
      status: "saved";
      createdPath: string;
      noteContentFingerprint: string;
      disposition: "new" | "new-version";
      acceptedFolderPaths: string[];
      diagnostics: [];
    }
  | {
      status: "in-progress" | "preview-in-progress" | "settings-pending";
      acceptedFolderPaths: [];
      diagnostics: [SourceWriterDiagnostic];
    }
  | {
      status: "stale";
      acceptedFolderPaths: string[];
      diagnostics: [SourceWriterDiagnostic];
    }
  | {
      status: "replanned";
      reason: "stale-plan" | "target-changed";
      plan: SourceWritePlan;
      acceptedFolderPaths: string[];
      diagnostics: [SourceWriterDiagnostic];
    }
  | {
      status: "mutation-failed" | "safety-check-failed";
      acceptedFolderPaths: string[];
      diagnostics: [SourceWriterDiagnostic];
    }
  | {
      status: "verification-failed";
      createdPath: string;
      acceptedFolderPaths: string[];
      diagnostics: [SourceWriterDiagnostic];
    }
  | {
      status: "post-create-stale";
      createdPath: string;
      acceptedFolderPaths: string[];
      verification:
        | { status: "verified"; noteContentFingerprint: string }
        | { status: "verification-failed" }
        | { status: "not-completed" };
      diagnostics: SourceWriterDiagnostic[];
    };

export interface SourceWriteSaveRequest {
  plan: Extract<SourceWritePlan, { disposition: "new" | "new-version" }>;
  previewGeneration: number;
  selectedConversationContentFingerprint: string;
  settledSourceRoot: string;
}

type Planner = () => Promise<SourceWritePlan>;
export type SourceWriteExecutor = (
  request: SourceWriteSaveRequest,
  token: SourceOperationToken,
  tokenIsCurrent: () => boolean,
) => Promise<SourceWriteExecutionResult>;

class BinaryMutex {
  private held = false;
  public get isHeld(): boolean {
    return this.held;
  }
  public tryAcquire(): boolean {
    if (this.held) return false;
    this.held = true;
    return true;
  }
  public release(): void {
    this.held = false;
  }
}

function rejected(
  status:
    "settings-pending" | "preview-in-progress" | "write-in-progress" | "stale",
): SourcePreviewResult {
  const code =
    status === "settings-pending"
      ? "SOURCE_ROOT_SETTING_PENDING"
      : status === "preview-in-progress"
        ? "SOURCE_PREVIEW_IN_PROGRESS"
        : status === "write-in-progress"
          ? "SOURCE_WRITE_IN_PROGRESS"
          : "STALE_SOURCE_WRITE_PLAN";
  return { status, diagnostics: [sourceWriterDiagnostic(code)] };
}

function saveRejected(
  status: "settings-pending" | "preview-in-progress" | "in-progress",
): SourceWriteExecutionResult {
  const code =
    status === "settings-pending"
      ? "SOURCE_ROOT_SETTING_PENDING"
      : status === "preview-in-progress"
        ? "SOURCE_PREVIEW_IN_PROGRESS"
        : "SOURCE_WRITE_IN_PROGRESS";
  return {
    status,
    acceptedFolderPaths: [],
    diagnostics: [sourceWriterDiagnostic(code)],
  };
}

export class SourceWriteController {
  private readonly previewMutex = new BinaryMutex();
  private readonly writeMutex = new BinaryMutex();
  private installed: InstalledSourcePreview | undefined;

  public constructor(
    private readonly state: () => SourceControllerState,
    private readonly planner: Planner,
    private readonly executor: SourceWriteExecutor,
  ) {}

  public get installedPreview(): InstalledSourcePreview | undefined {
    return this.installed;
  }

  public invalidate(): void {
    this.installed = undefined;
  }

  private token(): SourceOperationToken | undefined {
    const state = this.state();
    const fingerprint = state.selectedConversationContentFingerprint;
    if (fingerprint === undefined) return undefined;
    return {
      operationGeneration: state.generation,
      selectedConversationContentFingerprint: fingerprint,
      normalizedSourceRoot: state.settledSourceRoot,
    };
  }

  private isCurrent(token: SourceOperationToken): boolean {
    const state = this.state();
    return (
      state.loaded &&
      !state.sourceRootPending &&
      state.generation === token.operationGeneration &&
      state.selectedConversationContentFingerprint ===
        token.selectedConversationContentFingerprint &&
      state.settledSourceRoot === token.normalizedSourceRoot
    );
  }

  public async preview(): Promise<SourcePreviewResult> {
    if (this.state().sourceRootPending) return rejected("settings-pending");
    if (this.writeMutex.isHeld) return rejected("write-in-progress");
    if (!this.previewMutex.tryAcquire()) return rejected("preview-in-progress");
    try {
      if (this.state().sourceRootPending) return rejected("settings-pending");
      // Required atomic cross-mutex recheck; no other owner can appear in this turn.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.writeMutex.isHeld) return rejected("write-in-progress");
      this.installed = undefined;
      const token = this.token();
      if (token === undefined) return rejected("stale");
      const plan = await this.planner();
      if (!this.isCurrent(token)) return rejected("stale");
      this.installed = {
        token,
        plan,
        ...(plan.disposition === "new" || plan.disposition === "new-version"
          ? { display: sourceMarkdownPreview(plan.noteContent) }
          : {}),
      };
      return { status: "planned", plan };
    } finally {
      this.previewMutex.release();
    }
  }

  public save():
    | SourceWriteExecutionResult
    | Promise<SourceWriteExecutionResult>
    | undefined {
    if (this.state().sourceRootPending) return saveRejected("settings-pending");
    if (this.previewMutex.isHeld) return saveRejected("preview-in-progress");
    if (!this.writeMutex.tryAcquire()) return saveRejected("in-progress");
    if (this.state().sourceRootPending) {
      this.writeMutex.release();
      return saveRejected("settings-pending");
    }
    // Required atomic cross-mutex recheck; no other owner can appear in this turn.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.previewMutex.isHeld) {
      this.writeMutex.release();
      return saveRejected("preview-in-progress");
    }
    const preview = this.installed;
    if (
      preview === undefined ||
      (preview.plan.disposition !== "new" &&
        preview.plan.disposition !== "new-version")
    ) {
      this.writeMutex.release();
      return undefined;
    }
    this.installed = undefined;
    const request: SourceWriteSaveRequest = {
      plan: preview.plan,
      previewGeneration: preview.token.operationGeneration,
      selectedConversationContentFingerprint:
        preview.token.selectedConversationContentFingerprint,
      settledSourceRoot: preview.token.normalizedSourceRoot,
    };
    return this.runSave(request, preview.token);
  }

  private async runSave(
    request: SourceWriteSaveRequest,
    token: SourceOperationToken,
  ): Promise<SourceWriteExecutionResult> {
    try {
      if (!this.isCurrent(token))
        return {
          status: "stale",
          acceptedFolderPaths: [],
          diagnostics: [sourceWriterDiagnostic("STALE_SOURCE_WRITE_PLAN")],
        };
      const result = await this.executor(request, token, () =>
        this.isCurrent(token),
      );
      if (
        result.status === "replanned" &&
        this.isCurrent(token) &&
        !this.state().sourceRootPending
      ) {
        this.installed = {
          token,
          plan: result.plan,
          ...(result.plan.disposition === "new" ||
          result.plan.disposition === "new-version"
            ? { display: sourceMarkdownPreview(result.plan.noteContent) }
            : {}),
        };
      }
      return result;
    } finally {
      this.writeMutex.release();
    }
  }
}
