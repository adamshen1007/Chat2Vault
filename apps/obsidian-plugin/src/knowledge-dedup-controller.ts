import {
  fingerprint,
  matchKnowledgeCandidate,
  parseKnowledgeCatalogNote,
  renderCombinedKnowledgeNote,
  sha256,
  type CatalogSourceNote,
  type CombinedKnowledgePlanEntry,
  type KnowledgeDecision,
  type KnowledgeReviewEdit,
  type KnowledgeMatchResult,
  type KnowledgeReviewEditResult,
  type PreviewCandidate,
  type ResolvedKnowledgeSource,
  type ReviewedKnowledgeCandidate,
} from "@chat2vault/core";
import {
  KnowledgeController,
  type KnowledgeControllerCurrent,
  type KnowledgeOrdinaryAuthority,
} from "./knowledge-controller.js";
import type { KnowledgeCatalogReadResult } from "./knowledge-catalog-adapter.js";
import {
  executeKnowledgeWrite,
  type ExecutableKnowledgeWritePlan,
  type KnowledgeWriteExecutionResult,
} from "./knowledge-executor.js";
import type { KnowledgeVaultAdapter } from "./knowledge-vault-adapter.js";

export interface DedupDiagnostic {
  code:
    | "M07_CATALOG_UNAVAILABLE"
    | "M07_CATALOG_UNSAFE"
    | "M07_CATALOG_INCOMPLETE"
    | "M07_EXACT_DUPLICATE"
    | "M07_PLAN_STALE"
    | "M07_WRITE_IN_PROGRESS"
    | "M07_PREVIEW_IN_PROGRESS"
    | "M07_SOURCE_UNAVAILABLE"
    | "M07_SELECTED_UNAVAILABLE"
    | "M07_SELECTED_CHANGED"
    | "M07_DRAFT_INVALID"
    | "M07_NOTE_TOO_LARGE"
    | "M07_PATH_UNSAFE";
  severity: "error";
  message: string;
}
export interface CandidateMatch {
  candidateId: string;
  contentFingerprint: string;
  result: KnowledgeMatchResult;
}
export interface DedupSnapshot {
  status: "empty" | "previewing" | "ready" | "blocked" | "writing";
  canWrite: boolean;
  matches: readonly CandidateMatch[];
  diagnostics: readonly DedupDiagnostic[];
}
export type DedupPreviewResult =
  | { status: "planned"; diagnostics: readonly DedupDiagnostic[] }
  | {
      status: "blocked" | "stale" | "preview-in-progress" | "write-in-progress";
      diagnostics: readonly DedupDiagnostic[];
    };
export type DedupWriteResult =
  | KnowledgeWriteExecutionResult
  | {
      status: "stale" | "write-in-progress";
      ledger: [];
      diagnostics: readonly DedupDiagnostic[];
    };
interface InstalledGate {
  authorityFingerprint: string;
  catalogFingerprint: string;
  matches: readonly CandidateMatch[];
}
export interface CombinedGateServices {
  current(): KnowledgeControllerCurrent;
  adapter: KnowledgeVaultAdapter;
}
export type CombinedPreviewResult =
  | {
      status: "ready";
      entry: CombinedKnowledgePlanEntry;
      action: "create" | "identical-no-op";
      selectedPath: string;
      selectedByteDigest: string;
      sourcePaths: readonly string[];
    }
  | {
      status: "blocked" | "stale" | "preview-in-progress" | "write-in-progress";
      diagnostics: readonly DedupDiagnostic[];
    };
interface CombinedToken {
  authorityFingerprint: string;
  catalogFingerprint: string;
  selectedPath: string;
  selectedByteDigest: string;
  sourceFingerprint: string;
  plan: ExecutableKnowledgeWritePlan;
}
function sourceTriples(
  sources: readonly ResolvedKnowledgeSource[],
): CatalogSourceNote[] {
  return sources.map(
    ({ provider, conversationFingerprint, sourceNotePath }) => ({
      provider,
      conversationFingerprint,
      sourceNotePath,
    }),
  );
}
function unionSources(
  sources: readonly CatalogSourceNote[],
): CatalogSourceNote[] {
  return [
    ...new Map(
      sources.map((source) => [
        JSON.stringify([
          source.provider,
          source.conversationFingerprint,
          source.sourceNotePath,
        ]),
        source,
      ]),
    ).values(),
  ].sort((a, b) =>
    JSON.stringify([
      a.provider,
      a.conversationFingerprint,
      a.sourceNotePath,
    ]).localeCompare(
      JSON.stringify([b.provider, b.conversationFingerprint, b.sourceNotePath]),
      "en",
    ),
  );
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}
const diagnostic = (
  code: DedupDiagnostic["code"],
  message: string,
): DedupDiagnostic => ({ code, severity: "error", message });

