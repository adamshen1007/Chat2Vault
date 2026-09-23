/* eslint-disable @typescript-eslint/require-await -- synthetic async boundaries model vault I/O. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  const noteBytes = new Map<string, Uint8Array>();
  const effects = {
    create: 0,
    sourceMutation: 0,
    provider: 0,
    network: 0,
    persisted: [] as unknown[],
    logs: [] as unknown[][],
  };
  const adapter: KnowledgeVaultAdapter = {
    resolveKnowledgeSources: async () => ({ ok: true, sources: [source()] }),
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
      join(pluginRoot, "scripts/check-m06-runtime.mjs"),
      "utf8",
    );
    expect(runner).toContain('!process.argv.includes("--artifacts-only") &&');
    expect(runner).toContain('"generated production artifact requirement"');
    expect(runner).toContain('"fresh worker source"');
    expect(runner).toContain(
      'const worker = await readFile(join(directory, "worker.js"), "utf8");',
    );
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
