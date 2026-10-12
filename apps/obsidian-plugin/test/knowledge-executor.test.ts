/* eslint-disable @typescript-eslint/require-await -- synthetic async boundaries model vault I/O. */
import { describe, expect, it } from "vitest";

import type {
  ReadyKnowledgeWritePlan,
  ResolvedKnowledgeSource,
  ReviewedKnowledgeCandidate,
} from "@chat2vault/core";
import {
  executeKnowledgeWrite,
  type ExecutableKnowledgeWritePlan,
} from "../src/knowledge-executor.js";
import type {
  KnowledgeTargetCheckpoint,
  KnowledgeVaultAdapter,
} from "../src/knowledge-vault-adapter.js";

const encoder = new TextEncoder();
const conversationFingerprint = `sha256:${"a".repeat(64)}`;
const candidateFingerprint = `sha256:${"b".repeat(64)}`;

function candidate(id: string): ReviewedKnowledgeCandidate {
  return {
    id,
    originalCandidateFingerprint: candidateFingerprint,
    type: "insight",
    confidence: "high",
    sourceRefs: [
      {
        provider: "chatgpt",
        providerConversationId: "synthetic-conversation",
        conversationFingerprint,
        messageFingerprints: [],
      },
    ],
    title: `Synthetic ${id}`,
    summary: "Synthetic summary",
    body: "Synthetic body",
    tags: [],
    decision: "accepted",
    selected: true,
  };
}

function source(path = "Sources/source.md"): ResolvedKnowledgeSource {
  return {
    provider: "chatgpt",
    providerConversationId: "synthetic-conversation",
    conversationFingerprint,
    messageFingerprints: [],
    sourceNotePath: path,
  };
}

function plan(count = 3): ExecutableKnowledgeWritePlan {
  const entries = Array.from({ length: count }, (_, index) => ({
    candidateId: `candidate-${String(index + 1)}`,
    candidateFingerprint: `${candidateFingerprint.slice(0, -1)}${String(index)}`,
    targetPath: `Knowledge/note-${String(index + 1)}.md`,
    noteContent: `note ${String(index + 1)}\n`,
    noteContentFingerprint: `sha256:${String(index + 1).repeat(64)}`,
    action: "create" as const,
  }));
  const corePlan: ReadyKnowledgeWritePlan = {
    status: "ready",
    sourceRoot: "Sources",
    knowledgeRoot: "Knowledge",
    entries,
    planFingerprint: `sha256:${"f".repeat(64)}`,
    diagnostics: [],
  };
  return {
    ...corePlan,
    sourceAuthorities: entries.map((entry) => ({
      candidate: candidate(entry.candidateId),
      sources: [source()],
    })),
  };
}

function adapterHarness() {
  const bytes = new Map<string, Uint8Array>();
  const created: string[] = [];
  let failCreate: string | undefined;
  let checkpoint: KnowledgeTargetCheckpoint | undefined;
  let afterCreate: (() => void) | undefined;
  const adapter: KnowledgeVaultAdapter = {
    resolveKnowledgeSources: async () => ({ ok: true, sources: [source()] }),
    observeKnowledgeTarget: async (path) => {
      const existing = bytes.get(path);
      return existing === undefined
        ? { status: "absent" }
        : { status: "regular-file", bytes: new Uint8Array(existing) };
    },
    checkpointKnowledgeTarget: async (path) =>
      checkpoint ?? { status: "absent-safe", resolvedPath: path },
    createKnowledgeNote: async (resolvedPath, content) => {
      if (resolvedPath === failCreate) throw new Error("untrusted create text");
      created.push(resolvedPath);
      bytes.set(resolvedPath, encoder.encode(content));
      afterCreate?.();
    },
    readKnowledgeNote: async (path) => {
      const existing = bytes.get(path);
      if (existing === undefined) throw new Error("untrusted read text");
      return new Uint8Array(existing);
    },
  };
  return {
    adapter,
    bytes,
    created,
    setFailCreate: (path: string | undefined) => {
      failCreate = path;
    },
    setCheckpoint: (value: KnowledgeTargetCheckpoint | undefined) => {
      checkpoint = value;
    },
    setAfterCreate: (value: (() => void) | undefined) => {
      afterCreate = value;
    },
  };
}