function duplicateCandidateIds(matches: readonly CandidateMatch[]): string[] {
  const byContent = new Map<string, string[]>();
  for (const match of matches) {
    const group = byContent.get(match.contentFingerprint) ?? [];
    group.push(match.candidateId);
    byContent.set(match.contentFingerprint, group);
  }
  const conflicted = new Set(
    [...byContent.values()].filter((group) => group.length > 1).flat(),
  );
  for (const match of matches)
    if (match.result.exact.length > 0) conflicted.add(match.candidateId);
  return matches
    .filter(({ candidateId }) => conflicted.has(candidateId))
    .map(({ candidateId }) => candidateId);
}

export class KnowledgeDedupController {
  private installed: InstalledGate | undefined;
  private state: DedupSnapshot = {
    status: "empty",
    canWrite: false,
    matches: [],
    diagnostics: [],
  };
  private previewing = false;
  private writing = false;
  private combined: CombinedToken | undefined;
  private combinedPreviewing = false;
  private combinedWriting = false;

  public constructor(
    private readonly base: KnowledgeController,
    private readonly catalog: {
      readKnowledgeCatalog(): Promise<KnowledgeCatalogReadResult>;
    },
    private readonly combinedServices?: CombinedGateServices,
  ) {}

  public get snapshot(): DedupSnapshot {
    if (this.installed !== undefined && !this.authorityCurrent(this.installed))
      this.clear();
    return this.state;
  }

  private authorityFingerprint(authority: KnowledgeOrdinaryAuthority): string {
    return fingerprint({
      token: authority.token,
      plan: authority.plan.planFingerprint,
    });
  }

  private authorityCurrent(installed: InstalledGate): boolean {
    const authority = this.base.ordinaryAuthority();
    return (
      authority !== undefined &&
      this.authorityFingerprint(authority) === installed.authorityFingerprint
    );
  }

  private clear(): void {
    this.installed = undefined;
    this.combined = undefined;
    this.state = {
      status: "empty",
      canWrite: false,
      matches: [],
      diagnostics: [],
    };
  }

  public installCandidates(candidates: readonly PreviewCandidate[]): boolean {
    this.clear();
    return this.base.installCandidates(candidates);
  }
  public decide(id: string, decision: KnowledgeDecision): boolean {
    this.clear();
    return this.base.decide(id, decision);
  }
  public edit(id: string, value: unknown): KnowledgeReviewEditResult {
    this.clear();
    return this.base.edit(id, value);
  }
  public select(id: string, selected: boolean): boolean {
    this.clear();
    return this.base.select(id, selected);
  }
  public selectAllEligible(selected: boolean): boolean {
    this.clear();
    return this.base.selectAllEligible(selected);
  }
  public invalidate(): void {
    this.clear();
    this.base.invalidate();
  }

