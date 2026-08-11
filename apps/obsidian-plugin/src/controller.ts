import type { ChatGptExportFile, ImportResult } from "@chat2vault/core";
import { classifyResult, type PreviewState } from "./model.js";
import { validateInputEnvelope } from "./input.js";

export interface ReadableFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface ImportSnapshot {
  state: PreviewState;
  result?: ImportResult;
  error?: string;
}
export type ImportRunner = (
  files: readonly ChatGptExportFile[],
  signal: AbortSignal,
) => Promise<ImportResult>;

export class ImportController {
  private generation = 0;
  private active = false;
  private aborter: AbortController | undefined;
  private current: ImportSnapshot = { state: "idle" };
  private readonly listeners = new Set<(snapshot: ImportSnapshot) => void>();
  public constructor(private readonly runner: ImportRunner) {}
  public get snapshot(): ImportSnapshot {
    return this.current;
  }
  public subscribe(listener: (snapshot: ImportSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
  private publish(snapshot: ImportSnapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
  public cancelPicker(): void {
    /* Cancellation intentionally preserves terminal state. */
  }
  public clear(): void {
    this.generation += 1;
    this.aborter?.abort();
    this.aborter = undefined;
    this.active = false;
    this.publish({ state: "idle" });
  }
  public close(): void {
    this.clear();
    this.listeners.clear();
  }
  public async import(files: readonly ReadableFile[]): Promise<void> {
    if (this.active) {
      this.publish({
        ...this.current,
        error: "An import is already in progress.",
      });
      return;
    }
    const validation = validateInputEnvelope(files);
    if (!validation.ok) {
      this.publish({
        state: "error",
        error: validation.message ?? "Unsupported import input.",
      });
      return;
    }
    this.active = true;
    const aborter = new AbortController();
    this.aborter = aborter;
    const generation = ++this.generation;
    this.publish({ state: "reading" });
    try {
      const coreFiles = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          data: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      if (generation !== this.generation) return;
      this.publish({ state: "parsing" });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (generation !== this.generation || aborter.signal.aborted) return;
      const result = await this.runner(coreFiles, aborter.signal);
      if (generation !== this.generation) return;
      this.publish({
        state: classifyResult(result.conversations.length, result.diagnostics),
        result,
      });
    } catch {
      if (generation === this.generation)
        this.publish({
          state: "error",
          error: "The export could not be imported safely.",
        });
    } finally {
      if (generation === this.generation) {
        this.active = false;
        this.aborter = undefined;
      }
    }
  }
}
