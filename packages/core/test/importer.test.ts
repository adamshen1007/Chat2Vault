import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compareStableStrings,
  parseChatGptExport,
  stableStringify,
} from "../src/index.js";
import { createStoredZip, createZip } from "./zip-fixture.js";

const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/chatgpt/", import.meta.url),
);
const fixedOptions = { importedAt: "2026-08-09T00:00:00.000Z" } as const;

async function fixture(name: string): Promise<Uint8Array> {
  return readFile(`${fixtureRoot}${name}`);
}

async function parseFixture(name: string) {
  return parseChatGptExport(
    { fileName: name, data: await fixture(name) },
    fixedOptions,
  );
}

function zipU32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function findZipSignature(data: Uint8Array, signature: number): number {
  for (let offset = 0; offset <= data.length - 4; offset += 1) {
    if (zipU32(data, offset) === signature) return offset;
  }
  throw new Error("Synthetic ZIP signature not found.");
}

function writeZip16(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
}

describe("ChatGPT JSON normalization", () => {
  it("parses a minimal valid export into schema version 1", async () => {
    const result = await parseFixture("minimal.json");
    expect(result.diagnostics).toEqual([]);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({
      schemaVersion: 1,
      provider: "chatgpt",
      providerConversationId: "conversation-minimal",
    });
    expect(result.conversations[0]?.messages).toHaveLength(2);
  });

  it("parses multiple conversations", async () => {
    expect((await parseFixture("multiple.json")).conversations).toHaveLength(2);
  });

  it("preserves Unicode and CJK text", async () => {
    const result = await parseFixture("unicode-cjk.json");
    expect(result.conversations[0]?.messages[0]?.content[0]).toEqual({
      type: "text",
      text: "你好，世界 🌏 — café",
    });
  });

  it("preserves multiline code content", async () => {
    const result = await parseFixture("multiline-code.json");
    expect(result.conversations[0]?.messages[0]?.content[0]).toEqual({
      type: "code",
      text: "const value = 1;\nconsole.log(value);\n",
    });
  });

  it("tolerates missing optional metadata", async () => {
    const result = await parseFixture("missing-optional.json");
    expect(result.conversations[0]).not.toHaveProperty(
      "providerConversationId",
    );
    expect(result.conversations[0]?.messages[0]?.role).toBe("unknown");
  });

  it("ignores out-of-range provider timestamps without throwing", () => {
    const data = new TextEncoder().encode(
      '[{"id":"timestamp","create_time":1e300,"current_node":"n","mapping":{"n":{"id":"n","parent":null,"children":[],"message":{"id":"n","create_time":1e300,"author":{"role":"user"},"content":{"parts":["safe"]}}}}}]',
    );
    const result = parseChatGptExport(
      { fileName: "timestamps.json", data },
      fixedOptions,
    );
    expect(result.conversations[0]).not.toHaveProperty("createdAt");
    expect(result.conversations[0]?.messages[0]).not.toHaveProperty(
      "createdAt",
    );
  });

  it("tolerates unknown provider fields", async () => {
    expect(
      (await parseFixture("unknown-fields.json")).conversations,
    ).toHaveLength(1);
  });

  it("preserves every branch and documents a deterministic ambiguous selection", async () => {
    const result = await parseFixture("branching.json");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "AMBIGUOUS_BRANCH",
        severity: "warning",
      }),
    );
    expect(result.conversations[0]?.messages).toHaveLength(3);
    expect(result.conversations[0]?.metadata.chatgptGraph).toEqual({
      nodeCount: 3,
      selectedPathNodeIds: ["root", "left"],
      alternativeLeafNodeIds: ["right"],
      currentNodeId: null,
    });
  });

  it("warns and records a deterministic fallback for a cyclic graph", async () => {
    const result = await parseFixture("cyclic-graph.json");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INVALID_MESSAGE_GRAPH",
        severity: "warning",
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "AMBIGUOUS_BRANCH" }),
    );
    expect(result.conversations[0]?.messages).toHaveLength(2);
    expect(
      (
        result.conversations[0]?.metadata.chatgptGraph as {
          selectedPathNodeIds: string[];
        }
      ).selectedPathNodeIds,
    ).toEqual(["cycle-b", "cycle-a"]);
  });

  it("uses mapping keys as deterministic structure when declared node IDs duplicate", () => {
    const conversationPrefix =
      '{"id":"duplicate-nodes","mapping":{"mapping-a":{"id":"declared-duplicate","parent":null,"children":[],"message":{"id":"message-a","author":{"role":"user"},"content":{"parts":["A"]}}},"mapping-b":{"id":"declared-duplicate","parent":null,"children":[],"message":{"id":"message-b","author":{"role":"assistant"},"content":{"parts":["B"]}}}}}';
    const reordered =
      '{"mapping":{"mapping-b":{"message":{"content":{"parts":["B"]},"author":{"role":"assistant"},"id":"message-b"},"children":[],"parent":null,"id":"declared-duplicate"},"mapping-a":{"message":{"content":{"parts":["A"]},"author":{"role":"user"},"id":"message-a"},"children":[],"parent":null,"id":"declared-duplicate"}},"id":"duplicate-nodes"}';
    const first = parseChatGptExport(
      {
        fileName: "duplicate-nodes.json",
        data: new TextEncoder().encode(`[${conversationPrefix}]`),
      },
      fixedOptions,
    );
    const second = parseChatGptExport(
      {
        fileName: "duplicate-nodes.json",
        data: new TextEncoder().encode(`[${reordered}]`),
      },
      fixedOptions,
    );
    expect(first.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_MESSAGE_GRAPH" }),
    );
    expect(
      first.conversations[0]?.messages.map(
        ({ providerMessageId }) => providerMessageId,
      ),
    ).toEqual(["message-a", "message-b"]);
    expect(second.conversations[0]?.contentFingerprint).toBe(
      first.conversations[0]?.contentFingerprint,
    );
  });

  it("warns about an orphan parent while preserving the message", async () => {
    const result = await parseFixture("orphan-parent.json");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ORPHAN_PARENT" }),
    );
    expect(result.conversations[0]?.messages).toHaveLength(1);
  });

  it("warns about duplicate provider message IDs while preserving nodes", async () => {
    const result = await parseFixture("duplicate-message-id.json");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_MESSAGE_ID" }),
    );
    expect(result.conversations[0]?.messages).toHaveLength(2);
  });

  it("hashes untrusted provider identifiers before including them in diagnostics", () => {
    const sensitiveId = "SYNTHETIC-PRIVATE-IDENTIFIER-".repeat(20);
    const data = new TextEncoder().encode(
      JSON.stringify([
        {
          id: "diagnostic-privacy",
          current_node: "node-2",
          mapping: {
            "node-1": {
              id: "node-1",
              parent: null,
              children: ["node-2"],
              message: {
                id: sensitiveId,
                author: { role: "user" },
                content: { parts: ["synthetic"] },
              },
            },
            "node-2": {
              id: "node-2",
              parent: "node-1",
              children: [],
              message: {
                id: sensitiveId,
                author: { role: "assistant" },
                content: { parts: ["synthetic"] },
              },
            },
          },
        },
      ]),
    );
    const result = parseChatGptExport(
      { fileName: "identifier-privacy.json", data },
      fixedOptions,
    );
    const serializedDiagnostics = JSON.stringify(result.diagnostics);
    expect(serializedDiagnostics).not.toContain(sensitiveId);
    const duplicateDiagnostic = result.diagnostics.find(
      ({ code }) => code === "DUPLICATE_MESSAGE_ID",
    );
    expect(duplicateDiagnostic?.messageIdentifier).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
  });

  it("returns a typed error for malformed JSON without leaking its input", async () => {
    const result = await parseFixture("malformed.json");
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "MALFORMED_JSON", severity: "error" }),
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain("malformed");
  });

  it("returns a typed error for an unsupported JSON shape", async () => {
    expect(
      (await parseFixture("unsupported-shape.json")).diagnostics,
    ).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_JSON_SHAPE" }),
    );
  });

  it("rejects invalid members inside an export collection", () => {
    const result = parseChatGptExport(
      {
        fileName: "invalid-collection.json",
        data: new TextEncoder().encode('[{"mapping":{}},42]'),
      },
      fixedOptions,
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_JSON_SHAPE" }),
    );
  });

  it("accepts a set of numbered conversation JSON files", async () => {
    const result = parseChatGptExport(
      [
        {
          fileName: "conversation-1.json",
          data: await fixture("numbered-conversation-1.json"),
        },
        {
          fileName: "conversation-2.json",
          data: await fixture("numbered-conversation-2.json"),
        },
      ],
      fixedOptions,
    );
    expect(result.source.importFormat).toBe("chatgpt-json-numbered-set");
    expect(result.conversations).toHaveLength(2);
  });

  it("canonicalizes numbered input-set order", async () => {
    const one = {
      fileName: "conversation-1.json",
      data: await fixture("numbered-conversation-1.json"),
    };
    const two = {
      fileName: "conversation-2.json",
      data: await fixture("numbered-conversation-2.json"),
    };
    const first = parseChatGptExport([one, two], fixedOptions);
    const reversed = parseChatGptExport([two, one], fixedOptions);
    expect(stableStringify(reversed)).toBe(stableStringify(first));
  });
});