  public async previewOrdinary(): Promise<DedupPreviewResult> {
    if (this.writing || this.combinedWriting)
      return {
        status: "write-in-progress",
        diagnostics: [
          diagnostic("M07_WRITE_IN_PROGRESS", "A write is in progress."),
        ],
      };
    if (this.previewing || this.combinedPreviewing)
      return {
        status: "preview-in-progress",
        diagnostics: [
          diagnostic("M07_PREVIEW_IN_PROGRESS", "A dry-run is in progress."),
        ],
      };
    this.previewing = true;
    this.clear();
    this.state = { ...this.state, status: "previewing" };
    try {
      const preview = await this.base.preview();
      const authority = this.base.ordinaryAuthority();
      if (
        preview.status !== "planned" ||
        preview.plan.status !== "ready" ||
        authority === undefined
      ) {
        this.state = { ...this.state, status: "blocked" };
        return {
          status: preview.status === "planned" ? "blocked" : "stale",
          diagnostics: [],
        };
      }
      const authorityFingerprint = this.authorityFingerprint(authority);
      let catalog: KnowledgeCatalogReadResult;
      try {
        catalog = await this.catalog.readKnowledgeCatalog();
      } catch {
        catalog = { status: "blocked", code: "M07_CATALOG_UNAVAILABLE" };
      }
      if (!this.authorityMatches(authorityFingerprint)) {
        this.clear();
        return {
          status: "stale",
          diagnostics: [
            diagnostic(
              "M07_PLAN_STALE",
              "The knowledge dry-run changed; run it again.",
            ),
          ],
        };
      }
      if (catalog.status === "blocked") {
        const reason = diagnostic(
          catalog.code,
          "The knowledge catalog could not be completely verified; no note may be created.",
        );
        this.state = {
          status: "blocked",
          canWrite: false,
          matches: [],
          diagnostics: [reason],
        };
        return { status: "blocked", diagnostics: [reason] };
      }
      const matches: CandidateMatch[] = [];
      for (const entry of authority.plan.entries) {
        const candidate = authority.plan.sourceAuthorities.find(
          ({ candidate }) => candidate.id === entry.candidateId,
        )?.candidate;
        const parsed = parseKnowledgeCatalogNote(
          entry.targetPath,
          new TextEncoder().encode(entry.noteContent),
        );
        if (candidate === undefined || parsed.status !== "eligible") {
          const reason = diagnostic(
            "M07_CATALOG_INCOMPLETE",
            "A planned knowledge note could not be classified.",
          );
          this.state = {
            status: "blocked",
            canWrite: false,
            matches: [],
            diagnostics: [reason],
          };
          return { status: "blocked", diagnostics: [reason] };
        }
        matches.push({
          candidateId: candidate.id,
          contentFingerprint: parsed.note.contentFingerprint,
          result: matchKnowledgeCandidate({
            candidate,
            payload: parsed.note.payload,
            renderedTags: parsed.note.tags,
            notes: catalog.notes,
            resolvedSources: catalog.resolvedSources,
          }),
        });
      }
      const duplicates = duplicateCandidateIds(matches);
      const reasons =
        duplicates.length === 0
          ? []
          : [
              diagnostic(
                "M07_EXACT_DUPLICATE",
                `Exact duplicate selected. Deselect candidate(s): ${duplicates.join(", ")}; then run Dry run again.`,
              ),
            ];
      this.installed =
        duplicates.length === 0
          ? {
              authorityFingerprint,
              catalogFingerprint: catalog.fingerprint,
              matches,
            }
          : undefined;
      this.state = {
        status: duplicates.length === 0 ? "ready" : "blocked",
        canWrite: duplicates.length === 0,
        matches,
        diagnostics: reasons,
      };
      return {
        status: duplicates.length === 0 ? "planned" : "blocked",
        diagnostics: reasons,
      };
    } finally {
      this.previewing = false;
    }
  }

  private authorityMatches(expected: string): boolean {
    const current = this.base.ordinaryAuthority();
    return (
      current !== undefined && this.authorityFingerprint(current) === expected
    );
  }

  public writeOrdinary(): Promise<DedupWriteResult> {
    if (this.writing || this.combinedWriting)
      return Promise.resolve({
        status: "write-in-progress",
        ledger: [],
        diagnostics: [
          diagnostic("M07_WRITE_IN_PROGRESS", "A write is in progress."),
        ],
      });
    if (this.previewing || this.combinedPreviewing)
      return Promise.resolve({
        status: "stale",
        ledger: [],
        diagnostics: [
          diagnostic(
            "M07_PREVIEW_IN_PROGRESS",
            "The dry-run has not completed.",
          ),
        ],
      });
    const installed = this.installed;
    if (installed === undefined || !this.authorityCurrent(installed)) {
      this.clear();
      return Promise.resolve({
        status: "stale",
        ledger: [],
        diagnostics: [
          diagnostic(
            "M07_PLAN_STALE",
            "Run a new knowledge dry-run before writing.",
          ),
        ],
      });
    }
    // Own the write and consume the gate before the first asynchronous boundary.
    this.writing = true;
    this.installed = undefined;
    this.state = { ...this.state, status: "writing", canWrite: false };
    return this.runWrite(installed);
  }

