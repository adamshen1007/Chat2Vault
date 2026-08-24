import {
  sourceWritePlanEqual,
  sourceWriterDiagnostic,
  type SourceWritePlan,
  type SourceWriterDiagnosticCode,
} from "@chat2vault/core";
import type {
  SourceOperationToken,
  SourceWriteExecutionResult,
  SourceWriteSaveRequest,
} from "./source-controller.js";

export type MutationCheckpoint =
  | { status: "missing-safe"; resolvedPath: string }
  | { status: "exact-directory-present" }
  | { status: "blocked"; indeterminate?: boolean };
export type SafetyCheckpoint =
  | { status: "safe"; resolvedTargetPath?: string }
  | {
      status: "blocked";
      indeterminate?: boolean;
      diagnostic?: SourceWriterDiagnosticCode;
    };
export type VerificationResult =
  | { status: "verified" }
  | { status: "verification-failed" }
  | { status: "not-completed" };

export interface SourceMutationAdapter {
  plan(): Promise<SourceWritePlan>;
  checkpointFolder(logicalPath: string): Promise<MutationCheckpoint>;
  createFolder(resolvedPath: string, logicalPath: string): Promise<void>;
  verifyFolder(logicalPath: string): Promise<SafetyCheckpoint>;
  checkpointFinalParent(
    plan: SourceWriteSaveRequest["plan"],
  ): Promise<SafetyCheckpoint>;
  createNote(resolvedPath: string, content: string): Promise<void>;
  verifyCreatedNote(
    plan: SourceWriteSaveRequest["plan"],
  ): Promise<VerificationResult>;
}

function stale(acceptedFolderPaths: string[]): SourceWriteExecutionResult {
  return {
    status: "stale",
    acceptedFolderPaths,
    diagnostics: [sourceWriterDiagnostic("STALE_SOURCE_WRITE_PLAN")],
  };
}

function failed(acceptedFolderPaths: string[]): SourceWriteExecutionResult {
  return {
    status: "mutation-failed",
    acceptedFolderPaths,
    diagnostics: [sourceWriterDiagnostic("SOURCE_WRITE_FAILED")],
  };
}

function safetyFailed(
  acceptedFolderPaths: string[],
): SourceWriteExecutionResult {
  return {
    status: "safety-check-failed",
    acceptedFolderPaths,
    diagnostics: [sourceWriterDiagnostic("SOURCE_NATIVE_PROBE_INDETERMINATE")],
  };
}

async function classifyCurrentFailure(
  expected: SourceWritePlan,
  acceptedFolderPaths: string[],
  adapter: SourceMutationAdapter,
  current: () => boolean,
): Promise<SourceWriteExecutionResult> {
  const refreshed = await adapter.plan();
  if (!current()) return stale(acceptedFolderPaths);
  if (
    refreshed.disposition === "blocked" &&
    refreshed.diagnostics.at(-1)?.code === "SOURCE_NATIVE_PROBE_INDETERMINATE"
  )
    return safetyFailed(acceptedFolderPaths);
  if (!sourceWritePlanEqual(expected, refreshed)) {
    return {
      status: "replanned",
      reason: "target-changed",
      plan: refreshed,
      acceptedFolderPaths,
      diagnostics: [sourceWriterDiagnostic("SOURCE_WRITE_TARGET_CHANGED")],
    };
  }
  return failed(acceptedFolderPaths);
}

