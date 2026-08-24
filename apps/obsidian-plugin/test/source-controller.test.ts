/* eslint-disable @typescript-eslint/require-await -- async mocks model yield-capable adapter boundaries. */
import { describe, expect, test, vi } from "vitest";
import type { SourceWritePlan } from "@chat2vault/core";
import {
  SourceWriteController,
  type SourceControllerState,
  type SourceWriteExecutionResult,
  type SourceWriteExecutor,
} from "../src/source-controller.js";
import {
  executeSourceWrite,
  type SourceMutationAdapter,
} from "../src/source-executor.js";

const writable: Extract<SourceWritePlan, { disposition: "new" }> = {
  disposition: "new",
  targetPath: "Sources/note.md",
  noteContent: "note\n",
  noteContentFingerprint: `sha256:${"a".repeat(64)}`,
  foldersToCreate: [],
  diagnostics: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function setup() {
  const state: SourceControllerState = {
    loaded: true,
    generation: 0,
    selectedConversationContentFingerprint: `sha256:${"b".repeat(64)}`,
    settledSourceRoot: "Sources",
    sourceRootPending: false,
  };
  const planner = vi.fn<() => Promise<SourceWritePlan>>(async () => writable);
  const execute = vi.fn<SourceWriteExecutor>(async () => ({
    status: "saved" as const,
    createdPath: "Sources/note.md",
    noteContentFingerprint: writable.noteContentFingerprint,
    disposition: "new" as const,
    acceptedFolderPaths: [],
    diagnostics: [] as [],
  }));
  return {
    state,
    planner,
    execute,
    controller: new SourceWriteController(() => state, planner, execute),
  };
}

describe("M03 source Preview and Save controller", () => {
  test("rejects overlapping Preview without queueing and publishes only the current token", async () => {
    const { state, planner, execute } = setup();
    const gate = deferred<SourceWritePlan>();
    planner.mockImplementationOnce(() => gate.promise);
    const controller = new SourceWriteController(() => state, planner, execute);
    const first = controller.preview();
    await expect(controller.preview()).resolves.toMatchObject({
      status: "preview-in-progress",
    });
    expect(planner).toHaveBeenCalledTimes(1);
    state.generation += 1;
    gate.resolve(writable);
    await expect(first).resolves.toMatchObject({ status: "stale" });
    expect(controller.installedPreview).toBeUndefined();
  });

  test("uses exact entry precedence for pending, Preview, and Save mutexes", async () => {
    const { state, planner, execute } = setup();
    const previewGate = deferred<SourceWritePlan>();
    planner.mockImplementationOnce(() => previewGate.promise);
    state.sourceRootPending = true;
    const controller = new SourceWriteController(() => state, planner, execute);
    await expect(controller.preview()).resolves.toMatchObject({
      status: "settings-pending",
    });
    state.sourceRootPending = false;
    const preview = controller.preview();
    expect(controller.save()).toMatchObject({ status: "preview-in-progress" });
    previewGate.resolve(writable);
    await preview;
    const saveGate = deferred<SourceWriteExecutionResult>();
    execute.mockImplementationOnce(() => saveGate.promise);
    const save = controller.save();
    await expect(controller.preview()).resolves.toMatchObject({
      status: "write-in-progress",
    });
    expect(controller.save()).toMatchObject({ status: "in-progress" });
    saveGate.resolve({
      status: "saved",
      createdPath: "Sources/note.md",
      noteContentFingerprint: writable.noteContentFingerprint,
      disposition: "new",
      acceptedFolderPaths: [],
      diagnostics: [],
    });
    await expect(save).resolves.toMatchObject({ status: "saved" });
  });

  test("clears consumed Preview synchronously and installs only a current replanned result", async () => {
    const { state, planner, execute, controller } = setup();
    await controller.preview();
    const gate = deferred<SourceWriteExecutionResult>();
    execute.mockImplementationOnce(() => gate.promise);
    const save = controller.save();
    expect(controller.installedPreview).toBeUndefined();
    gate.resolve({
      status: "replanned",
      reason: "target-changed",
      plan: writable,
      acceptedFolderPaths: [],
      diagnostics: [
        {
          code: "SOURCE_WRITE_TARGET_CHANGED",
          severity: "error",
          message:
            "The source-note target changed before creation; review the refreshed plan before saving.",
        },
      ],
    });
    await expect(save).resolves.toMatchObject({ status: "replanned" });
    expect(controller.installedPreview?.plan).toEqual(writable);
    controller.invalidate();
    expect(state.generation).toBe(0);
    expect(controller.installedPreview).toBeUndefined();
    expect(planner).toHaveBeenCalledTimes(1);
  });

  test.each(["fulfilled", "rejected"] as const)(
    "makes a Preview stale when a root transaction starts and later is %s",
    async (settlement) => {
      const { state, planner, execute } = setup();
      const gate = deferred<SourceWritePlan>();
      planner.mockImplementationOnce(() => gate.promise);
      const controller = new SourceWriteController(
        () => state,
        planner,
        execute,
      );
      const preview = controller.preview();
      state.generation += 1;
      state.sourceRootPending = true;
      gate.resolve(writable);
      await expect(preview).resolves.toMatchObject({ status: "stale" });
      expect(controller.installedPreview).toBeUndefined();
      state.sourceRootPending = false;
      state.settledSourceRoot =
        settlement === "fulfilled" ? "Other" : "Sources";
      await expect(controller.preview()).resolves.toMatchObject({
        status: "planned",
      });
      expect(controller.installedPreview?.token.normalizedSourceRoot).toBe(
        state.settledSourceRoot,
      );
    },
  );

  test("clears an installed plan before a replacement Preview first yields", async () => {
    const { state, planner, execute, controller } = setup();
    await controller.preview();
    expect(controller.installedPreview?.plan).toEqual(writable);
    const gate = deferred<SourceWritePlan>();
    planner.mockImplementationOnce(() => gate.promise);
    const replacement = controller.preview();
    expect(controller.installedPreview).toBeUndefined();
    gate.resolve(writable);
    await expect(replacement).resolves.toMatchObject({ status: "planned" });
    expect(controller.installedPreview?.plan).toEqual(writable);
    void state;
    void execute;
  });

  test.each([
    [
      "import replacement",
      (state: SourceControllerState): void => {
        state.selectedConversationContentFingerprint = `sha256:${"c".repeat(64)}`;
      },
    ],
    [
      "selection change",
      (state: SourceControllerState): void => {
        state.selectedConversationContentFingerprint = `sha256:${"d".repeat(64)}`;
      },
    ],
    [
      "Clear",
      (state: SourceControllerState): void => {
        state.selectedConversationContentFingerprint = undefined;
      },
    ],
    [
      "root transaction",
      (state: SourceControllerState): void => {
        state.generation += 1;
        state.sourceRootPending = true;
      },
    ],
    [
      "view close",
      (state: SourceControllerState): void => {
        state.loaded = false;
      },
    ],
    [
      "unload",
      (state: SourceControllerState): void => {
        state.loaded = false;
        state.generation += 1;
      },
    ],
  ] as const)(
    "suppresses Preview publication when %s invalidates an awaiting planner",
    async (_name, invalidate) => {
      const { state, planner, execute } = setup();
      const gate = deferred<SourceWritePlan>();
      planner.mockImplementationOnce(() => gate.promise);
      const controller = new SourceWriteController(
        () => state,
        planner,
        execute,
      );
      const preview = controller.preview();
      invalidate(state);
      gate.resolve(writable);
      await expect(preview).resolves.toMatchObject({ status: "stale" });
      expect(controller.installedPreview).toBeUndefined();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  test.each([
    "saved",
    "stale",
    "mutation-failed",
    "safety-check-failed",
    "verification-failed",
    "post-create-stale",
  ] as const)(
    "leaves no installed plan after terminal Save result %s",
    async (status) => {
      const { state, planner } = setup();
      const execute = vi.fn<SourceWriteExecutor>(async () => {
        if (status === "saved")
          return {
            status,
            createdPath: writable.targetPath,
            noteContentFingerprint: writable.noteContentFingerprint,
            disposition: "new",
            acceptedFolderPaths: [],
            diagnostics: [],
          };
        if (status === "verification-failed")
          return {
            status,
            createdPath: writable.targetPath,
            acceptedFolderPaths: [],
            diagnostics: [
              {
                code: "SOURCE_WRITE_VERIFICATION_FAILED",
                severity: "error",
                message:
                  "The created source note could not be verified against the approved write plan.",
              },
            ],
          };
        if (status === "post-create-stale")
          return {
            status,
            createdPath: writable.targetPath,
            acceptedFolderPaths: [],
            verification: { status: "verification-failed" },
            diagnostics: [
              {
                code: "STALE_SOURCE_WRITE_PLAN",
                severity: "error",
                message:
                  "The source-note plan became stale before the write could complete.",
              },
              {
                code: "SOURCE_WRITE_VERIFICATION_FAILED",
                severity: "error",
                message:
                  "The created source note could not be verified against the approved write plan.",
              },
            ],
          };
        return {
          status,
          acceptedFolderPaths: [],
          diagnostics: [
            {
              code:
                status === "stale"
                  ? "STALE_SOURCE_WRITE_PLAN"
                  : status === "safety-check-failed"
                    ? "SOURCE_NATIVE_PROBE_INDETERMINATE"
                    : "SOURCE_WRITE_FAILED",
              severity: "error",
              message: "synthetic terminal diagnostic",
            },
          ],
        };
      });
      const controller = new SourceWriteController(
        () => state,
        planner,
        execute,
      );
      await controller.preview();
      const result = controller.save();
      if (!(result instanceof Promise))
        throw new Error("expected Save promise");
      await result;
      expect(controller.installedPreview).toBeUndefined();
    },
  );

  test.each(["fulfilled", "rejected"] as const)(
    "fences a Save when a root transaction begins during execution and is %s",
    async (settlement) => {
      const { state, planner } = setup();
      const gate = deferred<undefined>();
      const execute = vi.fn<SourceWriteExecutor>(
        async (_request, _token, current) => {
          await gate.promise;
          return current()
            ? {
                status: "saved" as const,
                createdPath: writable.targetPath,
                noteContentFingerprint: writable.noteContentFingerprint,
                disposition: "new" as const,
                acceptedFolderPaths: [],
                diagnostics: [] as [],
              }
            : {
                status: "stale" as const,
                acceptedFolderPaths: [],
                diagnostics: [
                  {
                    code: "STALE_SOURCE_WRITE_PLAN" as const,
                    severity: "error" as const,
                    message:
                      "The source-note plan became stale before the write could complete." as const,
                  },
                ],
              };
        },
      );
      const controller = new SourceWriteController(
        () => state,
        planner,
        execute,
      );
      await controller.preview();
      const save = controller.save();
      if (!(save instanceof Promise)) throw new Error("expected Save promise");
      state.generation += 1;
      state.sourceRootPending = true;
      gate.resolve(undefined);
      await expect(save).resolves.toMatchObject({ status: "stale" });
      expect(controller.installedPreview).toBeUndefined();
      state.sourceRootPending = false;
      state.settledSourceRoot =
        settlement === "fulfilled" ? "Other" : "Sources";
      expect(controller.save()).toBeUndefined();
      await controller.preview();
      expect(controller.installedPreview?.token.normalizedSourceRoot).toBe(
        state.settledSourceRoot,
      );
    },
  );

  test.each(
    ["fulfilled", "rejected"].flatMap((settlement) =>
      [
        "before-planner",
        "during-planner",
        "during-folder-checks",
        "during-final-note-checks",
        "after-note-create-invocation",
      ].map((stage) => ({ settlement, stage })),
    ) as {
      settlement: "fulfilled" | "rejected";
      stage:
        | "before-planner"
        | "during-planner"
        | "during-folder-checks"
        | "during-final-note-checks"
        | "after-note-create-invocation";
    }[],
  )(
    "fences Save when a $settlement root transaction begins $stage",
    async ({ settlement, stage }) => {
      const { state, planner } = setup();
      const planWithFolder = { ...writable, foldersToCreate: ["Sources"] };
      planner.mockResolvedValue(planWithFolder);
      let remainingFolders = ["Sources"];
      let triggered = false;
      const beginRootTransaction = () => {
        if (triggered) return;
        triggered = true;
        state.generation += 1;
        state.sourceRootPending = true;
        state.sourceRootPending = false;
        state.settledSourceRoot =
          settlement === "fulfilled" ? "Other" : "Sources";
      };
      const mutation: SourceMutationAdapter = {
        plan: vi.fn(async () => {
          if (stage === "during-planner") beginRootTransaction();
          return { ...planWithFolder, foldersToCreate: [...remainingFolders] };
        }),
        checkpointFolder: vi.fn(async () => {
          if (stage === "during-folder-checks") beginRootTransaction();
          return { status: "missing-safe", resolvedPath: "Sources" } as const;
        }),
        createFolder: vi.fn(async () => {
          remainingFolders = [];
        }),
        verifyFolder: vi.fn(async () => ({ status: "safe" }) as const),
        checkpointFinalParent: vi.fn(async () => {
          if (stage === "during-final-note-checks") beginRootTransaction();
          return {
            status: "safe",
            resolvedTargetPath: writable.targetPath,
          } as const;
        }),
        createNote: vi.fn(async () => {
          if (stage === "after-note-create-invocation") beginRootTransaction();
        }),
        verifyCreatedNote: vi.fn(async () => ({ status: "verified" }) as const),
      };
      const execute: SourceWriteExecutor = async (
        saveRequest,
        saveToken,
        current,
      ) => {
        if (stage === "before-planner") beginRootTransaction();
        return executeSourceWrite(saveRequest, saveToken, current, mutation);
      };
      const controller = new SourceWriteController(
        () => state,
        planner,
        execute,
      );
      await controller.preview();
      const save = controller.save();
      if (!(save instanceof Promise)) throw new Error("expected Save promise");
      const result = await save;
      expect(result).toMatchObject({
        status:
          stage === "after-note-create-invocation"
            ? "post-create-stale"
            : "stale",
        acceptedFolderPaths:
          stage === "during-final-note-checks" ||
          stage === "after-note-create-invocation"
            ? ["Sources"]
            : [],
      });
      if (stage === "after-note-create-invocation")
        expect(result).toMatchObject({ createdPath: writable.targetPath });
      else expect(result).not.toHaveProperty("createdPath");
      expect(triggered).toBe(true);
      expect(controller.installedPreview).toBeUndefined();
    },
  );
});
