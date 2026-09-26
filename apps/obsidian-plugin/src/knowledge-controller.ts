import {
  createKnowledgeReview,
  editKnowledgeCandidate,
  fingerprint,
  m06Diagnostic,
  planKnowledgeWrite,
  setKnowledgeDecision,
  setKnowledgeSelected,
  type KnowledgeDecision,
  type KnowledgePlannerInput,
  type KnowledgeReviewEditResult,
  type KnowledgeWritePlan,
  type M06Diagnostic,
  type PreviewCandidate,
  type ResolvedKnowledgeSource,
  type ReviewedKnowledgeCandidate,
} from "@chat2vault/core";
import {
  executeKnowledgeWrite,
  type ExecutableKnowledgeWritePlan,
  type KnowledgeSourceAuthority,
  type KnowledgeWriteExecutionResult,
} from "./knowledge-executor.js";
import type { KnowledgeVaultAdapter } from "./knowledge-vault-adapter.js";

export interface KnowledgeControllerCurrent {
  loaded: boolean;
  lifecycleGeneration: number;
  importGeneration: number;
  selectionGeneration: number;
  distillationGeneration: number;
  sourceSettingsGeneration: number;
  knowledgeSettingsGeneration: number;
  sourceRootPending: boolean;
  knowledgeRootPending: boolean;
  sourceRoot: string;
  knowledgeRoot: string;
}

type MaybePromise<T> = T | Promise<T>;
type KnowledgePlanner = (
  input: KnowledgePlannerInput,
) => MaybePromise<KnowledgeWritePlan>;
type KnowledgeExecutor = (
  plan: ExecutableKnowledgeWritePlan,
  current: () => boolean,
  adapter: KnowledgeVaultAdapter,
) => Promise<KnowledgeWriteExecutionResult>;

export interface KnowledgeControllerServices {
  current(): KnowledgeControllerCurrent;
  adapter: KnowledgeVaultAdapter;
  planner?: KnowledgePlanner;
  execute?: KnowledgeExecutor;
}

export type KnowledgeControllerStatus =
  "empty" | "reviewing" | "previewing" | "ready" | "blocked" | "writing";

export interface KnowledgeControllerSnapshot {
  readonly status: KnowledgeControllerStatus;
  readonly candidates: readonly ReviewedKnowledgeCandidate[];
  readonly plan: KnowledgeWritePlan | ExecutableKnowledgeWritePlan | undefined;
  readonly diagnostics: readonly M06Diagnostic[];
}

export type KnowledgePreviewResult =
  | { status: "planned"; plan: KnowledgeWritePlan }
  | {
      status: "blocked" | "stale" | "preview-in-progress" | "write-in-progress";
      diagnostics: readonly M06Diagnostic[];
    };

interface BaseToken extends KnowledgeControllerCurrent {
  candidateGeneration: number;
  reviewFingerprint: string;
}

interface InstalledPlan {
  token: BaseToken;
  plan: ExecutableKnowledgeWritePlan;
}

interface CandidateSourceAuthority {
  sourceSettingsGeneration: number;
  sourceRoot: string;
}

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

function cloneSource(source: ResolvedKnowledgeSource): ResolvedKnowledgeSource {
  return {
    provider: source.provider,
    ...(source.providerConversationId === undefined
      ? {}
      : { providerConversationId: source.providerConversationId }),
    conversationFingerprint: source.conversationFingerprint,
    messageFingerprints: [...source.messageFingerprints],
    sourceNotePath: source.sourceNotePath,
  };
}

function cloneCandidate(
  candidate: ReviewedKnowledgeCandidate,
): ReviewedKnowledgeCandidate {
  return {
    ...candidate,
    sourceRefs: candidate.sourceRefs.map((sourceRef) => ({
      ...sourceRef,
      messageFingerprints: [...sourceRef.messageFingerprints],
    })),
    tags: [...candidate.tags],
  };
}

function freezeCandidate(
  candidate: ReviewedKnowledgeCandidate,
): ReviewedKnowledgeCandidate {
  const detached = cloneCandidate(candidate);
  for (const sourceRef of detached.sourceRefs) {
    Object.freeze(sourceRef.messageFingerprints);
    Object.freeze(sourceRef);
  }
  Object.freeze(detached.sourceRefs);
  Object.freeze(detached.tags);
  return Object.freeze(detached);
}

