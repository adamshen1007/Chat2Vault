import { describe, expect, it } from "vitest";
import { validateCapture, type CaptureDraft } from "@chat2vault/core";
import {
  CaptureController,
  type CaptureControllerCurrent,
} from "../src/capture-controller.js";
import type {
  CaptureSaveResult,
  CaptureVaultAdapter,
  CaptureWritePlan,
} from "../src/capture-vault-adapter.js";

const encoder = new TextEncoder();

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function manualDraft(text = "Synthetic capture"): CaptureDraft {
  const result = validateCapture({ method: "manual-paste", text });
  if (!result.ok) throw new Error("invalid synthetic capture");
  return result.draft;
}

function readyPlan(
  draft = manualDraft(),
): Exclude<CaptureWritePlan, { disposition: "blocked" }> {
  return {
    disposition: "create",
    sourceRoot: {
      logicalPath: "Sources",
      resolvedPath: "Sources",
      realPath: "/vault/Sources",
      physicalIdentity: { device: "1", inode: "2" },
    },
    vaultIdentity: { device: "1", inode: "1" },
    configIdentity: { device: "1", inode: "3" },
    sourceInputFingerprint: draft.fingerprint,
    settingsFingerprint: "sha256:settings",
    targetPath: "Sources/Synthetic.md",
    markdown: "---\nsynthetic: true\n---\n\n    inert\n",
    outputDigest: "sha256:output",
  };
}

function harness(overrides: Partial<CaptureVaultAdapter> = {}) {
  let current: CaptureControllerCurrent = {
    loaded: true,
    lifecycleGeneration: 1,
    settingsGeneration: 1,
    sourceRoot: "Sources",
    sourceRootPending: false,
    activeFile: { path: "Staging/clip.md", identity: "1:2:3" },
  };
  const draft = manualDraft();
  const plan = readyPlan(draft);
  const adapter: CaptureVaultAdapter = {
    reconciliation: () => ({ status: "clear" }),
    acknowledgeReconciliation: () =>
      Promise.resolve({ status: "cleared" as const }),
    readActiveStaging: () =>
      Promise.resolve({
        bytes: encoder.encode(
          '---\nchat2vault_capture: 1\ncapture_method: "obsidian-web-clipper"\ncapture_scope: "visible-page-unverified"\nsource_provider: "chatgpt"\nsource_url: "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111"\n---\nSynthetic staging capture',
        ),
        digest: "sha256:staging",
      }),
    plan: () => Promise.resolve(plan),
    save: () => Promise.resolve({ status: "saved", path: plan.targetPath }),
    ...overrides,
  };
  const controller = new CaptureController({
    current: () => current,
    adapter,
  });
  return {
    controller,
    adapter,
    get current() {
      return current;
    },
    setCurrent(next: CaptureControllerCurrent) {
      current = next;
    },
  };
}

