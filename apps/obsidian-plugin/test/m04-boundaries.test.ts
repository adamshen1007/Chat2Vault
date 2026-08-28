/* eslint-disable @typescript-eslint/no-extraneous-class, @typescript-eslint/no-non-null-assertion, @typescript-eslint/require-await -- throwing constructor tripwires and proven fixture values model forbidden browser surfaces. */
import { describe, expect, it, vi } from "vitest";
import type { CanonicalConversation } from "@chat2vault/core";
import { ManualDistillationController } from "../src/distillation-controller.js";

const conversation: CanonicalConversation = {
  schemaVersion: 1,
  provider: "unknown",
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "Synthetic boundary input" }],
      metadata: {},
      fingerprint: `sha256:${"1".repeat(64)}`,
    },
  ],
  metadata: {},
  contentFingerprint: `sha256:${"2".repeat(64)}`,
};

describe("M04 side-effect boundary", () => {
  it("uses only the injected explicit clipboard writer for the complete round trip", async () => {
    const forbidden = vi.fn(() => {
      throw new Error("forbidden M04 side effect");
    });
    vi.stubGlobal("fetch", forbidden);
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        public constructor() {
          forbidden();
        }
      },
    );
    vi.stubGlobal(
      "WebSocket",
      class {
        public constructor() {
          forbidden();
        }
      },
    );
    vi.stubGlobal(
      "EventSource",
      class {
        public constructor() {
          forbidden();
        }
      },
    );
    const clipboard = vi.fn(async () => undefined);
    const controller = new ManualDistillationController({
      current: () => ({
        loaded: true,
        selectionGeneration: 1,
        importGeneration: 1,
        conversation,
      }),
      writeClipboard: clipboard,
    });
    expect((await controller.prepare()).status).toBe("prepared");
    expect((await controller.copy()).status).toBe("copied");
    const request = controller.snapshot.request!;
    controller.setPaste(
      JSON.stringify({
        schemaVersion: 1,
        contractVersion: "m04-manual-v1",
        requestId: request.requestId,
        conversationFingerprint: request.conversationFingerprint,
        candidates: [
          {
            type: "insight",
            title: "Boundary proof",
            summary: "No forbidden surface was called.",
            body: "The manual controller remained in memory.",
            confidence: "high",
            sourceMessageFingerprints: [request.messages[0]!.fingerprint],
            suggestedLinks: [],
            suggestedTags: [],
          },
        ],
      }),
    );
    expect((await controller.validate()).status).toBe("valid");
    expect(clipboard).toHaveBeenCalledOnce();
    expect(forbidden).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
