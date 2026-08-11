import { parseChatGptExport, type ChatGptExportFile } from "@chat2vault/core";
import { parentPort } from "node:worker_threads";

interface WorkerReply {
  ok: boolean;
  result?: ReturnType<typeof parseChatGptExport>;
}

const DIAGNOSTIC_CHUNK_SIZE = 250;

const handle = (files: readonly ChatGptExportFile[]): WorkerReply => {
  try {
    return { ok: true, result: parseChatGptExport(files) };
  } catch {
    return { ok: false };
  }
};

const nodeParentPort = parentPort;
if (nodeParentPort !== null) {
  nodeParentPort.once("message", (files: readonly ChatGptExportFile[]) => {
    nodeParentPort.postMessage(handle(files));
  });
} else {
  globalThis.addEventListener(
    "message",
    (event: MessageEvent<readonly ChatGptExportFile[]>) => {
      const reply = handle(event.data);
      if (!reply.ok || reply.result === undefined) {
        globalThis.postMessage({ ok: false });
        return;
      }
      const { diagnostics, ...result } = reply.result;
      globalThis.postMessage({ kind: "result-start", result });
      const postDiagnostics = (offset: number): void => {
        if (offset >= diagnostics.length) {
          globalThis.postMessage({ kind: "result-complete" });
          return;
        }
        globalThis.postMessage({
          kind: "diagnostics",
          diagnostics: diagnostics.slice(
            offset,
            offset + DIAGNOSTIC_CHUNK_SIZE,
          ),
        });
        setTimeout(() => postDiagnostics(offset + DIAGNOSTIC_CHUNK_SIZE), 2);
      };
      postDiagnostics(0);
    },
  );
}