describe("hostile ZIP handling", () => {
  it("reads a DEFLATE-compressed conversations.json entry", async () => {
    const zip = createZip(
      [{ name: "conversations.json", data: await fixture("minimal.json") }],
      "deflate",
    );
    const result = parseChatGptExport(
      { fileName: "deflate.zip", data: zip },
      fixedOptions,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.conversations).toHaveLength(1);
  });

  it("reads conversations.json in memory and ignores safe unrelated entries", async () => {
    const zip = createStoredZip([
      { name: "conversations.json", data: await fixture("minimal.json") },
      { name: "chat.html", data: new TextEncoder().encode("synthetic") },
    ]);
    const result = parseChatGptExport(
      { fileName: "export.zip", data: zip },
      fixedOptions,
    );
    expect(result.conversations).toHaveLength(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_ARCHIVE_ENTRY",
        severity: "warning",
      }),
    );
  });

  it("neutralizes safe directory entries without rejecting the archive", async () => {
    const zip = createStoredZip([
      { name: "folder/", data: new Uint8Array() },
      {
        name: "folder/conversations.json",
        data: await fixture("minimal.json"),
      },
    ]);
    expect(
      parseChatGptExport({ fileName: "directory.zip", data: zip }, fixedOptions)
        .conversations,
    ).toHaveLength(1);
  });

  it("rejects a ZIP without conversation JSON", () => {
    const zip = createStoredZip([
      { name: "readme.txt", data: new TextEncoder().encode("synthetic") },
    ]);
    expect(
      parseChatGptExport({ fileName: "empty.zip", data: zip }, fixedOptions)
        .diagnostics,
    ).toContainEqual(
      expect.objectContaining({
        code: "MISSING_CONVERSATIONS_JSON",
        severity: "error",
      }),
    );
  });

  it("rejects traversal even when the entry would otherwise be ignored", async () => {
    const zip = createStoredZip([
      { name: "../conversations.json", data: await fixture("minimal.json") },
    ]);
    const result = parseChatGptExport(
      { fileName: "traversal.zip", data: zip },
      fixedOptions,
    );
    expect(result.conversations).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "INVALID_ARCHIVE_PATH" }),
    ]);
  });

  it.each(["/conversations.json", "C:\\conversations.json"])(
    "rejects absolute ZIP path %s",
    async (entryName) => {
      const zip = createStoredZip([
        { name: entryName, data: await fixture("minimal.json") },
      ]);
      expect(
        parseChatGptExport(
          { fileName: "absolute.zip", data: zip },
          fixedOptions,
        ).diagnostics,
      ).toEqual([expect.objectContaining({ code: "INVALID_ARCHIVE_PATH" })]);
    },
  );

  it("rejects corrupted candidate data using the ZIP checksum", async () => {
    const entryName = "conversations.json";
    const zip = createStoredZip([
      { name: entryName, data: await fixture("minimal.json") },
    ]);
    const dataOffset = 30 + entryName.length;
    zip[dataOffset] = (zip[dataOffset] ?? 0) ^ 1;
    const result = parseChatGptExport(
      { fileName: "corrupt.zip", data: zip },
      fixedOptions,
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "INVALID_ARCHIVE" }),
    ]);
  });

  it("enforces archive entry limits before reading entry data", async () => {
    const zip = createStoredZip([
      { name: "conversations.json", data: await fixture("minimal.json") },
      {
        name: "conversation-2.json",
        data: await fixture("numbered-conversation-2.json"),
      },
    ]);
    const result = parseChatGptExport(
      { fileName: "large.zip", data: zip },
      { ...fixedOptions, archiveLimits: { maxEntries: 1 } },
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "ARCHIVE_ENTRY_LIMIT_EXCEEDED" }),
    ]);
  });

  it("enforces compressed, aggregate uncompressed, and JSON byte limits", async () => {
    const json = await fixture("minimal.json");
    const zip = createStoredZip([{ name: "conversations.json", data: json }]);
    expect(
      parseChatGptExport(
        { fileName: "compressed-limit.zip", data: zip },
        {
          ...fixedOptions,
          archiveLimits: { maxCompressedBytes: zip.length - 1 },
        },
      ).diagnostics,
    ).toEqual([
      expect.objectContaining({ code: "ARCHIVE_SIZE_LIMIT_EXCEEDED" }),
    ]);
    expect(
      parseChatGptExport(
        { fileName: "uncompressed-limit.zip", data: zip },
        {
          ...fixedOptions,
          archiveLimits: { maxUncompressedBytes: json.length - 1 },
        },
      ).diagnostics,
    ).toEqual([
      expect.objectContaining({ code: "ARCHIVE_SIZE_LIMIT_EXCEEDED" }),
    ]);
    expect(
      parseChatGptExport(
        { fileName: "json-limit.zip", data: zip },
        {
          ...fixedOptions,
          archiveLimits: { maxJsonBytes: json.length - 1 },
        },
      ).diagnostics,
    ).toEqual([expect.objectContaining({ code: "JSON_SIZE_LIMIT_EXCEEDED" })]);
  });

  it("rejects encrypted entries and unsupported compression methods", async () => {
    const json = await fixture("minimal.json");
    const encrypted = createStoredZip([
      { name: "conversations.json", data: json },
    ]);
    const encryptedCentral = findZipSignature(encrypted, 0x02014b50);
    writeZip16(encrypted, encryptedCentral + 8, 1);
    expect(
      parseChatGptExport(
        { fileName: "encrypted.zip", data: encrypted },
        fixedOptions,
      ).diagnostics,
    ).toEqual([expect.objectContaining({ code: "UNSUPPORTED_ARCHIVE_ENTRY" })]);

    const unsupported = createStoredZip([
      { name: "conversations.json", data: json },
    ]);
    const unsupportedCentral = findZipSignature(unsupported, 0x02014b50);
    writeZip16(unsupported, unsupportedCentral + 10, 99);
    expect(
      parseChatGptExport(
        { fileName: "unsupported-method.zip", data: unsupported },
        fixedOptions,
      ).diagnostics,
    ).toEqual([expect.objectContaining({ code: "UNSUPPORTED_ARCHIVE_ENTRY" })]);
  });

  it("rejects ZIP64 markers and multi-disk archives", async () => {
    const json = await fixture("minimal.json");
    const zip64 = createStoredZip([{ name: "conversations.json", data: json }]);
    const zip64End = findZipSignature(zip64, 0x06054b50);
    writeZip16(zip64, zip64End + 8, 0xffff);
    writeZip16(zip64, zip64End + 10, 0xffff);
    expect(
      parseChatGptExport({ fileName: "zip64.zip", data: zip64 }, fixedOptions)
        .diagnostics,
    ).toEqual([expect.objectContaining({ code: "UNSUPPORTED_ARCHIVE_ENTRY" })]);

    const multiDisk = createStoredZip([
      { name: "conversations.json", data: json },
    ]);
    const multiDiskEnd = findZipSignature(multiDisk, 0x06054b50);
    writeZip16(multiDisk, multiDiskEnd + 4, 1);
    expect(
      parseChatGptExport(
        { fileName: "multi-disk.zip", data: multiDisk },
        fixedOptions,
      ).diagnostics,
    ).toEqual([expect.objectContaining({ code: "UNSUPPORTED_ARCHIVE_ENTRY" })]);
  });
});

