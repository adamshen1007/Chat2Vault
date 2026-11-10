import type { NativeVaultIdentity } from "./native-observer.js";

export interface CaptureTemporaryCandidate {
  name: string;
  ownership: "unverified";
  identity?: NativeVaultIdentity;
}

interface CaptureReconciliationBase {
  version: 1;
  transactionId: string;
  targetPathDigest: string;
  targetLocator: string;
  sourceRootPathDigest: string;
  sourceRootIdentity: NativeVaultIdentity;
}

export type CaptureReconciliationRecord =
  | (CaptureReconciliationBase & { state: "prepared" })
  | (CaptureReconciliationBase & { state: "published-uncertain" })
  | (CaptureReconciliationBase & {
      state: "temporary-uncertain";
      temporaryCandidate: CaptureTemporaryCandidate;
    });

export interface CaptureReconciliationPrepareInput {
  targetPathDigest: string;
  targetLocator: string;
  sourceRootPathDigest: string;
  sourceRootIdentity: NativeVaultIdentity;
}

declare const captureReconciliationToken: unique symbol;
export type CaptureReconciliationToken = string & {
  readonly [captureReconciliationToken]: true;
};

export type CaptureReconciliationStatus =
  | { status: "clear" }
  | { status: "unresolved"; record: CaptureReconciliationRecord }
  | {
      status: "failed";
      code:
        | "CAPTURE_RECONCILIATION_LOAD_FAILED"
        | "CAPTURE_RECONCILIATION_PREPARE_FAILED";
    };

export type CaptureReconciliationPrepareResult =
  | { status: "prepared"; token: CaptureReconciliationToken }
  | {
      status: "failed";
      code:
        | "CAPTURE_RECONCILIATION_PREPARE_FAILED"
        | "CAPTURE_RECONCILIATION_REQUIRED";
    };

export type CaptureReconciliationUpdateResult =
  | { status: "updated" }
  | {
      status: "failed";
      code: "CAPTURE_RECONCILIATION_UPDATE_FAILED";
    };

export type CaptureReconciliationClearResult =
  | { status: "cleared" }
  | {
      status: "failed";
      code: "CAPTURE_RECONCILIATION_CLEAR_FAILED";
    };

export interface CaptureReconciliationService {
  current(): CaptureReconciliationStatus;
  prepare(
    input: CaptureReconciliationPrepareInput,
  ): Promise<CaptureReconciliationPrepareResult>;
  markUncertain(
    token: CaptureReconciliationToken,
    effect: "temporary" | "published",
    candidate?: CaptureTemporaryCandidate,
  ): Promise<CaptureReconciliationUpdateResult>;
  clearKnownOutcome(
    token: CaptureReconciliationToken,
  ): Promise<CaptureReconciliationClearResult>;
  acknowledge(): Promise<CaptureReconciliationClearResult>;
}
