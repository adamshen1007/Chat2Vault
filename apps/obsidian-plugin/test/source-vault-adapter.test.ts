/* eslint-disable @typescript-eslint/require-await -- in-memory async adapters model Vault and native promise boundaries. */
import { describe, expect, test } from "vitest";
import type { CanonicalConversation, SourceDescriptor } from "@chat2vault/core";
import type { App } from "obsidian";
import type { NativeContainmentAdapter } from "../src/containment.js";
import { executeSourceWrite } from "../src/source-executor.js";
import {
  createObsidianSourceVaultIO,
  ObsidianSourceMutationAdapter,
  pairVaultNativeListing,
  SourceExternalPathInvalidUnicodeError,
  type SourceVaultIO,
  type VaultPathEntry,
} from "../src/source-vault-adapter.js";

const source: SourceDescriptor = {
  provider: "chatgpt",
  importFormat: "chatgpt-json",
  sourceFileName: "synthetic.json",
  sourceFileFingerprint: `sha256:${"a".repeat(64)}`,
  importedAt: "2026-08-15T01:02:03.004Z",
};
const conversation: CanonicalConversation = {
  schemaVersion: 1,
  provider: "chatgpt",
  providerConversationId: "conversation-1",
  title: "Evidence",
  createdAt: "2026-08-14T01:02:03.004Z",
  messages: [],
  metadata: {
    chatgptGraph: {
      nodeCount: 0,
      selectedPathNodeIds: [],
      alternativeLeafNodeIds: [],
      currentNodeId: null,
    },
  },
  contentFingerprint: `sha256:${"b".repeat(64)}`,
};

