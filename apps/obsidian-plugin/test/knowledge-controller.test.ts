/* eslint-disable @typescript-eslint/require-await -- synthetic async boundaries model vault I/O. */
import { describe, expect, it } from "vitest";

import type {
  KnowledgeWritePlan,
  PreviewCandidate,
  ResolvedKnowledgeSource,
} from "@chat2vault/core";
import {
  KnowledgeController,
  type KnowledgeControllerCurrent,
  type KnowledgeControllerServices,
} from "../src/knowledge-controller.js";
import type {
  KnowledgeSourceResolution,
  KnowledgeVaultAdapter,
} from "../src/knowledge-vault-adapter.js";
import type { KnowledgeWriteExecutionResult } from "../src/knowledge-executor.js";

const conversationFingerprint = `sha256:${"1".repeat(64)}`;
const messageFingerprint = `sha256:${"2".repeat(64)}`;
const candidateId = `sha256:${"4".repeat(64)}`;

function previewCandidate(id = candidateId): PreviewCandidate {
  return {
    id,
    candidateFingerprint: `sha256:${"3".repeat(64)}`,
    type: "insight",
    title: "Synthetic candidate",
    summary: "Synthetic summary",
    body: "Synthetic body",
    status: "proposed",
    confidence: "high",
    sourceRefs: [
      {
        provider: "chatgpt",
        providerConversationId: "synthetic-conversation",
        conversationFingerprint,
        messageFingerprints: [messageFingerprint],
      },
    ],
    suggestedLinks: [],
    suggestedTags: ["synthetic"],
  };
}

function source(): ResolvedKnowledgeSource {
  return {
    provider: "chatgpt",
    providerConversationId: "synthetic-conversation",
    conversationFingerprint,
    messageFingerprints: [messageFingerprint],
    sourceNotePath: "Sources/source.md",
  };
}

