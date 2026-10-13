import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  checkM07BoundarySource,
  checkM07BoundaryArtifact,
  checkM07WiringSource,
} from "../scripts/check-m07-boundaries.mjs";
import * as m07Boundary from "../scripts/check-m07-boundaries.mjs";

const dedupSourcePath = new URL(
  "../src/knowledge-dedup-controller.ts",
  import.meta.url,
);
function checkDedupSource(source: string) {
  const checker = (
    m07Boundary as {
      checkM07DedupControllerSource?: (source: string) => { ok: boolean };
    }
  ).checkM07DedupControllerSource;
  expect(checker).toBeTypeOf("function");
  return checker?.(source);
}

describe("M07 source boundary", () => {
  it("exposes a dedicated audit for the sole internal ordinary write call", () => {
    expect("checkM07DedupControllerSource" in m07Boundary).toBe(true);
  });
  it("accepts exactly the existing revalidated ordinary execution spine", () => {
    expect(checkDedupSource(readFileSync(dedupSourcePath, "utf8"))?.ok).toBe(
      true,
    );
  });
  it("pins the approved controller and built gate class bytes", () => {
    expect("checkM07PinnedSource" in m07Boundary).toBe(true);
    expect("checkM07PinnedArtifact" in m07Boundary).toBe(true);
    const source = readFileSync(dedupSourcePath, "utf8");
    const artifact = readFileSync(
      new URL("../main.js", import.meta.url),
      "utf8",
    );
    const sourcePin = (
      m07Boundary as {
        checkM07PinnedSource?: (text: string) => { ok: boolean };
      }
    ).checkM07PinnedSource;
    const artifactPin = (
      m07Boundary as {
        checkM07PinnedArtifact?: (text: string) => { ok: boolean };
      }
    ).checkM07PinnedArtifact;
    expect(sourcePin?.(source).ok).toBe(true);
    expect(artifactPin?.(artifact).ok).toBe(true);
    expect(
      sourcePin?.(
        source.replace("let catalog:", "const alias=this; let catalog:"),
      ).ok,
    ).toBe(false);
    expect(sourcePin?.(`const bypass = 'write';\n${source}`).ok).toBe(false);
    expect(
      artifactPin?.(
        artifact.replace("this.base.write()", "this['base']['write']()"),
      ).ok,
    ).toBe(false);
    expect(artifactPin?.(`const bypass = 'write';\n${artifact}`).ok).toBe(
      false,
    );
  });
  it("rejects direct or aliased M06 write outside that spine", () => {
    const source = readFileSync(dedupSourcePath, "utf8");
    const valid = source;
    expect(
      checkDedupSource(
        valid.replace(
          "if (!this.authorityCurrent(installed)) return stale();",
          "await this.base.write();\n      if (!this.authorityCurrent(installed)) return stale();",
        ),
      )?.ok,
    ).toBe(false);
    expect(
      checkDedupSource(
        valid.replace(
          "return await this.base.write();",
          "const bypass = this.base.write; return await bypass();",
        ),
      )?.ok,
    ).toBe(false);
    expect(
      checkDedupSource(
        valid.replace(
          "return await this.base.write();",
          "return await this.base['write']();",
        ),
      )?.ok,
    ).toBe(false);
    expect(
      checkDedupSource(
        valid.replace(
          "let catalog: KnowledgeCatalogReadResult;",
          "this.base[methodName]();\n      let catalog: KnowledgeCatalogReadResult;",
        ),
      )?.ok,
    ).toBe(false);
  });
  it.each([
    "void this['base']['write']();",
    "const bypass=this.base; void bypass['write']();",
    "const key='write'; void this['base'][key]();",
    "const first=this.base; const second=first; void second[key]();",
    "void Reflect.get(this, 'base')['write']();",
    "void Object.getOwnPropertyDescriptor(this, 'base')?.value['write']();",
    "void (this.base)['write']();",
    "const alias=this; void alias['base']['write']();",
  ])("rejects M06 writer acquisition in source: %s", (injection) => {
    const source = readFileSync(dedupSourcePath, "utf8");
    const adversarial = source.replace(
      "let catalog: KnowledgeCatalogReadResult;",
      `${injection}\n      let catalog: KnowledgeCatalogReadResult;`,
    );
    expect(adversarial).not.toBe(source);
    expect(checkDedupSource(adversarial)?.ok).toBe(false);
  });
  it.each([
    "vault.modify(existing, text)",
    "vault.delete(existing)",
    "vault.create(path, text)",
    "fetch('https://provider.invalid')",
    "knowledgeController.write()",
    "vault['modify'](existing, text)",
    "Reflect.get(globalThis, 'fetch')('https://provider.invalid')",
    "knowledgeGate['base'].write()",
    "const mutate = vault.modify; mutate(existing, text)",
    "const caller = globalThis.fetch; caller('https://provider.invalid')",
    "const read = Reflect.get; read(globalThis, 'fetch')('https://provider.invalid')",
    "const global = globalThis; global.fetch('https://provider.invalid')",
    "const gate = knowledgeGate; gate['base'].write()",
  ])("rejects %s", (source) =>
    expect(checkM07BoundarySource(source).ok).toBe(false),
  );
  it("accepts create-only gated action", () => {
    expect(checkM07BoundarySource("knowledgeGate.createCombined()").ok).toBe(
      true,
    );
  });
  it("rejects forbidden capability in a shipped M07 class, not just a present marker", () => {
    const clean =
      'class Panel { draw() { this.button("Create combined note", () => this.createCombined()); } } class Gate { previewCombined() {} async runWrite(e) { return a(i).length>0||!this.authorityCurrent(e)?n():await this.base.write(); } }';
    expect(checkM07BoundaryArtifact(clean).ok).toBe(true);
    expect(
      checkM07BoundaryArtifact(
        clean.replace(
          "previewCombined() {}",
          'previewCombined() { vault["modify"](file, text); }',
        ),
      ).ok,
    ).toBe(false);
    expect(
      checkM07BoundaryArtifact(
        'class Panel { draw() { this.button("Create combined note", () => fetch(url)); } previewCombined() {} }',
      ).ok,
    ).toBe(false);
    expect(
      checkM07BoundaryArtifact(
        'const marker = "Create combined note"; const previewCombined = true;',
      ).ok,
    ).toBe(false);
  });
  it("rejects extra or aliased M06 writer calls in the built gate class", () => {
    const clean =
      'class Panel { draw() { this.button("Create combined note", () => this.createCombined()); } } class Gate { previewCombined() {} async runWrite(e) { return a(i).length>0||!this.authorityCurrent(e)?n():await this.base.write(); } }';
    expect(checkM07BoundaryArtifact(clean).ok).toBe(true);
    expect(
      checkM07BoundaryArtifact(
        clean.replace(
          "previewCombined() {}",
          "previewCombined() {} bypass() { return this.base.write(); }",
        ),
      ).ok,
    ).toBe(false);
    expect(
      checkM07BoundaryArtifact(
        clean.replace(
          "return a(i).length>0||!this.authorityCurrent(e)?n():await this.base.write();",
          "const bypass=this.base.write; return a(i).length>0||!this.authorityCurrent(e)?n():await bypass();",
        ),
      ).ok,
    ).toBe(false);
    expect(
      checkM07BoundaryArtifact(
        clean.replace(
          "async runWrite(e) {",
          "async runWrite(e) { return a(i).length>0||!this.authorityCurrent(e)?n():await this.base.write();",
        ),
      ).ok,
    ).toBe(false);
  });
  it.each([
    "bypass(){return this['base']['write']()}",
    "bypass(){const writer=this.base;return writer['write']()}",
    "bypass(){const key='write';return this['base'][key]()}",
    "bypass(){const writer=this.base;const alias=writer;return alias[key]()}",
    "bypass(){return Reflect.get(this,'base')['write']()}",
    "bypass(){return Object.getOwnPropertyDescriptor(this,'base')?.value['write']()}",
    "bypass(){return (this.base)['write']()}",
    "bypass(){const alias=this;return alias['base']['write']()}",
  ])("rejects M06 writer acquisition in built gate: %s", (injection) => {
    const clean =
      'class Panel { draw() { this.button("Create combined note", () => this.createCombined()); } } class Gate { previewCombined() {} async runWrite(e) { return a(i).length>0||!this.authorityCurrent(e)?n():await this.base.write(); } }';
    const adversarial = clean.replace(
      "previewCombined() {}",
      `previewCombined() {} ${injection}`,
    );
    expect(checkM07BoundaryArtifact(adversarial).ok).toBe(false);
  });
  it("checks M07 constructor wiring rather than ignoring view and main", () => {
    expect(
      checkM07WiringSource(
        "new KnowledgeDedupPanel(root, { createCombined: () => gate.createCombined() })",
        "KnowledgeDedupPanel",
      ).ok,
    ).toBe(true);
    expect(
      checkM07WiringSource(
        "new KnowledgeDedupPanel(root, { createCombined: () => vault['modify'](file, text) })",
        "KnowledgeDedupPanel",
      ).ok,
    ).toBe(false);
    expect(
      checkM07WiringSource("const absent = true", "KnowledgeDedupPanel").ok,
    ).toBe(false);
  });
});
