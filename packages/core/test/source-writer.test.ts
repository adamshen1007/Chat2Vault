import { describe, expect, test } from "vitest";
import {
  isCanonicalM03Timestamp,
  normalizeSourceRoot,
  pathCollisionKey,
  renderSourceNote,
  safeSourceTitle,
  sourceMarkdownPreview,
  toM03WellFormedString,
  type CanonicalConversation,
  type SourceDescriptor,
} from "../src/index.js";

const source: SourceDescriptor = {
  provider: "chatgpt",
  importFormat: "chatgpt-json",
  sourceFileName: "synthetic.json",
  sourceFileFingerprint:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  importedAt: "2026-08-15T01:02:03.004Z",
};

const conversation: CanonicalConversation = {
  schemaVersion: 1,
  provider: "chatgpt",
  providerConversationId: "conversation-1",
  title: "# Hostile\r\nTitle",
  createdAt: "2026-08-14T01:02:03.004Z",
  updatedAt: "2026-08-15T01:02:03.004Z",
  messages: [
    {
      providerMessageId: "provider-message-1",
      role: "user",
      createdAt: "2026-08-14T01:03:03.004Z",
      content: [{ type: "text", text: "# not a heading\n<script>x</script>" }],
      metadata: { providerNodeId: "node-1" },
      fingerprint:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  ],
  metadata: {
    chatgptGraph: {
      nodeCount: 1,
      selectedPathNodeIds: ["node-1"],
      alternativeLeafNodeIds: [],
      currentNodeId: "node-1",
    },
  },
  contentFingerprint:
    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
};

describe("M03 source writer primitives", () => {
  test("normalizes a valid source root and rejects unsafe roots", () => {
    expect(normalizeSourceRoot("Sources/Cafe\u0301")).toEqual({
      status: "configured",
      sourceRoot: "Sources/Café",
    });
    for (const value of [
      "/Sources",
      "Sources\\Child",
      "Sources/../Escape",
      "Sources/.hidden",
      "Sources/CON",
      "Sources/trailing.",
      "C:/Sources",
    ]) {
      expect(normalizeSourceRoot(value)).toEqual({ status: "invalid" });
    }
    expect(normalizeSourceRoot("")).toEqual({ status: "unconfigured" });
  });

  test.each([
    "Sources/<",
    "Sources/>",
    "Sources/:",
    'Sources/"',
    "Sources/|",
    "Sources/?",
    "Sources/*",
    "Sources/aux.txt",
    "Sources/COM¹.log",
    "Sources/trailing ",
    "Sources//child",
    "Sources/\ud800",
    "Sources/\udc00",
    "Sources/a\ud800b",
  ] as const)("rejects portable or ill-formed root fixture %s", (value) => {
    expect(normalizeSourceRoot(value)).toEqual({ status: "invalid" });
  });

  test("rejects control characters deterministically across repeated calls", () => {
    for (let index = 0; index < 4; index += 1) {
      expect(normalizeSourceRoot("Sources/unsafe\u0001root")).toEqual({
        status: "invalid",
      });
    }
  });

  test("uses total Unicode and timestamp predicates", () => {
    expect(toM03WellFormedString("a\ud800b")).toBe("a�b");
    expect(isCanonicalM03Timestamp("2024-02-29T23:59:59.999Z")).toBe(true);
    expect(isCanonicalM03Timestamp("2023-02-29T23:59:59.999Z")).toBe(false);
    expect(isCanonicalM03Timestamp("+010000-01-01T00:00:00.000Z")).toBe(false);
    expect(isCanonicalM03Timestamp(null)).toBe(false);
  });

  test.each([
    ["2024-02-29T23:59:59.999Z", true],
    ["2023-02-29T23:59:59.999Z", false],
    ["2026-00-01T00:00:00.000Z", false],
    ["2026-13-01T00:00:00.000Z", false],
    ["2026-04-31T00:00:00.000Z", false],
    ["2026-01-01T00:00:60.000Z", false],
    ["0000-01-01T00:00:00.000Z", true],
    ["+010000-01-01T00:00:00.000Z", false],
    ["not-a-date", false],
    [7, false],
  ] as const)("evaluates total timestamp fixture %s", (value, expected) => {
    expect(isCanonicalM03Timestamp(value)).toBe(expected);
  });

  test("derives portable title and path collision keys", () => {
    expect(safeSourceTitle("  A::B / C  ")).toBe("A-B - C");
    expect(pathCollisionKey("Sources/Cafe\u0301.md")).toBe("sources/café.md");
  });

  test("renders deterministic inert Markdown with trusted topology refs", () => {
    const rendered = renderSourceNote({ source, conversation });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.noteContent).toContain(
      'source_conversation_id: "conversation-1"\n',
    );
    expect(rendered.noteContent).toContain("# \\# Hostile�Title\n");
    expect(rendered.noteContent).toContain("- Current node: m0001\n");
    expect(rendered.noteContent).toContain(
      "<!-- chat2vault_message_fingerprint: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb -->\n",
    );
    expect(rendered.noteContent).toContain("    # not a heading\n");
    expect(rendered.noteContent).toContain("    <script>x</script>\n");
    expect(rendered.noteContent.endsWith("\n")).toBe(true);
    expect(rendered.noteContentFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  test("rejects inherited topology properties and unknown content variants", () => {
    const inheritedGraph = Object.create({
      nodeCount: 1,
      selectedPathNodeIds: ["node-1"],
      alternativeLeafNodeIds: [],
      currentNodeId: "node-1",
    }) as Record<string, unknown>;
    expect(
      renderSourceNote({
        source,
        conversation: {
          ...conversation,
          metadata: { chatgptGraph: inheritedGraph },
        },
      }),
    ).toEqual({ ok: false, code: "SOURCE_TOPOLOGY_UNAVAILABLE" });

    const hostile = structuredClone(conversation);
    const hostileMessage = hostile.messages[0];
    if (hostileMessage === undefined)
      throw new Error("missing fixture message");
    hostileMessage.content = [
      { type: "# injected", description: "payload" } as never,
    ];
    expect(renderSourceNote({ source, conversation: hostile })).toEqual({
      ok: false,
      code: "INVALID_SOURCE_RENDER_INPUT",
    });
  });

  const topologyCases: readonly (readonly [
    string,
    (item: CanonicalConversation) => void,
  ])[] = [
    [
      "graph null",
      (item: CanonicalConversation) => (item.metadata.chatgptGraph = null),
    ],
    [
      "graph array",
      (item: CanonicalConversation) => (item.metadata.chatgptGraph = []),
    ],
    [
      "nodeCount missing",
      (item: CanonicalConversation) =>
        delete (item.metadata.chatgptGraph as Record<string, unknown>)
          .nodeCount,
    ],
    [
      "nodeCount negative",
      (item: CanonicalConversation) =>
        ((item.metadata.chatgptGraph as Record<string, unknown>).nodeCount =
          -1),
    ],
    [
      "nodeCount fractional",
      (item: CanonicalConversation) =>
        ((item.metadata.chatgptGraph as Record<string, unknown>).nodeCount =
          1.5),
    ],
    [
      "nodeCount unsafe",
      (item: CanonicalConversation) =>
        ((item.metadata.chatgptGraph as Record<string, unknown>).nodeCount =
          Number.MAX_SAFE_INTEGER + 1),
    ],
    [
      "nodeCount below messages",
      (item: CanonicalConversation) =>
        ((item.metadata.chatgptGraph as Record<string, unknown>).nodeCount = 0),
    ],
    [
      "selected missing",
      (item: CanonicalConversation) =>
        delete (item.metadata.chatgptGraph as Record<string, unknown>)
          .selectedPathNodeIds,
    ],
    [
      "selected non-array",
      (item: CanonicalConversation) =>
        ((
          item.metadata.chatgptGraph as Record<string, unknown>
        ).selectedPathNodeIds = "node-1"),
    ],
    [
      "selected non-string",
      (item: CanonicalConversation) =>
        ((
          item.metadata.chatgptGraph as Record<string, unknown>
        ).selectedPathNodeIds = [1]),
    ],
    [
      "selected duplicate",
      (item: CanonicalConversation) =>
        ((
          item.metadata.chatgptGraph as Record<string, unknown>
        ).selectedPathNodeIds = ["node-1", "node-1"]),
    ],
    [
      "alternatives missing",
      (item: CanonicalConversation) =>
        delete (item.metadata.chatgptGraph as Record<string, unknown>)
          .alternativeLeafNodeIds,
    ],
    [
      "alternatives non-string",
      (item: CanonicalConversation) =>
        ((
          item.metadata.chatgptGraph as Record<string, unknown>
        ).alternativeLeafNodeIds = [null]),
    ],
    [
      "alternatives duplicate",
      (item: CanonicalConversation) =>
        ((
          item.metadata.chatgptGraph as Record<string, unknown>
        ).alternativeLeafNodeIds = ["node-1", "node-1"]),
    ],
    [
      "current missing",
      (item: CanonicalConversation) =>
        delete (item.metadata.chatgptGraph as Record<string, unknown>)
          .currentNodeId,
    ],
    [
      "current empty",
      (item: CanonicalConversation) =>
        ((item.metadata.chatgptGraph as Record<string, unknown>).currentNodeId =
          ""),
    ],
    [
      "current wrong type",
      (item: CanonicalConversation) =>
        ((item.metadata.chatgptGraph as Record<string, unknown>).currentNodeId =
          1),
    ],
    [
      "provider node missing",
      (item: CanonicalConversation) => {
        const message = item.messages[0];
        if (message !== undefined) delete message.metadata.providerNodeId;
      },
    ],
    [
      "provider node wrong type",
      (item: CanonicalConversation) => {
        const message = item.messages[0];
        if (message !== undefined) message.metadata.providerNodeId = 1;
      },
    ],
    [
      "parent wrong type",
      (item: CanonicalConversation) => {
        const message = item.messages[0];
        if (message !== undefined) message.parentMessageId = 1 as never;
      },
    ],
    [
      "provider message ID wrong type",
      (item: CanonicalConversation) => {
        const message = item.messages[0];
        if (message !== undefined) message.providerMessageId = 1 as never;
      },
    ],
  ];
  test.each(topologyCases)(
    "rejects exact topology schema branch %s",
    (_name, mutate) => {
      const item = structuredClone(conversation);
      mutate(item);
      expect(renderSourceNote({ source, conversation: item })).toEqual({
        ok: false,
        code: "SOURCE_TOPOLOGY_UNAVAILABLE",
      });
    },
  );

  test("proves forbidden provider metadata cannot serialize while allowed source provenance remains", () => {
    const first = structuredClone(conversation);
    const second = structuredClone(conversation);
    first.providerConversationId = "raw-collision";
    second.providerConversationId = "raw-collision";
    const firstMessage = first.messages[0];
    const secondMessage = second.messages[0];
    if (firstMessage === undefined || secondMessage === undefined)
      throw new Error("missing provenance fixture message");
    firstMessage.providerMessageId = "forbidden-message-alpha";
    secondMessage.providerMessageId = "forbidden-message-beta";
    firstMessage.metadata = {
      ...firstMessage.metadata,
      providerNodeId: "node-alpha",
      diagnostic: "forbidden-diagnostic-alpha",
      arbitrary: "forbidden-arbitrary-alpha",
    };
    secondMessage.metadata = {
      ...secondMessage.metadata,
      providerNodeId: "node-beta",
      diagnostic: "forbidden-diagnostic-beta",
      arbitrary: "forbidden-arbitrary-beta",
    };
    first.metadata.chatgptGraph = {
      nodeCount: 1,
      selectedPathNodeIds: ["node-alpha"],
      alternativeLeafNodeIds: [],
      currentNodeId: "node-alpha",
      forbiddenGraph: "forbidden-graph-alpha",
    };
    second.metadata.chatgptGraph = {
      nodeCount: 1,
      selectedPathNodeIds: ["node-beta"],
      alternativeLeafNodeIds: [],
      currentNodeId: "node-beta",
      forbiddenGraph: "forbidden-graph-beta",
    };
    const left = renderSourceNote({ source, conversation: first });
    const right = renderSourceNote({ source, conversation: second });
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(left.noteContent).toBe(right.noteContent);
    expect(left.noteContent).toContain(
      'source_conversation_id: "raw-collision"',
    );
    for (const forbidden of [
      "forbidden-message-alpha",
      "forbidden-message-beta",
      "forbidden-diagnostic-alpha",
      "forbidden-diagnostic-beta",
      "forbidden-arbitrary-alpha",
      "forbidden-arbitrary-beta",
      "forbidden-graph-alpha",
      "forbidden-graph-beta",
    ])
      expect(left.noteContent.includes(forbidden)).toBe(false);
  });

  test("accepts the positive branching, overlap, empty-ID, orphan, duplicate-message-ID, and extra-field topology matrix", () => {
    const item = structuredClone(conversation);
    const first = item.messages[0];
    if (first === undefined) throw new Error("missing topology fixture");
    first.providerMessageId = "duplicate-message";
    first.parentMessageId = "missing-parent";
    const second = structuredClone(first);
    second.metadata.providerNodeId = "node-2";
    second.providerMessageId = "duplicate-message";
    second.parentMessageId = "node-1";
    item.messages.push(second);
    item.metadata.chatgptGraph = {
      nodeCount: 3,
      selectedPathNodeIds: ["", "node-1", "node-2"],
      alternativeLeafNodeIds: ["", "node-1"],
      currentNodeId: "node-2",
      unexpected: "ignored",
    };
    const rendered = renderSourceNote({ source, conversation: item });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.noteContent).toContain(
      "- Selected path message refs: m0001->m0002\n",
    );
    expect(rendered.noteContent).toContain(
      "- Selected path unresolved nodes: 1\n",
    );
    expect(rendered.noteContent).toContain("- Alternative leaves: m0001\n");
    expect(rendered.noteContent).toContain(
      "- Alternative leaf unresolved nodes: 1\n",
    );
    expect(rendered.noteContent).toContain(
      "- Duplicate provider message IDs: yes\n",
    );
    expect(rendered.noteContent).toContain(
      "- Unresolved parent references: 1\n",
    );
    expect(rendered.noteContent).not.toContain("unexpected");
  });

  test.each([
    [
      "alternative leaves non-array",
      (item: CanonicalConversation) => {
        (
          item.metadata.chatgptGraph as Record<string, unknown>
        ).alternativeLeafNodeIds = "node-1";
      },
    ],
    [
      "duplicate provider node ID",
      (item: CanonicalConversation) => {
        const duplicate = structuredClone(item.messages[0]);
        if (duplicate === undefined) throw new Error("missing message");
        item.messages.push(duplicate);
        (item.metadata.chatgptGraph as Record<string, unknown>).nodeCount = 2;
      },
    ],
  ] as const)("rejects additional topology branch %s", (_name, mutate) => {
    const item = structuredClone(conversation);
    mutate(item);
    expect(renderSourceNote({ source, conversation: item })).toEqual({
      ok: false,
      code: "SOURCE_TOPOLOGY_UNAVAILABLE",
    });
  });

  test("renders the complete lone-surrogate content-field matrix as exact U+FFFD UTF-8 and preserves valid pairs", () => {
    const item = structuredClone(conversation);
    item.title = "title\ud800 low\udc00 pair😀";
    const message = item.messages[0];
    if (message === undefined) throw new Error("missing message");
    message.content = [
      { type: "text", text: "text\ud800x\udc00" },
      { type: "code", language: "lang\ud800", text: "code\udc00" },
      { type: "reference", text: "ref\ud800", url: "url\udc00" },
      { type: "unsupported", description: "unsupported\ud800x\udc00" },
    ];
    const rendered = renderSourceNote({ source, conversation: item });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    for (const exact of [
      "# title� low� pair😀",
      "    text�x�",
      "    lang�",
      "    code�",
      "    ref�",
      "    url�",
      "    unsupported�x�",
    ])
      expect(rendered.noteContent).toContain(exact);
    const bytes = new TextEncoder().encode(rendered.noteContent);
    const replacement = [0xef, 0xbf, 0xbd];
    expect(
      Array.from({ length: bytes.length - 2 }, (_, index) =>
        replacement.every((byte, offset) => bytes[index + offset] === byte),
      ).filter(Boolean).length,
    ).toBe(10);
    expect(rendered.noteContent).toContain("😀");
  });

  test("escapes U+2028/U+2029 only in frontmatter JSON and preserves body scalars", () => {
    const item = structuredClone(conversation);
    item.providerConversationId = "front\u2028middle\u2029end";
    item.title = "title\u2028\u2029";
    const message = item.messages[0];
    if (message === undefined) throw new Error("missing message");
    message.content = [{ type: "text", text: "body\u2028middle\u2029end" }];
    const rendered = renderSourceNote({ source, conversation: item });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.noteContent).toContain(
      'source_conversation_id: "front\\u2028middle\\u2029end"\n',
    );
    expect(rendered.noteContent).toContain("# title\u2028\u2029\n");
    expect(rendered.noteContent).toContain("    body\u2028middle\u2029end\n");
    expect(rendered.noteContent).not.toContain("front\u2028middle");
  });

  test("preserves allowed source strings that deliberately collide with forbidden provenance values", () => {
    const item = structuredClone(conversation);
    const collision = "raw provider metadata collision";
    item.providerConversationId = collision;
    item.title = collision;
    const message = item.messages[0];
    if (message === undefined) throw new Error("missing message");
    message.providerMessageId = collision;
    message.metadata = {
      providerNodeId: "node-1",
      diagnostic: collision,
      arbitrary: collision,
    };
    message.content = [
      { type: "text", text: collision },
      { type: "code", language: collision, text: collision },
      { type: "reference", text: collision, url: collision },
      { type: "unsupported", description: collision },
    ];
    const rendered = renderSourceNote({ source, conversation: item });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.noteContent).toContain(
      `source_conversation_id: "${collision}"`,
    );
    expect(rendered.noteContent).toContain(`# ${collision}\n`);
    expect(
      rendered.noteContent.match(new RegExp(collision, "gu"))?.length,
    ).toBe(8);
    expect(rendered.noteContent).not.toContain("providerMessageId");
    expect(rendered.noteContent).not.toContain("providerNodeId");
    expect(rendered.noteContent).not.toContain("diagnostic:");
    expect(rendered.noteContent).not.toContain("arbitrary:");
  });

  test("bounds raw Markdown display without splitting a surrogate pair", () => {
    const complete = sourceMarkdownPreview("abc");
    expect(complete).toEqual({
      completeness: "complete",
      text: "abc",
      totalUtf16Units: 3,
      displayedUtf16Units: 3,
    });
    const long = `${"a".repeat(65_535)}😀tail`;
    const bounded = sourceMarkdownPreview(long);
    expect(bounded.completeness).toBe("truncated");
    expect(bounded.text.length).toBe(65_535);
    expect(bounded.text.endsWith("\ud83d")).toBe(false);
  });

  test.each([
    [65_535, "complete"],
    [65_536, "complete"],
    [65_537, "truncated"],
  ] as const)(
    "applies exact raw Markdown UTF-16 boundary %s",
    (length, completeness) => {
      const value = "x".repeat(length);
      const display = sourceMarkdownPreview(value);
      expect(display.completeness).toBe(completeness);
      expect(display.totalUtf16Units).toBe(length);
      expect(display.displayedUtf16Units).toBe(Math.min(length, 65_536));
      expect(value.startsWith(display.text)).toBe(true);
      expect(display.text.includes("truncated")).toBe(false);
    },
  );
});