  private async runWrite(installed: InstalledGate): Promise<DedupWriteResult> {
    const stale = (): DedupWriteResult => ({
      status: "stale",
      ledger: [],
      diagnostics: [
        diagnostic(
          "M07_PLAN_STALE",
          "The knowledge catalog or plan changed; run a new dry-run.",
        ),
      ],
    });
    try {
      let catalog: KnowledgeCatalogReadResult;
      try {
        catalog = await this.catalog.readKnowledgeCatalog();
      } catch {
        return stale();
      }
      if (
        catalog.status !== "ready" ||
        catalog.fingerprint !== installed.catalogFingerprint ||
        !this.authorityCurrent(installed)
      )
        return stale();
      // The catalog is reclassified after observation; identity must still be duplicate-free.
      const refreshed: CandidateMatch[] = [];
      for (const match of installed.matches) {
        const authority = this.base.ordinaryAuthority();
        const candidate = authority?.plan.sourceAuthorities.find(
          ({ candidate }) => candidate.id === match.candidateId,
        )?.candidate;
        const entry = authority?.plan.entries.find(
          ({ candidateId }) => candidateId === match.candidateId,
        );
        if (candidate === undefined || entry === undefined) return stale();
        const parsed = parseKnowledgeCatalogNote(
          entry.targetPath,
          new TextEncoder().encode(entry.noteContent),
        );
        if (parsed.status !== "eligible") return stale();
        refreshed.push({
          candidateId: candidate.id,
          contentFingerprint: parsed.note.contentFingerprint,
          result: matchKnowledgeCandidate({
            candidate,
            payload: parsed.note.payload,
            renderedTags: parsed.note.tags,
            notes: catalog.notes,
            resolvedSources: catalog.resolvedSources,
          }),
        });
      }
      if (duplicateCandidateIds(refreshed).length > 0) return stale();
      if (!this.authorityCurrent(installed)) return stale();
      return await this.base.write();
    } finally {
      this.writing = false;
      this.clear();
    }
  }

  private combinedAuthority(candidateId: string):
    | {
        candidate: ReviewedKnowledgeCandidate;
        fingerprint: string;
        current: KnowledgeControllerCurrent;
      }
    | undefined {
    const services = this.combinedServices;
    if (services === undefined) return undefined;
    try {
      const current = services.current();
      if (
        !current.loaded ||
        current.sourceRootPending ||
        current.knowledgeRootPending ||
        !current.sourceRoot ||
        !current.knowledgeRoot
      )
        return undefined;
      const snapshot = this.base.snapshot;
      const candidate = snapshot.candidates.find(
        (item) => item.id === candidateId,
      );
      if (
        candidate === undefined ||
        (candidate.decision !== "accepted" && candidate.decision !== "edited")
      )
        return undefined;
      return {
        candidate,
        current,
        fingerprint: fingerprint({ current, candidates: snapshot.candidates }),
      };
    } catch {
      return undefined;
    }
  }

