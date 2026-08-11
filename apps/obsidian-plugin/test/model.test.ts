import {
  fingerprint,
  type CanonicalConversation,
  type ImportDiagnostic,
} from "@chat2vault/core";
import { describe, expect, it } from "vitest";
import {
  boundText,
  classifyResult,
  ConversationOrderCache,
  conversationDiagnosticSeverity,
  diagnosticDisplay,
  displayTimestamp,
  filterConversations,
  normalizeForSearch,
  orderConversations,
  pageItems,
  sanitizeDisplayText,
} from "../src/model.js";

const conversation = (
  title: string,
  updatedAt?: string,
): CanonicalConversation => ({
  schemaVersion: 1,
  provider: "chatgpt",
  title,
  ...(updatedAt === undefined ? {} : { updatedAt }),
  messages: [],
  metadata: {},
  contentFingerprint: `sha256:${title}`,
});

describe("preview model", () => {
  it("orders deterministically without locale semantics and filters normalized titles", () => {
    const input = [
      conversation("ä"),
      conversation("z", "2025-01-01T00:00:00Z"),
    ];
    expect(orderConversations(input).map((item) => item.title)).toEqual([
      "z",
      "ä",
    ]);
    expect(normalizeForSearch("  Ｚ  ")).toBe("z");
    expect(filterConversations(input, " Ｚ ")).toHaveLength(1);
    expect(
      filterConversations([conversation(`${"a".repeat(240)}hidden`)], "hidden"),
    ).toHaveLength(0);
  });

  it("reuses deterministic ordering for the same immutable result list", () => {
    const cache = new ConversationOrderCache();
    const input = [conversation("b"), conversation("a")];
    const first = cache.order(input);
    expect(cache.order(input)).toBe(first);
    expect(cache.order([...input])).not.toBe(first);
  });

  it("bounds queries, sanitizes controls, truncates, and pages mounted items", () => {
    expect(normalizeForSearch("x".repeat(300))).toHaveLength(240);
    expect(sanitizeDisplayText("a\u0000b\u0085c\tc\nd")).toBe("a�b�c\tc\nd");
    expect(boundText("x".repeat(50), 30)).toBe(
      "xxxxxxxxx… [preview truncated]",
    );
    expect(boundText("abcdef", 0)).toBe("");
    expect(pageItems([1, 2, 3, 4], 2, 2)).toEqual({
      items: [3, 4],
      page: 2,
      pages: 2,
    });
  });

  it("does not treat invalid timestamps as newer than valid timestamps", () => {
    expect(
      orderConversations([
        conversation("invalid", "not-a-date"),
        conversation("valid", "2025-01-01T00:00:00Z"),
      ]).map((item) => item.title),
    ).toEqual(["valid", "invalid"]);
  });

  it("allows only valid timestamps into display metadata", () => {
    expect(displayTimestamp("not-a-date")).toBeUndefined();
    expect(displayTimestamp("2026-01-01T00:00:00.000Z")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("uses the original ordinal to close a fully colliding order", () => {
    const first = conversation("same");
    const second = conversation("same");
    expect(orderConversations([first, second])).toEqual([first, second]);
    expect(orderConversations([second, first])).toEqual([second, first]);
  });

  it("derives all terminal result states", () => {
    const warning: ImportDiagnostic = {
      code: "AMBIGUOUS_BRANCH",
      severity: "warning",
      message: "w",
    };
    const error: ImportDiagnostic = {
      code: "MALFORMED_JSON",
      severity: "error",
      message: "e",
    };
    expect(classifyResult(1, [])).toBe("success");
    expect(classifyResult(1, [warning])).toBe("success-with-warnings");
    expect(classifyResult(1, [error])).toBe("partial-success");
    expect(classifyResult(1, [warning, error])).toBe("partial-success");
    expect(classifyResult(0, [error])).toBe("error");
    expect(classifyResult(0, [])).toBe("error");
    expect(classifyResult(0, [warning])).toBe("error");
    expect(classifyResult(0, [warning, error])).toBe("error");
  });

  it("projects diagnostics through the strict display whitelist", () => {
    const display = diagnosticDisplay({
      code: "MALFORMED_JSON",
      severity: "error",
      message: "safe",
      sourceIdentifier: "private-source",
      conversationIdentifier: "private-conversation",
      messageIdentifier: "private-message",
    });
    expect(display).toEqual({
      severity: "error",
      code: "MALFORMED_JSON",
      message: "safe",
    });
    expect(JSON.stringify(display)).not.toContain("private");
  });

  it("derives a per-conversation severity without exposing its correlation identifier", () => {
    const item = conversation("flagged");
    item.providerConversationId = "private-conversation";
    const identifier = fingerprint({
      providerIdentifier: "private-conversation",
    });
    expect(
      conversationDiagnosticSeverity(item, [
        {
          code: "AMBIGUOUS_BRANCH",
          severity: "warning",
          message: "safe",
          conversationIdentifier: identifier,
        },
      ]),
    ).toBe("warning");
  });
});
