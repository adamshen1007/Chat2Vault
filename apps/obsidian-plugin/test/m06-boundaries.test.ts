/* eslint-disable @typescript-eslint/require-await -- synthetic async boundaries model vault I/O. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type {
  PreviewCandidate,
  ResolvedKnowledgeSource,
} from "@chat2vault/core";
import { KnowledgeController } from "../src/knowledge-controller.js";
import {
  ObsidianKnowledgeVaultAdapter,
  type KnowledgeVaultAdapter,
} from "../src/knowledge-vault-adapter.js";

const repositoryRoot = join(import.meta.dirname, "../../..");
const pluginRoot = join(repositoryRoot, "apps/obsidian-plugin");
const checker = join(pluginRoot, "scripts/check-m06-boundaries.mjs");
const sentinel = "M06_SENTINEL_CONTENT_MUST_NOT_ESCAPE";
const conversationFingerprint = `sha256:${"1".repeat(64)}`;
const messageFingerprint = `sha256:${"2".repeat(64)}`;
const candidateId = `sha256:${"3".repeat(64)}`;
const completeMutationMethods = [
  "append",
  "appendBinary",
  "appendFile",
  "copy",
  "create",
  "createBinary",
  "createFolder",
  "delete",
  "mkdir",
  "modify",
  "modifyBinary",
  "process",
  "remove",
  "rename",
  "rmdir",
  "rm",
  "trash",
  "trashFile",
  "trashLocal",
  "trashSystem",
  "truncate",
  "unlink",
  "write",
  "writeBinary",
  "writeFile",
] as const;

function candidate(id = candidateId): PreviewCandidate {
  return {
    id,
    candidateFingerprint: `sha256:${"4".repeat(64)}`,
    type: "insight",
    title: sentinel,
    summary: `${sentinel} summary`,
    body: `${sentinel} body`,
    status: "proposed",
    confidence: "high",
    sourceRefs: [
      {
        provider: "chatgpt",
        providerConversationId: "synthetic-conversation",
        conversationFingerprint,
        messageFingerprints: [messageFingerprint],
      },
    ],
    suggestedLinks: [],
    suggestedTags: ["synthetic"],
  };
}

function source(): ResolvedKnowledgeSource {
  return {
    provider: "chatgpt",
    providerConversationId: "synthetic-conversation",
    conversationFingerprint,
    messageFingerprints: [messageFingerprint],
    sourceNotePath: "Sources/synthetic-source.md",
  };
}

function controllerHarness(observation: "absent" | "conflict" = "absent") {
  const sourceBytes = new TextEncoder().encode("synthetic source bytes\n");
  const initialSourceBytes = new Uint8Array(sourceBytes);
  const noteBytes = new Map<string, Uint8Array>([
    [source().sourceNotePath, sourceBytes],
  ]);
  const effects = {
    create: 0,
    sourceReads: 0,
    sourceMutation: 0,
    provider: 0,
    network: 0,
    persisted: [] as unknown[],
    logs: [] as unknown[][],
  };
  const adapter: KnowledgeVaultAdapter = {
    resolveKnowledgeSources: async () => {
      const resolved = source();
      const bytes = noteBytes.get(resolved.sourceNotePath);
      if (bytes === undefined) throw new Error("missing synthetic source note");
      effects.sourceReads += 1;
      expect(new TextDecoder().decode(bytes)).toBe("synthetic source bytes\n");
      return { ok: true, sources: [resolved] };
    },
    observeKnowledgeTarget: async (path) => {
      if (observation === "conflict")
        return {
          status: "regular-file",
          bytes: new TextEncoder().encode("synthetic conflicting bytes"),
        };
      const bytes = noteBytes.get(path);
      return bytes === undefined
        ? { status: "absent" }
        : { status: "regular-file", bytes };
    },
    checkpointKnowledgeTarget: async (path) => ({
      status: "absent-safe",
      resolvedPath: path,
    }),
    createKnowledgeNote: async (path, content) => {
      if (path === source().sourceNotePath) {
        effects.sourceMutation += 1;
        throw new Error("source mutation prohibited");
      }
      effects.create += 1;
      noteBytes.set(path, new TextEncoder().encode(content));
    },
    readKnowledgeNote: async (path) => {
      const bytes = noteBytes.get(path);
      if (bytes === undefined) throw new Error("missing synthetic note");
      return new Uint8Array(bytes);
    },
  };
  const controller = new KnowledgeController({
    current: () => ({
      loaded: true,
      lifecycleGeneration: 1,
      importGeneration: 1,
      selectionGeneration: 1,
      distillationGeneration: 1,
      knowledgeSettingsGeneration: 1,
      sourceRoot: "Sources",
      knowledgeRoot: "Knowledge",
    }),
    adapter,
  });
  return {
    controller,
    effects,
    sourceBytes,
    initialSourceBytes,
  };
}

function interfaceKeys(file: string, interfaceName: string): string[] {
  const text = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === interfaceName,
  );
  if (declaration === undefined) throw new Error(`missing ${interfaceName}`);
  return declaration.members
    .map((member) => member.name)
    .filter((name): name is ts.PropertyName => name !== undefined)
    .map((name) => name.getText(sourceFile).replaceAll(/["']/gu, ""))
    .sort();
}

describe("M06 capability and privacy boundary", () => {
  it("passes the syntax-aware M06 static boundary checker", () => {
    expect(() =>
      execFileSync(process.execPath, [checker], {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("retains the exact provider service and five-capability knowledge allowlists", () => {
    expect(
      interfaceKeys(
        join(pluginRoot, "src/provider-controller.ts"),
        "ProviderControllerServices",
      ),
    ).toEqual([
      "buildRequest",
      "current",
      "onCandidatesChanged",
      "parseResponse",
      "readCredential",
      "transport",
      "validateResult",
    ]);
    const adapter = Object.create(
      ObsidianKnowledgeVaultAdapter.prototype,
    ) as KnowledgeVaultAdapter;
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(adapter))
        .filter((name) => name !== "constructor")
        .sort(),
    ).toEqual([
      "checkpointKnowledgeTarget",
      "createKnowledgeNote",
      "observeKnowledgeTarget",
      "readKnowledgeNote",
      "resolveKnowledgeSources",
    ]);
  });

  it("defines exactly the nine approved runtime scenario identifiers", () => {
    const runtime = readFileSync(
      join(pluginRoot, "src/runtime-test-m06.ts"),
      "utf8",
    );
    const source = ts.createSourceFile(
      "runtime-test-m06.ts",
      runtime,
      ts.ScriptTarget.Latest,
      true,
    );
    const declaration = source.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => statement.declarationList.declarations)
      .find(
        (item) =>
          ts.isIdentifier(item.name) &&
          item.name.text === "M06_RUNTIME_SCENARIOS",
      );
    let initializer = declaration?.initializer;
    if (initializer !== undefined && ts.isAsExpression(initializer))
      initializer = initializer.expression;
    if (
      initializer !== undefined &&
      ts.isCallExpression(initializer) &&
      initializer.arguments[0] !== undefined
    )
      initializer = initializer.arguments[0];
    if (initializer !== undefined && ts.isAsExpression(initializer))
      initializer = initializer.expression;
    const ids =
      initializer !== undefined && ts.isArrayLiteralExpression(initializer)
        ? initializer.elements
            .filter(ts.isStringLiteral)
            .map((element) => element.text)
        : [];
    expect(ids).toEqual([
      "review-accept-edit-reject",
      "multi-select-dry-run",
      "stale-preview-disabled",
      "verified-create",
      "idempotent-retry-no-op",
      "conflict-refusal",
      "source-backlink",
      "source-note-unchanged",
      "provider-not-called",
    ]);
  });

  it("keeps clean-check artifact validation independent of restored generated bundles", () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m05-runtime.mjs"),
      "utf8",
    );
    expect(runner).toContain('!process.argv.includes("--artifacts-only") &&');
    expect(runner).toContain('entryPoints: { worker: "src/worker.ts" }');
    expect(runner).toContain(
      'const worker = await readFile(join(directory, "worker.js"), "utf8");',
    );
  });

  it("retains the general, M04, M05, and M06 aggregate gate paths", () => {
    const scripts = (
      JSON.parse(
        readFileSync(join(repositoryRoot, "package.json"), "utf8"),
      ) as { scripts: Record<string, string> }
    ).scripts;
    const aggregate = scripts["check:plugin"] ?? "";
    for (const command of [
      "check-plugin.mjs",
      "check-m04-boundaries.mjs",
      "check-m05-boundaries.mjs",
      "check-m05-runtime.mjs --artifacts-only",
      "check-m06-boundaries.mjs",
      "check-m06-runtime.mjs --artifacts-only",
    ])
      expect(aggregate).toContain(command);
    for (const checkerName of ["check-plugin.mjs", "check-m04-boundaries.mjs"])
      expect(() =>
        execFileSync(
          process.execPath,
          [join(pluginRoot, "scripts", checkerName)],
          {
            cwd: repositoryRoot,
            encoding: "utf8",
            stdio: "pipe",
          },
        ),
      ).not.toThrow();
  });

  it("uses the SHA inventory and provider contribution comparator for M06", () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m06-runtime.mjs"),
      "utf8",
    );
    expect(runner).toContain("compareM05RuntimeArtifacts");
    expect(runner).not.toContain("m06ArtifactComparisonFunction");
    expect(runner).not.toContain("providerTransport: {}");
  });

  it("derives one complete mutation authority from the installed Obsidian API", () => {
    const runtimeLedger = readFileSync(
      join(pluginRoot, "src/runtime-test-mutation-ledger.ts"),
      "utf8",
    );
    const sourceFile = ts.createSourceFile(
      "runtime-test-mutation-ledger.ts",
      runtimeLedger,
      ts.ScriptTarget.Latest,
      true,
    );
    const declaration = sourceFile.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => statement.declarationList.declarations)
      .find(
        (item) =>
          ts.isIdentifier(item.name) &&
          item.name.text === "M06_MUTATION_METHODS",
      );
    let initializer = declaration?.initializer;
    if (initializer !== undefined && ts.isAsExpression(initializer))
      initializer = initializer.expression;
    const methods =
      initializer !== undefined && ts.isArrayLiteralExpression(initializer)
        ? initializer.elements
            .filter(ts.isStringLiteral)
            .map((element) => element.text)
            .sort()
        : [];
    expect(methods).toEqual([...completeMutationMethods].sort());

    const obsidianTypes = readFileSync(
      join(pluginRoot, "node_modules/obsidian/obsidian.d.ts"),
      "utf8",
    );
    for (const declarationText of [
      "write(normalizedPath: string, data: string",
      "writeBinary(normalizedPath: string, data: ArrayBuffer",
      "append(normalizedPath: string, data: string",
      "appendBinary(normalizedPath: string, data: ArrayBuffer",
      "process(normalizedPath: string, fn: (data: string) => string",
      "mkdir(normalizedPath: string): Promise<void>",
      "trashSystem(normalizedPath: string): Promise<boolean>",
      "trashLocal(normalizedPath: string): Promise<void>",
      "rmdir(normalizedPath: string, recursive: boolean): Promise<void>",
      "remove(normalizedPath: string): Promise<void>",
      "rename(normalizedPath: string, normalizedNewPath: string)",
      "copy(normalizedPath: string, normalizedNewPath: string)",
      "create(path: string, data: string",
      "createBinary(path: string, data: ArrayBuffer",
      "createFolder(path: string): Promise<TFolder>",
      "delete(file: TAbstractFile, force?: boolean): Promise<void>",
      "trash(file: TAbstractFile, system: boolean): Promise<void>",
      "rename(file: TAbstractFile, newPath: string): Promise<void>",
      "modify(file: TFile, data: string",
      "modifyBinary(file: TFile, data: ArrayBuffer",
      "append(file: TFile, data: string",
      "appendBinary(file: TFile, data: ArrayBuffer",
      "process(file: TFile, fn: (data: string) => string",
      "copy<T extends TAbstractFile>(file: T, newPath: string)",
    ])
      expect(obsidianTypes).toContain(declarationText);
  });

  it.each([
    ["direct write", 'io.write("Sources/synthetic-source.md", "changed")'],
    [
      "computed write",
      'io["writeBinary"]("Sources/synthetic-source.md", bytes)',
    ],
    [
      "aliased modify",
      "const restore = io.modify; restore(sourceFile, original)",
    ],
    [
      "destructured rename",
      "const { rename } = adapter; rename(sourceFile, target)",
    ],
    ["assignment alias", "let mutate; mutate = io.modify"],
    ["destructuring assignment", "let mutate; ({ rename: mutate } = adapter)"],
    ["array indirection", "const bucket = [io.delete]"],
    ["object indirection", "const bucket = { mutate: io.copy }"],
    ["bound reference", "const mutate = io.write.bind(io)"],
    ["call reference", "io.write.call(io, sourcePath, original)"],
    ["apply reference", "io.write.apply(io, [sourcePath, original])"],
    ["optional reference", "io?.append?.(sourcePath, original)"],
    [
      "computed optional reference",
      'io?.["appendBinary"]?.(sourcePath, bytes)',
    ],
    ["appendBinary", "adapter.appendBinary(sourcePath, bytes)"],
    ["trashSystem", "adapter.trashSystem(sourcePath)"],
    ["trashLocal", "adapter.trashLocal(sourcePath)"],
    ["dynamic computed call", "io[method](sourcePath, original)"],
  ])("rejects adversarial %s mutation authority", async (_name, statement) => {
    const directory = await mkdtemp(join(tmpdir(), "c2v-m06-boundary-"));
    const fixture = join(directory, "knowledge-adversary.ts");
    await writeFile(
      fixture,
      `export function adversary(io: any, adapter: any, sourceFile: any, sourcePath: string, target: string, original: Uint8Array, bytes: Uint8Array, method: string) { ${statement}; }`,
      "utf8",
    );
    try {
      expect(() =>
        execFileSync(
          process.execPath,
          [checker, "--adversarial-file", fixture],
          {
            cwd: repositoryRoot,
            encoding: "utf8",
            stdio: "pipe",
          },
        ),
      ).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps dry-run and conflict paths at zero mutation", async () => {
    for (const observation of ["absent", "conflict"] as const) {
      const fixture = controllerHarness(observation);
      expect(fixture.controller.installCandidates([candidate()])).toBe(true);
      expect(fixture.controller.decide(candidateId, "accepted")).toBe(true);
      expect(fixture.controller.select(candidateId, true)).toBe(true);
      const result = await fixture.controller.preview();
      expect(result.status).toBe("planned");
      expect(fixture.effects.create).toBe(0);
      expect(fixture.effects.sourceMutation).toBe(0);
      expect(fixture.effects.sourceReads).toBeGreaterThan(0);
      expect(fixture.sourceBytes).toEqual(fixture.initialSourceBytes);
    }
  });

  it("keeps writer execution provider/network-free and source-byte immutable", async () => {
    const fixture = controllerHarness();
    const forbidden = vi.fn(() => {
      fixture.effects.network += 1;
      throw new Error("network is forbidden during knowledge write");
    });
    vi.stubGlobal("fetch", forbidden);
    try {
      expect(fixture.controller.installCandidates([candidate()])).toBe(true);
      expect(fixture.controller.decide(candidateId, "accepted")).toBe(true);
      expect(fixture.controller.select(candidateId, true)).toBe(true);
      expect((await fixture.controller.preview()).status).toBe("planned");
      await expect(
        Promise.resolve(fixture.controller.write()),
      ).resolves.toMatchObject({
        status: "saved",
        ledger: [{ status: "created" }],
      });
      expect(fixture.effects.create).toBe(1);
      expect(fixture.effects.provider).toBe(0);
      expect(fixture.effects.network).toBe(0);
      expect(fixture.effects.sourceReads).toBeGreaterThan(0);
      expect(forbidden).not.toHaveBeenCalled();
      expect(fixture.sourceBytes).toEqual(fixture.initialSourceBytes);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never places sentinel candidate content in diagnostics, settings, or logs", async () => {
    const fixture = controllerHarness("conflict");
    const log = vi.spyOn(console, "log").mockImplementation((...values) => {
      fixture.effects.logs.push(values);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation((...values) => {
      fixture.effects.logs.push(values);
    });
    const error = vi.spyOn(console, "error").mockImplementation((...values) => {
      fixture.effects.logs.push(values);
    });
    try {
      fixture.controller.installCandidates([candidate()]);
      fixture.controller.decide(candidateId, "accepted");
      fixture.controller.select(candidateId, true);
      const preview = await fixture.controller.preview();
      const write = await Promise.resolve(fixture.controller.write());
      const retained = JSON.stringify({
        preview:
          preview.status === "planned"
            ? preview.plan.diagnostics
            : preview.diagnostics,
        write: write.diagnostics,
        settings: fixture.effects.persisted,
        logs: fixture.effects.logs,
      });
      expect(retained).not.toContain(sentinel);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
