/* eslint-disable @typescript-eslint/require-await -- synthetic async boundaries model Obsidian and native I/O. */
import { describe, expect, test } from "vitest";
import type { ReviewedKnowledgeCandidate } from "@chat2vault/core";
import type { NativeContainmentAdapter } from "../src/containment.js";
import {
  ObsidianKnowledgeVaultAdapter,
  type KnowledgeVaultAdapter,
} from "../src/knowledge-vault-adapter.js";
import type {
  SourceVaultIO,
  VaultPathEntry,
} from "../src/source-vault-adapter.js";

const conversationFingerprint = `sha256:${"b".repeat(64)}`;
const importFingerprint = `sha256:${"a".repeat(64)}`;
const messageFingerprint = `sha256:${"c".repeat(64)}`;

function sourceNote(
  fingerprint = conversationFingerprint,
  conversationId: string | null = "conversation-1",
): Uint8Array {
  return new TextEncoder().encode(
    [
      "---",
      "chat2vault_schema: 1",
      'type: "ai-conversation-source"',
      'source_provider: "chatgpt"',
      ...(conversationId === null
        ? []
        : [`source_conversation_id: ${JSON.stringify(conversationId)}`]),
      `source_content_fingerprint: ${JSON.stringify(fingerprint)}`,
      `source_import_fingerprint: ${JSON.stringify(importFingerprint)}`,
      "source_message_count: 1",
      'imported_at: "2026-09-15T00:00:00.000Z"',
      'knowledge_status: "source"',
      "---",
      "",
      "# Synthetic source",
      "",
    ].join("\n"),
  );
}

function reviewedCandidate(
  overrides: Partial<ReviewedKnowledgeCandidate> = {},
): ReviewedKnowledgeCandidate {
  return {
    id: "candidate-1",
    originalCandidateFingerprint: `sha256:${"d".repeat(64)}`,
    type: "insight",
    confidence: "high",
    sourceRefs: [
      {
        provider: "chatgpt",
        providerConversationId: "conversation-1",
        conversationFingerprint,
        messageFingerprints: [messageFingerprint],
      },
    ],
    title: "Synthetic knowledge",
    summary: "Synthetic summary",
    body: "Synthetic body",
    tags: ["synthetic"],
    decision: "accepted",
    selected: true,
    ...overrides,
  };
}

function harness() {
  const entries = new Map<string, VaultPathEntry>([
    ["Sources", { path: "Sources", kind: "folder" }],
    ["Knowledge", { path: "Knowledge", kind: "folder" }],
  ]);
  const bytes = new Map<string, Uint8Array>();
  const calls = { list: [] as string[], read: [] as string[], create: 0 };
  const children = (parent: string) =>
    [...entries.values()].filter((entry) => {
      const index = entry.path.lastIndexOf("/");
      return (index < 0 ? "" : entry.path.slice(0, index)) === parent;
    });
  const io: SourceVaultIO = {
    configDir: ".obsidian",
    basePath: "/vault",
    list: async (path) => {
      calls.list.push(path);
      return children(path);
    },
    lookup: async (path) => entries.get(path),
    readBinary: async (path) => {
      calls.read.push(path);
      const value = bytes.get(path);
      if (value === undefined) throw new Error("missing");
      return new Uint8Array(value);
    },
    createFolder: async () => {
      throw new Error("knowledge adapter must not create folders");
    },
    create: async (path, content) => {
      calls.create += 1;
      if (entries.has(path)) throw new Error("collision");
      entries.set(path, { path, kind: "file" });
      bytes.set(path, new TextEncoder().encode(content));
    },
  };
  const native: NativeContainmentAdapter = {
    platform: "darwin",
    separator: "/",
    aliasCapability: async () => ({
      kind: "available",
      capability: "macos-mount-point",
    }),
    lstat: async (path) => {
      if (path === "/vault")
        return { kind: "present", objectKind: "directory" };
      const relative = path.slice("/vault/".length);
      const entry = entries.get(relative);
      return entry === undefined
        ? { kind: "absent" }
        : {
            kind: "present",
            objectKind: entry.kind === "folder" ? "directory" : "regular-file",
          };
    },
    realpath: async (path) => ({ kind: "resolved", realPath: path }),
    observeWindowsReparsePoint: async () => ({ kind: "not-reparse-point" }),
    observeMacOSMountPoint: async () => ({ kind: "not-mount-point" }),
  };
  const adapter = () =>
    new ObsidianKnowledgeVaultAdapter(
      io,
      native,
      () => "Sources",
      () => "Knowledge",
      "darwin",
      "x64",
    );
  const addSource = (path = "Sources/source.md", content = sourceNote()) => {
    entries.set(path, { path, kind: "file" });
    bytes.set(path, content);
  };
  return { adapter, io, native, entries, bytes, calls, addSource };
}

