/* eslint-disable @typescript-eslint/require-await -- synthetic vault I/O. */
import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderKnowledgeNote,
  type ReviewedKnowledgeCandidate,
} from "@chat2vault/core";
import type { NativeContainmentAdapter } from "../src/containment.js";
import { ObsidianKnowledgeCatalogAdapter } from "../src/knowledge-catalog-adapter.js";
import { observeKnowledgeCatalog } from "../src/catalog-observer.js";
import {
  configureNativeObserver,
  readNativeVaultFileBounded,
} from "../src/native-observer.js";
import type {
  SourceVaultIO,
  VaultPathEntry,
} from "../src/source-vault-adapter.js";
import { createCatalogReadIO } from "../src/source-vault-adapter.js";

const fingerprint = `sha256:${"a".repeat(64)}`;
const messageFingerprint = `sha256:${"b".repeat(64)}`;
const sourceBytes = new TextEncoder().encode(
  [
    "---",
    "chat2vault_schema: 1",
    'type: "ai-conversation-source"',
    'source_provider: "chatgpt"',
    'source_conversation_id: "stable-1"',
    `source_content_fingerprint: "${fingerprint}"`,
    `source_import_fingerprint: "${fingerprint}"`,
    "source_message_count: 1",
    'imported_at: "2026-09-15T00:00:00.000Z"',
    'knowledge_status: "source"',
    "---",
    "",
    "# Synthetic source",
    "",
  ].join("\n"),
);
const candidate: ReviewedKnowledgeCandidate = {
  id: fingerprint,
  originalCandidateFingerprint: fingerprint,
  type: "insight",
  confidence: "high",
  sourceRefs: [
    {
      provider: "chatgpt",
      providerConversationId: "stable-1",
      conversationFingerprint: fingerprint,
      messageFingerprints: [messageFingerprint],
    },
  ],
  title: "Valid",
  summary: "Summary",
  body: "Body",
  tags: ["synthetic"],
  decision: "accepted",
  selected: true,
};
function fixture() {
  const entries = new Map<string, VaultPathEntry>([
    ["Sources", { path: "Sources", kind: "folder" }],
    ["Knowledge", { path: "Knowledge", kind: "folder" }],
  ]);
  const bytes = new Map<string, Uint8Array>();
  const counts = {
    create: 0,
    read: 0,
    bounded: 0,
    lists: [] as string[],
    readPaths: [] as string[],
  };
  const add = (
    path: string,
    content: Uint8Array | string,
    kind: VaultPathEntry["kind"] = "file",
  ) => {
    entries.set(path, { path, kind });
    bytes.set(
      path,
      typeof content === "string" ? new TextEncoder().encode(content) : content,
    );
  };
  add("Sources/source.md", sourceBytes);
  const rendered = renderKnowledgeNote(candidate, [
    {
      provider: "chatgpt",
      providerConversationId: "stable-1",
      conversationFingerprint: fingerprint,
      messageFingerprints: [messageFingerprint],
      sourceNotePath: "Sources/source.md",
    },
  ]);
  if (!rendered.ok) throw new Error("invalid synthetic fixture");
  const validPath = `Knowledge/${rendered.filename}`;
  add(validPath, rendered.noteContent);
  const io: SourceVaultIO = {
    configDir: ".obsidian",
    basePath: "/vault",
    list: async (parent) => {
      counts.lists.push(parent);
      return [...entries.values()].filter(({ path }) => {
        const split = path.lastIndexOf("/");
        return (split < 0 ? "" : path.slice(0, split)) === parent;
      });
    },
    lookup: async (path) => entries.get(path),
    readBinary: async (path) => {
      counts.read++;
      counts.readPaths.push(path);
      const value = bytes.get(path);
      if (!value) throw new Error("unavailable");
      return new Uint8Array(value);
    },
    readBinaryBounded: async (path, maxBytes) => {
      counts.bounded++;
      const value = bytes.get(path);
      if (!value) throw new Error("unavailable");
      return new Uint8Array(value.slice(0, maxBytes + 1));
    },
    createFolder: async () => {
      counts.create++;
    },
    create: async () => {
      counts.create++;
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
      const entry = entries.get(path.slice("/vault/".length));
      return path === "/vault"
        ? { kind: "present", objectKind: "directory" }
        : entry
          ? {
              kind: "present",
              objectKind:
                entry.kind === "folder" ? "directory" : "regular-file",
            }
          : { kind: "absent" };
    },
    realpath: async (path) => ({ kind: "resolved", realPath: path }),
    observeWindowsReparsePoint: async () => ({ kind: "not-reparse-point" }),
    observeMacOSMountPoint: async () => ({ kind: "not-mount-point" }),
  };
  const adapter = () =>
    new ObsidianKnowledgeCatalogAdapter(() =>
      observeKnowledgeCatalog(
        createCatalogReadIO(io),
        native,
        () => "Sources",
        () => "Knowledge",
        "darwin",
        "x64",
      ),
    );
  return { adapter, io, native, add, entries, bytes, counts, validPath };
}

