/* eslint-disable @typescript-eslint/require-await -- synthetic async methods model Obsidian Vault and DataAdapter contracts. */
import { describe, expect, it } from "vitest";
import { installM06MutationLedger } from "../src/runtime-test-mutation-ledger.js";

const sourcePath = "Sources/synthetic-source.md";

interface SyntheticFile {
  path: string;
}

function runtimeVault() {
  const initialSource = new TextEncoder().encode("synthetic source bytes\n");
  const files = new Map<string, Uint8Array>([
    [sourcePath, new Uint8Array(initialSource)],
  ]);
  const encode = (value: string | ArrayBuffer): Uint8Array =>
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  const adapter = {
    readBinary: async (path: string): Promise<ArrayBuffer> =>
      (files.get(path) ?? new Uint8Array()).slice().buffer,
    write: async (path: string, content: string): Promise<void> => {
      files.set(path, encode(content));
    },
    writeBinary: async (path: string, content: ArrayBuffer): Promise<void> => {
      files.set(path, encode(content));
    },
    append: async (path: string, content: string): Promise<void> => {
      const before = files.get(path) ?? new Uint8Array();
      files.set(path, encode(`${new TextDecoder().decode(before)}${content}`));
    },
    process: async (
      path: string,
      callback: (content: string) => string,
    ): Promise<void> => {
      const before = new TextDecoder().decode(files.get(path));
      files.set(path, encode(callback(before)));
    },
    remove: async (path: string): Promise<void> => {
      files.delete(path);
    },
    rename: async (path: string, target: string): Promise<void> => {
      const bytes = files.get(path);
      files.delete(path);
      if (bytes !== undefined) files.set(target, bytes);
    },
    copy: async (path: string, target: string): Promise<void> => {
      const bytes = files.get(path);
      if (bytes !== undefined) files.set(target, new Uint8Array(bytes));
    },
    trash: async (path: string): Promise<void> => {
      files.delete(path);
    },
    mkdir: async (): Promise<void> => undefined,
    rmdir: async (): Promise<void> => undefined,
  };
  const vault = {
    adapter,
    create: async (path: string, content: string): Promise<SyntheticFile> => {
      files.set(path, encode(content));
      return { path };
    },
    createBinary: async (
      path: string,
      content: ArrayBuffer,
    ): Promise<SyntheticFile> => {
      files.set(path, encode(content));
      return { path };
    },
    createFolder: async (): Promise<void> => undefined,
    modify: async (file: SyntheticFile, content: string): Promise<void> => {
      files.set(file.path, encode(content));
    },
    modifyBinary: async (
      file: SyntheticFile,
      content: ArrayBuffer,
    ): Promise<void> => {
      files.set(file.path, encode(content));
    },
    process: async (
      file: SyntheticFile,
      callback: (content: string) => string,
    ): Promise<void> => {
      const before = new TextDecoder().decode(files.get(file.path));
      files.set(file.path, encode(callback(before)));
    },
    delete: async (file: SyntheticFile): Promise<void> => {
      files.delete(file.path);
    },
    trash: async (file: SyntheticFile): Promise<void> => {
      files.delete(file.path);
    },
    rename: async (file: SyntheticFile, target: string): Promise<void> => {
      const bytes = files.get(file.path);
      files.delete(file.path);
      if (bytes !== undefined) files.set(target, bytes);
    },
    copy: async (
      file: SyntheticFile,
      target: string,
    ): Promise<SyntheticFile> => {
      const bytes = files.get(file.path);
      if (bytes !== undefined) files.set(target, new Uint8Array(bytes));
      return { path: target };
    },
  };
  return { vault, adapter, files, initialSource };
}

describe("M06 runtime mutation attempt ledger", () => {
  it("blocks and retains source write-then-restore attempts through aliases and computed calls", async () => {
    const fixture = runtimeVault();
    const ledger = installM06MutationLedger(fixture.vault, sourcePath);
    const write = fixture.adapter.write.bind(fixture.adapter);
    const computed = "writeBinary" as const;
    try {
      await expect(write(sourcePath, "changed")).rejects.toThrow(
        "source mutation prohibited",
      );
      await expect(
        fixture.adapter[computed](sourcePath, fixture.initialSource.buffer),
      ).rejects.toThrow("source mutation prohibited");
      expect(
        new Uint8Array(await fixture.adapter.readBinary(sourcePath)),
      ).toEqual(fixture.initialSource);
      expect(ledger.entries()).toEqual([
        {
          surface: "adapter",
          method: "write",
          path: sourcePath,
          phase: "production",
          blocked: true,
        },
        {
          surface: "adapter",
          method: "writeBinary",
          path: sourcePath,
          phase: "production",
          blocked: true,
        },
      ]);
    } finally {
      ledger.restore();
    }
  });

  it("records Vault and adapter mutations per relative path and method", async () => {
    const fixture = runtimeVault();
    const ledger = installM06MutationLedger(fixture.vault, sourcePath);
    try {
      await fixture.vault.create("Knowledge/first.md", "first");
      await fixture.adapter.write("Knowledge/second.md", "second");
      ledger.setPhase("fixture");
      await fixture.vault.copy(
        { path: "Knowledge/first.md" },
        "Knowledge/conflict.md",
      );
      expect(ledger.entries()).toEqual([
        {
          surface: "vault",
          method: "create",
          path: "Knowledge/first.md",
          phase: "production",
          blocked: false,
        },
        {
          surface: "adapter",
          method: "write",
          path: "Knowledge/second.md",
          phase: "production",
          blocked: false,
        },
        {
          surface: "vault",
          method: "copy",
          path: "Knowledge/first.md",
          phase: "fixture",
          blocked: false,
        },
      ]);
    } finally {
      ledger.restore();
    }
  });
});