export async function executeSourceWrite(
  request: SourceWriteSaveRequest,
  _token: SourceOperationToken,
  current: () => boolean,
  adapter: SourceMutationAdapter,
): Promise<SourceWriteExecutionResult> {
  const acceptedFolderPaths: string[] = [];
  if (!current()) return stale(acceptedFolderPaths);
  const initial = await adapter.plan();
  if (!current()) return stale(acceptedFolderPaths);
  if (!sourceWritePlanEqual(request.plan, initial)) {
    return {
      status: "replanned",
      reason: "stale-plan",
      plan: initial,
      acceptedFolderPaths,
      diagnostics: [sourceWriterDiagnostic("STALE_SOURCE_WRITE_PLAN")],
    };
  }
  let expected: SourceWritePlan = initial;
  if (expected.disposition !== "new" && expected.disposition !== "new-version")
    return failed(acceptedFolderPaths);

  for (const logicalPath of [...expected.foldersToCreate]) {
    if (!current()) return stale(acceptedFolderPaths);
    const checkpoint = await adapter.checkpointFolder(logicalPath);
    if (!current()) return stale(acceptedFolderPaths);
    if (checkpoint.status !== "missing-safe") {
      if (checkpoint.status === "blocked" && checkpoint.indeterminate === true)
        return safetyFailed(acceptedFolderPaths);
      return classifyCurrentFailure(
        expected,
        acceptedFolderPaths,
        adapter,
        current,
      );
    }
    if (!current()) return stale(acceptedFolderPaths);
    try {
      const settlement = adapter.createFolder(
        checkpoint.resolvedPath,
        logicalPath,
      );
      await settlement;
    } catch {
      if (!current()) return stale(acceptedFolderPaths);
      return classifyCurrentFailure(
        expected,
        acceptedFolderPaths,
        adapter,
        current,
      );
    }
    acceptedFolderPaths.push(logicalPath);
    expected = {
      ...expected,
      foldersToCreate: expected.foldersToCreate.filter(
        (path) => path !== logicalPath,
      ),
    };
    if (!current()) return stale(acceptedFolderPaths);
    const verified = await adapter.verifyFolder(logicalPath);
    if (!current()) return stale(acceptedFolderPaths);
    if (verified.status !== "safe") {
      if (verified.indeterminate === true)
        return safetyFailed(acceptedFolderPaths);
      return classifyCurrentFailure(
        expected,
        acceptedFolderPaths,
        adapter,
        current,
      );
    }
  }

  if (!current()) return stale(acceptedFolderPaths);
  const finalPlan = await adapter.plan();
  if (!current()) return stale(acceptedFolderPaths);
  if (!sourceWritePlanEqual(expected, finalPlan)) {
    return {
      status: "replanned",
      reason: "target-changed",
      plan: finalPlan,
      acceptedFolderPaths,
      diagnostics: [sourceWriterDiagnostic("SOURCE_WRITE_TARGET_CHANGED")],
    };
  }
  const parent = await adapter.checkpointFinalParent(expected);
  if (!current()) return stale(acceptedFolderPaths);
  if (parent.status !== "safe") {
    if (parent.indeterminate === true) return safetyFailed(acceptedFolderPaths);
    return classifyCurrentFailure(
      expected,
      acceptedFolderPaths,
      adapter,
      current,
    );
  }
  if (!current()) return stale(acceptedFolderPaths);
  const resolvedTargetPath = parent.resolvedTargetPath ?? expected.targetPath;
  try {
    const settlement = adapter.createNote(
      resolvedTargetPath,
      expected.noteContent,
    );
    await settlement;
  } catch {
    if (!current()) return stale(acceptedFolderPaths);
    return classifyCurrentFailure(
      expected,
      acceptedFolderPaths,
      adapter,
      current,
    );
  }
  const createdPath = expected.targetPath;
  const currentAfterCreate = current();
  const verification = await adapter.verifyCreatedNote(expected);
  const currentAfterVerification = current();
  if (verification.status === "verified") {
    if (!currentAfterCreate || !currentAfterVerification) {
      return {
        status: "post-create-stale",
        createdPath,
        acceptedFolderPaths,
        verification: {
          status: "verified",
          noteContentFingerprint: expected.noteContentFingerprint,
        },
        diagnostics: [sourceWriterDiagnostic("STALE_SOURCE_WRITE_PLAN")],
      };
    }
    return {
      status: "saved",
      createdPath,
      noteContentFingerprint: expected.noteContentFingerprint,
      disposition: expected.disposition,
      acceptedFolderPaths,
      diagnostics: [],
    };
  }
  if (!currentAfterCreate || !currentAfterVerification) {
    return {
      status: "post-create-stale",
      createdPath,
      acceptedFolderPaths,
      verification: { status: verification.status },
      diagnostics:
        verification.status === "verification-failed"
          ? [
              sourceWriterDiagnostic("STALE_SOURCE_WRITE_PLAN"),
              sourceWriterDiagnostic("SOURCE_WRITE_VERIFICATION_FAILED"),
            ]
          : [sourceWriterDiagnostic("STALE_SOURCE_WRITE_PLAN")],
    };
  }
  return {
    status: "verification-failed",
    createdPath,
    acceptedFolderPaths,
    diagnostics: [sourceWriterDiagnostic("SOURCE_WRITE_VERIFICATION_FAILED")],
  };
}