describe("M07 read-only knowledge catalog", () => {
  test("catalog I/O facade exposes no mutation or lookup authority", async () => {
    const f = fixture();
    const readIO = createCatalogReadIO(f.io);
    expect(Object.keys(readIO).sort()).toEqual([
      "basePath",
      "configDir",
      "list",
      "readBinary",
      "readBinaryBounded",
    ]);
    expect("create" in readIO).toBe(false);
    expect("createFolder" in readIO).toBe(false);
    expect("lookup" in readIO).toBe(false);
    expect((await f.adapter().readKnowledgeCatalog()).status).toBe("ready");
    expect(f.counts.create).toBe(0);
  });

  test.skipIf(process.platform !== "darwin")(
    "native bounded read returns a sentinel and rejects symlinks",
    async () => {
      expect(
        configureNativeObserver(
          join(process.cwd(), "native", "source_observer.node"),
        ),
      ).toBe(true);
      const root = await mkdtemp(join(tmpdir(), "c2v-m07-"));
      try {
        await mkdir(join(root, "Knowledge"));
        await writeFile(
          join(root, "Knowledge", "exact.md"),
          Buffer.alloc(128 * 1024, 97),
        );
        await writeFile(
          join(root, "Knowledge", "large.md"),
          Buffer.alloc(128 * 1024 + 10, 98),
        );
        await symlink("exact.md", join(root, "Knowledge", "alias.md"));
        expect(
          (
            await readNativeVaultFileBounded(
              root,
              "Knowledge/exact.md",
              128 * 1024,
            )
          ).length,
        ).toBe(128 * 1024);
        expect(
          (
            await readNativeVaultFileBounded(
              root,
              "Knowledge/large.md",
              128 * 1024,
            )
          ).length,
        ).toBe(128 * 1024 + 1);
        await expect(
          readNativeVaultFileBounded(root, "Knowledge/alias.md", 128 * 1024),
        ).rejects.toThrow();
        await expect(
          readNativeVaultFileBounded(root, "../outside.md", 128 * 1024),
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  test("returns sorted eligible notes with stable source identity and repeatable fingerprint", async () => {
    const f = fixture();
    f.add("Knowledge/unrelated.md", "# Personal note\n");
    f.add("Knowledge/nested/ignored.md", "bad");
    const first = await f.adapter().readKnowledgeCatalog();
    expect(first.status).toBe("ready");
    if (first.status !== "ready") return;
    expect(first.notes).toHaveLength(1);
    expect(first.notes[0]?.path).toBe(f.validPath);
    expect(first.resolvedSources[0]?.providerConversationId).toBe("stable-1");
    expect(first.resolvedSources[0]?.messageFingerprints).toEqual([]);
    expect(await f.adapter().readKnowledgeCatalog()).toEqual(first);
    f.add("Knowledge/another.md", "# Another personal note\n");
    const changed = await f.adapter().readKnowledgeCatalog();
    expect(changed.status).toBe("ready");
    if (changed.status === "ready")
      expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(f.counts.create).toBe(0);
    expect(f.counts.bounded).toBeGreaterThan(0);
    expect(f.counts.read).toBeGreaterThan(0); // Source registry only.
    expect(f.counts.readPaths).not.toContain(f.validPath);
    expect(f.counts.lists).not.toContain("Knowledge/nested");
  });
  test("changes fingerprint when source registry bytes change without changing source identity", async () => {
    const f = fixture();
    const before = await f.adapter().readKnowledgeCatalog();
    expect(before.status).toBe("ready");
    f.add(
      "Sources/source.md",
      new TextEncoder().encode(
        new TextDecoder()
          .decode(sourceBytes)
          .replace("# Synthetic source", "# Synthetic source edited"),
      ),
    );
    const after = await f.adapter().readKnowledgeCatalog();
    expect(after.status).toBe("ready");
    if (before.status === "ready" && after.status === "ready") {
      expect(after.resolvedSources).toEqual(before.resolvedSources);
      expect(after.fingerprint).not.toBe(before.fingerprint);
    }
  });
  test("blocks malformed Chat2Vault-like content without returning a partial catalog", async () => {
    const f = fixture();
    f.add("Knowledge/bad.md", "---\nchat2vault_schema: 1\n---\n");
    expect(await f.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
      code: "M07_CATALOG_INCOMPLETE",
    });
  });
  test("blocks listing failure", async () => {
    const f = fixture();
    f.io.list = async () => {
      throw new Error("unavailable");
    };
    expect(await f.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
      code: "M07_CATALOG_UNAVAILABLE",
    });
  });
  test("blocks more than 10,000 direct child Markdown paths", async () => {
    const f = fixture();
    for (let i = 0; i < 10001; i++)
      f.entries.set(`Knowledge/n${String(i)}.md`, {
        path: `Knowledge/n${String(i)}.md`,
        kind: "file",
      });
    expect(await f.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
      code: "M07_CATALOG_INCOMPLETE",
    });
  });
  test("blocks oversized eligible note", async () => {
    const f = fixture();
    const original = new TextDecoder().decode(f.bytes.get(f.validPath));
    const footer = "\n\n## Source\n\n";
    const split = original.lastIndexOf(footer);
    if (split < 0) throw new Error("fixture footer missing");
    const large = `${original.slice(0, split)}${"x".repeat(128 * 1024)}${original.slice(split)}`;
    f.add(f.validPath, large);
    expect(await f.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
      code: "M07_CATALOG_INCOMPLETE",
    });
    expect(f.counts.bounded).toBeGreaterThan(0);
    expect(f.counts.readPaths).not.toContain(f.validPath);
  });
  test("accepts a valid note at exactly 128 KiB without an unbounded knowledge read", async () => {
    const f = fixture();
    const original = new TextDecoder().decode(f.bytes.get(f.validPath));
    const footer = "\n\n## Source\n\n";
    const split = original.lastIndexOf(footer);
    if (split < 0) throw new Error("fixture footer missing");
    const pad = 128 * 1024 - new TextEncoder().encode(original).length;
    f.add(
      f.validPath,
      `${original.slice(0, split)}${"x".repeat(pad)}${original.slice(split)}`,
    );
    const result = await f.adapter().readKnowledgeCatalog();
    expect(result.status).toBe("ready");
    expect(f.counts.bounded).toBeGreaterThan(0);
    expect(f.counts.readPaths).not.toContain(f.validPath);
  });
  test("fails closed when bounded I/O is unavailable", async () => {
    const f = fixture();
    delete f.io.readBinaryBounded;
    expect(await f.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
    });
  });
  test("blocks unsafe native object and duplicate normalized paths", async () => {
    const f = fixture();
    f.native.lstat = async (path) =>
      path.endsWith(f.validPath)
        ? { kind: "present", objectKind: "symbolic-link" }
        : { kind: "present", objectKind: "directory" };
    expect(await f.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
      code: "M07_CATALOG_UNSAFE",
    });
    const g = fixture();
    g.add("Knowledge/É.md", "personal");
    g.add("Knowledge/E\u0301.md", "personal");
    expect(await g.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
      code: "M07_CATALOG_INCOMPLETE",
    });
  });
  test("blocks unresolved source provenance", async () => {
    const f = fixture();
    f.entries.delete("Sources/source.md");
    expect(await f.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
      code: "M07_CATALOG_INCOMPLETE",
    });
  });
  test("blocks a knowledge file that changes during observation", async () => {
    const f = fixture();
    const original = f.io.readBinaryBounded?.bind(f.io);
    if (!original) throw new Error("bounded fixture missing");
    let reads = 0;
    f.io.readBinaryBounded = async (path, maxBytes) => {
      const value = await original(path, maxBytes);
      if (path === f.validPath && ++reads === 2)
        return new TextEncoder().encode("changed");
      return value;
    };
    expect(await f.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
      code: "M07_CATALOG_INCOMPLETE",
    });
  });
  test("blocks ambiguous source registry identity even when a linked path matches", async () => {
    const f = fixture();
    f.add("Sources/duplicate.md", sourceBytes);
    expect(await f.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
      code: "M07_CATALOG_INCOMPLETE",
    });
  });
  test("sorts two eligible notes and rejects duplicate candidate fingerprints", async () => {
    const f = fixture();
    const second = renderKnowledgeNote({ ...candidate, title: "Aardvark" }, [
      {
        provider: "chatgpt",
        providerConversationId: "stable-1",
        conversationFingerprint: fingerprint,
        messageFingerprints: [messageFingerprint],
        sourceNotePath: "Sources/source.md",
      },
    ]);
    if (!second.ok) throw new Error("invalid second fixture");
    f.add(`Knowledge/${second.filename}`, second.noteContent);
    const ready = await f.adapter().readKnowledgeCatalog();
    expect(ready.status).toBe("ready");
    if (ready.status === "ready")
      expect(ready.notes.map(({ path }) => path)).toEqual(
        [...ready.notes.map(({ path }) => path)].sort(),
      );
    const duplicatePath = f.validPath.replace("Valid", "Aardvark");
    const bytes = f.bytes.get(f.validPath);
    if (!bytes) throw new Error("missing fixture");
    f.add(duplicatePath, bytes);
    expect(await f.adapter().readKnowledgeCatalog()).toMatchObject({
      status: "blocked",
      code: "M07_CATALOG_INCOMPLETE",
    });
  });
});