function harness() {
  const entries = new Map<string, VaultPathEntry>();
  const bytes = new Map<string, Uint8Array>();
  const children = (parent: string) =>
    [...entries.values()].filter((entry) => {
      const index = entry.path.lastIndexOf("/");
      return (index < 0 ? "" : entry.path.slice(0, index)) === parent;
    });
  const io: SourceVaultIO = {
    configDir: ".obsidian",
    basePath: "/vault",
    list: async (path) => children(path),
    lookup: async (path) => entries.get(path),
    readBinary: async (path) => {
      const value = bytes.get(path);
      if (value === undefined) throw new Error("missing");
      return value;
    },
    createFolder: async (path) => {
      entries.set(path, { path, kind: "folder" });
    },
    create: async (path, content) => {
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
  return { io, native, entries, bytes };
}

describe("M03 Obsidian source adapter", () => {
  test("validates Vault and native enumeration strings before raw-path pairing", () => {
    const rawFolder = "Cafe\u0301";
    expect(
      pairVaultNativeListing(
        "",
        [{ path: "Café", kind: "folder" }],
        [rawFolder],
      ),
    ).toEqual([{ path: rawFolder, kind: "folder" }]);

    for (const run of [
      () =>
        pairVaultNativeListing(
          "",
          [{ path: "bad\ud800", kind: "folder" }],
          ["bad"],
        ),
      () =>
        pairVaultNativeListing(
          "",
          [{ path: "bad", kind: "folder" }],
          ["bad\ud800"],
        ),
      () =>
        pairVaultNativeListing(
          "bad\ud800",
          [{ path: "bad", kind: "folder" }],
          ["bad"],
        ),
    ]) {
      expect(run).toThrowError(SourceExternalPathInvalidUnicodeError);
      try {
        run();
      } catch (error) {
        expect(error).toMatchObject({
          code: "SOURCE_EXTERNAL_PATH_INVALID_UNICODE",
        });
      }
    }
  });

  test("uses DataAdapter raw paths for enumeration, lookup, and binary reads", async () => {
    const rawFolder = "Cafe\u0301";
    const rawFile = `${rawFolder}/source.md`;
    const adapter = {
      list: async () => ({ files: [rawFile], folders: [rawFolder] }),
      stat: async (path: string) =>
        path === rawFolder
          ? { type: "folder" as const }
          : path === rawFile
            ? { type: "file" as const }
            : null,
      readBinary: async () => new Uint8Array([1, 2, 3]).buffer,
    };
    const io = createObsidianSourceVaultIO({
      vault: {
        adapter,
        configDir: ".obsidian",
        createFolder: async () => undefined,
        create: async () => undefined,
      },
    } as unknown as App);

    await expect(io.list("")).resolves.toEqual([
      { path: rawFolder, kind: "folder" },
      { path: rawFile, kind: "file" },
    ]);
    await expect(io.lookup(rawFolder)).resolves.toEqual({
      path: rawFolder,
      kind: "folder",
    });
    await expect(io.lookup(rawFile)).resolves.toEqual({
      path: rawFile,
      kind: "file",
    });
    await expect(io.readBinary(rawFile)).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  test("runs pending/platform/provider gates before root or registry I/O", async () => {
    const { io, native } = harness();
    let ioCalls = 0;
    io.list = async () => {
      ioCalls += 1;
      throw new Error("must not run");
    };
    const adapter = new ObsidianSourceMutationAdapter(
      io,
      native,
      source,
      { ...conversation, provider: "unknown" },
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(adapter.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "UNSUPPORTED_SOURCE_PROVIDER" }],
    });
    expect(ioCalls).toBe(0);
  });

  test("plans a synthetic missing descendant, creates parent-first, and rediscovers verified registry bytes", async () => {
    const { io, native, entries } = harness();
    const adapter = new ObsidianSourceMutationAdapter(
      io,
      native,
      source,
      conversation,
      () => "Sources/Deep",
      () => false,
      "darwin",
    );
    const plan = await adapter.plan();
    expect(plan).toMatchObject({
      disposition: "new",
      foldersToCreate: ["Sources", "Sources/Deep"],
    });
    if (plan.disposition !== "new") throw new Error("expected writable plan");
    const result = await executeSourceWrite(
      {
        plan,
        previewGeneration: 0,
        selectedConversationContentFingerprint: conversation.contentFingerprint,
        settledSourceRoot: "Sources/Deep",
      },
      {
        operationGeneration: 0,
        selectedConversationContentFingerprint: conversation.contentFingerprint,
        normalizedSourceRoot: "Sources/Deep",
      },
      () => true,
      adapter,
    );
    expect(result).toMatchObject({
      status: "saved",
      acceptedFolderPaths: ["Sources", "Sources/Deep"],
    });
    expect(entries.get(plan.targetPath)).toEqual({
      path: plan.targetPath,
      kind: "file",
    });
    await expect(adapter.plan()).resolves.toMatchObject({
      disposition: "duplicate",
      existingPath: plan.targetPath,
    });
  });

  test("blocks physical aliases even when their real paths remain contained", async () => {
    const { io, native, entries } = harness();
    entries.set("Sources", { path: "Sources", kind: "folder" });
    native.observeMacOSMountPoint = async () => ({ kind: "mount-point" });
    const adapter = new ObsidianSourceMutationAdapter(
      io,
      native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(adapter.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_ROOT_PHYSICAL_ALIAS" }],
    });
  });

  test("maps unavailable platform alias capability before concrete probing", async () => {
    const { io, native } = harness();
    let concreteProbes = 0;
    native.aliasCapability = async () => ({
      kind: "unavailable",
      capability: "macos-mount-point",
    });
    native.lstat = async () => {
      concreteProbes += 1;
      return { kind: "indeterminate" };
    };
    const adapter = new ObsidianSourceMutationAdapter(
      io,
      native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(adapter.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE" }],
    });
    expect(concreteProbes).toBe(0);
  });

  test("classifies native aliases and object kinds before Vault visibility", async () => {
    const { io, native } = harness();
    native.lstat = async (path) =>
      path === "/vault/Sources"
        ? { kind: "present", objectKind: "symbolic-link" }
        : { kind: "present", objectKind: "directory" };
    const adapter = new ObsidianSourceMutationAdapter(
      io,
      native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(adapter.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_ROOT_PHYSICAL_ALIAS" }],
    });

    const folderReportedAsFile = harness();
    folderReportedAsFile.entries.set("Sources", {
      path: "Sources",
      kind: "folder",
    });
    folderReportedAsFile.native.lstat = async (path) =>
      path === "/vault/Sources"
        ? { kind: "present", objectKind: "regular-file" }
        : { kind: "present", objectKind: "directory" };
    const second = new ObsidianSourceMutationAdapter(
      folderReportedAsFile.io,
      folderReportedAsFile.native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(second.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_PATH_OBSTRUCTED" }],
    });

    const vaultFileAlias = harness();
    vaultFileAlias.entries.set("Sources", { path: "Sources", kind: "file" });
    vaultFileAlias.native.observeMacOSMountPoint = async (path) =>
      path === "/vault/Sources"
        ? { kind: "mount-point" }
        : { kind: "not-mount-point" };
    const third = new ObsidianSourceMutationAdapter(
      vaultFileAlias.io,
      vaultFileAlias.native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(third.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_ROOT_PHYSICAL_ALIAS" }],
    });
  });

  test("uses exact lowercase registry eligibility and rejects normalized duplicate candidates", async () => {
    const { io, native, entries, bytes } = harness();
    entries.set("Sources", { path: "Sources", kind: "folder" });
    entries.set("Sources/UPPER.MD", {
      path: "Sources/UPPER.MD",
      kind: "file",
    });
    bytes.set("Sources/UPPER.MD", new TextEncoder().encode("not read"));
    let reads = 0;
    const originalRead = io.readBinary.bind(io);
    io.readBinary = async (path) => {
      reads += 1;
      return originalRead(path);
    };
    const adapter = new ObsidianSourceMutationAdapter(
      io,
      native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(adapter.plan()).resolves.toMatchObject({ disposition: "new" });
    expect(reads).toBe(0);

    entries.set("Sources/Café.md", {
      path: "Sources/Café.md",
      kind: "file",
    });
    entries.set("Sources/Cafe\u0301.md", {
      path: "Sources/Cafe\u0301.md",
      kind: "file",
    });
    await expect(adapter.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_REGISTRY_ENUMERATION_FAILED" }],
    });
  });

  test("fails registry trust when a candidate changes after its byte read", async () => {
    const { io, native, entries, bytes } = harness();
    entries.set("Sources", { path: "Sources", kind: "folder" });
    entries.set("Sources/candidate.md", {
      path: "Sources/candidate.md",
      kind: "file",
    });
    bytes.set("Sources/candidate.md", new TextEncoder().encode("---\n---\n"));
    const originalList = io.list.bind(io);
    let rootLists = 0;
    io.list = async (path) => {
      const listed = await originalList(path);
      if (path === "Sources" && ++rootLists === 2)
        entries.delete("Sources/candidate.md");
      return listed;
    };
    const adapter = new ObsidianSourceMutationAdapter(
      io,
      native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(adapter.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_REGISTRY_READ_FAILED" }],
    });
  });

  test("treats a native-only final target as occupied before planning", async () => {
    const { io, native, entries } = harness();
    entries.set("Sources", { path: "Sources", kind: "folder" });
    const first = `/vault/Sources/2026-08-14 - Source - Evidence - ${"b".repeat(12)}.md`;
    const originalLstat = native.lstat.bind(native);
    native.lstat = async (path) =>
      path === first
        ? { kind: "present", objectKind: "regular-file" }
        : originalLstat(path);
    const adapter = new ObsidianSourceMutationAdapter(
      io,
      native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(adapter.plan()).resolves.toMatchObject({
      disposition: "new",
      targetPath: `Sources/2026-08-14 - Source - Evidence - ${"b".repeat(20)}.md`,
    });
  });

  test("requires a fresh post-create registry read before reporting saved", async () => {
    const { io, native, entries } = harness();
    const adapter = new ObsidianSourceMutationAdapter(
      io,
      native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    const plan = await adapter.plan();
    if (plan.disposition !== "new") throw new Error("expected writable plan");
    const originalRead = io.readBinary.bind(io);
    let readsAfterCreate = 0;
    io.readBinary = async (path) => {
      const value = await originalRead(path);
      if (entries.has(plan.targetPath) && ++readsAfterCreate > 1)
        return new TextEncoder().encode("changed after checkpoint C");
      return value;
    };
    const result = await executeSourceWrite(
      {
        plan,
        previewGeneration: 0,
        selectedConversationContentFingerprint: conversation.contentFingerprint,
        settledSourceRoot: "Sources",
      },
      {
        operationGeneration: 0,
        selectedConversationContentFingerprint: conversation.contentFingerprint,
        normalizedSourceRoot: "Sources",
      },
      () => true,
      adapter,
    );
    expect(result).toMatchObject({ status: "verification-failed" });
    expect(readsAfterCreate).toBeGreaterThan(1);
  });

  test("uses collision keys again at the final pre-create checkpoint", async () => {
    const { io, native, entries } = harness();
    entries.set("Sources", { path: "Sources", kind: "folder" });
    const adapter = new ObsidianSourceMutationAdapter(
      io,
      native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    const plan = await adapter.plan();
    if (plan.disposition !== "new") throw new Error("expected writable plan");
    const slash = plan.targetPath.lastIndexOf("/");
    const collision = `${plan.targetPath.slice(0, slash + 1)}${plan.targetPath.slice(slash + 1).toUpperCase()}`;
    entries.set(collision, { path: collision, kind: "file" });
    await expect(adapter.checkpointFinalParent(plan)).resolves.toEqual({
      status: "blocked",
    });

    entries.delete(collision);
    io.lookup = async () => ({ path: `Sources/bad\ud800.md`, kind: "file" });
    await expect(adapter.checkpointFinalParent(plan)).resolves.toEqual({
      status: "blocked",
      diagnostic: "SOURCE_EXTERNAL_PATH_INVALID_UNICODE",
    });

    io.lookup = async () => {
      throw new Error("Vault lookup unavailable");
    };
    await expect(adapter.checkpointFinalParent(plan)).resolves.toEqual({
      status: "blocked",
    });
  });

  test("preserves before-read absence and after-read alias transition diagnostics", async () => {
    const absentCase = harness();
    absentCase.entries.set("Sources", { path: "Sources", kind: "folder" });
    absentCase.entries.set("Sources/candidate.md", {
      path: "Sources/candidate.md",
      kind: "file",
    });
    absentCase.bytes.set(
      "Sources/candidate.md",
      new TextEncoder().encode("---\n---\n"),
    );
    const originalAbsentLstat = absentCase.native.lstat.bind(absentCase.native);
    absentCase.native.lstat = async (path) =>
      path.endsWith("candidate.md")
        ? { kind: "absent" }
        : originalAbsentLstat(path);
    const absentAdapter = new ObsidianSourceMutationAdapter(
      absentCase.io,
      absentCase.native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(absentAdapter.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_NATIVE_PROBE_INDETERMINATE" }],
    });

    const aliasCase = harness();
    aliasCase.entries.set("Sources", { path: "Sources", kind: "folder" });
    aliasCase.entries.set("Sources/candidate.md", {
      path: "Sources/candidate.md",
      kind: "file",
    });
    aliasCase.bytes.set(
      "Sources/candidate.md",
      new TextEncoder().encode("---\n---\n"),
    );
    let candidateObservations = 0;
    aliasCase.native.observeMacOSMountPoint = async (path) =>
      path.endsWith("candidate.md") && ++candidateObservations > 1
        ? { kind: "mount-point" }
        : { kind: "not-mount-point" };
    const aliasAdapter = new ObsidianSourceMutationAdapter(
      aliasCase.io,
      aliasCase.native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    await expect(aliasAdapter.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_REGISTRY_READ_FAILED" }],
    });
  });

  test.each([
    ["required-object absence", "absent"],
    ["permission or I/O indeterminacy", "indeterminate"],
    ["unknown rejection", "throw"],
  ] as const)(
    "fails closed on registry candidate realpath %s before trust",
    async (_name, outcome) => {
      const fixture = harness();
      fixture.entries.set("Sources", { path: "Sources", kind: "folder" });
      fixture.entries.set("Sources/candidate.md", {
        path: "Sources/candidate.md",
        kind: "file",
      });
      fixture.bytes.set(
        "Sources/candidate.md",
        new TextEncoder().encode("---\n---\n"),
      );
      const original = fixture.native.realpath.bind(fixture.native);
      fixture.native.realpath = async (path) => {
        if (!path.endsWith("candidate.md")) return original(path);
        if (outcome === "throw") throw new Error("unknown native rejection");
        return { kind: outcome };
      };
      let reads = 0;
      const originalRead = fixture.io.readBinary.bind(fixture.io);
      fixture.io.readBinary = async (path) => {
        reads += 1;
        return originalRead(path);
      };
      const adapter = new ObsidianSourceMutationAdapter(
        fixture.io,
        fixture.native,
        source,
        conversation,
        () => "Sources",
        () => false,
        "darwin",
      );
      await expect(adapter.plan()).resolves.toMatchObject({
        disposition: "blocked",
        diagnostics: [{ code: "SOURCE_NATIVE_PROBE_INDETERMINATE" }],
      });
      expect(reads).toBe(0);
    },
  );

  test.each(
    ["lstat", "realpath", "platform-observation"].flatMap((probe) =>
      ["permission", "I/O", "capability", "unknown"].map((failure) => ({
        probe,
        failure,
      })),
    ) as {
      probe: "lstat" | "realpath" | "platform-observation";
      failure: "permission" | "I/O" | "capability" | "unknown";
    }[],
  )(
    "fails closed on registry candidate $probe $failure failure",
    async ({ probe, failure }) => {
      const fixture = harness();
      fixture.entries.set("Sources", { path: "Sources", kind: "folder" });
      fixture.entries.set("Sources/candidate.md", {
        path: "Sources/candidate.md",
        kind: "file",
      });
      fixture.bytes.set(
        "Sources/candidate.md",
        new TextEncoder().encode("---\n---\n"),
      );
      let reads = 0;
      const originalRead = fixture.io.readBinary.bind(fixture.io);
      fixture.io.readBinary = async (path) => {
        reads += 1;
        return originalRead(path);
      };
      if (probe === "lstat") {
        const original = fixture.native.lstat.bind(fixture.native);
        fixture.native.lstat = async (path) => {
          if (!path.endsWith("candidate.md")) return original(path);
          if (failure === "unknown") throw new Error("unknown lstat failure");
          return { kind: "indeterminate" };
        };
      }
      if (probe === "realpath") {
        const original = fixture.native.realpath.bind(fixture.native);
        fixture.native.realpath = async (path) => {
          if (!path.endsWith("candidate.md")) return original(path);
          if (failure === "unknown")
            throw new Error("unknown realpath failure");
          return { kind: "indeterminate" };
        };
      }
      if (probe === "platform-observation")
        fixture.native.observeMacOSMountPoint = async (path) => {
          if (!path.endsWith("candidate.md"))
            return { kind: "not-mount-point" };
          if (failure === "unknown")
            throw new Error("unknown mount observation failure");
          return { kind: "indeterminate" };
        };
      const adapter = new ObsidianSourceMutationAdapter(
        fixture.io,
        fixture.native,
        source,
        conversation,
        () => "Sources",
        () => false,
        "darwin",
      );
      await expect(adapter.plan()).resolves.toMatchObject({
        disposition: "blocked",
        diagnostics: [{ code: "SOURCE_NATIVE_PROBE_INDETERMINATE" }],
      });
      expect(reads).toBe(0);
    },
  );

  test("uses collision-key config exclusion and reports lifecycle-closed verification as not completed", async () => {
    const configCase = harness();
    configCase.io.configDir = "Meta";
    const configAdapter = new ObsidianSourceMutationAdapter(
      configCase.io,
      configCase.native,
      source,
      conversation,
      () => "META/Plugins",
      () => false,
      "darwin",
    );
    await expect(configAdapter.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_ROOT_CONFIG_DIR" }],
    });

    const lifecycleCase = harness();
    let open = true;
    const originalCreate = lifecycleCase.io.create.bind(lifecycleCase.io);
    lifecycleCase.io.create = async (path, content) => {
      await originalCreate(path, content);
      open = false;
    };
    const lifecycleAdapter = new ObsidianSourceMutationAdapter(
      lifecycleCase.io,
      lifecycleCase.native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
      () => open,
    );
    const plan = await lifecycleAdapter.plan();
    if (plan.disposition !== "new") throw new Error("expected writable plan");
    await expect(
      executeSourceWrite(
        {
          plan,
          previewGeneration: 0,
          selectedConversationContentFingerprint:
            conversation.contentFingerprint,
          settledSourceRoot: "Sources",
        },
        {
          operationGeneration: 0,
          selectedConversationContentFingerprint:
            conversation.contentFingerprint,
          normalizedSourceRoot: "Sources",
        },
        () => open,
        lifecycleAdapter,
      ),
    ).resolves.toMatchObject({
      status: "post-create-stale",
      verification: { status: "not-completed" },
    });
  });

  test.each([
    ["darwin", 1],
    ["darwin", 2],
    ["darwin", 3],
    ["win32", 1],
    ["win32", 2],
    ["win32", 3],
  ] as const)(
    "detects a contained-realpath %s parent alias at post-create checkpoint %s",
    async (platform, checkpoint) => {
      const fixture = harness();
      fixture.entries.set("Sources", { path: "Sources", kind: "folder" });
      fixture.native.platform = platform;
      fixture.native.separator = "/";
      const adapter = new ObsidianSourceMutationAdapter(
        fixture.io,
        fixture.native,
        source,
        conversation,
        () => "Sources",
        () => false,
        platform,
      );
      const plan = await adapter.plan();
      if (plan.disposition !== "new") throw new Error("expected writable plan");
      fixture.entries.set(plan.targetPath, {
        path: plan.targetPath,
        kind: "file",
      });
      fixture.bytes.set(
        plan.targetPath,
        new TextEncoder().encode(plan.noteContent),
      );
      let parentObservations = 0;
      if (platform === "darwin")
        fixture.native.observeMacOSMountPoint = async (path) => ({
          kind:
            path.endsWith("/Sources") && ++parentObservations === checkpoint
              ? "mount-point"
              : "not-mount-point",
        });
      else
        fixture.native.observeWindowsReparsePoint = async (path) => ({
          kind:
            path.endsWith("/Sources") && ++parentObservations === checkpoint
              ? "reparse-point"
              : "not-reparse-point",
        });
      await expect(adapter.verifyCreatedNote(plan)).resolves.toEqual({
        status: "verification-failed",
      });
      expect(parentObservations).toBe(checkpoint);
    },
  );

  test.each(
    ["darwin", "win32"].flatMap((platform) =>
      [1, 2, 3].flatMap((checkpoint) =>
        [false, true].map((stale) => ({ platform, checkpoint, stale })),
      ),
    ) as {
      platform: "darwin" | "win32";
      checkpoint: 1 | 2 | 3;
      stale: boolean;
    }[],
  )(
    "settles an actually fulfilled note after $platform checkpoint $checkpoint alias (stale=$stale)",
    async ({ platform, checkpoint, stale }) => {
      const fixture = harness();
      fixture.entries.set("Sources", { path: "Sources", kind: "folder" });
      fixture.native.platform = platform;
      fixture.native.separator = "/";
      let created = false;
      let current = true;
      let parentObservations = 0;
      const originalCreate = fixture.io.create.bind(fixture.io);
      fixture.io.create = async (path, content) => {
        await originalCreate(path, content);
        created = true;
      };
      const observe = (path: string) => {
        if (
          created &&
          path.endsWith("/Sources") &&
          ++parentObservations === checkpoint
        ) {
          if (stale) current = false;
          return true;
        }
        return false;
      };
      if (platform === "darwin")
        fixture.native.observeMacOSMountPoint = async (path) => ({
          kind: observe(path) ? "mount-point" : "not-mount-point",
        });
      else
        fixture.native.observeWindowsReparsePoint = async (path) => ({
          kind: observe(path) ? "reparse-point" : "not-reparse-point",
        });
      const adapter = new ObsidianSourceMutationAdapter(
        fixture.io,
        fixture.native,
        source,
        conversation,
        () => "Sources",
        () => false,
        platform,
      );
      const plan = await adapter.plan();
      if (plan.disposition !== "new") throw new Error("expected writable plan");
      const result = await executeSourceWrite(
        {
          plan,
          previewGeneration: 0,
          selectedConversationContentFingerprint:
            conversation.contentFingerprint,
          settledSourceRoot: "Sources",
        },
        {
          operationGeneration: 0,
          selectedConversationContentFingerprint:
            conversation.contentFingerprint,
          normalizedSourceRoot: "Sources",
        },
        () => current,
        adapter,
      );
      expect(result).toMatchObject({
        status: stale ? "post-create-stale" : "verification-failed",
        createdPath: plan.targetPath,
        acceptedFolderPaths: [],
      });
      if (stale)
        expect(result).toMatchObject({
          verification: { status: "verification-failed" },
        });
      expect(parentObservations).toBe(checkpoint);
      expect(fixture.entries.has(plan.targetPath)).toBe(true);
    },
  );

  test.each([
    "config-dir",
    "vault-base",
    "enumerated-root-child",
    "native-realpath-return",
    "registry-child",
  ] as const)(
    "blocks invalid external Unicode at the %s ingress before later operations",
    async (ingress) => {
      const fixture = harness();
      let nativeLstatCalls = 0;
      let reads = 0;
      const originalLstat = fixture.native.lstat.bind(fixture.native);
      fixture.native.lstat = async (path) => {
        nativeLstatCalls += 1;
        return originalLstat(path);
      };
      fixture.io.readBinary = async () => {
        reads += 1;
        throw new Error("must not read invalid ingress");
      };
      if (ingress === "config-dir") fixture.io.configDir = "bad\ud800config";
      if (ingress === "vault-base") fixture.io.basePath = "/bad\ud800vault";
      if (ingress === "enumerated-root-child")
        fixture.io.list = async () => [
          { path: "bad\ud800child", kind: "folder" },
        ];
      if (ingress === "native-realpath-return")
        fixture.native.realpath = async () => ({
          kind: "resolved",
          realPath: "/bad\ud800realpath",
        });
      if (ingress === "registry-child") {
        fixture.entries.set("Sources", { path: "Sources", kind: "folder" });
        const originalList = fixture.io.list.bind(fixture.io);
        fixture.io.list = async (path) =>
          path === "Sources"
            ? [{ path: "Sources/bad\ud800.md", kind: "file" }]
            : originalList(path);
      }
      const adapter = new ObsidianSourceMutationAdapter(
        fixture.io,
        fixture.native,
        source,
        conversation,
        () => "Sources",
        () => false,
        "darwin",
      );
      const result = await adapter.plan();
      expect(result).toMatchObject({
        disposition: "blocked",
        diagnostics: [{ code: "SOURCE_EXTERNAL_PATH_INVALID_UNICODE" }],
      });
      expect(JSON.stringify(result)).not.toContain("bad");
      expect(reads).toBe(0);
      if (
        ingress === "config-dir" ||
        ingress === "vault-base" ||
        ingress === "enumerated-root-child" ||
        ingress === "native-realpath-return"
      )
        expect(nativeLstatCalls).toBe(0);
    },
  );

  test("preserves raw NFD resolved addressing while exposing logical NFC paths", async () => {
    const fixture = harness();
    fixture.entries.set("Cafe\u0301", {
      path: "Cafe\u0301",
      kind: "folder",
    });
    const lstatPaths: string[] = [];
    const originalLstat = fixture.native.lstat.bind(fixture.native);
    fixture.native.lstat = async (path) => {
      lstatPaths.push(path);
      return originalLstat(path);
    };
    const adapter = new ObsidianSourceMutationAdapter(
      fixture.io,
      fixture.native,
      source,
      conversation,
      () => "Café/Deep",
      () => false,
      "darwin",
    );
    const plan = await adapter.plan();
    expect(plan).toMatchObject({
      disposition: "new",
      foldersToCreate: ["Café/Deep"],
    });
    expect(plan.disposition === "new" ? plan.targetPath : "").toMatch(
      /^Café\/Deep\//u,
    );
    await expect(adapter.checkpointFolder("Café/Deep")).resolves.toEqual({
      status: "missing-safe",
      resolvedPath: "Cafe\u0301/Deep",
    });
    expect(lstatPaths.some((path) => path.includes("Cafe\u0301"))).toBe(true);
    expect(lstatPaths.some((path) => path.includes("Café"))).toBe(false);
  });

  test.each([
    ["permission", { kind: "indeterminate" as const }],
    ["I/O", { kind: "indeterminate" as const }],
    ["capability", { kind: "indeterminate" as const }],
    ["unknown rejection", "throw" as const],
  ])(
    "never treats a target native %s failure as unoccupied",
    async (_name, outcome) => {
      const fixture = harness();
      fixture.entries.set("Sources", { path: "Sources", kind: "folder" });
      const original = fixture.native.lstat.bind(fixture.native);
      fixture.native.lstat = async (path) => {
        if (!path.endsWith(".md")) return original(path);
        if (outcome === "throw") throw new Error("synthetic native rejection");
        return outcome;
      };
      const adapter = new ObsidianSourceMutationAdapter(
        fixture.io,
        fixture.native,
        source,
        conversation,
        () => "Sources",
        () => false,
        "darwin",
      );
      await expect(adapter.plan()).resolves.toMatchObject({
        disposition: "blocked",
        diagnostics: [{ code: "SOURCE_NATIVE_PROBE_INDETERMINATE" }],
      });
      expect(fixture.entries.size).toBe(1);
    },
  );

  test("blocks an ill-formed created-folder re-enumeration before any later mutation", async () => {
    const fixture = harness();
    fixture.io.createFolder = async () => {
      fixture.entries.set("bad\ud800created", {
        path: "bad\ud800created",
        kind: "folder",
      });
    };
    let noteCreates = 0;
    fixture.io.create = async () => {
      noteCreates += 1;
    };
    const adapter = new ObsidianSourceMutationAdapter(
      fixture.io,
      fixture.native,
      source,
      conversation,
      () => "Sources",
      () => false,
      "darwin",
    );
    const plan = await adapter.plan();
    if (plan.disposition !== "new") throw new Error("expected writable plan");
    const result = await executeSourceWrite(
      {
        plan,
        previewGeneration: 0,
        selectedConversationContentFingerprint: conversation.contentFingerprint,
        settledSourceRoot: "Sources",
      },
      {
        operationGeneration: 0,
        selectedConversationContentFingerprint: conversation.contentFingerprint,
        normalizedSourceRoot: "Sources",
      },
      () => true,
      adapter,
    );
    expect(result).toMatchObject({
      status: "replanned",
      plan: {
        disposition: "blocked",
        diagnostics: [{ code: "SOURCE_EXTERNAL_PATH_INVALID_UNICODE" }],
      },
      acceptedFolderPaths: ["Sources"],
    });
    expect(JSON.stringify(result)).not.toContain("bad");
    expect(noteCreates).toBe(0);
  });

  test.each([
    ["darwin", "SOURCE_REGISTRY_PHYSICAL_ALIAS"],
    ["win32", "SOURCE_REGISTRY_PHYSICAL_ALIAS"],
  ] as const)(
    "blocks a contained-realpath %s registry candidate solely on the platform alias observation",
    async (platform, diagnostic) => {
      const fixture = harness();
      fixture.entries.set("Sources", { path: "Sources", kind: "folder" });
      fixture.entries.set("Sources/candidate.md", {
        path: "Sources/candidate.md",
        kind: "file",
      });
      fixture.bytes.set(
        "Sources/candidate.md",
        new TextEncoder().encode("---\n---\n"),
      );
      fixture.native.platform = platform;
      fixture.native.separator = "/";
      if (platform === "darwin")
        fixture.native.observeMacOSMountPoint = async (path) => ({
          kind: path.endsWith("candidate.md")
            ? "mount-point"
            : "not-mount-point",
        });
      else
        fixture.native.observeWindowsReparsePoint = async (path) => ({
          kind: path.endsWith("candidate.md")
            ? "reparse-point"
            : "not-reparse-point",
        });
      const adapter = new ObsidianSourceMutationAdapter(
        fixture.io,
        fixture.native,
        source,
        conversation,
        () => "Sources",
        () => false,
        platform,
      );
      await expect(adapter.plan()).resolves.toMatchObject({
        disposition: "blocked",
        diagnostics: [{ code: diagnostic }],
      });
    },
  );

  test.each([
    ["darwin", 1],
    ["darwin", 2],
    ["darwin", 3],
    ["win32", 1],
    ["win32", 2],
    ["win32", 3],
  ] as const)(
    "maps an indeterminate %s parent observation at post-create checkpoint %s to verification failure",
    async (platform, checkpoint) => {
      const fixture = harness();
      fixture.entries.set("Sources", { path: "Sources", kind: "folder" });
      fixture.native.platform = platform;
      fixture.native.separator = "/";
      const adapter = new ObsidianSourceMutationAdapter(
        fixture.io,
        fixture.native,
        source,
        conversation,
        () => "Sources",
        () => false,
        platform,
      );
      const plan = await adapter.plan();
      if (plan.disposition !== "new") throw new Error("expected writable plan");
      fixture.entries.set(plan.targetPath, {
        path: plan.targetPath,
        kind: "file",
      });
      fixture.bytes.set(
        plan.targetPath,
        new TextEncoder().encode(plan.noteContent),
      );
      let parentObservations = 0;
      if (platform === "darwin")
        fixture.native.observeMacOSMountPoint = async (path) => ({
          kind:
            path.endsWith("/Sources") && ++parentObservations === checkpoint
              ? "indeterminate"
              : "not-mount-point",
        });
      else
        fixture.native.observeWindowsReparsePoint = async (path) => ({
          kind:
            path.endsWith("/Sources") && ++parentObservations === checkpoint
              ? "indeterminate"
              : "not-reparse-point",
        });
      await expect(adapter.verifyCreatedNote(plan)).resolves.toEqual({
        status: "verification-failed",
      });
      expect(parentObservations).toBe(checkpoint);
    },
  );

  test.each([
    ["symbolic-link", 1],
    ["symbolic-link", 2],
    ["symbolic-link", 3],
    ["realpath-escape", 1],
    ["realpath-escape", 2],
    ["realpath-escape", 3],
  ] as const)(
    "detects a POSIX %s parent race at post-create checkpoint %s",
    async (kind, checkpoint) => {
      const fixture = harness();
      fixture.entries.set("Sources", { path: "Sources", kind: "folder" });
      const adapter = new ObsidianSourceMutationAdapter(
        fixture.io,
        fixture.native,
        source,
        conversation,
        () => "Sources",
        () => false,
        "darwin",
      );
      const plan = await adapter.plan();
      if (plan.disposition !== "new") throw new Error("expected writable plan");
      fixture.entries.set(plan.targetPath, {
        path: plan.targetPath,
        kind: "file",
      });
      fixture.bytes.set(
        plan.targetPath,
        new TextEncoder().encode(plan.noteContent),
      );
      let parents = 0;
      if (kind === "symbolic-link") {
        const original = fixture.native.lstat.bind(fixture.native);
        fixture.native.lstat = async (path) =>
          path.endsWith("/Sources") && ++parents === checkpoint
            ? { kind: "present", objectKind: "symbolic-link" }
            : original(path);
      } else {
        const original = fixture.native.realpath.bind(fixture.native);
        fixture.native.realpath = async (path) =>
          path.endsWith("/Sources") && ++parents === checkpoint
            ? { kind: "resolved", realPath: "/outside/Sources" }
            : original(path);
      }
      await expect(adapter.verifyCreatedNote(plan)).resolves.toEqual({
        status: "verification-failed",
      });
      expect(parents).toBe(checkpoint);
    },
  );

  test.each(["darwin", "win32"] as const)(
    "returns post-create-stale when a %s contained alias race also invalidates the token",
    async (platform) => {
      const fixture = harness();
      fixture.entries.set("Sources", { path: "Sources", kind: "folder" });
      fixture.native.platform = platform;
      fixture.native.separator = "/";
      let created = false;
      let current = true;
      const originalCreate = fixture.io.create.bind(fixture.io);
      fixture.io.create = async (path, content) => {
        await originalCreate(path, content);
        created = true;
      };
      if (platform === "darwin")
        fixture.native.observeMacOSMountPoint = async (path) => {
          if (created && path.endsWith("/Sources")) {
            current = false;
            return { kind: "mount-point" };
          }
          return { kind: "not-mount-point" };
        };
      else
        fixture.native.observeWindowsReparsePoint = async (path) => {
          if (created && path.endsWith("/Sources")) {
            current = false;
            return { kind: "reparse-point" };
          }
          return { kind: "not-reparse-point" };
        };
      const adapter = new ObsidianSourceMutationAdapter(
        fixture.io,
        fixture.native,
        source,
        conversation,
        () => "Sources",
        () => false,
        platform,
      );
      const plan = await adapter.plan();
      if (plan.disposition !== "new") throw new Error("expected writable plan");
      await expect(
        executeSourceWrite(
          {
            plan,
            previewGeneration: 0,
            selectedConversationContentFingerprint:
              conversation.contentFingerprint,
            settledSourceRoot: "Sources",
          },
          {
            operationGeneration: 0,
            selectedConversationContentFingerprint:
              conversation.contentFingerprint,
            normalizedSourceRoot: "Sources",
          },
          () => current,
          adapter,
        ),
      ).resolves.toMatchObject({
        status: "post-create-stale",
        createdPath: plan.targetPath,
        verification: { status: "verification-failed" },
        diagnostics: [
          { code: "STALE_SOURCE_WRITE_PLAN" },
          { code: "SOURCE_WRITE_VERIFICATION_FAILED" },
        ],
      });
      expect(fixture.entries.has(plan.targetPath)).toBe(true);
    },
  );

  test.each([
    { collisions: [{ path: "sources", kind: "folder" as const }] },
    {
      collisions: [
        { path: "Café", kind: "folder" as const },
        { path: "Cafe\u0301", kind: "folder" as const },
      ],
    },
  ])("blocks root collision fixture $collisions", async ({ collisions }) => {
    const fixture = harness();
    for (const entry of collisions) fixture.entries.set(entry.path, entry);
    const configured = collisions.length === 1 ? "Sources" : "Café";
    const adapter = new ObsidianSourceMutationAdapter(
      fixture.io,
      fixture.native,
      source,
      conversation,
      () => configured,
      () => false,
      "darwin",
    );
    await expect(adapter.plan()).resolves.toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_ROOT_NAME_COLLISION" }],
    });
  });
});
