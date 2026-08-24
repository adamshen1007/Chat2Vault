import { describe, expect, test } from "vitest";
import {
  isChat2VaultLikeMalformed,
  parseSourceRegistryEntry,
  planSourceWrite,
  renderSourceNote,
  sourceWritePlanEqual,
  type CanonicalConversation,
  type SourceDescriptor,
  type SourcePlannerInput,
} from "../src/index.js";

const source: SourceDescriptor = {
  provider: "chatgpt",
  importFormat: "chatgpt-json",
  sourceFileName: "synthetic.json",
  sourceFileFingerprint:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  importedAt: "2026-08-15T01:02:03.004Z",
};

function conversation(fingerprint = "c".repeat(64)): CanonicalConversation {
  return {
    schemaVersion: 1,
    provider: "chatgpt",
    providerConversationId: "conversation-1",
    title: "A title",
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
    contentFingerprint: `sha256:${fingerprint}`,
  };
}

describe("M03 registry and planner", () => {
  test("parses only the exact generated frontmatter byte subset", () => {
    const rendered = renderSourceNote({ source, conversation: conversation() });
    if (!rendered.ok) throw new Error(rendered.code);
    expect(
      parseSourceRegistryEntry(
        new TextEncoder().encode(rendered.noteContent),
        "Sources/note.md",
      ),
    ).toEqual({
      schemaVersion: 1,
      path: "Sources/note.md",
      provider: "chatgpt",
      providerConversationId: "conversation-1",
      contentFingerprint: `sha256:${"c".repeat(64)}`,
      importFingerprint: source.sourceFileFingerprint,
    });
    const crlf = new TextEncoder().encode(
      rendered.noteContent.replace(/\n/gu, "\r\n"),
    );
    expect(parseSourceRegistryEntry(crlf, "Sources/note.md")).toBeUndefined();
    expect(isChat2VaultLikeMalformed(crlf)).toBe(true);

    const withDelimiterInId = rendered.noteContent.replace(
      'source_conversation_id: "conversation-1"',
      'source_conversation_id: "conversation: one"',
    );
    expect(
      parseSourceRegistryEntry(
        new TextEncoder().encode(withDelimiterInId),
        "Sources/note.md",
      )?.providerConversationId,
    ).toBe("conversation: one");
  });

  test("applies the exact raw-byte malformed-warning and fatal UTF-8 matrix", () => {
    const encoder = new TextEncoder();
    const bytes = (...parts: (string | Uint8Array)[]) => {
      const chunks = parts.map((part) =>
        typeof part === "string" ? encoder.encode(part) : part,
      );
      const result = new Uint8Array(
        chunks.reduce((total, chunk) => total + chunk.length, 0),
      );
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    };
    const exactType = 'type: "ai-conversation-source"';
    const exactStatus = 'knowledge_status: "source"';
    const fixtures = [
      {
        raw: encoder.encode(`\uFEFF---\n${exactType}\n${exactStatus}\n`),
        warning: true,
      },
      {
        raw: encoder.encode(`---\r\n${exactType}\r\n${exactStatus}\r\n`),
        warning: true,
      },
      {
        raw: encoder.encode(`---\n${exactType}\n${exactStatus}\n`),
        warning: true,
      },
      {
        raw: encoder.encode(
          `---\n${exactType}\n${exactType}\n${exactStatus}\n---\n`,
        ),
        warning: true,
      },
      {
        raw: encoder.encode(`${exactType}\n${exactStatus}\n`),
        warning: false,
      },
      {
        raw: encoder.encode(`---\ntype: "wrong"\n${exactStatus}\n`),
        warning: false,
      },
      {
        raw: encoder.encode(`Body ${exactType}\n${exactStatus}\n`),
        warning: false,
      },
      {
        raw: encoder.encode(`---\n${exactType}\n`),
        warning: false,
      },
      {
        raw: bytes(
          `---\n${exactType}\n${exactStatus}\nsource_conversation_id: "`,
          new Uint8Array([0xff]),
          `"\n---\n`,
        ),
        warning: true,
      },
      {
        raw: bytes(
          `---\ntype: "ai-conversation-`,
          new Uint8Array([0xff]),
          `source"\n${exactStatus}\n---\n`,
        ),
        warning: false,
      },
      {
        raw: bytes(`---\nfield: "`, new Uint8Array([0xff]), `"\n---\n`),
        warning: false,
      },
    ];
    for (const fixture of fixtures) {
      expect(isChat2VaultLikeMalformed(fixture.raw)).toBe(fixture.warning);
      expect(
        parseSourceRegistryEntry(fixture.raw, "Sources/malformed.md"),
      ).toBeUndefined();
    }
  });

  test("rejects invalid and extended registry timestamps plus decoded lone-surrogate strings", () => {
    const rendered = renderSourceNote({ source, conversation: conversation() });
    if (!rendered.ok) throw new Error(rendered.code);
    const encoder = new TextEncoder();
    for (const candidate of [
      rendered.noteContent.replace(
        'imported_at: "2026-08-15T01:02:03.004Z"',
        'imported_at: "+010000-01-01T00:00:00.000Z"',
      ),
      rendered.noteContent.replace(
        'imported_at: "2026-08-15T01:02:03.004Z"',
        'imported_at: "2026-02-30T01:02:03.004Z"',
      ),
      rendered.noteContent.replace(
        'source_created_at: "2026-08-14T01:02:03.004Z"',
        'source_created_at: "+010000-01-01T00:00:00.000Z"',
      ),
      rendered.noteContent.replace(
        'source_conversation_id: "conversation-1"',
        'source_conversation_id: "\\ud800"',
      ),
    ])
      expect(
        parseSourceRegistryEntry(encoder.encode(candidate), "Sources/note.md"),
      ).toBeUndefined();
  });

  test("round-trips the exact largest JSON-escaped provider ID fitting the 16,384-byte trust window", () => {
    const make = (count: number) => {
      const item = conversation();
      item.providerConversationId = '"'.repeat(count);
      const rendered = renderSourceNote({ source, conversation: item });
      if (!rendered.ok) throw new Error(rendered.code);
      return rendered.noteContent;
    };
    let low = 0;
    let high = 16_384;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const parsed = parseSourceRegistryEntry(
        new TextEncoder().encode(make(middle)),
        "Sources/note.md",
      );
      if (parsed === undefined) high = middle - 1;
      else low = middle;
    }
    const accepted = new TextEncoder().encode(make(low));
    const rejected = new TextEncoder().encode(make(low + 1));
    expect(parseSourceRegistryEntry(accepted, "Sources/note.md")).toMatchObject(
      {
        providerConversationId: '"'.repeat(low),
      },
    );
    expect(
      parseSourceRegistryEntry(rejected, "Sources/note.md"),
    ).toBeUndefined();
    expect(accepted.indexOf(0x0a, accepted.indexOf(0x0a) + 1)).toBeGreaterThan(
      0,
    );
    expect(accepted.length).toBeGreaterThan(16_384);
  });

  test("classifies exact duplicates before versions and never allocates a write", () => {
    const plan = planSourceWrite({
      source,
      conversation: conversation(),
      sourceRoot: "Sources",
      platform: "darwin",
      rootStatus: "existing",
      foldersToCreate: [],
      registryEntries: [
        {
          schemaVersion: 1,
          path: "Sources/z.md",
          provider: "chatgpt",
          providerConversationId: "conversation-1",
          contentFingerprint: `sha256:${"c".repeat(64)}`,
          importFingerprint: `sha256:${"d".repeat(64)}`,
        },
        {
          schemaVersion: 1,
          path: "Sources/a.md",
          provider: "chatgpt",
          providerConversationId: "conversation-1",
          contentFingerprint: `sha256:${"c".repeat(64)}`,
          importFingerprint: `sha256:${"e".repeat(64)}`,
        },
      ],
      occupiedPaths: [],
      malformedRegistryPaths: [],
    });
    expect(plan).toMatchObject({
      disposition: "duplicate",
      existingPath: "Sources/a.md",
      duplicatePaths: ["Sources/a.md", "Sources/z.md"],
      foldersToCreate: [],
      diagnostics: [{ code: "DUPLICATE_SOURCE_REGISTRY_ENTRY" }],
    });
  });

  test("derives topology before duplicate classification", () => {
    const invalid = conversation();
    invalid.metadata = { chatgptGraph: { nodeCount: 0 } };
    const plan = planSourceWrite({
      source,
      conversation: invalid,
      sourceRoot: "Sources",
      platform: "darwin",
      rootStatus: "existing",
      foldersToCreate: [],
      registryEntries: [
        {
          schemaVersion: 1,
          path: "Sources/duplicate.md",
          provider: "chatgpt",
          providerConversationId: "conversation-1",
          contentFingerprint: invalid.contentFingerprint,
          importFingerprint: source.sourceFileFingerprint,
        },
      ],
      occupiedPaths: [],
      malformedRegistryPaths: ["Sources/bad.md"],
    });
    expect(plan).toMatchObject({
      disposition: "blocked",
      diagnostics: [
        { code: "MALFORMED_SOURCE_REGISTRY_ENTRY" },
        { code: "SOURCE_TOPOLOGY_UNAVAILABLE" },
      ],
    });
  });

  test("orders registry paths by numeric Unicode code point", () => {
    const plan = planSourceWrite({
      source,
      conversation: conversation(),
      sourceRoot: "Sources",
      platform: "darwin",
      rootStatus: "existing",
      foldersToCreate: [],
      registryEntries: ["Sources/\uE000.md", "Sources/😀.md"].map((path) => ({
        schemaVersion: 1 as const,
        path,
        provider: "chatgpt" as const,
        providerConversationId: "conversation-1",
        contentFingerprint: `sha256:${"c".repeat(64)}`,
        importFingerprint: source.sourceFileFingerprint,
      })),
      occupiedPaths: [],
      malformedRegistryPaths: [],
    });
    expect(plan).toMatchObject({
      disposition: "duplicate",
      duplicatePaths: ["Sources/\uE000.md", "Sources/😀.md"],
    });
  });

  test("allocates deterministic suffixes and classifies versions", () => {
    const next = conversation("f".repeat(64));
    const first = "2026-08-14 - Source - A title - ffffffffffff.md";
    const plan = planSourceWrite({
      source,
      conversation: next,
      sourceRoot: "Sources",
      platform: "darwin",
      rootStatus: "existing",
      foldersToCreate: [],
      registryEntries: [
        {
          schemaVersion: 1,
          path: "Sources/old.md",
          provider: "chatgpt",
          providerConversationId: "conversation-1",
          contentFingerprint: `sha256:${"c".repeat(64)}`,
          importFingerprint: source.sourceFileFingerprint,
        },
      ],
      occupiedPaths: [`Sources/${first}`],
      malformedRegistryPaths: ["Sources/bad.md"],
    });
    expect(plan).toMatchObject({
      disposition: "new-version",
      targetPath: `Sources/2026-08-14 - Source - A title - ${"f".repeat(20)}.md`,
      previousVersionPaths: ["Sources/old.md"],
      diagnostics: [{ code: "MALFORMED_SOURCE_REGISTRY_ENTRY" }],
    });
  });

  test.each([
    [[], 12],
    [[12], 20],
    [[12, 20], 32],
    [[12, 20, 32], 64],
  ] as const)(
    "allocates the next suffix after occupied lengths %j",
    (occupiedLengths, expectedLength) => {
      const next = conversation("f".repeat(64));
      const occupiedPaths = occupiedLengths.map(
        (length) =>
          `Sources/2026-08-14 - Source - A title - ${"f".repeat(length)}.md`,
      );
      const plan = planSourceWrite({
        source,
        conversation: next,
        sourceRoot: "Sources",
        platform: "darwin",
        rootStatus: "existing",
        foldersToCreate: [],
        registryEntries: [],
        occupiedPaths,
        malformedRegistryPaths: [],
      });
      expect(plan).toMatchObject({
        disposition: "new",
        targetPath: `Sources/2026-08-14 - Source - A title - ${"f".repeat(expectedLength)}.md`,
      });
    },
  );

  test("blocks after all 12/20/32/64 suffixes are occupied", () => {
    const next = conversation("f".repeat(64));
    const occupiedPaths = [12, 20, 32, 64].map(
      (length) =>
        `Sources/2026-08-14 - Source - A title - ${"f".repeat(length)}.md`,
    );
    expect(
      planSourceWrite({
        source,
        conversation: next,
        sourceRoot: "Sources",
        platform: "darwin",
        rootStatus: "existing",
        foldersToCreate: [],
        registryEntries: [],
        occupiedPaths,
        malformedRegistryPaths: [],
      }),
    ).toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_PATH_COLLISION" }],
    });
  });

  test("blocks an oversized escaped provider conversation ID before write planning", () => {
    const next = conversation();
    next.providerConversationId = "x".repeat(16_384);
    expect(
      planSourceWrite({
        source,
        conversation: next,
        sourceRoot: "Sources",
        platform: "darwin",
        rootStatus: "existing",
        foldersToCreate: [],
        registryEntries: [],
        occupiedPaths: [],
        malformedRegistryPaths: [],
      }),
    ).toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "INVALID_SOURCE_RENDER_INPUT" }],
    });
  });

  test("uses normalization collision keys when an occupied target has a different raw spelling", () => {
    const next = conversation();
    next.title = "Café";
    const first = planSourceWrite({
      source,
      conversation: next,
      sourceRoot: "Sources",
      platform: "darwin",
      rootStatus: "existing",
      foldersToCreate: [],
      registryEntries: [],
      occupiedPaths: [],
      malformedRegistryPaths: [],
    });
    if (first.disposition !== "new") throw new Error("expected first target");
    const rawNfd = first.targetPath.replace("é", "e\u0301");
    expect(rawNfd).not.toBe(first.targetPath);
    const second = planSourceWrite({
      source,
      conversation: next,
      sourceRoot: "Sources",
      platform: "darwin",
      rootStatus: "existing",
      foldersToCreate: [],
      registryEntries: [],
      occupiedPaths: [rawNfd],
      malformedRegistryPaths: [],
    });
    expect(second).toMatchObject({ disposition: "new" });
    if (second.disposition !== "new") return;
    expect(second.targetPath.endsWith(`- ${"c".repeat(20)}.md`)).toBe(true);
  });

  test("enforces exact 1024-unit and 2048-byte target path boundaries", () => {
    const baseInput = {
      source,
      conversation: conversation(),
      platform: "darwin",
      rootStatus: "existing" as const,
      foldersToCreate: [],
      registryEntries: [],
      occupiedPaths: [],
      malformedRegistryPaths: [],
    };
    const sample = planSourceWrite({ ...baseInput, sourceRoot: "R" });
    if (sample.disposition !== "new") throw new Error("expected sample target");
    const filePart = sample.targetPath.slice(2);
    const unitRoot = "r".repeat(1024 - 1 - filePart.length);
    const exactUnits = planSourceWrite({ ...baseInput, sourceRoot: unitRoot });
    expect(exactUnits).toMatchObject({ disposition: "new" });
    if (exactUnits.disposition !== "new") return;
    expect(exactUnits.targetPath.length).toBe(1024);
    expect(
      planSourceWrite({ ...baseInput, sourceRoot: `${unitRoot}r` }),
    ).toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_PATH_TOO_LONG" }],
    });

    const fileBytes = new TextEncoder().encode(`/${filePart}`).length;
    const remaining = 2048 - fileBytes;
    const byteRoot = `${"界".repeat(Math.floor(remaining / 3))}${"r".repeat(
      remaining % 3,
    )}`;
    const exactBytes = planSourceWrite({ ...baseInput, sourceRoot: byteRoot });
    expect(exactBytes).toMatchObject({ disposition: "new" });
    if (exactBytes.disposition !== "new") return;
    expect(new TextEncoder().encode(exactBytes.targetPath).length).toBe(2048);
    expect(
      planSourceWrite({ ...baseInput, sourceRoot: `${byteRoot}r` }),
    ).toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_PATH_TOO_LONG" }],
    });
  });

  test("fits CJK filenames under the exact 180-unit and 240-byte component limits", () => {
    const item = conversation();
    item.title = "界".repeat(200);
    const result = planSourceWrite({
      source,
      conversation: item,
      sourceRoot: "Sources",
      platform: "darwin",
      rootStatus: "existing",
      foldersToCreate: [],
      registryEntries: [],
      occupiedPaths: [],
      malformedRegistryPaths: [],
    });
    expect(result).toMatchObject({ disposition: "new" });
    if (result.disposition !== "new") return;
    const filename = result.targetPath.slice(
      result.targetPath.lastIndexOf("/") + 1,
    );
    expect(filename.length).toBeLessThanOrEqual(180);
    expect(new TextEncoder().encode(filename).length).toBeLessThanOrEqual(240);
  });

  test("invalid content fingerprint wins before allocation even for an over-limit target", () => {
    const item = conversation();
    item.contentFingerprint = "invalid";
    expect(
      planSourceWrite({
        source,
        conversation: item,
        sourceRoot: "r".repeat(2000),
        platform: "darwin",
        rootStatus: "existing",
        foldersToCreate: [],
        registryEntries: [],
        occupiedPaths: ["anything"],
        malformedRegistryPaths: ["Sources/bad.md"],
      }),
    ).toEqual({
      disposition: "blocked",
      foldersToCreate: [],
      diagnostics: [
        expect.objectContaining({ code: "INVALID_SOURCE_RENDER_INPUT" }),
      ],
    });
  });

  test("applies pending/platform/provider/root gate precedence", () => {
    const base = {
      source,
      conversation: conversation(),
      sourceRoot: "",
      platform: "linux" as const,
      rootStatus: "blocked" as const,
      rootError: "SOURCE_ROOT_UNCONFIGURED" as const,
      foldersToCreate: [] as string[],
      registryEntries: [],
      occupiedPaths: [],
      malformedRegistryPaths: [],
    };
    expect(planSourceWrite({ ...base, settingsPending: true })).toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "SOURCE_ROOT_SETTING_PENDING" }],
    });
    expect(planSourceWrite(base)).toMatchObject({
      disposition: "blocked",
      diagnostics: [{ code: "UNSUPPORTED_SOURCE_WRITER_PLATFORM" }],
    });
  });

  test("applies every pre-registry gate before warnings, classification, allocation, and render", () => {
    const base = {
      source,
      conversation: conversation(),
      sourceRoot: "Sources",
      platform: "darwin",
      rootStatus: "existing" as const,
      foldersToCreate: [],
      registryEntries: [
        {
          schemaVersion: 1 as const,
          path: "Sources/duplicate.md",
          provider: "chatgpt" as const,
          contentFingerprint: `sha256:${"c".repeat(64)}`,
          importFingerprint: source.sourceFileFingerprint,
        },
      ],
      occupiedPaths: ["Sources/occupied.md"],
      malformedRegistryPaths: ["Sources/malformed.md"],
    };
    const cases = [
      {
        input: { ...base, settingsPending: true },
        code: "SOURCE_ROOT_SETTING_PENDING",
      },
      {
        input: { ...base, platform: "linux" },
        code: "UNSUPPORTED_SOURCE_WRITER_PLATFORM",
      },
      {
        input: {
          ...base,
          conversation: { ...base.conversation, provider: "unknown" },
        },
        code: "UNSUPPORTED_SOURCE_PROVIDER",
      },
      {
        input: {
          ...base,
          rootStatus: "blocked" as const,
          rootError: "SOURCE_REGISTRY_ENUMERATION_FAILED" as const,
        },
        code: "SOURCE_REGISTRY_ENUMERATION_FAILED",
      },
      {
        input: {
          ...base,
          conversation: {
            ...base.conversation,
            contentFingerprint: "invalid",
          },
        },
        code: "INVALID_SOURCE_RENDER_INPUT",
      },
      {
        input: {
          ...base,
          conversation: {
            ...base.conversation,
            providerConversationId: "bad\ud800id",
          },
        },
        code: "INVALID_SOURCE_RENDER_INPUT",
      },
    ];
    for (const fixture of cases) {
      const result = planSourceWrite(fixture.input as SourcePlannerInput);
      expect(result.disposition).toBe("blocked");
      expect(result.diagnostics.map(({ code }) => code)).toEqual([
        fixture.code,
      ]);
    }
  });

  test("orders malformed warnings before topology failure after registry access", () => {
    const item = conversation();
    item.metadata.chatgptGraph = { nodeCount: 0 };
    const result = planSourceWrite({
      source,
      conversation: item,
      sourceRoot: "Sources",
      platform: "darwin",
      rootStatus: "existing",
      foldersToCreate: [],
      registryEntries: [],
      occupiedPaths: [],
      malformedRegistryPaths: ["Sources/z.md", "Sources/a.md"],
    });
    expect(result).toMatchObject({ disposition: "blocked" });
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "MALFORMED_SOURCE_REGISTRY_ENTRY",
      "MALFORMED_SOURCE_REGISTRY_ENTRY",
      "SOURCE_TOPOLOGY_UNAVAILABLE",
    ]);
  });

  test("compares plans structurally and rejects extra fields or reordered arrays", () => {
    const plan = planSourceWrite({
      source,
      conversation: conversation(),
      sourceRoot: "Sources/Deep",
      platform: "darwin",
      rootStatus: "partially-missing",
      foldersToCreate: ["Sources", "Sources/Deep"],
      registryEntries: [],
      occupiedPaths: [],
      malformedRegistryPaths: [],
    });
    expect(sourceWritePlanEqual(plan, structuredClone(plan))).toBe(true);
    expect(sourceWritePlanEqual(plan, { ...plan, extra: true })).toBe(false);
    if (plan.disposition === "new" || plan.disposition === "new-version") {
      expect(
        sourceWritePlanEqual(plan, {
          ...plan,
          foldersToCreate: [...plan.foldersToCreate].reverse(),
        }),
      ).toBe(false);
    }
  });
});