describe("M06 knowledge batch executor", () => {
  it("preflights every target and refuses the whole batch on conflict", async () => {
    const fixture = adapterHarness();
    fixture.bytes.set("Knowledge/note-2.md", encoder.encode("different\n"));

    const result = await executeKnowledgeWrite(
      plan(2),
      () => true,
      fixture.adapter,
    );

    expect(result.status).toBe("conflict");
    expect(result.ledger.map((entry) => entry.status)).toEqual([
      "not-attempted",
      "conflict",
    ]);
    expect(fixture.created).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "KNOWLEDGE_TARGET_CONFLICT",
    ]);
  });

  it("retains verified creates after failure and retries prior bytes as exact no-ops", async () => {
    const fixture = adapterHarness();
    const frozen = plan();
    fixture.setFailCreate("Knowledge/note-2.md");

    const first = await executeKnowledgeWrite(
      frozen,
      () => true,
      fixture.adapter,
    );
    expect(first.status).toBe("partial");
    expect(first.ledger.map((entry) => entry.status)).toEqual([
      "created",
      "create-failed",
      "not-attempted",
    ]);

    fixture.setFailCreate(undefined);
    const retry = await executeKnowledgeWrite(
      frozen,
      () => true,
      fixture.adapter,
    );
    expect(retry.status).toBe("saved");
    expect(retry.ledger.map((entry) => entry.status)).toEqual([
      "identical-no-op",
      "created",
      "created",
    ]);
  });

  it("re-resolves every frozen source authority before observing or creating targets", async () => {
    const fixture = adapterHarness();
    let observed = 0;
    fixture.adapter.resolveKnowledgeSources = async () => ({
      ok: true,
      sources: [source("Sources/replaced.md")],
    });
    fixture.adapter.observeKnowledgeTarget = async () => {
      observed += 1;
      return { status: "absent" };
    };

    const result = await executeKnowledgeWrite(
      plan(2),
      () => true,
      fixture.adapter,
    );

    expect(result.status).toBe("stale");
    expect(result.ledger.map((entry) => entry.status)).toEqual([
      "stale",
      "stale",
    ]);
    expect(observed).toBe(0);
    expect(fixture.created).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("replaced.md");
  });

  it("finishes the complete source preflight before refusing a stale authority", async () => {
    const fixture = adapterHarness();
    let resolutions = 0;
    fixture.adapter.resolveKnowledgeSources = async () => {
      resolutions += 1;
      return {
        ok: true,
        sources: [
          source(
            resolutions === 1 ? "Sources/replaced.md" : "Sources/source.md",
          ),
        ],
      };
    };

    const result = await executeKnowledgeWrite(
      plan(2),
      () => true,
      fixture.adapter,
    );

    expect(result.status).toBe("stale");
    expect(resolutions).toBe(2);
    expect(fixture.created).toEqual([]);
  });

  it("checks current at await boundaries but still reads back a post-create stale target", async () => {
    const fixture = adapterHarness();
    let current = true;
    let reads = 0;
    fixture.setAfterCreate(() => {
      current = false;
    });
    const read = fixture.adapter.readKnowledgeNote.bind(fixture.adapter);
    fixture.adapter.readKnowledgeNote = async (path) => {
      reads += 1;
      return read(path);
    };

    const result = await executeKnowledgeWrite(
      plan(2),
      () => current,
      fixture.adapter,
    );

    expect(result.status).toBe("stale");
    expect(result.ledger.map((entry) => entry.status)).toEqual([
      "created",
      "not-attempted",
    ]);
    expect(reads).toBe(1);
  });

  it("reports a verified create truthfully when staleness is observed after readback", async () => {
    const fixture = adapterHarness();
    let current = true;
    const read = fixture.adapter.readKnowledgeNote.bind(fixture.adapter);
    fixture.adapter.readKnowledgeNote = async (path) => {
      const result = await read(path);
      current = false;
      return result;
    };

    const result = await executeKnowledgeWrite(
      plan(2),
      () => current,
      fixture.adapter,
    );

    expect(result.status).toBe("stale");
    expect(result.ledger.map(({ status }) => status)).toEqual([
      "created",
      "not-attempted",
    ]);
  });

  it("keeps mixed exact no-ops and creates in deterministic plan order", async () => {
    const fixture = adapterHarness();
    const frozen = plan(3);
    const existing = frozen.entries[1];
    if (existing === undefined) throw new Error("invalid synthetic plan");
    fixture.bytes.set(
      existing.targetPath,
      encoder.encode(existing.noteContent),
    );

    const result = await executeKnowledgeWrite(
      frozen,
      () => true,
      fixture.adapter,
    );

    expect(result.status).toBe("saved");
    expect(result.ledger.map(({ status }) => status)).toEqual([
      "created",
      "identical-no-op",
      "created",
    ]);
    expect(fixture.created).toEqual([
      "Knowledge/note-1.md",
      "Knowledge/note-3.md",
    ]);
  });

  it("returns exact no-ops for an unchanged all-existing batch", async () => {
    const fixture = adapterHarness();
    const frozen = plan(3);
    for (const entry of frozen.entries)
      fixture.bytes.set(entry.targetPath, encoder.encode(entry.noteContent));
    let checkpoints = 0;
    fixture.adapter.checkpointKnowledgeTarget = async () => {
      checkpoints += 1;
      return { status: "unsafe" };
    };

    const result = await executeKnowledgeWrite(
      frozen,
      () => true,
      fixture.adapter,
    );

    expect(result.status).toBe("saved");
    expect(result.ledger.map(({ status }) => status)).toEqual([
      "identical-no-op",
      "identical-no-op",
      "identical-no-op",
    ]);
    expect(checkpoints).toBe(0);
    expect(fixture.created).toEqual([]);
  });

  it.each(["throw", "byte-mismatch"] as const)(
    "retains a %s verification failure and retries the unchanged bytes as a no-op",
    async (failure) => {
      const fixture = adapterHarness();
      const read = fixture.adapter.readKnowledgeNote.bind(fixture.adapter);
      fixture.adapter.readKnowledgeNote = async (path) => {
        if (failure === "throw") throw new Error("untrusted read detail");
        await read(path);
        return encoder.encode("different bytes");
      };

      const first = await executeKnowledgeWrite(
        plan(1),
        () => true,
        fixture.adapter,
      );
      expect(first).toMatchObject({
        status: "failed",
        ledger: [{ status: "verification-failed" }],
        diagnostics: [{ code: "KNOWLEDGE_VERIFICATION_FAILED" }],
      });

      fixture.adapter.readKnowledgeNote = read;
      const retry = await executeKnowledgeWrite(
        plan(1),
        () => true,
        fixture.adapter,
      );
      expect(retry).toMatchObject({
        status: "saved",
        ledger: [{ status: "identical-no-op" }],
      });
    },
  );

  it.each(["throw", "unsafe"] as const)(
    "stops at a %s checkpoint after retaining an earlier verified create",
    async (failure) => {
      const fixture = adapterHarness();
      fixture.adapter.checkpointKnowledgeTarget = async (path) => {
        if (path === "Knowledge/note-2.md") {
          if (failure === "throw") throw new Error("untrusted checkpoint");
          return { status: "unsafe" };
        }
        return { status: "absent-safe", resolvedPath: path };
      };

      const result = await executeKnowledgeWrite(
        plan(3),
        () => true,
        fixture.adapter,
      );

      expect(result.status).toBe("partial");
      expect(result.ledger.map(({ status }) => status)).toEqual([
        "created",
        "conflict",
        "not-attempted",
      ]);
      expect(fixture.created).toEqual(["Knowledge/note-1.md"]);
    },
  );

  it.each([
    ["source", "stale", "stale"],
    ["observation", "conflict", "conflict"],
    ["checkpoint", "conflict", "conflict"],
    ["create", "failed", "create-failed"],
    ["readback", "failed", "verification-failed"],
  ] as const)(
    "closes a thrown %s boundary without exposing service content",
    async (stage, expectedStatus, expectedLedger) => {
      const fixture = adapterHarness();
      if (stage === "source")
        fixture.adapter.resolveKnowledgeSources = async () => {
          throw new Error("private source content");
        };
      if (stage === "observation")
        fixture.adapter.observeKnowledgeTarget = async () => {
          throw new Error("private observation content");
        };
      if (stage === "checkpoint")
        fixture.adapter.checkpointKnowledgeTarget = async () => {
          throw new Error("private checkpoint content");
        };
      if (stage === "create")
        fixture.adapter.createKnowledgeNote = async () => {
          throw new Error("private create content");
        };
      if (stage === "readback")
        fixture.adapter.readKnowledgeNote = async () => {
          throw new Error("private readback content");
        };

      const result = await executeKnowledgeWrite(
        plan(1),
        () => true,
        fixture.adapter,
      );

      expect(result.status).toBe(expectedStatus);
      expect(result.ledger[0]?.status).toBe(expectedLedger);
      expect(JSON.stringify(result)).not.toContain("private");
    },
  );

  it.each([
    "source",
    "observation",
    "checkpoint",
    "create",
    "readback",
  ] as const)("fences staleness after the %s await boundary", async (stage) => {
    const fixture = adapterHarness();
    let current = true;
    const resolve = fixture.adapter.resolveKnowledgeSources.bind(
      fixture.adapter,
    );
    const observe = fixture.adapter.observeKnowledgeTarget.bind(
      fixture.adapter,
    );
    const checkpoint = fixture.adapter.checkpointKnowledgeTarget.bind(
      fixture.adapter,
    );
    const create = fixture.adapter.createKnowledgeNote.bind(fixture.adapter);
    const read = fixture.adapter.readKnowledgeNote.bind(fixture.adapter);
    if (stage === "source")
      fixture.adapter.resolveKnowledgeSources = async (candidate) => {
        const result = await resolve(candidate);
        current = false;
        return result;
      };
    if (stage === "observation")
      fixture.adapter.observeKnowledgeTarget = async (path) => {
        const result = await observe(path);
        current = false;
        return result;
      };
    if (stage === "checkpoint")
      fixture.adapter.checkpointKnowledgeTarget = async (path) => {
        const result = await checkpoint(path);
        current = false;
        return result;
      };
    if (stage === "create")
      fixture.adapter.createKnowledgeNote = async (path, content) => {
        await create(path, content);
        current = false;
      };
    if (stage === "readback")
      fixture.adapter.readKnowledgeNote = async (path) => {
        const result = await read(path);
        current = false;
        return result;
      };

    const result = await executeKnowledgeWrite(
      plan(1),
      () => current,
      fixture.adapter,
    );

    expect(result.status).toBe("stale");
    expect(result.ledger[0]?.status).toBe(
      stage === "create" || stage === "readback" ? "created" : "stale",
    );
  });

  it("fails closed when a target appears at checkpoint without mutating", async () => {
    const fixture = adapterHarness();
    fixture.setCheckpoint({ status: "changed" });

    const result = await executeKnowledgeWrite(
      plan(2),
      () => true,
      fixture.adapter,
    );

    expect(result.status).toBe("conflict");
    expect(result.ledger.map((entry) => entry.status)).toEqual([
      "conflict",
      "not-attempted",
    ]);
    expect(fixture.created).toEqual([]);
  });

  it("returns content-free diagnostics for thrown untrusted services", async () => {
    const fixture = adapterHarness();
    fixture.adapter.observeKnowledgeTarget = async () => {
      throw new Error("private candidate body");
    };

    const result = await executeKnowledgeWrite(
      plan(1),
      () => true,
      fixture.adapter,
    );

    expect(result.status).toBe("conflict");
    expect(result.ledger[0]?.status).toBe("conflict");
    expect(JSON.stringify(result)).not.toContain("private candidate body");
  });
});
