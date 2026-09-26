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
const boundaryChildTimeoutMs = 15_000;
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

function runBoundaryChild(
  arguments_: string[],
  timeoutMs = boundaryChildTimeoutMs,
): string {
  return execFileSync(process.execPath, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
}

function runM06Boundary(
  arguments_: string[] = [],
  timeoutMs = boundaryChildTimeoutMs,
): string {
  return runBoundaryChild([checker, ...arguments_], timeoutMs);
}

async function runAdversarialBoundary(source: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "c2v-m06-classifier-"));
  const fixture = join(directory, "knowledge-classifier-adversary.ts");
  await writeFile(fixture, source, "utf8");
  try {
    runM06Boundary(["--adversarial-file", fixture]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runImportedAdversarialBoundary(
  authoritySource: string,
  consumerSource: string,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "c2v-m06-imported-type-"));
  const authority = join(directory, "authority.ts");
  const consumer = join(directory, "knowledge-consumer.ts");
  await writeFile(authority, authoritySource, "utf8");
  await writeFile(consumer, consumerSource, "utf8");
  try {
    runM06Boundary(["--adversarial-file", consumer]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

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
      sourceSettingsGeneration: 1,
      knowledgeSettingsGeneration: 1,
      sourceRootPending: false,
      knowledgeRootPending: false,
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

vi.setConfig({ testTimeout: 15_000 });

describe("M06 capability and privacy boundary", () => {
  it("passes the syntax-aware M06 static boundary checker", () => {
    expect(() => runM06Boundary()).not.toThrow();
  }, 15_000);

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

  it("requires clean-check validation against the tracked release bundles", () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m05-runtime.mjs"),
      "utf8",
    );
    expect(runner).not.toContain(
      '!process.argv.includes("--artifacts-only") &&',
    );
    expect(runner).toContain("compareTrackedReleaseArtifacts(");
    expect(runner).toContain('"main.js": production.artifact');
    expect(runner).toContain('"worker.js": builtWorker');
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
      "check-m05-runtime.mjs",
      "check-m06-boundaries.mjs",
      "check-m06-runtime.mjs --artifacts-only",
    ])
      expect(aggregate).toContain(command);
    expect(aggregate).not.toContain("check-m05-runtime.mjs --artifacts-only");
    for (const checkerName of ["check-plugin.mjs", "check-m04-boundaries.mjs"])
      expect(() =>
        runBoundaryChild([join(pluginRoot, "scripts", checkerName)]),
      ).not.toThrow();

    const generalGate = readFileSync(
      join(pluginRoot, "scripts/check-plugin.mjs"),
      "utf8",
    );
    expect(generalGate).toContain("ts.isElementAccessExpression(node)");
    expect(generalGate).toContain("forbiddenVaultMutationAccess(node)");
  });

  it.each([
    [
      "logical authority",
      "const disk = io || fallback; disk.write(sourcePath, original)",
    ],
    [
      "constructor parameter property",
      "class Box { constructor(private readonly disk: SourceVaultIO) {} mutate() { this.disk.write(sourcePath, original); } } new Box(io).mutate()",
    ],
    [
      "new constructor argument",
      "class Box { constructor(_disk: SourceVaultIO) {} } new Box(io)",
    ],
    ["spread argument", "sink(...[io])"],
    [
      "for-of authority",
      "for (const disk of [io]) disk.write(sourcePath, original)",
    ],
    [
      "default parameter",
      "const use = (disk: SourceVaultIO = io) => disk.write(sourcePath, original); use()",
    ],
    [
      "computed class field",
      "class Box { [io as unknown as string] = 1 } void Box",
    ],
    ["tagged template", "tag`${io}`"],
    [
      "compound assignment",
      "let disk: SourceVaultIO | undefined; disk ||= io; disk.write(sourcePath, original)",
    ],
  ])("rejects typed adversarial %s flow", async (_name, statement) => {
    const directory = await mkdtemp(join(tmpdir(), "c2v-m06-typed-flow-"));
    const fixture = join(directory, "knowledge-typed-adversary.ts");
    await writeFile(
      fixture,
      `interface SourceVaultIO { write(path: string, bytes: Uint8Array): unknown }
export function adversary(io: SourceVaultIO, fallback: SourceVaultIO, sourcePath: string, original: Uint8Array, sink: (...values: unknown[]) => unknown, tag: (strings: TemplateStringsArray, value: unknown) => unknown) { ${statement}; }`,
      "utf8",
    );
    try {
      expect(() => runM06Boundary(["--adversarial-file", fixture])).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects cross-file imported writer authority", async () => {
    const directory = await mkdtemp(join(tmpdir(), "c2v-m06-cross-file-"));
    const authority = join(directory, "knowledge-authority.ts");
    const consumer = join(directory, "knowledge-consumer.ts");
    await writeFile(
      authority,
      `export interface SourceVaultIO { write(path: string, bytes: Uint8Array): unknown }
export declare const exportedWriter: SourceVaultIO;`,
      "utf8",
    );
    await writeFile(
      consumer,
      `import { exportedWriter as renamedWriter } from "./knowledge-authority.js";
export const escaped = { nested: renamedWriter };`,
      "utf8",
    );
    try {
      expect(() =>
        runM06Boundary([
          "--adversarial-file",
          consumer,
          "--adversarial-file",
          authority,
        ]),
      ).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a single-root consumer importing a non-root writer envelope", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "c2v-m06-imported-envelope-"),
    );
    const authority = join(directory, "authority.ts");
    const consumer = join(directory, "knowledge-consumer.ts");
    await writeFile(
      authority,
      `export interface Writer { write(path: string, bytes: Uint8Array): unknown }
export interface WriterEnvelope { writer: Writer }
export declare const envelope: WriterEnvelope;`,
      "utf8",
    );
    await writeFile(
      consumer,
      `import { envelope } from "./authority.js";
export const escaped = envelope;`,
      "utf8",
    );
    try {
      expect(() => runM06Boundary(["--adversarial-file", consumer])).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a renamed structural writer computed mutation call", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "c2v-m06-structural-writer-"),
    );
    const fixture = join(directory, "knowledge-structural-writer.ts");
    await writeFile(
      fixture,
      `interface Writer { write(path: string, bytes: Uint8Array): unknown }
export function adversary(writer: Writer, path: string, bytes: Uint8Array) {
  writer["write"](path, bytes);
}`,
      "utf8",
    );
    try {
      expect(() => runM06Boundary(["--adversarial-file", fixture])).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an imported envelope writer computed mutation call", async () => {
    const directory = await mkdtemp(join(tmpdir(), "c2v-m06-envelope-call-"));
    const authority = join(directory, "authority.ts");
    const consumer = join(directory, "knowledge-consumer.ts");
    await writeFile(
      authority,
      `export interface Writer { write(path: string, bytes: Uint8Array): unknown }
export interface Envelope { writer: Writer }
export declare const envelope: Envelope;`,
      "utf8",
    );
    await writeFile(
      consumer,
      `import { envelope } from "./authority.js";
export function adversary(path: string, bytes: Uint8Array) {
  envelope.writer["write"](path, bytes);
}`,
      "utf8",
    );
    try {
      expect(() => runM06Boundary(["--adversarial-file", consumer])).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects whole-object transfer of a structurally named writer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "c2v-m06-writer-transfer-"));
    const fixture = join(directory, "knowledge-writer-transfer.ts");
    await writeFile(
      fixture,
      `interface Writer { write(path: string, bytes: Uint8Array): unknown }
export function adversary(writer: Writer, sink: (value: unknown) => unknown) {
  sink(writer);
}`,
      "utf8",
    );
    try {
      expect(() => runM06Boundary(["--adversarial-file", fixture])).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["Array", "Map", "Object", "Promise"])(
    "does not exempt a repository-local %s shadow from structural authority",
    async (shadowName) => {
      await expect(
        runAdversarialBoundary(
          `export interface ${shadowName} { write(path: string, bytes: Uint8Array): unknown }
export function adversary(writer: ${shadowName}, path: string, bytes: Uint8Array, sink: (value: unknown) => unknown) {
  writer["write"](path, bytes);
  sink(writer);
}`,
        ),
      ).rejects.toThrow();
    },
  );

  it("keeps actual standard-library read-only containers non-authority", async () => {
    await expect(
      runAdversarialBoundary(
        `export function inspect(map: Map<string, string>, set: Set<string>, values: readonly string[], pending: Promise<string>, sink: (value: unknown) => unknown) {
  void map.get("key");
  void set.has("value");
  void values.slice();
  void pending.then((value) => value);
  sink({ map, set, values, pending });
}`,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    [
      "optional parameters",
      "write(path?: string, bytes?: Uint8Array): unknown",
    ],
    [
      "tuple rest parameters",
      "write(...args: [path: string, bytes: Uint8Array]): unknown",
    ],
    ["general rest parameters", "write(...args: unknown[]): unknown"],
  ])(
    "rejects structural writer authority with %s",
    async (_name, signature) => {
      await expect(
        runAdversarialBoundary(
          `interface Writer { ${signature} }
export function adversary(writer: Writer, path: string, bytes: Uint8Array, sink: (value: unknown) => unknown) {
  writer["write"](path, bytes);
  sink(writer);
}`,
        ),
      ).rejects.toThrow();
    },
  );

  it("fails closed for an indeterminate callable mutation member", async () => {
    await expect(
      runAdversarialBoundary(
        `interface IndeterminateWriter { write: any }
export function adversary(writer: IndeterminateWriter, sink: (value: unknown) => unknown) {
  sink(writer);
}`,
      ),
    ).rejects.toThrow();
  });

  it.each([
    ["rmdir", "path: string, recursive: boolean"],
    ["trash", "file: unknown, system: boolean"],
  ])(
    "uses the two-argument canonical count for %s",
    async (method, parameters) => {
      await expect(
        runAdversarialBoundary(
          `interface Writer { ${method}(${parameters}): unknown }
export function adversary(writer: Writer, sink: (value: unknown) => unknown) {
  sink(writer);
}`,
        ),
      ).rejects.toThrow();
    },
  );

  it.each([
    ["zero-argument method", "write(): unknown"],
    ["one-argument method", "write(path: string): unknown"],
    [
      "three-required-argument method",
      "write(path: string, bytes: Uint8Array, mode: string): unknown",
    ],
    [
      "one-position tuple-rest method",
      "write(...args: [path: string]): unknown",
    ],
    ["one-argument rmdir method", "rmdir(path: string): unknown"],
    ["one-argument trash method", "trash(file: unknown): unknown"],
    ["non-callable property", "write: string"],
  ])("keeps incompatible %s non-authority", async (_name, member) => {
    await expect(
      runAdversarialBoundary(
        `interface ReadOnlyShape { ${member} }
export function inspect(value: ReadOnlyShape, sink: (value: unknown) => unknown) {
  sink(value);
}`,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects writer authority beyond fourteen imported envelope layers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "c2v-m06-deep-envelope-"));
    const authority = join(directory, "authority.ts");
    const consumer = join(directory, "knowledge-consumer.ts");
    const layers = Array.from(
      { length: 18 },
      (_, index) =>
        `export interface Layer${String(index + 1)} { nested: Layer${String(index)} }`,
    ).join("\n");
    await writeFile(
      authority,
      `export interface Writer { write(path: string, bytes: Uint8Array): unknown }
export interface Layer0 { writer: Writer }
${layers}
export declare const envelope: Layer18;`,
      "utf8",
    );
    await writeFile(
      consumer,
      `import { envelope } from "./authority.js";
export const escaped = envelope;`,
      "utf8",
    );
    try {
      expect(() => runM06Boundary(["--adversarial-file", consumer])).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("terminates a recursive read-only cycle without inventing authority", async () => {
    await expect(
      runAdversarialBoundary(
        `interface Left { right?: Right; value: string }
interface Right { left?: Left; count: number }
export function inspect(value: Left, sink: (value: unknown) => unknown) {
  sink(value);
}`,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects writer authority reachable through a recursive cycle", async () => {
    await expect(
      runAdversarialBoundary(
        `interface Writer { write(path: string, bytes: Uint8Array): unknown }
interface Left { right?: Right }
interface Right { left?: Left; writer?: Writer }
export function adversary(value: Left, sink: (value: unknown) => unknown) {
  sink(value);
}`,
      ),
    ).rejects.toThrow();
  });

  it("locks fail-closed traversal exhaustion and removes depth shortcuts", () => {
    const boundary = readFileSync(checker, "utf8");
    expect(boundary).not.toContain("depth >");
    expect(boundary).toContain("authorityTraversalExhausted = true");
    expect(boundary).toContain("authorityCache.set(type, true)");
    expect(boundary).toContain("traversal budget and failed closed");
  });

  it.each([
    ["ReadonlyArray", "ReadonlyArray<Writer>"],
    ["Promise", "Promise<Writer>"],
    ["Map", "Map<string, Writer>"],
    ["Set", "Set<Writer>"],
  ])(
    "rejects writer authority in imported default-lib %s type arguments",
    async (_name, containerType) => {
      await expect(
        runImportedAdversarialBoundary(
          `export interface Writer { write(path: string, bytes: Uint8Array): unknown }
export declare const wrapped: ${containerType};`,
          `import { wrapped } from "./authority.js";
export const escaped = wrapped;`,
        ),
      ).rejects.toThrow();
    },
  );

  it("keeps imported default-lib string containers non-authority", async () => {
    await expect(
      runImportedAdversarialBoundary(
        `export declare const readonlyValues: ReadonlyArray<string>;
export declare const pending: Promise<string>;
export declare const index: Map<string, string>;
export declare const unique: Set<string>;`,
        `import { index, pending, readonlyValues, unique } from "./authority.js";
export const inspected = { index, pending, readonlyValues, unique };`,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["Record", "Record<string, Writer>", 'indexed["writer"]'],
    ["string index", "{ readonly [key: string]: Writer }", 'indexed["writer"]'],
    ["number index", "{ readonly [key: number]: Writer }", "indexed[0]"],
    [
      "symbol index",
      "{ readonly [key: symbol]: Writer }",
      "indexed[Symbol.iterator]",
    ],
    [
      "nested indexed container",
      "{ readonly [key: string]: ReadonlyArray<Writer> }",
      'indexed["writers"]',
    ],
  ])(
    "rejects whole transfer of imported %s writer authority",
    async (_name, indexedType) => {
      await expect(
        runImportedAdversarialBoundary(
          `export interface Writer { write(path: string, bytes: Uint8Array): unknown }
export declare const indexed: ${indexedType};`,
          `import { indexed } from "./authority.js";
export const escaped = indexed;`,
        ),
      ).rejects.toThrow();
    },
  );

  it.each([
    ["Record", "Record<string, Writer>", 'indexed["writer"]'],
    ["string index", "{ readonly [key: string]: Writer }", 'indexed["writer"]'],
    ["number index", "{ readonly [key: number]: Writer }", "indexed[0]"],
    [
      "symbol index",
      "{ readonly [key: symbol]: Writer }",
      "indexed[Symbol.iterator]",
    ],
    [
      "nested indexed container",
      "{ readonly [key: string]: ReadonlyArray<Writer> }",
      'indexed["writers"]',
    ],
  ])(
    "rejects computed extraction from imported %s writer authority",
    async (_name, indexedType, access) => {
      await expect(
        runImportedAdversarialBoundary(
          `export interface Writer { write(path: string, bytes: Uint8Array): unknown }
export declare const indexed: ${indexedType};`,
          `import { indexed } from "./authority.js";
export const extracted = ${access};`,
        ),
      ).rejects.toThrow();
    },
  );

  it("keeps imported read-only indexed values non-authority", async () => {
    await expect(
      runImportedAdversarialBoundary(
        `export declare const record: Record<string, string>;
export declare const strings: { readonly [key: string]: string };
export declare const numbers: { readonly [key: number]: string };
export declare const symbols: { readonly [key: symbol]: string };
export declare const nested: { readonly [key: string]: ReadonlyArray<string> };`,
        `import { nested, numbers, record, strings, symbols } from "./authority.js";
export const inspected = {
  record,
  recordValue: record["key"],
  strings,
  stringValue: strings["key"],
  numbers,
  numberValue: numbers[0],
  symbols,
  symbolValue: symbols[Symbol.iterator],
  nested,
  nestedValue: nested["key"],
};`,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["Array", "interface Array<T>", "Array<string>"],
    ["Map", "interface Map<K, V>", "Map<string, string>"],
    ["Object", "interface Object", "Object"],
    ["Promise", "interface Promise<T>", "Promise<string>"],
  ])(
    "does not exempt a local global %s augmentation",
    async (_name, declaration, valueType) => {
      await expect(
        runAdversarialBoundary(
          `export {};
declare global { ${declaration} { write(path: string, bytes: Uint8Array): unknown } }
export function adversary(value: ${valueType}, path: string, bytes: Uint8Array, sink: (value: unknown) => unknown) {
  value["write"](path, bytes);
  sink(value);
}`,
        ),
      ).rejects.toThrow();
    },
  );

  it("excludes an explicit TypeScript this parameter from mutation arity", async () => {
    await expect(
      runAdversarialBoundary(
        `interface Writer { write(this: Writer, path: string, bytes: Uint8Array): unknown }
export function adversary(writer: Writer, path: string, bytes: Uint8Array, sink: (value: unknown) => unknown) {
  writer["write"](path, bytes);
  sink(writer);
}`,
      ),
    ).rejects.toThrow();
  });

  it("terminates boundary children within the configured subprocess bound", () => {
    expect(boundaryChildTimeoutMs).toBe(15_000);
    const startedAt = Date.now();
    let failure: unknown;
    try {
      runBoundaryChild(["-e", "setInterval(() => undefined, 1_000)"], 100);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "ETIMEDOUT", signal: "SIGKILL" });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("uses the SHA inventory and provider contribution comparator for M06", () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m06-runtime.mjs"),
      "utf8",
    );
    expect(runner).toContain("compareM05RuntimeArtifacts");
    expect(runner).not.toContain("m06ArtifactComparisonFunction");
    expect(runner).not.toContain("providerTransport: {}");
    const preFixtureSettle = runner.indexOf(
      'enablePlugin("chat-to-vault");await new Promise((resolve)=>setTimeout(resolve,3000))',
    );
    const interception = runner.indexOf("plugin.installM06MutationLedger()");
    const fixtureSetup = runner.indexOf("plugin.prepareM06RuntimeVault()");
    const viewConstruction = runner.indexOf(
      "let runtimeLeaf=",
      fixtureSetup + 1,
    );
    expect(preFixtureSettle).toBeGreaterThan(-1);
    expect(interception).toBeGreaterThan(preFixtureSettle);
    expect(fixtureSetup).toBeGreaterThan(interception);
    expect(viewConstruction).toBeGreaterThan(fixtureSetup);
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
      expect(() => runM06Boundary(["--adversarial-file", fixture])).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "renamed nested container",
      "const bucket = { outer: { disk: io } }; bucket.outer.disk.write(sourcePath, original)",
    ],
    [
      "whole authority array",
      "const bucket = [io]; bucket[0].write(sourcePath, original)",
    ],
    [
      "public class field",
      "class Box { disk = io; mutate() { this.disk.write(sourcePath, original); } } new Box().mutate()",
    ],
    [
      "private class field",
      "class Box { #disk = io; mutate() { this.#disk.write(sourcePath, original); } } new Box().mutate()",
    ],
    [
      "constructor field assignment",
      "class Box { disk: any; constructor() { this.disk = io; } mutate() { this.disk.write(sourcePath, original); } } new Box().mutate()",
    ],
    ["returned authority", "return io"],
    ["passed authority", "sink(io)"],
    [
      "closure authority",
      "const reveal = () => io; reveal().write(sourcePath, original)",
    ],
    [
      "destructured container",
      "const bucket = { disk: io }; const { disk: renamed } = bucket; renamed.write(sourcePath, original)",
    ],
    [
      "optional computed chained read",
      'const bucket = { disk: io }; bucket?.["disk"]?.write(sourcePath, original)',
    ],
  ])("rejects adversarial %s transfer", async (_name, statement) => {
    const directory = await mkdtemp(join(tmpdir(), "c2v-m06-authority-"));
    const fixture = join(directory, "knowledge-authority-adversary.ts");
    await writeFile(
      fixture,
      `export function adversary(io: any, sourcePath: string, original: Uint8Array, sink: (value: any) => unknown) { ${statement}; }`,
      "utf8",
    );
    try {
      expect(() => runM06Boundary(["--adversarial-file", fixture])).toThrow();
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