function freezePlan<T extends KnowledgeWritePlan>(plan: T): T {
  for (const entry of plan.entries) Object.freeze(entry);
  for (const diagnostic of plan.diagnostics) Object.freeze(diagnostic);
  Object.freeze(plan.entries);
  Object.freeze(plan.diagnostics);
  return Object.freeze(plan);
}

function freezeExecutable(
  plan: ExecutableKnowledgeWritePlan,
): ExecutableKnowledgeWritePlan {
  const sourceAuthorities = plan.sourceAuthorities.map((authority) => {
    const sources = authority.sources.map((source) => {
      const detached = cloneSource(source);
      Object.freeze(detached.messageFingerprints);
      return Object.freeze(detached);
    });
    Object.freeze(sources);
    return Object.freeze({
      candidate: freezeCandidate(authority.candidate),
      sources,
    });
  });
  Object.freeze(sourceAuthorities);
  return freezePlan({ ...plan, sourceAuthorities });
}

function immutableSnapshot(
  status: KnowledgeControllerStatus,
  candidates: readonly ReviewedKnowledgeCandidate[],
  plan: KnowledgeWritePlan | ExecutableKnowledgeWritePlan | undefined,
  diagnostics: readonly M06Diagnostic[],
): KnowledgeControllerSnapshot {
  const frozenCandidates = candidates.map(freezeCandidate);
  const frozenDiagnostics = diagnostics.map((diagnostic) =>
    Object.freeze({ ...diagnostic }),
  );
  Object.freeze(frozenCandidates);
  Object.freeze(frozenDiagnostics);
  return Object.freeze({
    status,
    candidates: frozenCandidates,
    plan,
    diagnostics: frozenDiagnostics,
  });
}

function currentSafely(
  services: KnowledgeControllerServices,
): KnowledgeControllerCurrent | undefined {
  try {
    const current = services.current();
    const snapshot: KnowledgeControllerCurrent = {
      loaded: current.loaded,
      lifecycleGeneration: current.lifecycleGeneration,
      importGeneration: current.importGeneration,
      selectionGeneration: current.selectionGeneration,
      distillationGeneration: current.distillationGeneration,
      sourceSettingsGeneration: current.sourceSettingsGeneration,
      knowledgeSettingsGeneration: current.knowledgeSettingsGeneration,
      sourceRootPending: current.sourceRootPending,
      knowledgeRootPending: current.knowledgeRootPending,
      sourceRoot: current.sourceRoot,
      knowledgeRoot: current.knowledgeRoot,
    };
    return typeof snapshot.loaded === "boolean" &&
      Number.isSafeInteger(snapshot.lifecycleGeneration) &&
      Number.isSafeInteger(snapshot.importGeneration) &&
      Number.isSafeInteger(snapshot.selectionGeneration) &&
      Number.isSafeInteger(snapshot.distillationGeneration) &&
      Number.isSafeInteger(snapshot.sourceSettingsGeneration) &&
      Number.isSafeInteger(snapshot.knowledgeSettingsGeneration) &&
      typeof snapshot.sourceRootPending === "boolean" &&
      typeof snapshot.knowledgeRootPending === "boolean" &&
      typeof snapshot.sourceRoot === "string" &&
      typeof snapshot.knowledgeRoot === "string"
      ? snapshot
      : undefined;
  } catch {
    return undefined;
  }
}

function sameCurrent(
  left: KnowledgeControllerCurrent,
  right: KnowledgeControllerCurrent,
): boolean {
  return (
    right.loaded &&
    left.loaded === right.loaded &&
    left.lifecycleGeneration === right.lifecycleGeneration &&
    left.importGeneration === right.importGeneration &&
    left.selectionGeneration === right.selectionGeneration &&
    left.distillationGeneration === right.distillationGeneration &&
    left.sourceSettingsGeneration === right.sourceSettingsGeneration &&
    left.knowledgeSettingsGeneration === right.knowledgeSettingsGeneration &&
    left.sourceRootPending === right.sourceRootPending &&
    left.knowledgeRootPending === right.knowledgeRootPending &&
    left.sourceRoot === right.sourceRoot &&
    left.knowledgeRoot === right.knowledgeRoot
  );
}