describe("M06 knowledge vault adapter", () => {
  test("exposes only the approved five-capability surface", () => {
    const fixture = harness();
    const adapter: KnowledgeVaultAdapter = fixture.adapter();
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(adapter))
        .filter((name) => name !== "constructor")
        .sort(),
    ).toEqual([
      "checkpointKnowledgeTarget",
      "createKnowledgeNote",
      "observeKnowledgeTarget",
      "readKnowledgeNote",
      "resolveKnowledgeSources",
    ]);
    expect(Reflect.ownKeys(adapter)).toEqual([]);
  });

  test("resolves one exact direct-child registry entry and preserves candidate message fingerprints", async () => {
    const fixture = harness();
    fixture.addSource();
    await expect(
      fixture.adapter().resolveKnowledgeSources(reviewedCandidate()),
    ).resolves.toEqual({
      ok: true,
      sources: [
        {
          provider: "chatgpt",
          providerConversationId: "conversation-1",
          conversationFingerprint,
          messageFingerprints: [messageFingerprint],
          sourceNotePath: "Sources/source.md",
        },
      ],
    });
    expect(new Set(fixture.calls.list)).toEqual(new Set(["", "Sources"]));
    expect(fixture.calls.read).toEqual([
      "Sources/source.md",
      "Sources/source.md",
      "Sources/source.md",
    ]);
    expect(fixture.calls.create).toBe(0);
  });

  test("matches an omitted conversation ID exactly", async () => {
    const fixture = harness();
    fixture.addSource(
      "Sources/source.md",
      sourceNote(conversationFingerprint, null),
    );
    const candidate = reviewedCandidate({
      sourceRefs: [
        {
          provider: "chatgpt",
          conversationFingerprint,
          messageFingerprints: [messageFingerprint],
        },
      ],
    });
    await expect(
      fixture.adapter().resolveKnowledgeSources(candidate),
    ).resolves.toMatchObject({
      ok: true,
      sources: [{ sourceNotePath: "Sources/source.md" }],
    });
  });

  test("returns unresolved for zero matches and ambiguous for two exact matches", async () => {
    const missing = harness();
    await expect(
      missing.adapter().resolveKnowledgeSources(reviewedCandidate()),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "KNOWLEDGE_SOURCE_UNRESOLVED" }],
    });
    expect(missing.calls.create).toBe(0);

    const duplicate = harness();
    duplicate.addSource("Sources/a.md");
    duplicate.addSource("Sources/b.md");
    await expect(
      duplicate.adapter().resolveKnowledgeSources(reviewedCandidate()),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "KNOWLEDGE_SOURCE_AMBIGUOUS" }],
    });
    expect(duplicate.calls.create).toBe(0);
  });

  test.each([
    "malformed",
    "changed",
    "alias",
    "read-error",
    "list-error",
  ] as const)(
    "fails closed for a %s registry observation without mutation",
    async (scenario) => {
      const fixture = harness();
      fixture.addSource();
      if (scenario === "malformed")
        fixture.bytes.set(
          "Sources/source.md",
          new TextEncoder().encode(
            '---\ntype: "ai-conversation-source"\nknowledge_status: "source"\nsource_provider: "chatgpt"\n---\n',
          ),
        );
      if (scenario === "alias")
        fixture.native.lstat = async (path) =>
          path.endsWith("/source.md")
            ? { kind: "present", objectKind: "symbolic-link" }
            : { kind: "present", objectKind: "directory" };
      if (scenario === "read-error")
        fixture.io.readBinary = async () => {
          throw new Error("read failed");
        };
      if (scenario === "list-error")
        fixture.io.list = async (path) => {
          if (path === "Sources") throw new Error("list failed");
          return [];
        };
      if (scenario === "changed") {
        const originalRead = fixture.io.readBinary.bind(fixture.io);
        fixture.io.readBinary = async (path) => {
          const result = await originalRead(path);
          fixture.entries.delete(path);
          return result;
        };
      }
      await expect(
        fixture.adapter().resolveKnowledgeSources(reviewedCandidate()),
      ).resolves.toMatchObject({
        ok: false,
        diagnostics: [{ code: "KNOWLEDGE_SOURCE_STALE" }],
      });
      expect(fixture.calls.create).toBe(0);
    },
  );

  test("classifies a changed source identity as stale", async () => {
    const fixture = harness();
    fixture.addSource(
      "Sources/source.md",
      sourceNote(`sha256:${"e".repeat(64)}`),
    );
    await expect(
      fixture.adapter().resolveKnowledgeSources(reviewedCandidate()),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "KNOWLEDGE_SOURCE_STALE" }],
    });
  });

  test("fails closed when a competing registry entry appears during resolution", async () => {
    const fixture = harness();
    fixture.addSource("Sources/a.md");
    const originalRead = fixture.io.readBinary.bind(fixture.io);
    fixture.io.readBinary = async (path) => {
      const result = await originalRead(path);
      fixture.addSource("Sources/b.md");
      return result;
    };
    await expect(
      fixture.adapter().resolveKnowledgeSources(reviewedCandidate()),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "KNOWLEDGE_SOURCE_STALE" }],
    });
    expect(fixture.calls.create).toBe(0);
  });

  test("fails closed when registry bytes change in place during resolution", async () => {
    const fixture = harness();
    fixture.addSource();
    const originalRead = fixture.io.readBinary.bind(fixture.io);
    fixture.io.readBinary = async (path) => {
      const result = await originalRead(path);
      fixture.bytes.set(path, sourceNote(`sha256:${"e".repeat(64)}`));
      return result;
    };

    await expect(
      fixture.adapter().resolveKnowledgeSources(reviewedCandidate()),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "KNOWLEDGE_SOURCE_STALE" }],
    });
    expect(fixture.calls.create).toBe(0);
  });

  test("fails closed when an earlier matched source mutates while a later source is processed", async () => {
    const fixture = harness();
    const secondConversationFingerprint = `sha256:${"e".repeat(64)}`;
    const secondMessageFingerprint = `sha256:${"f".repeat(64)}`;
    fixture.addSource("Sources/a.md");
    fixture.addSource(
      "Sources/b.md",
      sourceNote(secondConversationFingerprint, "conversation-2"),
    );
    const originalRead = fixture.io.readBinary.bind(fixture.io);
    let mutated = false;
    fixture.io.readBinary = async (path) => {
      const result = await originalRead(path);
      if (path === "Sources/b.md" && !mutated) {
        mutated = true;
        fixture.bytes.set(
          "Sources/a.md",
          sourceNote(`sha256:${"0".repeat(64)}`),
        );
      }
      return result;
    };
    const candidate = reviewedCandidate({
      sourceRefs: [
        {
          provider: "chatgpt",
          providerConversationId: "conversation-1",
          conversationFingerprint,
          messageFingerprints: [messageFingerprint],
        },
        {
          provider: "chatgpt",
          providerConversationId: "conversation-2",
          conversationFingerprint: secondConversationFingerprint,
          messageFingerprints: [secondMessageFingerprint],
        },
      ],
    });

    await expect(
      fixture.adapter().resolveKnowledgeSources(candidate),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "KNOWLEDGE_SOURCE_STALE" }],
    });
    expect(fixture.calls.create).toBe(0);
  });

  test("fails closed when a non-final source-root ancestor becomes an in-vault symlink", async () => {
    const fixture = harness();
    fixture.entries.delete("Sources");
    fixture.entries.set("Registry", { path: "Registry", kind: "folder" });
    fixture.entries.set("Registry/Sources", {
      path: "Registry/Sources",
      kind: "folder",
    });
    fixture.addSource("Registry/Sources/source.md");
    fixture.adapter = () =>
      new ObsidianKnowledgeVaultAdapter(
        fixture.io,
        fixture.native,
        () => "Registry/Sources",
        () => "Knowledge",
        "darwin",
        "x64",
      );
    const originalRead = fixture.io.readBinary.bind(fixture.io);
    let readCount = 0;
    let ancestorChanged = false;
    fixture.io.readBinary = async (path) => {
      const result = await originalRead(path);
      readCount += 1;
      if (readCount === 2) ancestorChanged = true;
      return result;
    };
    const originalLstat = fixture.native.lstat.bind(fixture.native);
    fixture.native.lstat = async (path) =>
      path === "/vault/Registry" && ancestorChanged
        ? { kind: "present", objectKind: "symbolic-link" }
        : originalLstat(path);

    await expect(
      fixture.adapter().resolveKnowledgeSources(reviewedCandidate()),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "KNOWLEDGE_SOURCE_STALE" }],
    });
    expect(fixture.calls.create).toBe(0);
  });

  test("observes existing bytes and creates only after an absent-safe checkpoint", async () => {
    const fixture = harness();
    const path = "Knowledge/note.md";
    await expect(
      fixture.adapter().observeKnowledgeTarget(path),
    ).resolves.toEqual({
      status: "absent",
    });
    await expect(
      fixture.adapter().checkpointKnowledgeTarget(path),
    ).resolves.toEqual({ status: "absent-safe", resolvedPath: path });

    await fixture.adapter().createKnowledgeNote(path, "synthetic note");
    expect(fixture.calls.create).toBe(1);
    await expect(fixture.adapter().readKnowledgeNote(path)).resolves.toEqual(
      new TextEncoder().encode("synthetic note"),
    );
    await expect(
      fixture.adapter().observeKnowledgeTarget(path),
    ).resolves.toEqual({
      status: "regular-file",
      bytes: new TextEncoder().encode("synthetic note"),
    });
    await expect(
      fixture.adapter().checkpointKnowledgeTarget(path),
    ).resolves.toEqual({ status: "changed" });
  });

  test("refuses a target that changes between observation and checkpoint", async () => {
    const fixture = harness();
    const adapter = fixture.adapter();
    const path = "Knowledge/race.md";
    await expect(adapter.observeKnowledgeTarget(path)).resolves.toEqual({
      status: "absent",
    });
    fixture.entries.set(path, { path, kind: "file" });
    fixture.bytes.set(path, new TextEncoder().encode("other"));
    await expect(adapter.checkpointKnowledgeTarget(path)).resolves.toEqual({
      status: "changed",
    });
    await expect(
      adapter.createKnowledgeNote(path, "must not write"),
    ).rejects.toThrow();
    expect(fixture.calls.create).toBe(0);
  });

  test("fails closed when the knowledge root changes after target absence is observed", async () => {
    const fixture = harness();
    const originalLstat = fixture.native.lstat.bind(fixture.native);
    let rootChanged = false;
    fixture.native.lstat = async (path) => {
      if (path === "/vault/Knowledge/race.md") {
        rootChanged = true;
        return { kind: "absent" };
      }
      if (path === "/vault/Knowledge" && rootChanged)
        return { kind: "present", objectKind: "symbolic-link" };
      return originalLstat(path);
    };

    await expect(
      fixture.adapter().checkpointKnowledgeTarget("Knowledge/race.md"),
    ).resolves.toEqual({ status: "unsafe" });
    expect(fixture.calls.create).toBe(0);
  });

  test("fails closed when a non-final knowledge-root ancestor becomes an in-vault symlink", async () => {
    const nestedFixture = () => {
      const fixture = harness();
      fixture.entries.delete("Knowledge");
      fixture.entries.set("Workspace", {
        path: "Workspace",
        kind: "folder",
      });
      fixture.entries.set("Workspace/Knowledge", {
        path: "Workspace/Knowledge",
        kind: "folder",
      });
      fixture.adapter = () =>
        new ObsidianKnowledgeVaultAdapter(
          fixture.io,
          fixture.native,
          () => "Sources",
          () => "Workspace/Knowledge",
          "darwin",
          "x64",
        );
      const originalLstat = fixture.native.lstat.bind(fixture.native);
      let ancestorChanged = false;
      fixture.native.lstat = async (path) => {
        if (path === "/vault/Workspace/Knowledge/race.md") {
          ancestorChanged = true;
          return { kind: "absent" };
        }
        if (path === "/vault/Workspace" && ancestorChanged)
          return { kind: "present", objectKind: "symbolic-link" };
        return originalLstat(path);
      };
      return fixture;
    };

    const checkpoint = nestedFixture();
    await expect(
      checkpoint
        .adapter()
        .checkpointKnowledgeTarget("Workspace/Knowledge/race.md"),
    ).resolves.toEqual({ status: "unsafe" });
    expect(checkpoint.calls.create).toBe(0);

    const create = nestedFixture();
    await expect(
      create
        .adapter()
        .createKnowledgeNote("Workspace/Knowledge/race.md", "must not write"),
    ).rejects.toThrow();
    expect(create.calls.create).toBe(0);
  });

  test("fails a read-only target observation when a collision appears during the read", async () => {
    const fixture = harness();
    const path = "Knowledge/Note.md";
    fixture.entries.set(path, { path, kind: "file" });
    fixture.bytes.set(path, new TextEncoder().encode("original"));
    const originalRead = fixture.io.readBinary.bind(fixture.io);
    fixture.io.readBinary = async (readPath) => {
      const result = await originalRead(readPath);
      fixture.entries.set("Knowledge/note.md", {
        path: "Knowledge/note.md",
        kind: "file",
      });
      fixture.bytes.set(
        "Knowledge/note.md",
        new TextEncoder().encode("competing"),
      );
      return result;
    };
    await expect(
      fixture.adapter().observeKnowledgeTarget(path),
    ).resolves.toEqual({
      status: "unsafe",
    });
    expect(fixture.calls.create).toBe(0);
  });

  test.each([
    "outside-root",
    "config-dir",
    "missing-root",
    "case-collision",
    "nfc-collision",
    "root-alias",
    "root-mount",
    "target-obstruction",
    "external-unicode",
  ] as const)("returns unsafe for %s", async (scenario) => {
    const fixture = harness();
    let path = "Knowledge/note.md";
    if (scenario === "outside-root") path = "Elsewhere/note.md";
    if (scenario === "config-dir") {
      fixture.entries.delete("Knowledge");
      fixture.entries.set(".obsidian", { path: ".obsidian", kind: "folder" });
      fixture.io.configDir = ".obsidian";
      fixture.adapter = () =>
        new ObsidianKnowledgeVaultAdapter(
          fixture.io,
          fixture.native,
          () => "Sources",
          () => ".obsidian",
          "darwin",
          "x64",
        );
      path = ".obsidian/note.md";
    }
    if (scenario === "missing-root") fixture.entries.delete("Knowledge");
    if (scenario === "case-collision") {
      fixture.entries.delete("Knowledge");
      fixture.entries.set("knowledge", { path: "knowledge", kind: "folder" });
    }
    if (scenario === "nfc-collision") {
      path = "Knowledge/Café.md";
      fixture.entries.set("Knowledge/Café.md", {
        path: "Knowledge/Café.md",
        kind: "file",
      });
      fixture.entries.set("Knowledge/Cafe\u0301.md", {
        path: "Knowledge/Cafe\u0301.md",
        kind: "file",
      });
    }
    if (scenario === "root-alias")
      fixture.native.lstat = async (nativePath) =>
        nativePath === "/vault/Knowledge"
          ? { kind: "present", objectKind: "symbolic-link" }
          : { kind: "present", objectKind: "directory" };
    if (scenario === "root-mount")
      fixture.native.observeMacOSMountPoint = async (nativePath) =>
        nativePath === "/vault/Knowledge"
          ? { kind: "mount-point" }
          : { kind: "not-mount-point" };
    if (scenario === "target-obstruction") {
      fixture.entries.set(path, { path, kind: "folder" });
    }
    if (scenario === "external-unicode") path = "Knowledge/bad\ud800.md";

    await expect(
      fixture.adapter().observeKnowledgeTarget(path),
    ).resolves.toEqual({
      status: scenario === "target-obstruction" ? "obstructed" : "unsafe",
    });
    await expect(
      fixture.adapter().checkpointKnowledgeTarget(path),
    ).resolves.toEqual({
      status: scenario === "target-obstruction" ? "changed" : "unsafe",
    });
    expect(fixture.calls.create).toBe(0);
  });

  test("fails closed on target listing and reading errors and on unsupported hosts", async () => {
    const listFailure = harness();
    listFailure.io.list = async () => {
      throw new Error("list failed");
    };
    await expect(
      listFailure.adapter().observeKnowledgeTarget("Knowledge/note.md"),
    ).resolves.toEqual({ status: "unsafe" });

    const readFailure = harness();
    readFailure.entries.set("Knowledge/note.md", {
      path: "Knowledge/note.md",
      kind: "file",
    });
    readFailure.io.readBinary = async () => {
      throw new Error("read failed");
    };
    await expect(
      readFailure.adapter().observeKnowledgeTarget("Knowledge/note.md"),
    ).resolves.toEqual({ status: "unsafe" });

    const unsupported = harness();
    const adapter = new ObsidianKnowledgeVaultAdapter(
      unsupported.io,
      unsupported.native,
      () => "Sources",
      () => "Knowledge",
      "darwin",
      "arm64",
    );
    await expect(
      adapter.observeKnowledgeTarget("Knowledge/note.md"),
    ).resolves.toEqual({
      status: "unsafe",
    });
    await expect(
      adapter.resolveKnowledgeSources(reviewedCandidate()),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "KNOWLEDGE_SOURCE_STALE" }],
    });
  });
});
