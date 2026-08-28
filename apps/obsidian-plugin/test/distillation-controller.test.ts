/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/require-await -- controller tests use proven fixture values and injected async rejection values. */
import { describe, expect, it, vi } from "vitest";

import {
  M04_RESULT_MAX_UTF8_BYTES,
  buildDistillationRequest,
  renderDistillationPrompt,
  validateDistillationResult,
  type PromptRenderResult,
  type RequestBuildResult,
  type CanonicalConversation,
  type DistillationValidationResult,
} from "@chat2vault/core";
import { ManualDistillationController } from "../src/distillation-controller.js";

function conversation(): CanonicalConversation {
  return {
    schemaVersion: 1,
    provider: "unknown",
    providerConversationId: "controller-synthetic",
    title: "Controller synthetic",
    messages: [
      {
        providerMessageId: "message-one",
        role: "user",
        content: [{ type: "text", text: "Synthetic input" }],
        metadata: {},
        fingerprint: `sha256:${"1".repeat(64)}`,
      },
    ],
    metadata: {},
    contentFingerprint: `sha256:${"2".repeat(64)}`,
  };
}

function validResult(requestId: string, fingerprint: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    contractVersion: "m04-manual-v1",
    requestId,
    conversationFingerprint: fingerprint,
    candidates: [
      {
        type: "insight",
        title: "Safe candidate",
        summary: "Validated locally.",
        body: "The result is installed only after validation.",
        confidence: "high",
        sourceMessageFingerprints: [`sha256:${"1".repeat(64)}`],
        suggestedLinks: [],
        suggestedTags: [],
      },
    ],
  });
}

