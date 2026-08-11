import type { ImportResult } from "@chat2vault/core";
import { describe, expect, it } from "vitest";
import { ImportController } from "../src/controller.js";

const result: ImportResult = {
  source: {
    provider: "chatgpt",
    importFormat: "json",
    sourceFileName: "x.json",
    sourceFileFingerprint: "sha256:x",
    importedAt: "2026-01-01T00:00:00Z",
  },
  conversations: [
    {
      schemaVersion: 1,
      provider: "chatgpt",
      title: "Synthetic",
      messages: [],
      metadata: {},
      contentFingerprint: "sha256:synthetic",
    },
  ],
  diagnostics: [],
};

describe("import controller", () => {
  it("rejects overlap, invalidates stale work on clear, and preserves terminal state on picker cancel", async () => {
    let resolve!: (value: ImportResult) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((done) => {
      markStarted = done;
    });
    const controller = new ImportController(
      () =>
        new Promise((done) => {
          resolve = done;
          markStarted();
        }),
    );
    const first = controller.import([
      {
        name: "x.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);
    await controller.import([
      {
        name: "x.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);
    expect(controller.snapshot.error).toContain("already");
    await started;
    controller.clear();
    resolve(result);
    await first;
    expect(controller.snapshot.state).toBe("idle");
    controller.cancelPicker();
    expect(controller.snapshot.state).toBe("idle");
  });

  it("aborts parser work when cleared", async () => {
    let observed: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const controller = new ImportController((_files, signal) => {
      observed = signal;
      markStarted();
      return new Promise(() => undefined);
    });
    void controller.import([
      {
        name: "x.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);
    await started;
    controller.clear();
    expect(observed?.aborted).toBe(true);
  });

  it("preserves a terminal result when the picker is cancelled", async () => {
    const controller = new ImportController(() => Promise.resolve(result));
    await controller.import([
      {
        name: "x.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);
    controller.cancelPicker();
    expect(controller.snapshot.result).toBe(result);
    expect(controller.snapshot.state).toBe("success");
  });

  it("clears an accepted previous result and never resurrects it after replacement failure", async () => {
    let attempt = 0;
    const controller = new ImportController(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.resolve(result)
        : Promise.reject(new Error("synthetic"));
    });
    const input = [
      {
        name: "x.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ];
    await controller.import(input);
    const states: { state: string; hasResult: boolean }[] = [];
    const unsubscribe = controller.subscribe((snapshot) => {
      states.push({
        state: snapshot.state,
        hasResult: snapshot.result !== undefined,
      });
    });
    await controller.import(input);
    unsubscribe();
    expect(states).toContainEqual({ state: "reading", hasResult: false });
    expect(controller.snapshot.state).toBe("error");
    expect(controller.snapshot.result).toBeUndefined();
  });

  it("prevents a stale completion from changing state after clear", async () => {
    let finish!: (value: ImportResult) => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const controller = new ImportController(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          started();
        }),
    );
    const pending = controller.import([
      {
        name: "x.json",
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      },
    ]);
    await running;
    controller.clear();
    finish(result);
    await pending;
    expect(controller.snapshot).toEqual({ state: "idle" });
  });
});