function rejection(
  status: Exclude<KnowledgePreviewResult["status"], "planned">,
  diagnostic: M06Diagnostic,
): KnowledgePreviewResult {
  return { status, diagnostics: [diagnostic] };
}

function writeRejection(
  code: M06Diagnostic["code"],
): KnowledgeWriteExecutionResult {
  return { status: "failed", ledger: [], diagnostics: [m06Diagnostic(code)] };
}

function staleExecution(
  result?: KnowledgeWriteExecutionResult,
): KnowledgeWriteExecutionResult {
  return {
    status: "stale",
    ledger: result?.ledger ?? [],
    diagnostics: [
      m06Diagnostic("KNOWLEDGE_PLAN_STALE"),
      ...(result?.diagnostics.filter(
        ({ code }) => code !== "KNOWLEDGE_PLAN_STALE",
      ) ?? []),
    ],
  };
}

export class KnowledgeController {
  private readonly previewMutex = new BinaryMutex();
  private readonly writeMutex = new BinaryMutex();
  private candidates: ReviewedKnowledgeCandidate[] = [];
  private candidateSourceAuthority: CandidateSourceAuthority | undefined;
  private candidateGeneration = 0;
  private installed: InstalledPlan | undefined;
  private writeOwner = 0;
  private currentSnapshot = immutableSnapshot("empty", [], undefined, []);

  public constructor(private readonly services: KnowledgeControllerServices) {}

  public get snapshot(): KnowledgeControllerSnapshot {
    if (!this.candidateAuthorityCurrent()) this.invalidate();
    if (
      this.installed !== undefined &&
      !this.tokenCurrent(this.installed.token)
    )
      this.clearPlan();
    return this.currentSnapshot;
  }

  private publish(
    status: KnowledgeControllerStatus,
    plan: KnowledgeWritePlan | ExecutableKnowledgeWritePlan | undefined,
    diagnostics: readonly M06Diagnostic[] = [],
  ): void {
    this.currentSnapshot = immutableSnapshot(
      status,
      this.candidates,
      plan,
      diagnostics,
    );
  }

  private reviewFingerprint(): string {
    return fingerprint(this.candidates);
  }

  private candidateAuthorityCurrent(
    current = currentSafely(this.services),
  ): boolean {
    if (this.candidates.length === 0)
      return this.candidateSourceAuthority === undefined;
    const authority = this.candidateSourceAuthority;
    if (current === undefined || authority === undefined) return false;
    return (
      current.loaded &&
      !current.sourceRootPending &&
      current.sourceSettingsGeneration === authority.sourceSettingsGeneration &&
      current.sourceRoot === authority.sourceRoot
    );
  }

  private token(): BaseToken | undefined {
    const current = currentSafely(this.services);
    if (
      !current?.loaded ||
      current.sourceRootPending ||
      current.knowledgeRootPending
    )
      return undefined;
    if (!this.candidateAuthorityCurrent(current)) {
      this.invalidate();
      return undefined;
    }
    return {
      ...current,
      candidateGeneration: this.candidateGeneration,
      reviewFingerprint: this.reviewFingerprint(),
    };
  }

  private tokenCurrent(token: BaseToken): boolean {
    const current = currentSafely(this.services);
    return (
      current !== undefined &&
      sameCurrent(token, current) &&
      this.candidateGeneration === token.candidateGeneration &&
      this.reviewFingerprint() === token.reviewFingerprint
    );
  }

  private clearPlan(): void {
    this.installed = undefined;
    this.publish(
      this.candidates.length === 0 ? "empty" : "reviewing",
      undefined,
    );
  }

  private stalePreview(
    code:
      | "KNOWLEDGE_PLAN_STALE"
      | "KNOWLEDGE_SOURCE_STALE" = "KNOWLEDGE_PLAN_STALE",
  ): KnowledgePreviewResult {
    if (this.currentSnapshot.status === "previewing") this.clearPlan();
    return rejection("stale", m06Diagnostic(code));
  }

