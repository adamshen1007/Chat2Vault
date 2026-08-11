import type { ImportResult } from "@chat2vault/core";
import { describe, expect, it, vi } from "vitest";

import { runImportInWorker, type ImportWebWorker } from "../src/runner.js";

const result: ImportResult = {
  source: {
    provider: "chatgpt",
    importFormat: "chatgpt-json",
    sourceFileName: "synthetic.json",
    sourceFileFingerprint: "sha256:source",
    importedAt: "2026-08-09T00:00:00.000Z",
  },
  conversations: [],
  diagnostics: [],
};

class FakeWorker implements ImportWebWorker {
  public readonly postMessage = vi.fn();
  public readonly terminate = vi.fn();
  private readonly listeners = new Map<string, Set<EventListener>>();
  public addEventListener(type: string, listener: EventListener): void {
    const set = this.listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  public removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  public emit(type: "message" | "error", event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("browser import worker runner", () => {
  it("posts files to a local browser worker and resolves its result", async () => {
    const worker = new FakeWorker();
    const create = vi.fn(() => worker);
    const data = new Uint8Array([1]);
    const promise = runImportInWorker(
      [{ fileName: "synthetic.json", data }],
      new AbortController().signal,
      create,
    );
    worker.emit(
      "message",
      new MessageEvent("message", { data: { ok: true, result } }),
    );
    await expect(promise).resolves.toBe(result);
    expect(create).toHaveBeenCalledWith();
    expect(worker.postMessage).toHaveBeenCalledWith(
      [{ fileName: "synthetic.json", data }],
      [data.buffer],
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("assembles bounded diagnostic chunks from the worker", async () => {
    const worker = new FakeWorker();
    const promise = runImportInWorker(
      [],
      new AbortController().signal,
      () => worker,
    );
    const resultWithoutDiagnostics = {
      source: result.source,
      conversations: result.conversations,
    };
    worker.emit(
      "message",
      new MessageEvent("message", {
        data: { kind: "result-start", result: resultWithoutDiagnostics },
      }),
    );
    worker.emit(
      "message",
      new MessageEvent("message", {
        data: { kind: "diagnostics", diagnostics: [] },
      }),
    );
    worker.emit(
      "message",
      new MessageEvent("message", { data: { kind: "result-complete" } }),
    );
    await expect(promise).resolves.toEqual(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates and rejects when the import is aborted", async () => {
    const worker = new FakeWorker();
    const aborter = new AbortController();
    const promise = runImportInWorker([], aborter.signal, () => worker);
    aborter.abort();
    await expect(promise).rejects.toThrow("aborted");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
