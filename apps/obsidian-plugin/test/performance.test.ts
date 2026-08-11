import type { CanonicalConversation, ImportDiagnostic } from "@chat2vault/core";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  filterConversations,
  orderConversations,
  pageItems,
} from "../src/model.js";

describe("bounded model performance", () => {
  it("orders and filters 10,000 conversations within the pure-model budgets", () => {
    const conversations: CanonicalConversation[] = Array.from(
      { length: 10_000 },
      (_, ordinal) => ({
        schemaVersion: 1,
        provider: "chatgpt",
        title: `Conversation ${String(ordinal).padStart(5, "0")}`,
        updatedAt: "2026-01-01T00:00:00.000Z",
        messages: [],
        metadata: {},
        contentFingerprint: `sha256:${String(ordinal).padStart(64, "0")}`,
      }),
    );
    const start = performance.now();
    const ordered = orderConversations(conversations);
    const initial = performance.now() - start;
    const samples = Array.from({ length: 20 }, (_, index) => {
      const sampleStart = performance.now();
      filterConversations(ordered, ` ${String(index)} `);
      return performance.now() - sampleStart;
    }).sort((left, right) => left - right);
    expect(initial).toBeLessThanOrEqual(250);
    expect(samples[18]).toBeLessThanOrEqual(100);
  });

  it("keeps all 50,000 diagnostics reachable in pages of 25", () => {
    const diagnostics: ImportDiagnostic[] = Array.from(
      { length: 50_000 },
      () => ({
        code: "MALFORMED_JSON",
        severity: "error",
        message: "synthetic",
      }),
    );
    const start = performance.now();
    const last = pageItems(diagnostics, 2000, 25);
    expect(performance.now() - start).toBeLessThanOrEqual(100);
    expect(last.items).toHaveLength(25);
    expect(last.page).toBe(2000);
    expect(last.pages).toBe(2000);
  });
});