  public async previewCombined(
    candidateId: string,
    selectedPath: string,
    draft: KnowledgeReviewEdit,
    displayedSelectedDigest: string,
  ): Promise<CombinedPreviewResult> {
    if (this.writing || this.combinedWriting)
      return {
        status: "write-in-progress",
        diagnostics: [
          diagnostic("M07_WRITE_IN_PROGRESS", "A write is in progress."),
        ],
      };
    if (this.previewing || this.combinedPreviewing)
      return {
        status: "preview-in-progress",
        diagnostics: [
          diagnostic("M07_PREVIEW_IN_PROGRESS", "A dry-run is in progress."),
        ],
      };
    this.combinedPreviewing = true;
    this.combined = undefined;
    const fail = (code: DedupDiagnostic["code"]): CombinedPreviewResult => ({
      status: "blocked",
      diagnostics: [
        diagnostic(code, "The combined note could not be safely planned."),
      ],
    });
    try {
      const authority = this.combinedAuthority(candidateId);
      const services = this.combinedServices;
      if (authority === undefined || services === undefined)
        return fail("M07_PLAN_STALE");
      const catalog = await this.catalog.readKnowledgeCatalog().catch(() => ({
        status: "blocked" as const,
        code: "M07_CATALOG_UNAVAILABLE" as const,
      }));
      if (catalog.status !== "ready") return fail(catalog.code);
      const selected = catalog.notes.find((note) => note.path === selectedPath);
      if (selected === undefined) return fail("M07_SELECTED_UNAVAILABLE");
      const selectedBytes = await services.adapter
        .readKnowledgeNote(selectedPath)
        .catch(() => undefined);
      if (selectedBytes === undefined) return fail("M07_SELECTED_UNAVAILABLE");
      if (sha256(selectedBytes) !== displayedSelectedDigest)
        return {
          status: "stale",
          diagnostics: [
            diagnostic(
              "M07_SELECTED_CHANGED",
              "The selected note changed. Review it and confirm again.",
            ),
          ],
        };
      const parsed = parseKnowledgeCatalogNote(selectedPath, selectedBytes);
      if (
        parsed.status !== "eligible" ||
        fingerprint(parsed.note) !== fingerprint(selected)
      )
        return fail("M07_SELECTED_UNAVAILABLE");
      const resolution = await services.adapter
        .resolveKnowledgeSources(authority.candidate)
        .catch(() => undefined);
      if (!resolution?.ok) return fail("M07_SOURCE_UNAVAILABLE");
      const selectedSources = selected.sourceNotes.map((link) =>
        catalog.resolvedSources.filter(
          (source) =>
            source.provider === link.provider &&
            source.conversationFingerprint === link.conversationFingerprint &&
            source.sourceNotePath === link.sourceNotePath,
        ),
      );
      if (selectedSources.some((matches) => matches.length !== 1))
        return fail("M07_SOURCE_UNAVAILABLE");
      const sources = unionSources([
        ...selected.sourceNotes,
        ...sourceTriples(resolution.sources),
      ]);
      const input = {
        candidate: authority.candidate,
        selectedNote: selected,
        draft,
        sourceNotes: sources,
        knowledgeRoot: authority.current.knowledgeRoot,
      };
      const initial = renderCombinedKnowledgeNote({
        ...input,
        existingContentFingerprints: [selected.contentFingerprint],
      });
      if (!initial.ok) return fail(initial.code);
      const rendered = renderCombinedKnowledgeNote({
        ...input,
        existingContentFingerprints: catalog.notes
          .filter((note) => note.path !== initial.targetPath)
          .map((note) => note.contentFingerprint),
      });
      if (!rendered.ok) return fail(rendered.code);
      const observation = await services.adapter
        .observeKnowledgeTarget(rendered.targetPath)
        .catch(() => ({ status: "unsafe" as const }));
      if (
        observation.status !== "absent" &&
        (observation.status !== "regular-file" ||
          !sameBytes(
            observation.bytes,
            new TextEncoder().encode(rendered.noteContent),
          ))
      )
        return fail("M07_PATH_UNSAFE");
      const fresh = this.combinedAuthority(candidateId);
      if (fresh?.fingerprint !== authority.fingerprint)
        return {
          status: "stale",
          diagnostics: [
            diagnostic(
              "M07_PLAN_STALE",
              "The combined preview changed; run it again.",
            ),
          ],
        };
      const entry = {
        ...rendered.entry,
        candidateId,
        action:
          observation.status === "absent"
            ? ("create" as const)
            : ("identical-no-op" as const),
      };
      const resolvedSources = resolution.sources.map((source) =>
        Object.freeze({
          ...source,
          messageFingerprints: Object.freeze([...source.messageFingerprints]),
        }),
      );
      const plan: ExecutableKnowledgeWritePlan = {
        status: "ready",
        sourceRoot: authority.current.sourceRoot,
        knowledgeRoot: authority.current.knowledgeRoot,
        entries: [entry],
        planFingerprint: fingerprint({
          entry,
          selectedPath,
          selectedDigest: sha256(selectedBytes),
          catalog: catalog.fingerprint,
          sources,
        }),
        diagnostics: [],
        sourceAuthorities: [
          { candidate: authority.candidate, sources: resolvedSources },
        ],
      };
      Object.freeze(entry);
      Object.freeze(plan.entries);
      Object.freeze(resolvedSources);
      Object.freeze(plan.sourceAuthorities);
      Object.freeze(plan);
      this.combined = {
        authorityFingerprint: authority.fingerprint,
        catalogFingerprint: catalog.fingerprint,
        selectedPath,
        selectedByteDigest: sha256(selectedBytes),
        sourceFingerprint: fingerprint({
          sources: catalog.resolvedSources,
          candidate: resolvedSources,
        }),
        plan,
      };
      return {
        status: "ready",
        entry: rendered.entry,
        action: entry.action,
        selectedPath,
        selectedByteDigest: sha256(selectedBytes),
        sourcePaths: sources.map((source) => source.sourceNotePath),
      };
    } catch {
      return fail("M07_PLAN_STALE");
    } finally {
      this.combinedPreviewing = false;
    }
  }

