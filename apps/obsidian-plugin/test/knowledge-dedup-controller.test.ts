/* eslint-disable @typescript-eslint/require-await -- synthetic async vault I/O. */
import { describe, expect, it, vi } from "vitest";
import type {
  CatalogKnowledgeNote,
  PreviewCandidate,
  ResolvedKnowledgeSource,
} from "@chat2vault/core";
import {
  createKnowledgeReview,
  parseKnowledgeCatalogNote,
  renderKnowledgeNote,
  sha256,
} from "@chat2vault/core";
import {
  KnowledgeController,
  type KnowledgeControllerCurrent,
} from "../src/knowledge-controller.js";
import { KnowledgeDedupController } from "../src/knowledge-dedup-controller.js";
import type { KnowledgeCatalogReadResult } from "../src/knowledge-catalog-adapter.js";
import type { KnowledgeVaultAdapter } from "../src/knowledge-vault-adapter.js";

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
const source: ResolvedKnowledgeSource = {
  provider: "chatgpt",
  providerConversationId: "conversation-1",
  conversationFingerprint: hash("1"),
  messageFingerprints: [hash("2")],
  sourceNotePath: "Sources/one.md",
};
const candidate: PreviewCandidate = {
  id: hash("3"),
  candidateFingerprint: hash("4"),
  type: "insight",
  title: "Synthetic candidate",
  summary: "Synthetic summary",
  body: "Synthetic body",
  status: "proposed",
  confidence: "high",
  sourceRefs: [
    {
      provider: source.provider,
      providerConversationId: "conversation-1",
      conversationFingerprint: source.conversationFingerprint,
      messageFingerprints: [...source.messageFingerprints],
    },
  ],
  suggestedLinks: [],
  suggestedTags: ["synthetic"],
};
const secondCandidate: PreviewCandidate = {
  ...candidate,
  id: hash("5"),
  candidateFingerprint: hash("6"),
  sourceRefs: [
    {
      provider: "chatgpt",
      providerConversationId: "conversation-2",
      conversationFingerprint: hash("7"),
      messageFingerprints: [hash("8")],
    },
  ],
};
const initial: KnowledgeControllerCurrent = {
  loaded: true,
  lifecycleGeneration: 1,
  importGeneration: 1,
  selectionGeneration: 1,
  distillationGeneration: 1,
  sourceSettingsGeneration: 1,
  knowledgeSettingsGeneration: 1,
  sourceRootPending: false,
  knowledgeRootPending: false,
  sourceRoot: "Sources",
  knowledgeRoot: "Knowledge",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness(extraCandidate?: PreviewCandidate) {
  let current = { ...initial };
  let catalog: KnowledgeCatalogReadResult = {
    status: "ready",
    notes: [],
    resolvedSources: [source],
    fingerprint: "catalog-1",
  };
  let read = () => Promise.resolve(catalog);
  const execute = vi.fn(() =>
    Promise.resolve({
      status: "saved" as const,
      ledger: [],
      diagnostics: [],
    }),
  );
  const adapter: KnowledgeVaultAdapter = {
    resolveKnowledgeSources: (reviewed) =>
      Promise.resolve({
        ok: true,
        sources: reviewed.sourceRefs.map((reference) => ({
          ...reference,
          sourceNotePath:
            reviewed.id === secondCandidate.id
              ? "Sources/two.md"
              : source.sourceNotePath,
        })),
      }),
    observeKnowledgeTarget: () => Promise.resolve({ status: "absent" }),
    checkpointKnowledgeTarget: (path) =>
      Promise.resolve({
        status: "absent-safe",
        resolvedPath: path,
      }),
    createKnowledgeNote: () => Promise.resolve(),
    readKnowledgeNote: () => Promise.resolve(new Uint8Array()),
  };
  const base = new KnowledgeController({
    current: () => current,
    adapter,
    execute,
  });
  const gate = new KnowledgeDedupController(base, {
    readKnowledgeCatalog: () => read(),
  });
  expect(
    gate.installCandidates(
      extraCandidate === undefined ? [candidate] : [candidate, extraCandidate],
    ),
  ).toBe(true);
  for (const selected of extraCandidate === undefined
    ? [candidate]
    : [candidate, extraCandidate]) {
    expect(gate.decide(selected.id, "accepted")).toBe(true);
    expect(gate.select(selected.id, true)).toBe(true);
  }
  return {
    gate,
    base,
    execute,
    setCatalog: (next: KnowledgeCatalogReadResult) => {
      catalog = next;
    },
    setRead: (next: typeof read) => {
      read = next;
    },
    mutate: (patch: Partial<KnowledgeControllerCurrent>) => {
      current = { ...current, ...patch };
    },
  };
}
function existing(
  noteContentFingerprint: string,
  conversationFingerprint = hash("5"),
): CatalogKnowledgeNote {
  return {
    schemaVersion: 1,
    path: "Knowledge/existing-aaaaaaaaaaaa.md",
    type: "insight",
    title: "Synthetic candidate",
    payload:
      "# Synthetic candidate\n\n## Summary\n\nSynthetic summary\n\n## Knowledge\n\nSynthetic body",
    tags: ["knowledge", "synthetic"],
    candidateFingerprint: hash("a"),
    contentFingerprint: noteContentFingerprint,
    sourceNotes: [
      {
        provider: "chatgpt",
        conversationFingerprint,
        sourceNotePath: "Sources/one.md",
      },
    ],
  };
}
describe("M07 ordinary dedup gate", () => {
  it("blocks equal content in two selected candidates despite an empty catalog", async () => {
    const h = harness(secondCandidate);
    expect((await h.gate.previewOrdinary()).status).toBe("blocked");
    expect(h.gate.snapshot.canWrite).toBe(false);
    expect(h.gate.snapshot.diagnostics[0]?.code).toBe("M07_EXACT_DUPLICATE");
    expect(h.gate.snapshot.diagnostics[0]?.message).toContain(candidate.id);
    expect(h.gate.snapshot.diagnostics[0]?.message).toContain(
      secondCandidate.id,
    );
    expect(await h.gate.writeOrdinary()).toMatchObject({ status: "stale" });
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("blocks an exact duplicate across sources and identifies the candidate to deselect", async () => {
    const h = harness();
    await h.gate.previewOrdinary();
    const content = h.gate.snapshot.matches[0]?.contentFingerprint;
    expect(content).toBeDefined();
    h.setCatalog({
      status: "ready",
      notes: [existing(content ?? "", hash("9"))],
      resolvedSources: [source],
      fingerprint: "catalog-2",
    });
    expect((await h.gate.previewOrdinary()).status).toBe("blocked");
    expect(h.gate.snapshot.matches[0]?.result.exact).toHaveLength(1);
    expect(h.gate.snapshot.canWrite).toBe(false);
    expect(h.gate.snapshot.diagnostics[0]?.message).toContain(candidate.id);
    expect(await h.gate.writeOrdinary()).toMatchObject({ status: "stale" });
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("warns for same-source and related notes without blocking", async () => {
    const h = harness();
    h.setCatalog({
      status: "ready",
      notes: [existing(hash("8"), source.conversationFingerprint)],
      resolvedSources: [source],
      fingerprint: "catalog-2",
    });
    expect((await h.gate.previewOrdinary()).status).toBe("planned");
    expect(h.gate.snapshot.matches[0]?.result.sameSource).toHaveLength(1);
    expect(h.gate.snapshot.canWrite).toBe(true);
  });
  it("shows a related suggestion without treating it as an exact duplicate", async () => {
    const h = harness();
    h.setCatalog({
      status: "ready",
      notes: [existing(hash("8"), hash("9"))],
      resolvedSources: [source],
      fingerprint: "catalog-related",
    });
    expect((await h.gate.previewOrdinary()).status).toBe("planned");
    expect(h.gate.snapshot.matches[0]?.result.related).toHaveLength(1);
    expect(h.gate.snapshot.matches[0]?.result.sameSource).toHaveLength(0);
    expect(h.gate.snapshot.canWrite).toBe(true);
  });
  it("closes on an incomplete catalog", async () => {
    const h = harness();
    h.setCatalog({ status: "blocked", code: "M07_CATALOG_INCOMPLETE" });
    expect((await h.gate.previewOrdinary()).status).toBe("blocked");
    expect(h.gate.snapshot.canWrite).toBe(false);
  });
  it("invalidates a candidate edit and settings generation change", async () => {
    const h = harness();
    await h.gate.previewOrdinary();
    expect(
      h.gate.edit(candidate.id, {
        title: "Changed",
        summary: candidate.summary,
        body: candidate.body,
        tags: ["synthetic"],
      }).ok,
    ).toBe(true);
    expect(h.gate.snapshot.canWrite).toBe(false);
    await h.gate.previewOrdinary();
    h.mutate({ knowledgeSettingsGeneration: 2 });
    expect(h.gate.snapshot.canWrite).toBe(false);
    expect(await h.gate.writeOrdinary()).toMatchObject({ status: "stale" });
  });
  it("rejects catalog changes while preflight is pending with zero creates", async () => {
    const h = harness();
    await h.gate.previewOrdinary();
    const pending = deferred<KnowledgeCatalogReadResult>();
    h.setRead(() => pending.promise);
    const writing = h.gate.writeOrdinary();
    expect((await h.gate.writeOrdinary()).status).toBe("write-in-progress");
    pending.resolve({
      status: "ready",
      notes: [],
      resolvedSources: [source],
      fingerprint: "catalog-changed",
    });
    expect((await writing).status).toBe("stale");
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("rejects candidate and source-setting changes during pending preflight", async () => {
    const h = harness();
    await h.gate.previewOrdinary();
    const pending = deferred<KnowledgeCatalogReadResult>();
    h.setRead(() => pending.promise);
    const writing = h.gate.writeOrdinary();
    h.mutate({ sourceSettingsGeneration: 2, sourceRoot: "OtherSources" });
    pending.resolve({
      status: "ready",
      notes: [],
      resolvedSources: [source],
      fingerprint: "catalog-1",
    });
    expect((await writing).status).toBe("stale");
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("consumes a current token before dispatching the M06 writer", async () => {
    const h = harness();
    await h.gate.previewOrdinary();
    expect((await h.gate.writeOrdinary()).status).toBe("saved");
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect((await h.gate.writeOrdinary()).status).toBe("stale");
  });
});

function combinedHarness() {
  const encoder = new TextEncoder();
  let current = { ...initial };
  const files = new Map<string, Uint8Array>();
  const creates: string[] = [];
  const reviewed = {
    ...createKnowledgeReview(candidate),
    decision: "accepted" as const,
  };
  const rendered = renderKnowledgeNote(reviewed, [source]);
  if (!rendered.ok) throw new Error("synthetic fixture failed");
  const selectedPath = `Knowledge/${rendered.filename}`;
  const selectedBytes = encoder.encode(rendered.noteContent);
  const parsed = parseKnowledgeCatalogNote(selectedPath, selectedBytes);
  if (parsed.status !== "eligible")
    throw new Error("synthetic fixture malformed");
  files.set(selectedPath, selectedBytes);
  files.set(source.sourceNotePath, encoder.encode("synthetic source bytes"));
  let catalog: KnowledgeCatalogReadResult = {
    status: "ready",
    notes: [parsed.note],
    resolvedSources: [source],
    fingerprint: "catalog-1",
  };
  let createFailure = false;
  let readbackFailure = false;
  let createPending: ReturnType<typeof deferred<undefined>> | undefined;
  let resolvedSource = source;
  const adapter: KnowledgeVaultAdapter = {
    resolveKnowledgeSources: async () => ({
      ok: true,
      sources: [resolvedSource],
    }),
    observeKnowledgeTarget: async (path) => {
      const bytes = files.get(path);
      return bytes === undefined
        ? { status: "absent" }
        : { status: "regular-file", bytes: new Uint8Array(bytes) };
    },
    checkpointKnowledgeTarget: async (path) =>
      files.has(path)
        ? { status: "changed" }
        : { status: "absent-safe", resolvedPath: path },
    createKnowledgeNote: async (path, content) => {
      if (createFailure) throw new Error("synthetic failure");
      await createPending?.promise;
      creates.push(path);
      files.set(path, encoder.encode(content));
    },
    readKnowledgeNote: async (path) => {
      if (readbackFailure && path !== selectedPath)
        throw new Error("synthetic failure");
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error("not found");
      return new Uint8Array(bytes);
    },
  };
  const base = new KnowledgeController({ current: () => current, adapter });
  const gate = new KnowledgeDedupController(
    base,
    { readKnowledgeCatalog: async () => catalog },
    { current: () => current, adapter },
  );
  expect(gate.installCandidates([candidate])).toBe(true);
  expect(gate.decide(candidate.id, "accepted")).toBe(true);
  const draft = {
    title: "Combined synthetic insight",
    summary: "Combined summary",
    body: "Combined body retaining useful context",
    tags: ["synthetic"],
  };
  const originals = new Map(
    [selectedPath, source.sourceNotePath].map((path) => [
      path,
      files.get(path),
    ]),
  );
  return {
    gate,
    base,
    adapter,
    files,
    creates,
    selectedPath,
    selectedDigest: sha256(selectedBytes),
    draft,
    originals,
    setCatalog: (next: KnowledgeCatalogReadResult) => {
      catalog = next;
    },
    mutate: (patch: Partial<KnowledgeControllerCurrent>) => {
      current = { ...current, ...patch };
    },
    failCreate: () => {
      createFailure = true;
    },
    failReadback: () => {
      readbackFailure = true;
    },
    pauseCreate: () => {
      createPending = deferred<undefined>();
      return createPending;
    },
    changeCandidateSource: () => {
      resolvedSource = { ...source, sourceNotePath: "Sources/changed.md" };
    },
    addCatalogNote: (bytes: Uint8Array, path: string) => {
      const parsed = parseKnowledgeCatalogNote(path, bytes);
      if (parsed.status !== "eligible" || catalog.status !== "ready")
        throw new Error("invalid catalog fixture");
      catalog = {
        ...catalog,
        notes: [...catalog.notes, parsed.note],
        fingerprint: "catalog-with-target",
      };
    },
    changeSelectedNote: () => {
      const bytes = encoder.encode(
        new TextDecoder()
          .decode(selectedBytes)
          .replace("Synthetic body", "A newer valid existing-note revision"),
      );
      const next = parseKnowledgeCatalogNote(selectedPath, bytes);
      if (next.status !== "eligible")
        throw new Error("changed fixture malformed");
      files.set(selectedPath, bytes);
      catalog = {
        status: "ready",
        notes: [next.note],
        resolvedSources: [source],
        fingerprint: "catalog-changed-selected",
      };
    },
  };
}

function expectOriginalsUnchanged(h: ReturnType<typeof combinedHarness>) {
  for (const [path, bytes] of h.originals)
    expect(h.files.get(path)).toEqual(bytes);
}

describe("M07 combined create gate", () => {
  it("rejects a valid selected-note revision newer than the displayed confirmation", async () => {
    const h = combinedHarness();
    h.changeSelectedNote();
    expect(
      await h.gate.previewCombined(
        candidate.id,
        h.selectedPath,
        h.draft,
        h.selectedDigest,
      ),
    ).toMatchObject({
      status: "stale",
      diagnostics: [{ code: "M07_SELECTED_CHANGED" }],
    });
    expect((await h.gate.createCombined()).status).toBe("stale");
    expect(h.creates).toHaveLength(0);
  });
  it("creates one v2 note through the create-only writer and preserves inputs", async () => {
    const h = combinedHarness();
    const preview = await h.gate.previewCombined(
      candidate.id,
      h.selectedPath,
      h.draft,
      h.selectedDigest,
    );
    expect(preview.status).toBe("ready");
    const result = await h.gate.createCombined();
    expect(result.status).toBe("saved");
    expect(result.ledger).toMatchObject([{ status: "created" }]);
    expect(h.creates).toHaveLength(1);
    expectOriginalsUnchanged(h);
  });
  it("reports an exact byte-identical target as no-op", async () => {
    const h = combinedHarness();
    const preview = await h.gate.previewCombined(
      candidate.id,
      h.selectedPath,
      h.draft,
      h.selectedDigest,
    );
    if (preview.status !== "ready") throw new Error("preview failed");
    const targetBytes = new TextEncoder().encode(preview.entry.noteContent);
    h.files.set(preview.entry.targetPath, targetBytes);
    h.addCatalogNote(targetBytes, preview.entry.targetPath);
    const repeat = await h.gate.previewCombined(
      candidate.id,
      h.selectedPath,
      h.draft,
      h.selectedDigest,
    );
    expect(repeat.status).toBe("ready");
    const result = await h.gate.createCombined();
    expect(result).toMatchObject({
      status: "saved",
      ledger: [{ status: "identical-no-op" }],
    });
    expect(h.creates).toHaveLength(0);
    expectOriginalsUnchanged(h);
  });
  it("rejects changed candidate source resolution before create", async () => {
    const h = combinedHarness();
    expect(
      (
        await h.gate.previewCombined(
          candidate.id,
          h.selectedPath,
          h.draft,
          h.selectedDigest,
        )
      ).status,
    ).toBe("ready");
    h.changeCandidateSource();
    expect((await h.gate.createCombined()).status).toBe("stale");
    expect(h.creates).toHaveLength(0);
    expectOriginalsUnchanged(h);
  });
  it.each(["selected bytes", "catalog", "source registry", "settings"])(
    "rejects changed %s before create",
    async (change) => {
      const h = combinedHarness();
      const preview = await h.gate.previewCombined(
        candidate.id,
        h.selectedPath,
        h.draft,
        h.selectedDigest,
      );
      expect(preview.status).toBe("ready");
      if (change === "selected bytes")
        h.files.set(h.selectedPath, new TextEncoder().encode("changed"));
      if (change === "catalog")
        h.setCatalog({
          status: "ready",
          notes: [],
          resolvedSources: [source],
          fingerprint: "catalog-2",
        });
      if (change === "source registry")
        h.setCatalog({
          status: "ready",
          notes: [],
          resolvedSources: [],
          fingerprint: "catalog-2",
        });
      if (change === "settings") h.mutate({ knowledgeSettingsGeneration: 2 });
      expect((await h.gate.createCombined()).status).toBe("stale");
      expect(h.creates).toHaveLength(0);
      if (change !== "selected bytes") expectOriginalsUnchanged(h);
      else
        expect(h.files.get(source.sourceNotePath)).toEqual(
          h.originals.get(source.sourceNotePath),
        );
    },
  );
  it("conflicts on a different-byte target without touching inputs", async () => {
    const h = combinedHarness();
    const preview = await h.gate.previewCombined(
      candidate.id,
      h.selectedPath,
      h.draft,
      h.selectedDigest,
    );
    if (preview.status !== "ready") throw new Error("preview failed");
    h.files.set(
      preview.entry.targetPath,
      new TextEncoder().encode("obstruction"),
    );
    expect((await h.gate.createCombined()).status).toBe("conflict");
    expect(h.creates).toHaveLength(0);
    expectOriginalsUnchanged(h);
  });
  it.each(["create", "readback"])(
    "preserves ledger after %s failure",
    async (failure) => {
      const h = combinedHarness();
      expect(
        (
          await h.gate.previewCombined(
            candidate.id,
            h.selectedPath,
            h.draft,
            h.selectedDigest,
          )
        ).status,
      ).toBe("ready");
      if (failure === "create") h.failCreate();
      else h.failReadback();
      const result = await h.gate.createCombined();
      expect(result.status).toBe("failed");
      expect(result.ledger).toMatchObject([
        {
          status:
            failure === "create" ? "create-failed" : "verification-failed",
        },
      ]);
      expectOriginalsUnchanged(h);
    },
  );
  it("consumes the plan before a second create click", async () => {
    const h = combinedHarness();
    expect(
      (
        await h.gate.previewCombined(
          candidate.id,
          h.selectedPath,
          h.draft,
          h.selectedDigest,
        )
      ).status,
    ).toBe("ready");
    const pause = h.pauseCreate();
    const first = h.gate.createCombined();
    expect((await h.gate.createCombined()).status).toBe("write-in-progress");
    pause.resolve(undefined);
    expect((await first).status).toBe("saved");
    expect((await h.gate.createCombined()).status).toBe("stale");
    expect(h.creates).toHaveLength(1);
    expectOriginalsUnchanged(h);
  });
});
