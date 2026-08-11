import type { ChatGptExportFile, ImportResult } from "@chat2vault/core";

interface WorkerReply {
  ok: boolean;
  result?: ImportResult;
}

type WorkerStreamReply =
  | { kind: "result-start"; result: Omit<ImportResult, "diagnostics"> }
  | { kind: "diagnostics"; diagnostics: ImportResult["diagnostics"] }
  | { kind: "result-complete" };

export interface ImportWebWorker {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

type WorkerFactory = () => ImportWebWorker;

declare const __C2V_WORKER_SOURCE__: string;

function createEmbeddedWorker(): ImportWebWorker {
  const workerUrl = URL.createObjectURL(
    new Blob([__C2V_WORKER_SOURCE__], { type: "text/javascript" }),
  );
  const worker = new globalThis.Worker(workerUrl);
  return {
    addEventListener: worker.addEventListener.bind(worker),
    removeEventListener: worker.removeEventListener.bind(worker),
    postMessage: worker.postMessage.bind(worker),
    terminate: () => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    },
  };
}

export function runImportInWorker(
  files: readonly ChatGptExportFile[],
  signal: AbortSignal,
  createWorker: WorkerFactory = createEmbeddedWorker,
): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Import aborted."));
      return;
    }
    const worker = createWorker();
    let settled = false;
    let streamedResult: Omit<ImportResult, "diagnostics"> | undefined;
    const streamedDiagnostics: ImportResult["diagnostics"] = [];
    const cleanup = (): void => {
      signal.removeEventListener("abort", abort);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("message", onMessage);
      worker.terminate();
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = (): void => {
      fail(new Error("Import aborted."));
    };
    const onError: EventListener = (): void => {
      fail(new Error("Import worker failed."));
    };
    const onMessage: EventListener = (event): void => {
      if (settled) return;
      const reply = (event as MessageEvent<WorkerReply | WorkerStreamReply>)
        .data;
      if ("kind" in reply) {
        if (reply.kind === "result-start") {
          streamedResult = reply.result;
          return;
        }
        if (reply.kind === "diagnostics") {
          streamedDiagnostics.push(...reply.diagnostics);
          return;
        }
        if (streamedResult === undefined) {
          fail(new Error("Import worker failed."));
          return;
        }
        settled = true;
        cleanup();
        resolve({ ...streamedResult, diagnostics: streamedDiagnostics });
        return;
      }
      settled = true;
      cleanup();
      if (reply.ok && reply.result !== undefined) resolve(reply.result);
      else reject(new Error("Import worker failed."));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.addEventListener("error", onError);
    worker.addEventListener("message", onMessage);
    worker.postMessage(
      files,
      files.map((file) => file.data.buffer as ArrayBuffer),
    );
  });
}
