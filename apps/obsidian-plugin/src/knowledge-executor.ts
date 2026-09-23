import {
  m06Diagnostic,
  type M06Diagnostic,
  type ReadyKnowledgeWritePlan,
  type ResolvedKnowledgeSource,
  type ReviewedKnowledgeCandidate,
} from "@chat2vault/core";
import type { KnowledgeVaultAdapter } from "./knowledge-vault-adapter.js";

export type KnowledgeLedgerStatus =
  | "created"
  | "identical-no-op"
  | "not-attempted"
  | "conflict"
  | "create-failed"
  | "verification-failed"
  | "stale";

export interface KnowledgeLedgerEntry {
  targetPath: string;
  status: KnowledgeLedgerStatus;
}

export interface KnowledgeWriteExecutionResult {
  status: "saved" | "partial" | "conflict" | "stale" | "failed";
  ledger: readonly KnowledgeLedgerEntry[];
  diagnostics: readonly M06Diagnostic[];
}

export interface KnowledgeSourceAuthority {
  candidate: ReviewedKnowledgeCandidate;
  sources: readonly ResolvedKnowledgeSource[];
}

export interface ExecutableKnowledgeWritePlan extends ReadyKnowledgeWritePlan {
  sourceAuthorities: readonly KnowledgeSourceAuthority[];
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sourcesEqual(
  left: readonly ResolvedKnowledgeSource[],
  right: readonly ResolvedKnowledgeSource[],
): boolean {
  return (
    left.length === right.length &&
    left.every((source, index) => {
      const other = right[index];
      return (
        source.provider === other?.provider &&
        source.providerConversationId === other.providerConversationId &&
        source.conversationFingerprint === other.conversationFingerprint &&
        source.sourceNotePath === other.sourceNotePath &&
        arraysEqual(source.messageFingerprints, other.messageFingerprints)
      );
    })
  );
}

function currentSafely(current: () => boolean): boolean {
  try {
    return current();
  } catch {
    return false;
  }
}

function diagnosticSet(
  ...diagnostics: M06Diagnostic[]
): readonly M06Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter(({ code }) => {
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

function fillLedger(
  plan: ExecutableKnowledgeWritePlan,
  status: KnowledgeLedgerStatus = "not-attempted",
): KnowledgeLedgerEntry[] {
  return plan.entries.map(({ targetPath }) => ({ targetPath, status }));
}

function staleResult(
  plan: ExecutableKnowledgeWritePlan,
  ledger = fillLedger(plan, "stale"),
  diagnostics: readonly M06Diagnostic[] = [],
): KnowledgeWriteExecutionResult {
  return {
    status: "stale",
    ledger,
    diagnostics: diagnosticSet(
      m06Diagnostic("KNOWLEDGE_PLAN_STALE"),
      ...diagnostics,
    ),
  };
}

function hasCreated(ledger: readonly KnowledgeLedgerEntry[]): boolean {
  return ledger.some(({ status }) => status === "created");
}

export async function executeKnowledgeWrite(
  plan: ExecutableKnowledgeWritePlan,
  current: () => boolean,
  adapter: KnowledgeVaultAdapter,
): Promise<KnowledgeWriteExecutionResult> {
  const ledger = fillLedger(plan);
  if (!currentSafely(current)) return staleResult(plan);

  const sourceDiagnostics: M06Diagnostic[] = [];
  for (const authority of plan.sourceAuthorities) {
    if (!currentSafely(current)) return staleResult(plan);
    let resolution;
    try {
      resolution = await adapter.resolveKnowledgeSources(authority.candidate);
    } catch {
      resolution = undefined;
    }
    if (!currentSafely(current)) return staleResult(plan);
    if (resolution === undefined)
      sourceDiagnostics.push(m06Diagnostic("KNOWLEDGE_SOURCE_STALE"));
    else if (!resolution.ok) sourceDiagnostics.push(...resolution.diagnostics);
    else if (!sourcesEqual(resolution.sources, authority.sources))
      sourceDiagnostics.push(m06Diagnostic("KNOWLEDGE_SOURCE_STALE"));
  }
  if (sourceDiagnostics.length > 0)
    return staleResult(plan, fillLedger(plan, "stale"), sourceDiagnostics);

  const expectedByPath = new Map(
    plan.entries.map((entry) => [
      entry.targetPath,
      new TextEncoder().encode(entry.noteContent),
    ]),
  );
  let preflightConflict = false;
  let preflightUnsafe = false;
  for (let index = 0; index < plan.entries.length; index += 1) {
    if (!currentSafely(current)) return staleResult(plan);
    const entry = plan.entries[index];
    if (entry === undefined) return staleResult(plan);
    try {
      const observation = await adapter.observeKnowledgeTarget(
        entry.targetPath,
      );
      if (!currentSafely(current)) return staleResult(plan);
      if (observation.status === "absent") continue;
      if (
        observation.status === "regular-file" &&
        bytesEqual(
          observation.bytes,
          expectedByPath.get(entry.targetPath) ?? new Uint8Array(),
        )
      ) {
        ledger[index] = {
          targetPath: entry.targetPath,
          status: "identical-no-op",
        };
        continue;
      }
      ledger[index] = { targetPath: entry.targetPath, status: "conflict" };
      preflightConflict = true;
      if (observation.status === "unsafe") preflightUnsafe = true;
    } catch {
      if (!currentSafely(current)) return staleResult(plan);
      ledger[index] = { targetPath: entry.targetPath, status: "conflict" };
      preflightConflict = true;
      preflightUnsafe = true;
    }
  }
  if (preflightConflict) {
    return {
      status: "conflict",
      ledger,
      diagnostics: [
        m06Diagnostic(
          preflightUnsafe
            ? "KNOWLEDGE_PATH_UNSAFE"
            : "KNOWLEDGE_TARGET_CONFLICT",
        ),
      ],
    };
  }

  for (let index = 0; index < plan.entries.length; index += 1) {
    const entry = plan.entries[index];
    if (entry === undefined) return staleResult(plan, ledger);
    if (ledger[index]?.status === "identical-no-op") continue;
    if (!currentSafely(current)) {
      ledger[index] = { targetPath: entry.targetPath, status: "stale" };
      return staleResult(plan, ledger);
    }

    let checkpoint;
    try {
      checkpoint = await adapter.checkpointKnowledgeTarget(entry.targetPath);
    } catch {
      checkpoint = { status: "unsafe" as const };
    }
    if (!currentSafely(current)) {
      ledger[index] = { targetPath: entry.targetPath, status: "stale" };
      return staleResult(plan, ledger);
    }
    if (checkpoint.status !== "absent-safe") {
      ledger[index] = { targetPath: entry.targetPath, status: "conflict" };
      return {
        status: hasCreated(ledger) ? "partial" : "conflict",
        ledger,
        diagnostics: [
          m06Diagnostic(
            checkpoint.status === "unsafe"
              ? "KNOWLEDGE_PATH_UNSAFE"
              : "KNOWLEDGE_TARGET_CONFLICT",
          ),
        ],
      };
    }

    if (!currentSafely(current)) {
      ledger[index] = { targetPath: entry.targetPath, status: "stale" };
      return staleResult(plan, ledger);
    }
    try {
      await adapter.createKnowledgeNote(
        checkpoint.resolvedPath,
        entry.noteContent,
      );
    } catch {
      ledger[index] = {
        targetPath: entry.targetPath,
        status: "create-failed",
      };
      if (!currentSafely(current))
        return staleResult(plan, ledger, [
          m06Diagnostic("KNOWLEDGE_CREATE_FAILED"),
        ]);
      return {
        status: hasCreated(ledger) ? "partial" : "failed",
        ledger,
        diagnostics: [m06Diagnostic("KNOWLEDGE_CREATE_FAILED")],
      };
    }

    const currentAfterCreate = currentSafely(current);
    let verified = false;
    try {
      const actual = await adapter.readKnowledgeNote(entry.targetPath);
      verified = bytesEqual(
        actual,
        expectedByPath.get(entry.targetPath) ?? new Uint8Array(),
      );
    } catch {
      verified = false;
    }
    const currentAfterRead = currentSafely(current);
    ledger[index] = {
      targetPath: entry.targetPath,
      status: verified ? "created" : "verification-failed",
    };
    if (!currentAfterCreate || !currentAfterRead) {
      return staleResult(
        plan,
        ledger,
        verified ? [] : [m06Diagnostic("KNOWLEDGE_VERIFICATION_FAILED")],
      );
    }
    if (!verified) {
      return {
        status: hasCreated(ledger) ? "partial" : "failed",
        ledger,
        diagnostics: [m06Diagnostic("KNOWLEDGE_VERIFICATION_FAILED")],
      };
    }
  }

  return { status: "saved", ledger, diagnostics: [] };
}