describe("ManualDistillationController", () => {
  it("prepares, explicitly copies, validates, and keeps candidates in memory", async () => {
    const copied = vi.fn(async () => undefined);
    const current = {
      loaded: true,
      selectionGeneration: 1,
      importGeneration: 1,
      conversation: conversation(),
    };
    const controller = new ManualDistillationController({
      current: () => current,
      writeClipboard: copied,
    });

    expect((await controller.prepare()).status).toBe("prepared");
    expect(controller.snapshot.request).toBeDefined();
    expect((await controller.copy()).status).toBe("copied");
    expect(copied).toHaveBeenCalledOnce();

    const request = controller.snapshot.request!;
    controller.setPaste(
      validResult(request.requestId, request.conversationFingerprint),
    );
    expect((await controller.validate()).status).toBe("valid");
    expect(controller.snapshot.candidates).toHaveLength(1);
    expect(controller.snapshot.owner).toBeUndefined();
  });

  it("makes an invalidated asynchronous completion return-only", async () => {
    let resolveDeferred!: () => void;
    const deferred = new Promise<void>((resolve) => {
      resolveDeferred = resolve;
    });
    const current = {
      loaded: true,
      selectionGeneration: 1,
      importGeneration: 1,
      conversation: conversation(),
    };
    const controller = new ManualDistillationController({
      current: () => current,
      writeClipboard: () => deferred,
    });
    await controller.prepare();
    const pending = controller.copy();
    controller.invalidate();
    const winner = controller.snapshot;
    resolveDeferred();

    expect((await pending).status).toBe("stale");
    expect(controller.snapshot).toEqual(winner);
    expect(controller.snapshot.status).toBe("empty");
    expect(controller.snapshot.owner).toBeUndefined();
  });

  it("applies the closed arbitration table without queueing or replay", async () => {
    let resolveCopy!: () => void;
    const copyPending = new Promise<void>((resolve) => {
      resolveCopy = resolve;
    });
    const current = {
      loaded: true,
      selectionGeneration: 1,
      importGeneration: 1,
      conversation: conversation(),
    };
    const controller = new ManualDistillationController({
      current: () => current,
      writeClipboard: () => copyPending,
    });
    await controller.prepare();
    const copy = controller.copy();

    expect(await controller.prepare()).toMatchObject({
      status: "prepare-in-progress",
      diagnostics: [{ code: "DISTILLATION_PREPARE_IN_PROGRESS" }],
    });
    expect(await controller.copy()).toMatchObject({
      status: "copy-in-progress",
      diagnostics: [{ code: "DISTILLATION_COPY_IN_PROGRESS" }],
    });
    expect(await controller.validate()).toMatchObject({
      status: "validate-in-progress",
      diagnostics: [{ code: "DISTILLATION_VALIDATE_IN_PROGRESS" }],
    });

    resolveCopy();
    expect((await copy).status).toBe("copied");
    expect(controller.snapshot.owner).toBeUndefined();
  });

  it.each(["Prepare", "Validate"] as const)(
    "rejects every requested operation while %s owns the mutex",
    async (owner) => {
      let resolveBuild!: (value: RequestBuildResult) => void;
      let resolveValidation!: (value: DistillationValidationResult) => void;
      const current = {
        loaded: true,
        selectionGeneration: 1,
        importGeneration: 1,
        conversation: conversation(),
      };
      const controller = new ManualDistillationController({
        current: () => current,
        writeClipboard: async () => undefined,
        ...(owner === "Prepare"
          ? {
              buildRequest: () =>
                new Promise<RequestBuildResult>((resolve) => {
                  resolveBuild = resolve;
                }),
            }
          : {}),
        ...(owner === "Validate"
          ? {
              validateResult: () =>
                new Promise<DistillationValidationResult>((resolve) => {
                  resolveValidation = resolve;
                }),
            }
          : {}),
      });
      let pending: Promise<unknown>;
      if (owner === "Prepare") pending = controller.prepare();
      else {
        await controller.prepare();
        controller.setPaste("{}");
        pending = controller.validate();
      }
      expect((await controller.prepare()).status).toBe("prepare-in-progress");
      expect((await controller.copy()).status).toBe("copy-in-progress");
      expect((await controller.validate()).status).toBe("validate-in-progress");
      if (owner === "Prepare")
        resolveBuild(buildDistillationRequest(current.conversation));
      else resolveValidation({ ok: false, diagnostics: [] });
      await pending;
      expect(controller.snapshot.owner).toBeUndefined();
    },
  );

  it("lets textarea input win over an old Validate completion", async () => {
    let resolveValidation!: (value: DistillationValidationResult) => void;
    const validationPending = new Promise<DistillationValidationResult>(
      (resolve) => {
        resolveValidation = resolve;
      },
    );
    const current = {
      loaded: true,
      selectionGeneration: 1,
      importGeneration: 1,
      conversation: conversation(),
    };
    const controller = new ManualDistillationController({
      current: () => current,
      writeClipboard: async () => undefined,
      validateResult: () => validationPending,
    });
    await controller.prepare();
    const active = controller.snapshot.request!;
    controller.setPaste(
      validResult(active.requestId, active.conversationFingerprint),
    );
    const validation = controller.validate();
    controller.setPaste("newer input");
    const winner = controller.snapshot;
    resolveValidation({ ok: true, candidates: [] });

    expect((await validation).status).toBe("stale");
    expect(controller.snapshot).toEqual(winner);
    expect(controller.snapshot.paste).toBe("newer input");
  });

  it("clears an installed preview on accepted validation and on every paste input", async () => {
    const current = {
      loaded: true,
      selectionGeneration: 1,
      importGeneration: 1,
      conversation: conversation(),
    };
    const controller = new ManualDistillationController({
      current: () => current,
      writeClipboard: async () => undefined,
    });
    await controller.prepare();
    const active = controller.snapshot.request!;
    controller.setPaste(
      validResult(active.requestId, active.conversationFingerprint),
    );
    await controller.validate();
    expect(controller.snapshot.candidates).toHaveLength(1);
    controller.setPaste("{}");
    expect(controller.snapshot.candidates).toEqual([]);
    expect((await controller.validate()).status).toBe("invalid");
    expect(controller.snapshot.candidates).toEqual([]);
  });

  it("clears rather than retaining or truncating an over-limit paste", async () => {
    const controller = new ManualDistillationController({
      current: () => ({
        loaded: true,
        selectionGeneration: 1,
        importGeneration: 1,
        conversation: conversation(),
      }),
      writeClipboard: async () => undefined,
    });
    await controller.prepare();
    controller.setPaste("x".repeat(M04_RESULT_MAX_UTF8_BYTES + 1));
    expect(controller.snapshot).toMatchObject({
      paste: "",
      pasteBytes: 0,
      pasteOverLimit: true,
      candidates: [],
      diagnostics: [{ code: "DISTILLATION_RESULT_TOO_LARGE" }],
    });
  });

  it("classifies current clipboard failures and gives staleness precedence", async () => {
    const current = {
      loaded: true,
      selectionGeneration: 1,
      importGeneration: 1,
      conversation: conversation(),
    };
    const denied = new ManualDistillationController({
      current: () => current,
      writeClipboard: () => {
        throw new DOMException("synthetic", "NotAllowedError");
      },
    });
    await denied.prepare();
    expect(await denied.copy()).toMatchObject({
      status: "clipboard-denied",
      diagnostics: [{ code: "DISTILLATION_CLIPBOARD_DENIED" }],
    });
    expect(denied.snapshot.owner).toBeUndefined();

    let rejectCopy!: (reason: unknown) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectCopy = reject;
    });
    const stale = new ManualDistillationController({
      current: () => current,
      writeClipboard: () => pending,
    });
    await stale.prepare();
    const copy = stale.copy();
    stale.invalidate();
    const winner = stale.snapshot;
    rejectCopy(new DOMException("synthetic", "NotAllowedError"));
    expect((await copy).status).toBe("stale");
    expect(stale.snapshot).toEqual(winner);
  });

  it.each([
    [new DOMException("synthetic", "AbortError"), "clipboard-failed"],
    [new Error("synthetic"), "clipboard-failed"],
    ["synthetic rejection", "clipboard-failed"],
  ] as const)(
    "classifies a current clipboard rejection %#",
    async (failure, status) => {
      const controller = new ManualDistillationController({
        current: () => ({
          loaded: true,
          selectionGeneration: 1,
          importGeneration: 1,
          conversation: conversation(),
        }),
        writeClipboard: () => Promise.reject(failure),
      });
      await controller.prepare();
      expect((await controller.copy()).status).toBe(status);
      expect(controller.snapshot.owner).toBeUndefined();
    },
  );

  it("synchronously invalidates the workflow before clipboard invocation when the active fingerprint changes", async () => {
    const current = {
      loaded: true,
      selectionGeneration: 1,
      importGeneration: 1,
      conversation: conversation(),
    };
    const clipboard = vi.fn(async () => undefined);
    const controller = new ManualDistillationController({
      current: () => current,
      writeClipboard: clipboard,
    });
    await controller.prepare();
    current.conversation.contentFingerprint = `sha256:${"3".repeat(64)}`;
    expect((await controller.copy()).status).toBe("stale");
    expect(clipboard).not.toHaveBeenCalled();
    expect(controller.snapshot).toMatchObject({
      status: "empty",
      owner: undefined,
      request: undefined,
      prompt: undefined,
      candidates: [],
    });
    expect((await controller.prepare()).status).toBe("prepared");
  });

  it.each(["Copy", "Validate"] as const)(
    "lets fingerprint invalidation and a fresh Prepare win over an old pending %s",
    async (kind) => {
      let resolveCopy!: () => void;
      let resolveValidation!: (value: DistillationValidationResult) => void;
      const current = {
        loaded: true,
        selectionGeneration: 1,
        importGeneration: 1,
        conversation: conversation(),
      };
      const controller = new ManualDistillationController({
        current: () => current,
        writeClipboard: () =>
          new Promise<void>((resolve) => {
            resolveCopy = resolve;
          }),
        validateResult: () =>
          new Promise<DistillationValidationResult>((resolve) => {
            resolveValidation = resolve;
          }),
      });
      await controller.prepare();
      const active = controller.snapshot.request!;
      controller.setPaste(
        validResult(active.requestId, active.conversationFingerprint),
      );
      const old = kind === "Copy" ? controller.copy() : controller.validate();

      current.conversation.contentFingerprint = `sha256:${"3".repeat(64)}`;
      expect(controller.invalidateIfConversationChanged()).toBe(true);
      expect(controller.snapshot).toMatchObject({
        status: "empty",
        owner: undefined,
        request: undefined,
        prompt: undefined,
        candidates: [],
      });
      expect((await controller.prepare()).status).toBe("prepared");
      const winner = controller.snapshot;

      if (kind === "Copy") resolveCopy();
      else resolveValidation({ ok: true, candidates: [] });
      expect((await old).status).toBe("stale");
      expect(controller.snapshot).toEqual(winner);
    },
  );

  it("detects a fingerprint change at settlement even without an explicit view refresh", async () => {
    let resolveCopy!: () => void;
    const current = {
      loaded: true,
      selectionGeneration: 1,
      importGeneration: 1,
      conversation: conversation(),
    };
    const controller = new ManualDistillationController({
      current: () => current,
      writeClipboard: () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    });
    await controller.prepare();
    const old = controller.copy();
    current.conversation.contentFingerprint = `sha256:${"3".repeat(64)}`;
    resolveCopy();

    expect((await old).status).toBe("stale");
    expect(controller.snapshot).toMatchObject({
      status: "empty",
      owner: undefined,
      request: undefined,
      prompt: undefined,
    });
  });

  it("releases ownership after synchronous request failures", async () => {
    const invalidConversation = conversation();
    invalidConversation.messages = [];
    const current = {
      loaded: true,
      selectionGeneration: 1,
      importGeneration: 1,
      conversation: invalidConversation,
    };
    const controller = new ManualDistillationController({
      current: () => current,
      writeClipboard: async () => undefined,
      buildRequest: (value) => buildDistillationRequest(value),
    });
    expect((await controller.prepare()).status).toBe("request-invalid");
    expect(controller.snapshot.owner).toBeUndefined();
    expect((await controller.prepare()).status).toBe("request-invalid");
  });

  it.each(["throw", "reject"] as const)(
    "totally settles a request-builder %s and releases ownership",
    async (mode) => {
      const failure = new Error("synthetic request boundary failure");
      const controller = new ManualDistillationController({
        current: () => ({
          loaded: true,
          selectionGeneration: 1,
          importGeneration: 1,
          conversation: conversation(),
        }),
        writeClipboard: async () => undefined,
        buildRequest: () => {
          if (mode === "throw") throw failure;
          return Promise.reject(failure);
        },
      });
      await expect(controller.prepare()).resolves.toMatchObject({
        status: "request-invalid",
        diagnostics: [{ code: "DISTILLATION_REQUEST_INVALID" }],
      });
      expect(controller.snapshot.owner).toBeUndefined();
    },
  );

  it("keeps a newer Prepare winner when an invalidated request build rejects", async () => {
    let rejectOld!: (reason: Error) => void;
    const oldBuild = new Promise<RequestBuildResult>((_resolve, reject) => {
      rejectOld = reject;
    });
    let calls = 0;
    const controller = new ManualDistillationController({
      current: () => ({
        loaded: true,
        selectionGeneration: 1,
        importGeneration: 1,
        conversation: conversation(),
      }),
      writeClipboard: async () => undefined,
      buildRequest: (value) => {
        calls += 1;
        return calls === 1 ? oldBuild : buildDistillationRequest(value);
      },
    });
    const old = controller.prepare();
    controller.invalidate();
    expect((await controller.prepare()).status).toBe("prepared");
    const winner = controller.snapshot;
    rejectOld(new Error("stale request rejection"));
    expect((await old).status).toBe("stale");
    expect(controller.snapshot).toEqual(winner);
  });

  it("keeps a newer Prepare winner when an invalidated prompt render rejects", async () => {
    let rejectOld!: (reason: Error) => void;
    const oldRender = new Promise<PromptRenderResult>((_resolve, reject) => {
      rejectOld = reject;
    });
    let calls = 0;
    const controller = new ManualDistillationController({
      current: () => ({
        loaded: true,
        selectionGeneration: 1,
        importGeneration: 1,
        conversation: conversation(),
      }),
      writeClipboard: async () => undefined,
      renderPrompt: (value) => {
        calls += 1;
        return calls === 1 ? oldRender : renderDistillationPrompt(value);
      },
    });
    const old = controller.prepare();
    controller.invalidate();
    expect((await controller.prepare()).status).toBe("prepared");
    const winner = controller.snapshot;
    rejectOld(new Error("stale prompt rejection"));
    expect((await old).status).toBe("stale");
    expect(controller.snapshot).toEqual(winner);
  });

  it("keeps a newer Validate winner when an invalidated validator rejects", async () => {
    let rejectOld!: (reason: Error) => void;
    const oldValidation = new Promise<DistillationValidationResult>(
      (_resolve, reject) => {
        rejectOld = reject;
      },
    );
    let calls = 0;
    const controller = new ManualDistillationController({
      current: () => ({
        loaded: true,
        selectionGeneration: 1,
        importGeneration: 1,
        conversation: conversation(),
      }),
      writeClipboard: async () => undefined,
      validateResult: (raw, active) => {
        calls += 1;
        return calls === 1
          ? oldValidation
          : validateDistillationResult(raw, active);
      },
    });
    await controller.prepare();
    const active = controller.snapshot.request!;
    controller.setPaste(
      validResult(active.requestId, active.conversationFingerprint),
    );
    const old = controller.validate();
    controller.setPaste(
      validResult(active.requestId, active.conversationFingerprint),
    );
    expect((await controller.validate()).status).toBe("valid");
    const winner = controller.snapshot;
    rejectOld(new Error("stale validation rejection"));
    expect((await old).status).toBe("stale");
    expect(controller.snapshot).toEqual(winner);
  });

  it.each(["throw", "reject"] as const)(
    "totally settles a prompt-renderer %s and releases ownership",
    async (mode) => {
      const failure = new Error("synthetic prompt boundary failure");
      const controller = new ManualDistillationController({
        current: () => ({
          loaded: true,
          selectionGeneration: 1,
          importGeneration: 1,
          conversation: conversation(),
        }),
        writeClipboard: async () => undefined,
        renderPrompt: () => {
          if (mode === "throw") throw failure;
          return Promise.reject(failure);
        },
      });
      await expect(controller.prepare()).resolves.toMatchObject({
        status: "prompt-too-large",
        diagnostics: [{ code: "DISTILLATION_PROMPT_TOO_LARGE" }],
      });
      expect(controller.snapshot.owner).toBeUndefined();
    },
  );

  it.each(["throw", "reject"] as const)(
    "totally settles a result-validator %s and releases ownership",
    async (mode) => {
      const failure = new Error("synthetic validation boundary failure");
      const controller = new ManualDistillationController({
        current: () => ({
          loaded: true,
          selectionGeneration: 1,
          importGeneration: 1,
          conversation: conversation(),
        }),
        writeClipboard: async () => undefined,
        validateResult: () => {
          if (mode === "throw") throw failure;
          return Promise.reject(failure);
        },
      });
      await controller.prepare();
      controller.setPaste("{}");
      await expect(controller.validate()).resolves.toMatchObject({
        status: "invalid",
        diagnostics: [{ code: "DISTILLATION_JSON_INVALID" }],
      });
      expect(controller.snapshot.owner).toBeUndefined();
    },
  );
});