describe("CaptureController", () => {
  it("restores a service-owned prepared block after reconstruction and clears only after durable acknowledgment", async () => {
    let unresolved = true;
    let clearFails = true;
    const shared: Partial<CaptureVaultAdapter> = {
      reconciliation: () =>
        unresolved
          ? {
              status: "unresolved" as const,
              record: {
                version: 1 as const,
                state: "prepared" as const,
                transactionId: "223e4567-e89b-42d3-a456-426614174000",
                targetPathDigest: `sha256:${"a".repeat(64)}`,
                targetLocator: "0123456789ab",
                sourceRootPathDigest: `sha256:${"b".repeat(64)}`,
                sourceRootIdentity: { device: "1", inode: "2" },
              },
            }
          : { status: "clear" as const },
      acknowledgeReconciliation: () => {
        if (clearFails)
          return Promise.resolve({
            status: "failed" as const,
            code: "CAPTURE_RECONCILIATION_CLEAR_FAILED" as const,
          });
        unresolved = false;
        return Promise.resolve({ status: "cleared" as const });
      },
    };
    const first = harness(shared).controller;
    expect(first.snapshot).toMatchObject({
      status: "reconciliation-required",
      targetPathDigest: `sha256:${"a".repeat(64)}`,
    });
    first.invalidate("view-close");
    const reopened = harness(shared).controller;
    await expect(reopened.acknowledgeReconciliation()).resolves.toEqual({
      status: "failed",
      code: "CAPTURE_RECONCILIATION_CLEAR_FAILED",
    });
    expect(reopened.snapshot.status).toBe("reconciliation-required");
    clearFails = false;
    await expect(reopened.acknowledgeReconciliation()).resolves.toEqual({
      status: "cleared",
    });
    expect(reopened.snapshot).toEqual({ status: "idle" });
  });
  it("owns one non-queued staging preview and installs only its current settlement", async () => {
    const read = deferred<
      { bytes: Uint8Array; digest: string } | { code: string }
    >();
    let reads = 0;
    const { controller } = harness({
      readActiveStaging: () => {
        reads += 1;
        return read.promise;
      },
    });

    const first = controller.previewStaging("Staging/clip.md");
    await expect(controller.previewStaging("Staging/clip.md")).resolves.toEqual(
      { status: "busy", code: "CAPTURE_PREVIEW_IN_PROGRESS" },
    );
    expect(controller.snapshot.status).toBe("previewing");
    expect(reads).toBe(1);

    read.resolve({ code: "CAPTURE_STAGING_READ_FAILED" });
    await expect(first).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_STAGING_READ_FAILED",
    });
    expect(controller.snapshot.status).toBe("blocked");
  });

  it("drops staging read and plan settlements after active-file or lifecycle invalidation", async () => {
    const read = deferred<
      { bytes: Uint8Array; digest: string } | { code: string }
    >();
    const first = harness({ readActiveStaging: () => read.promise });
    const reading = first.controller.previewStaging("Staging/clip.md");
    first.setCurrent({
      ...first.current,
      activeFile: { path: "Staging/other.md", identity: "4:5:6" },
    });
    read.resolve({ code: "CAPTURE_STAGING_READ_FAILED" });
    await expect(reading).resolves.toEqual({
      status: "stale",
      code: "CAPTURE_PREVIEW_STALE",
    });
    expect(first.controller.snapshot.status).toBe("idle");

    const planning = deferred<CaptureWritePlan>();
    const second = harness({ plan: () => planning.promise });
    const pending = second.controller.previewPaste("Synthetic capture");
    second.controller.invalidate("paste-edit");
    planning.resolve(readyPlan());
    await expect(pending).resolves.toEqual({
      status: "stale",
      code: "CAPTURE_PREVIEW_STALE",
    });
    expect(second.controller.snapshot.status).toBe("idle");
  });

  it("blocks a staged save when active-file authority disappears without an invalidation event", async () => {
    let saves = 0;
    const state = harness({
      save: () => {
        saves += 1;
        return Promise.resolve({
          status: "saved" as const,
          path: "Sources/Synthetic.md",
        });
      },
    });
    await expect(
      state.controller.previewStaging("Staging/clip.md"),
    ).resolves.toMatchObject({ status: "ready" });
    const withoutActiveFile = { ...state.current };
    delete withoutActiveFile.activeFile;
    state.setCurrent(withoutActiveFile);

    await expect(state.controller.save()).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_PLAN_REQUIRED",
    });
    expect(saves).toBe(0);
    expect(state.controller.snapshot).toEqual({ status: "idle" });
  });

  it("lets an invalidation replace a hung preview without the old owner releasing the new one", async () => {
    const first = deferred<CaptureWritePlan>();
    const second = deferred<CaptureWritePlan>();
    let plans = 0;
    const state = harness({
      plan: () => {
        plans += 1;
        return plans === 1 ? first.promise : second.promise;
      },
    });
    const oldPreview = state.controller.previewPaste("Synthetic capture");
    state.controller.invalidate("paste-edit");
    const newPreview = state.controller.previewPaste("Replacement capture");
    first.resolve(readyPlan());
    await expect(oldPreview).resolves.toEqual({
      status: "stale",
      code: "CAPTURE_PREVIEW_STALE",
    });
    await expect(
      state.controller.previewPaste("Third capture"),
    ).resolves.toEqual({
      status: "busy",
      code: "CAPTURE_PREVIEW_IN_PROGRESS",
    });
    second.resolve(readyPlan(manualDraft("Replacement capture")));
    await expect(newPreview).resolves.toMatchObject({ status: "ready" });
  });

  it("keeps manual paste memory-only and installs the exact draft and plan", async () => {
    const { controller } = harness();
    await expect(
      controller.previewPaste(
        "<script>synthetic</script>",
        "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111?private=discard",
      ),
    ).resolves.toMatchObject({ status: "ready" });

    expect(controller.snapshot).toMatchObject({
      status: "ready",
      mode: "manual",
      draft: {
        scope: "visible-page-unverified",
        text: "<script>synthetic</script>",
        sourceUrl: "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111",
      },
      plan: { disposition: "create" },
    });
  });

  it("requires a current exact plan and owns one non-queued save", async () => {
    const save = deferred<CaptureSaveResult>();
    let saves = 0;
    const { controller } = harness({
      save: () => {
        saves += 1;
        return save.promise;
      },
    });
    await expect(controller.save()).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_PLAN_REQUIRED",
    });
    await controller.previewPaste("Synthetic capture");

    const first = controller.save();
    await expect(controller.save()).resolves.toEqual({
      status: "busy",
      code: "CAPTURE_SAVE_IN_PROGRESS",
    });
    expect(saves).toBe(1);
    expect(controller.snapshot.status).toBe("saving");
    save.resolve({ status: "saved", path: "Sources/Synthetic.md" });
    await expect(first).resolves.toEqual({
      status: "saved",
      path: "Sources/Synthetic.md",
    });
    expect(controller.snapshot.status).toBe("saved");
  });

  it.each([
    ["settings", { settingsGeneration: 2 }],
    ["root", { sourceRoot: "Other" }],
    ["pending", { sourceRootPending: true }],
    [
      "active identity",
      { activeFile: { path: "Staging/clip.md", identity: "9:9:9" } },
    ],
  ] as const)(
    "preserves known save success when %s changes while save is awaiting",
    async (_label, change) => {
      const save = deferred<CaptureSaveResult>();
      const state = harness({ save: () => save.promise });
      await state.controller.previewStaging("Staging/clip.md");
      const pending = state.controller.save();
      state.setCurrent({ ...state.current, ...change });
      save.resolve({ status: "saved", path: "Sources/Synthetic.md" });
      await expect(pending).resolves.toEqual({
        status: "saved",
        path: "Sources/Synthetic.md",
      });
      expect(state.controller.snapshot).toMatchObject({
        status: "saved",
        path: "Sources/Synthetic.md",
        authorityChanged: true,
      });
    },
  );

  it("preserves a possible published effect and target for reconciliation", async () => {
    const state = harness({
      save: () =>
        Promise.resolve({
          status: "blocked",
          code: "CAPTURE_PUBLISH_UNCERTAIN",
          effect: "published",
        }),
    });
    await state.controller.previewPaste("Synthetic capture");
    await expect(state.controller.save()).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_PUBLISH_UNCERTAIN",
      effect: "published",
    });
    expect(state.controller.snapshot).toEqual({
      status: "reconciliation-required",
      code: "CAPTURE_PUBLISH_UNCERTAIN",
      effect: "published",
      targetPath: "Sources/Synthetic.md",
    });
    state.controller.invalidate("settings");
    expect(state.controller.snapshot).toMatchObject({
      status: "reconciliation-required",
      effect: "published",
      targetPath: "Sources/Synthetic.md",
    });
    await expect(
      state.controller.previewPaste("Blocked retry"),
    ).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_RECONCILIATION_REQUIRED",
    });
    await expect(state.controller.save()).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_RECONCILIATION_REQUIRED",
    });
  });

  it("latches an identified private temporary artifact until explicit reconciliation acknowledgment", async () => {
    const state = harness({
      save: () =>
        Promise.resolve({
          status: "blocked",
          code: "CAPTURE_EFFECT_UNCERTAIN",
          effect: "temporary",
          temporaryArtifact: {
            path: "Sources/.chat2vault-private-123",
            ownership: "unverified",
            identity: { device: "1", inode: "77" },
          },
        } as CaptureSaveResult),
    });
    await state.controller.previewPaste("Synthetic capture");
    await state.controller.save();
    expect(state.controller.snapshot).toEqual({
      status: "reconciliation-required",
      code: "CAPTURE_EFFECT_UNCERTAIN",
      effect: "temporary",
      targetPath: "Sources/Synthetic.md",
      temporaryArtifact: {
        path: "Sources/.chat2vault-private-123",
        ownership: "unverified",
        identity: { device: "1", inode: "77" },
      },
    });
    state.controller.invalidate("active-file-edit");
    expect(state.controller.snapshot).toMatchObject({
      status: "reconciliation-required",
      effect: "temporary",
    });
    await state.controller.acknowledgeReconciliation();
    expect(state.controller.snapshot).toEqual({ status: "idle" });
  });

  it("preserves a confirmed path when explicit invalidation occurs during save", async () => {
    const save = deferred<CaptureSaveResult>();
    const state = harness({ save: () => save.promise });
    await state.controller.previewPaste("Synthetic capture");
    const pending = state.controller.save();
    state.controller.invalidate("settings");
    save.resolve({ status: "saved", path: "Sources/Synthetic.md" });
    await expect(pending).resolves.toEqual({
      status: "saved",
      path: "Sources/Synthetic.md",
    });
    expect(state.controller.snapshot).toMatchObject({
      status: "saved",
      path: "Sources/Synthetic.md",
      authorityChanged: true,
    });
  });

  it("clears draft and plan on explicit lifecycle invalidation", async () => {
    const { controller } = harness();
    await controller.previewPaste("Synthetic capture");
    controller.invalidate("view-close");
    expect(controller.snapshot).toEqual({ status: "idle" });
    await expect(controller.save()).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_PLAN_REQUIRED",
    });
  });
});