describe("fingerprints and deterministic serialization", () => {
  it("uses locale-independent UTF-16 ordering for canonical objects and nodes", () => {
    expect(["ä", "z"].sort(compareStableStrings)).toEqual(["z", "ä"]);
    expect(stableStringify({ ä: 1, z: 2 })).toBe('{"z":2,"ä":1}');
    const data = new TextEncoder().encode(
      JSON.stringify([
        {
          id: "locale-order",
          mapping: {
            ä: {
              id: "ä",
              parent: null,
              children: [],
              message: {
                id: "ä",
                author: { role: "assistant" },
                content: { parts: ["umlaut"] },
              },
            },
            z: {
              id: "z",
              parent: null,
              children: [],
              message: {
                id: "z",
                author: { role: "user" },
                content: { parts: ["latin"] },
              },
            },
          },
        },
      ]),
    );
    const result = parseChatGptExport(
      { fileName: "locale.json", data },
      fixedOptions,
    );
    expect(
      result.conversations[0]?.messages.map(
        ({ providerMessageId }) => providerMessageId,
      ),
    ).toEqual(["z", "ä"]);
  });

  it("is byte-equivalent across repeated imports", async () => {
    const first = await parseFixture("minimal.json");
    const second = await parseFixture("minimal.json");
    expect(stableStringify(first)).toBe(stableStringify(second));
  });

  it("changes message and conversation fingerprints when content changes", async () => {
    const original = await fixture("minimal.json");
    const changed = new TextEncoder().encode(
      new TextDecoder()
        .decode(original)
        .replace("Hello, synthetic world.", "Changed synthetic content."),
    );
    const before = parseChatGptExport(
      { fileName: "minimal.json", data: original },
      fixedOptions,
    );
    const after = parseChatGptExport(
      { fileName: "minimal.json", data: changed },
      fixedOptions,
    );
    expect(after.conversations[0]?.messages[0]?.fingerprint).not.toBe(
      before.conversations[0]?.messages[0]?.fingerprint,
    );
    expect(after.conversations[0]?.contentFingerprint).not.toBe(
      before.conversations[0]?.contentFingerprint,
    );
  });

  it("does not use the conversation title as content identity", async () => {
    const original = await fixture("minimal.json");
    const renamed = new TextEncoder().encode(
      new TextDecoder()
        .decode(original)
        .replace("Synthetic minimal", "Renamed synthetic conversation"),
    );
    const before = parseChatGptExport(
      { fileName: "minimal.json", data: original },
      fixedOptions,
    );
    const after = parseChatGptExport(
      { fileName: "minimal.json", data: renamed },
      fixedOptions,
    );
    expect(after.conversations[0]?.title).not.toBe(
      before.conversations[0]?.title,
    );
    expect(after.conversations[0]?.contentFingerprint).toBe(
      before.conversations[0]?.contentFingerprint,
    );
  });

  it("does not let non-semantic object-key order destabilize canonical fingerprints", () => {
    const first = parseChatGptExport(
      {
        fileName: "conversation-1.json",
        data: new TextEncoder().encode(
          '{"id":"order","current_node":"n","mapping":{"n":{"id":"n","parent":null,"children":[],"message":{"id":"n","author":{"role":"user"},"content":{"parts":["same"]}}}}}',
        ),
      },
      fixedOptions,
    );
    const second = parseChatGptExport(
      {
        fileName: "conversation-1.json",
        data: new TextEncoder().encode(
          '{"mapping":{"n":{"message":{"content":{"parts":["same"]},"author":{"role":"user"},"id":"n"},"children":[],"parent":null,"id":"n"}},"current_node":"n","id":"order"}',
        ),
      },
      fixedOptions,
    );
    expect(second.conversations[0]?.contentFingerprint).toBe(
      first.conversations[0]?.contentFingerprint,
    );
    expect(second.conversations[0]?.messages[0]?.fingerprint).toBe(
      first.conversations[0]?.messages[0]?.fingerprint,
    );
  });

  it("never reproduces an entire sensitive message in diagnostics", () => {
    const sensitive = "SYNTHETIC-SENSITIVE-BODY-".repeat(100);
    const result = parseChatGptExport(
      {
        fileName: "bad.json",
        data: new TextEncoder().encode(`{"message":"${sensitive}"`),
      },
      fixedOptions,
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain(sensitive);
    expect(JSON.stringify(result.diagnostics).length).toBeLessThan(500);
  });
});