  private replaceCandidate(
    id: string,
    replacement: (
      candidate: ReviewedKnowledgeCandidate,
    ) => ReviewedKnowledgeCandidate,
  ): boolean {
    if (!this.candidateAuthorityCurrent()) {
      this.invalidate();
      return false;
    }
    const index = this.candidates.findIndex((candidate) => candidate.id === id);
    const existing = this.candidates[index];
    if (index < 0 || existing === undefined) return false;
    this.candidates = this.candidates.map((candidate, candidateIndex) =>
      candidateIndex === index
        ? replacement(candidate)
        : cloneCandidate(candidate),
    );
    this.candidateGeneration += 1;
    this.clearPlan();
    return true;
  }

  public installCandidates(candidates: readonly PreviewCandidate[]): boolean {
    const current = currentSafely(this.services);
    if (
      current === undefined ||
      !current.loaded ||
      current.sourceRootPending ||
      current.knowledgeRootPending ||
      !Array.isArray(candidates)
    )
      return false;
    try {
      const reviews = candidates.map(createKnowledgeReview);
      if (new Set(reviews.map(({ id }) => id)).size !== reviews.length)
        return false;
      this.candidates = reviews.map(cloneCandidate);
      this.candidateSourceAuthority = {
        sourceSettingsGeneration: current.sourceSettingsGeneration,
        sourceRoot: current.sourceRoot,
      };
      this.candidateGeneration += 1;
      this.clearPlan();
      return true;
    } catch {
      return false;
    }
  }

  public decide(id: string, decision: KnowledgeDecision): boolean {
    return this.replaceCandidate(id, (candidate) =>
      setKnowledgeDecision(candidate, decision),
    );
  }

  public edit(id: string, value: unknown): KnowledgeReviewEditResult {
    const candidate = this.candidates.find((item) => item.id === id);
    if (candidate === undefined)
      return {
        ok: false,
        diagnostics: [m06Diagnostic("KNOWLEDGE_REVIEW_INVALID")],
      };
    const edited = editKnowledgeCandidate(candidate, value);
    if (!edited.ok) return edited;
    this.replaceCandidate(id, () => edited.candidate);
    return { ok: true, candidate: freezeCandidate(edited.candidate) };
  }

  public select(id: string, selected: boolean): boolean {
    return this.replaceCandidate(id, (candidate) =>
      setKnowledgeSelected(candidate, selected),
    );
  }

  public selectAllEligible(selected: boolean): boolean {
    if (!this.candidateAuthorityCurrent()) {
      this.invalidate();
      return false;
    }
    if (this.candidates.length === 0) return false;
    this.candidates = this.candidates.map((candidate) =>
      setKnowledgeSelected(candidate, selected),
    );
    this.candidateGeneration += 1;
    this.clearPlan();
    return true;
  }

  public invalidate(): void {
    this.candidates = [];
    this.candidateSourceAuthority = undefined;
    this.candidateGeneration += 1;
    this.installed = undefined;
    this.publish("empty", undefined);
  }