  public createCombined(): Promise<DedupWriteResult> {
    if (this.writing || this.combinedWriting)
      return Promise.resolve({
        status: "write-in-progress",
        ledger: [],
        diagnostics: [
          diagnostic("M07_WRITE_IN_PROGRESS", "A write is in progress."),
        ],
      });
    if (this.previewing || this.combinedPreviewing)
      return Promise.resolve({
        status: "stale",
        ledger: [],
        diagnostics: [
          diagnostic(
            "M07_PREVIEW_IN_PROGRESS",
            "The dry-run has not completed.",
          ),
        ],
      });
    const token = this.combined;
    this.combined = undefined;
    if (token === undefined)
      return Promise.resolve({
        status: "stale",
        ledger: [],
        diagnostics: [
          diagnostic(
            "M07_PLAN_STALE",
            "Run a new combined dry-run before writing.",
          ),
        ],
      });
    this.combinedWriting = true;
    return this.runCombined(token);
  }

  private async runCombined(token: CombinedToken): Promise<DedupWriteResult> {
    const stale = (): DedupWriteResult => ({
      status: "stale",
      ledger: [],
      diagnostics: [
        diagnostic(
          "M07_PLAN_STALE",
          "The combined plan changed; run a new dry-run.",
        ),
      ],
    });
    try {
      const services = this.combinedServices;
      const candidateId = token.plan.entries[0]?.candidateId;
      if (services === undefined || candidateId === undefined) return stale();
      const authority = this.combinedAuthority(candidateId);
      if (authority?.fingerprint !== token.authorityFingerprint) return stale();
      const catalog = await this.catalog
        .readKnowledgeCatalog()
        .catch(() => undefined);
      if (
        catalog?.status !== "ready" ||
        catalog.fingerprint !== token.catalogFingerprint
      )
        return stale();
      const selectedBytes = await services.adapter
        .readKnowledgeNote(token.selectedPath)
        .catch(() => undefined);
      if (
        selectedBytes === undefined ||
        sha256(selectedBytes) !== token.selectedByteDigest
      )
        return stale();
      const parsed = parseKnowledgeCatalogNote(
        token.selectedPath,
        selectedBytes,
      );
      if (
        parsed.status !== "eligible" ||
        !catalog.notes.some(
          (note) =>
            note.path === token.selectedPath &&
            fingerprint(note) === fingerprint(parsed.note),
        )
      )
        return stale();
      const resolution = await services.adapter
        .resolveKnowledgeSources(authority.candidate)
        .catch(() => undefined);
      if (
        resolution === undefined ||
        !resolution.ok ||
        fingerprint({
          sources: catalog.resolvedSources,
          candidate: resolution.sources,
        }) !== token.sourceFingerprint
      )
        return stale();
      if (
        this.combinedAuthority(candidateId)?.fingerprint !==
        token.authorityFingerprint
      )
        return stale();
      const result = await executeKnowledgeWrite(
        token.plan,
        () =>
          this.combinedAuthority(candidateId)?.fingerprint ===
          token.authorityFingerprint,
        services.adapter,
      );
      return result;
    } catch {
      return stale();
    } finally {
      this.combinedWriting = false;
    }
  }
}