function currentState(): KnowledgeControllerCurrent {
  return {
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
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(overrides: Partial<KnowledgeControllerServices> = {}) {
  let current = currentState();
  const bytes = new Map<string, Uint8Array>();
  const adapter: KnowledgeVaultAdapter = {
    resolveKnowledgeSources: async () => ({ ok: true, sources: [source()] }),
    observeKnowledgeTarget: async (path) => {
      const existing = bytes.get(path);
      return existing === undefined
        ? { status: "absent" }
        : { status: "regular-file", bytes: new Uint8Array(existing) };
    },
    checkpointKnowledgeTarget: async (path) => ({
      status: "absent-safe",
      resolvedPath: path,
    }),
    createKnowledgeNote: async (path, content) => {
      bytes.set(path, new TextEncoder().encode(content));
    },
    readKnowledgeNote: async (path) => {
      const result = bytes.get(path);
      if (result === undefined) throw new Error("missing");
      return new Uint8Array(result);
    },
  };
  const services: KnowledgeControllerServices = {
    current: () => current,
    adapter,
    ...overrides,
  };
  const controller = new KnowledgeController(services);
  return {
    adapter,
    bytes,
    controller,
    mutate: (patch: Partial<KnowledgeControllerCurrent>) => {
      current = { ...current, ...patch };
    },
  };
}

async function ready(controller: KnowledgeController): Promise<void> {
  expect(controller.installCandidates([previewCandidate()])).toBe(true);
  expect(controller.decide(candidateId, "accepted")).toBe(true);
  expect(controller.select(candidateId, true)).toBe(true);
  expect((await controller.preview()).status).toBe("planned");
  expect(controller.snapshot.status).toBe("ready");
}

describe("M06 KnowledgeController", () => {
  it("installs detached immutable reviews and never persists provider candidates", () => {
    const { controller } = harness();
    const input = previewCandidate();

    expect(controller.installCandidates([input])).toBe(true);
    input.suggestedTags[0] = "mutated";

    expect(controller.snapshot.candidates[0]?.tags).toEqual(["synthetic"]);
    expect(Object.isFrozen(controller.snapshot)).toBe(true);
    expect(Object.isFrozen(controller.snapshot.candidates)).toBe(true);
    expect(Object.isFrozen(controller.snapshot.candidates[0])).toBe(true);
  });

  it("invalidates an installed dry-run on every review or selection change", async () => {
    const { controller } = harness();
    await ready(controller);

    expect(controller.decide(candidateId, "rejected")).toBe(true);
    expect(controller.snapshot.plan).toBeUndefined();

    expect(controller.decide(candidateId, "accepted")).toBe(true);
    expect(controller.select(candidateId, true)).toBe(true);
    expect((await controller.preview()).status).toBe("planned");
    expect(
      controller.edit(candidateId, {
        title: "Edited title",
        summary: "Edited summary",
        body: "Edited body",
        tags: ["edited"],
      }).ok,
    ).toBe(true);
    expect(controller.snapshot.plan).toBeUndefined();

    expect(controller.select(candidateId, true)).toBe(true);
    expect((await controller.preview()).status).toBe("planned");
    expect(controller.select(candidateId, false)).toBe(true);
    expect(controller.snapshot.plan).toBeUndefined();

    expect(controller.selectAllEligible(true)).toBe(true);
    expect((await controller.preview()).status).toBe("planned");
    expect(controller.selectAllEligible(false)).toBe(true);
    expect(controller.snapshot.plan).toBeUndefined();
  });

  it("invalidates the plan when any captured generation or root changes", async () => {
    const fields: (keyof KnowledgeControllerCurrent)[] = [
      "loaded",
      "lifecycleGeneration",
      "importGeneration",
      "selectionGeneration",
      "distillationGeneration",
      "sourceSettingsGeneration",
      "knowledgeSettingsGeneration",
      "sourceRootPending",
      "knowledgeRootPending",
      "sourceRoot",
      "knowledgeRoot",
    ];
    for (const field of fields) {
      const { controller, mutate } = harness();
      await ready(controller);
      const value = currentState()[field];
      mutate({
        [field]:
          typeof value === "number"
            ? value + 1
            : typeof value === "boolean"
              ? !value
              : `${value}-changed`,
      });
      expect(controller.snapshot.plan, field).toBeUndefined();
    }
  });

  it.each(["success", "failure"] as const)(
    "refuses candidate installation throughout a pending source-root save and keeps it fenced after %s settlement",
    (settlement) => {
      const { controller, mutate } = harness();
      mutate({ sourceSettingsGeneration: 2, sourceRootPending: true });

      expect(controller.installCandidates([previewCandidate()])).toBe(false);
      expect(controller.snapshot).toMatchObject({
        status: "empty",
        candidates: [],
        plan: undefined,
      });

      mutate({
        sourceRootPending: false,
        sourceRoot: settlement === "success" ? "Other sources" : "Sources",
      });
      expect(controller.snapshot).toMatchObject({
        status: "empty",
        candidates: [],
        plan: undefined,
      });
    },
  );

  it.each(["success", "failure"] as const)(
    "discards candidates installed before source-save start across %s settlement",
    (settlement) => {
      const { controller, mutate } = harness();
      expect(controller.installCandidates([previewCandidate()])).toBe(true);

      mutate({ sourceSettingsGeneration: 2, sourceRootPending: true });
      expect(controller.snapshot.candidates).toEqual([]);

      mutate({
        sourceRootPending: false,
        sourceRoot: settlement === "success" ? "Other sources" : "Sources",
      });
      expect(controller.snapshot).toMatchObject({
        status: "empty",
        candidates: [],
        plan: undefined,
      });
    },
  );

  it("refuses preview while either relevant root save is pending", async () => {
    for (const pending of [
      "sourceRootPending",
      "knowledgeRootPending",
    ] as const) {
      const { controller, mutate } = harness();
      expect(controller.installCandidates([previewCandidate()])).toBe(true);
      expect(controller.decide(candidateId, "accepted")).toBe(true);
      expect(controller.select(candidateId, true)).toBe(true);
      mutate({ [pending]: true });

      expect(await controller.preview(), pending).toMatchObject({
        status: "stale",
        diagnostics: [{ code: "KNOWLEDGE_PLAN_STALE" }],
      });
      expect(controller.snapshot.plan).toBeUndefined();
    }
  });

  it("refuses execution of a plan made stale by source-save start", async () => {
    const { controller, mutate, bytes } = harness();
    await ready(controller);

    mutate({ sourceSettingsGeneration: 2, sourceRootPending: true });

    expect(await controller.write()).toMatchObject({
      status: "failed",
      diagnostics: [{ code: "KNOWLEDGE_PLAN_STALE" }],
    });
    expect(bytes.size).toBe(0);
    expect(controller.snapshot.plan).toBeUndefined();
  });

  it("uses binary preview arbitration and never installs a stale async settlement", async () => {
    const pending = deferred<KnowledgeSourceResolution>();
    const { controller, mutate } = harness({
      adapter: {
        ...harness().adapter,
        resolveKnowledgeSources: () => pending.promise,
      },
    });
    controller.installCandidates([previewCandidate()]);
    controller.decide(candidateId, "accepted");
    controller.select(candidateId, true);

    const first = controller.preview();
    expect((await controller.preview()).status).toBe("preview-in-progress");
    mutate({ selectionGeneration: 2 });
    pending.resolve({ ok: true, sources: [source()] });

    expect((await first).status).toBe("stale");
    expect(controller.snapshot.plan).toBeUndefined();
    expect(controller.snapshot.status).toBe("reviewing");
  });

  it.each([
    ["import", { importGeneration: 2 }],
    ["settings", { knowledgeSettingsGeneration: 2 }],
    ["unload", { loaded: false }],
  ] as const)(
    "fences a pending planner across mid-preview %s invalidation",
    async (_reason, patch) => {
      const pending = deferred<KnowledgeWritePlan>();
      const { controller, mutate } = harness({
        planner: () => pending.promise,
      });
      controller.installCandidates([previewCandidate()]);
      controller.decide(candidateId, "accepted");
      controller.select(candidateId, true);

      const preview = controller.preview();
      mutate(patch);
      pending.resolve({
        status: "blocked",
        sourceRoot: "Sources",
        knowledgeRoot: "Knowledge",
        entries: [],
        planFingerprint: `sha256:${"6".repeat(64)}`,
        diagnostics: [],
      });

      expect((await preview).status).toBe("stale");
      expect(controller.snapshot.plan).toBeUndefined();
    },
  );

  it("keeps a newly installed candidate set when an older preview settles late", async () => {
    const pending = deferred<KnowledgeSourceResolution>();
    const base = harness();
    const { controller } = harness({
      adapter: {
        ...base.adapter,
        resolveKnowledgeSources: () => pending.promise,
      },
    });
    controller.installCandidates([previewCandidate()]);
    controller.decide(candidateId, "accepted");
    controller.select(candidateId, true);

    const oldPreview = controller.preview();
    const replacementId = `sha256:${"5".repeat(64)}`;
    expect(
      controller.installCandidates([previewCandidate(replacementId)]),
    ).toBe(true);
    pending.resolve({ ok: true, sources: [source()] });

    expect((await oldPreview).status).toBe("stale");
    expect(controller.snapshot).toMatchObject({
      status: "reviewing",
      candidates: [{ id: replacementId }],
      plan: undefined,
    });
  });

  it("never enables write for a blocked dry-run", async () => {
    const { controller } = harness();
    controller.installCandidates([previewCandidate()]);

    expect(await controller.preview()).toMatchObject({
      status: "planned",
      plan: { status: "blocked" },
    });
    expect(await controller.write()).toMatchObject({
      status: "failed",
      diagnostics: [{ code: "KNOWLEDGE_PLAN_STALE" }],
    });
  });

  it("arbitrates preview against write in both directions without queueing", async () => {
    const sourcePending = deferred<KnowledgeSourceResolution>();
    const base = harness();
    const previewFixture = harness({
      adapter: {
        ...base.adapter,
        resolveKnowledgeSources: () => sourcePending.promise,
      },
    });
    previewFixture.controller.installCandidates([previewCandidate()]);
    previewFixture.controller.decide(candidateId, "accepted");
    previewFixture.controller.select(candidateId, true);
    const preview = previewFixture.controller.preview();
    expect(await previewFixture.controller.write()).toMatchObject({
      diagnostics: [{ code: "KNOWLEDGE_PREVIEW_IN_PROGRESS" }],
    });
    sourcePending.resolve({ ok: true, sources: [source()] });
    await preview;

    const writePending = deferred<KnowledgeWriteExecutionResult>();
    const writeFixture = harness({ execute: () => writePending.promise });
    await ready(writeFixture.controller);
    const write = writeFixture.controller.write();
    expect(await writeFixture.controller.preview()).toMatchObject({
      status: "write-in-progress",
      diagnostics: [{ code: "KNOWLEDGE_WRITE_IN_PROGRESS" }],
    });
    writePending.resolve({ status: "saved", ledger: [], diagnostics: [] });
    await write;
  });

  it("installs only a current ready dry-run and freezes source authority", async () => {
    const { controller } = harness();
    await ready(controller);

    expect(controller.snapshot.plan).toMatchObject({
      status: "ready",
      sourceAuthorities: [
        {
          candidate: { id: candidateId },
          sources: [{ sourceNotePath: "Sources/source.md" }],
        },
      ],
    });
    expect(Object.isFrozen(controller.snapshot.plan)).toBe(true);
  });

  it("consumes the ready plan synchronously, rejects duplicate writes, and never reinstalls it", async () => {
    const pending = deferred<KnowledgeWriteExecutionResult>();
    const { controller } = harness({ execute: () => pending.promise });
    await ready(controller);

    const first = controller.write();
    expect(controller.snapshot.plan).toBeUndefined();
    expect(controller.snapshot.status).toBe("writing");
    expect(await controller.write()).toMatchObject({
      status: "failed",
      diagnostics: [{ code: "KNOWLEDGE_WRITE_IN_PROGRESS" }],
    });
    pending.resolve({ status: "saved", ledger: [], diagnostics: [] });

    expect(await first).toMatchObject({ status: "saved" });
    expect(controller.snapshot.plan).toBeUndefined();
    expect(controller.snapshot.status).toBe("reviewing");
  });

  it("gives controller staleness precedence over an untrusted executor settlement", async () => {
    const fixture = harness({
      execute: async () => {
        fixture.mutate({ selectionGeneration: 2 });
        return {
          status: "saved",
          ledger: [{ targetPath: "Knowledge/synthetic.md", status: "created" }],
          diagnostics: [],
        };
      },
    });
    await ready(fixture.controller);

    expect(await fixture.controller.write()).toMatchObject({
      status: "stale",
      ledger: [{ status: "created" }],
      diagnostics: [{ code: "KNOWLEDGE_PLAN_STALE" }],
    });
  });

  it.each([
    "import",
    "settings",
    "unload",
    "invalidate",
    "replacement",
  ] as const)(
    "fences a pending write across mid-operation %s invalidation",
    async (reason) => {
      const pending = deferred<KnowledgeWriteExecutionResult>();
      const fixture = harness({ execute: () => pending.promise });
      await ready(fixture.controller);

      const write = fixture.controller.write();
      if (reason === "import") fixture.mutate({ importGeneration: 2 });
      if (reason === "settings")
        fixture.mutate({ knowledgeSettingsGeneration: 2 });
      if (reason === "unload") fixture.mutate({ loaded: false });
      if (reason === "invalidate") fixture.controller.invalidate();
      if (reason === "replacement")
        fixture.controller.installCandidates([
          previewCandidate(`sha256:${"7".repeat(64)}`),
        ]);
      pending.resolve({
        status: "saved",
        ledger: [{ targetPath: "Knowledge/synthetic.md", status: "created" }],
        diagnostics: [],
      });

      expect(await write).toMatchObject({
        status: "stale",
        ledger: [{ status: "created" }],
        diagnostics: [{ code: "KNOWLEDGE_PLAN_STALE" }],
      });
      expect(fixture.controller.snapshot.plan).toBeUndefined();
    },
  );

  it("fails closed on thrown current/source services without exposing content", async () => {
    const currentController = new KnowledgeController({
      current: () => {
        throw new Error("private current text");
      },
      adapter: harness().adapter,
    });
    expect(currentController.installCandidates([previewCandidate()])).toBe(
      false,
    );
    const proxyController = new KnowledgeController({
      current: () =>
        new Proxy(currentState(), {
          get: () => {
            throw new Error("private current property");
          },
        }),
      adapter: harness().adapter,
    });
    expect(() =>
      proxyController.installCandidates([previewCandidate()]),
    ).not.toThrow();
    expect(proxyController.installCandidates([previewCandidate()])).toBe(false);

    const { controller } = harness({
      adapter: {
        ...harness().adapter,
        resolveKnowledgeSources: async () => {
          throw new Error("private source text");
        },
      },
    });
    controller.installCandidates([previewCandidate()]);
    controller.decide(candidateId, "accepted");
    controller.select(candidateId, true);
    const result = await controller.preview();
    expect(result.status).toBe("stale");
    expect(JSON.stringify(result)).not.toContain("private source text");
  });

  it("fails closed when the pure planner throws without exposing content", async () => {
    const { controller } = harness({
      planner: () => {
        throw new Error("private planner text");
      },
    });
    controller.installCandidates([previewCandidate()]);
    controller.decide(candidateId, "accepted");
    controller.select(candidateId, true);

    const result = await controller.preview();
    expect(result).toMatchObject({
      status: "stale",
      diagnostics: [{ code: "KNOWLEDGE_PLAN_STALE" }],
    });
    expect(JSON.stringify(result)).not.toContain("private planner text");
  });
});
