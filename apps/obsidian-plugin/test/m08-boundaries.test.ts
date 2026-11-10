import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkM08CaptureArtifact,
  checkM08CaptureSource,
  checkM08ProductionInventory,
} from "../scripts/check-m08-boundaries.mjs";

const pluginRoot = new URL("..", import.meta.url);

describe("M08 capture boundaries", () => {
  it("accepts the current capture spine and production artifact", () => {
    for (const name of [
      "capture-controller.ts",
      "capture-vault-adapter.ts",
      "capture-reconciliation.ts",
      "main.ts",
      "view.ts",
    ]) {
      expect(
        checkM08CaptureSource(
          readFileSync(new URL(`src/${name}`, pluginRoot), "utf8"),
          name,
        ),
      ).toEqual({ ok: true, failures: [] });
    }
    expect(
      checkM08CaptureArtifact(
        readFileSync(new URL("main.js", pluginRoot), "utf8"),
      ).ok,
    ).toBe(true);
  });

  it.each([
    ["provider route", "fetch('https://provider.invalid')"],
    ["provider alias", "const send = sendOpenAICompatibleRequest; send(x)"],
    ["clipboard read", "navigator.clipboard.readText()"],
    ["browser session", "sessionStorage.getItem('capture')"],
    ["browser location", "window.location.href"],
    ["automatic staging scan", "app.vault.getMarkdownFiles()"],
    ["automatic file scan", "app.vault.getFiles()"],
    ["update", "vault.modify(file, text)"],
    ["delete", "vault.delete(file)"],
    ["rename", "vault.rename(file, target)"],
  ])("rejects %s from the capture spine", (_label, source) => {
    expect(checkM08CaptureSource(source, "capture-fixture.ts").ok).toBe(false);
  });

  it("rejects forbidden capabilities in the built capture classes", () => {
    const artifact = readFileSync(new URL("main.js", pluginRoot), "utf8");
    expect(
      checkM08CaptureArtifact(
        artifact.replace(
          "previewPaste(",
          "bypass(){return navigator.clipboard.readText()}previewPaste(",
        ),
      ).ok,
    ).toBe(false);
    expect(
      checkM08CaptureArtifact(
        artifact.replace(
          "previewPaste(",
          "bypass(){return app.vault.delete(file)}previewPaste(",
        ),
      ).ok,
    ).toBe(false);
  });

  it("requires the closed production inventory and rejects the test-only addon", () => {
    const inventory = [
      "main.js",
      "manifest.json",
      "native/keychain.node",
      "native/source_observer.node",
      "styles.css",
      "worker.js",
    ];
    expect(checkM08ProductionInventory(inventory)).toEqual({
      ok: true,
      failures: [],
    });
    expect(
      checkM08ProductionInventory([
        ...inventory,
        "native/source_observer_test.node",
      ]).ok,
    ).toBe(false);
    expect(checkM08ProductionInventory(inventory.slice(1)).ok).toBe(false);
  });
});