  public async preview(): Promise<KnowledgePreviewResult> {
    if (this.writeMutex.isHeld)
      return rejection(
        "write-in-progress",
        m06Diagnostic("KNOWLEDGE_WRITE_IN_PROGRESS"),
      );
    if (!this.previewMutex.tryAcquire())
      return rejection(
        "preview-in-progress",
        m06Diagnostic("KNOWLEDGE_PREVIEW_IN_PROGRESS"),
      );
    try {
      // Required atomic cross-mutex recheck; no other owner can appear in this turn.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.writeMutex.isHeld)
        return rejection(
          "write-in-progress",
          m06Diagnostic("KNOWLEDGE_WRITE_IN_PROGRESS"),
        );
      this.installed = undefined;
      this.publish("previewing", undefined);
      const token = this.token();
      if (token === undefined) return this.stalePreview();

      const selected = this.candidates
        .filter(
          (candidate) =>
            candidate.selected &&
            (candidate.decision === "accepted" ||
              candidate.decision === "edited"),
        )
        .map(cloneCandidate);
      const authorities: KnowledgeSourceAuthority[] = [];
      const resolved = new Map<string, ResolvedKnowledgeSource>();
      for (const candidate of selected) {
        if (!this.tokenCurrent(token)) return this.stalePreview();
        let resolution;
        try {
          resolution =
            await this.services.adapter.resolveKnowledgeSources(candidate);
        } catch {
          return this.stalePreview("KNOWLEDGE_SOURCE_STALE");
        }
        if (!this.tokenCurrent(token)) return this.stalePreview();
        if (!resolution.ok) {
          this.publish("blocked", undefined, resolution.diagnostics);
          return { status: "blocked", diagnostics: resolution.diagnostics };
        }
        const sources = resolution.sources.map(cloneSource);
        authorities.push({ candidate, sources });
        for (const source of sources) resolved.set(fingerprint(source), source);
      }

      const planner = this.services.planner ?? planKnowledgeWrite;
      const baseInput = {
        sourceRoot: token.sourceRoot,
        knowledgeRoot: token.knowledgeRoot,
        candidates: this.candidates.map(cloneCandidate),
        resolvedSources: [...resolved.values()].map(cloneSource),
      };
      let initial: KnowledgeWritePlan;
      try {
        initial = await planner({ ...baseInput, targetObservations: [] });
      } catch {
        return this.stalePreview();
      }
      if (!this.tokenCurrent(token)) return this.stalePreview();

      const targetObservations = [];
      for (const entry of initial.entries) {
        let observation;
        try {
          observation = await this.services.adapter.observeKnowledgeTarget(
            entry.targetPath,
          );
        } catch {
          observation = { status: "unsafe" as const };
        }
        if (!this.tokenCurrent(token)) return this.stalePreview();
        targetObservations.push({ targetPath: entry.targetPath, observation });
      }

      let planned: KnowledgeWritePlan;
      try {
        planned = await planner({ ...baseInput, targetObservations });
      } catch {
        return this.stalePreview();
      }
      if (!this.tokenCurrent(token)) return this.stalePreview();
      if (planned.status !== "ready") {
        const frozen = freezePlan({ ...planned });
        this.publish("blocked", frozen, frozen.diagnostics);
        return { status: "planned", plan: frozen };
      }

      const executable = freezeExecutable({
        ...planned,
        sourceAuthorities: authorities,
      });
      this.installed = { token, plan: executable };
      this.publish("ready", executable);
      return { status: "planned", plan: executable };
    } finally {
      this.previewMutex.release();
    }
  }

  public write():
    KnowledgeWriteExecutionResult | Promise<KnowledgeWriteExecutionResult> {
    if (this.previewMutex.isHeld)
      return writeRejection("KNOWLEDGE_PREVIEW_IN_PROGRESS");
    if (!this.writeMutex.tryAcquire())
      return writeRejection("KNOWLEDGE_WRITE_IN_PROGRESS");
    // Required atomic cross-mutex recheck; no other owner can appear in this turn.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.previewMutex.isHeld) {
      this.writeMutex.release();
      return writeRejection("KNOWLEDGE_PREVIEW_IN_PROGRESS");
    }
    const installed = this.installed;
    if (installed === undefined || !this.tokenCurrent(installed.token)) {
      this.installed = undefined;
      this.writeMutex.release();
      this.clearPlan();
      return writeRejection("KNOWLEDGE_PLAN_STALE");
    }

    // The exact installed plan is consumed before runWrite can reach its first await.
    this.installed = undefined;
    const owner = ++this.writeOwner;
    this.publish("writing", undefined);
    return this.runWrite(owner, installed);
  }

  private async runWrite(
    owner: number,
    installed: InstalledPlan,
  ): Promise<KnowledgeWriteExecutionResult> {
    try {
      const executor = this.services.execute ?? executeKnowledgeWrite;
      const result = await executor(
        installed.plan,
        () => this.tokenCurrent(installed.token),
        this.services.adapter,
      );
      return this.tokenCurrent(installed.token)
        ? result
        : staleExecution(result);
    } catch {
      return this.tokenCurrent(installed.token)
        ? writeRejection("KNOWLEDGE_CREATE_FAILED")
        : staleExecution();
    } finally {
      this.writeMutex.release();
      if (
        owner === this.writeOwner &&
        this.currentSnapshot.status === "writing"
      )
        this.publish(
          this.candidates.length === 0 ? "empty" : "reviewing",
          undefined,
        );
    }
  }
}
