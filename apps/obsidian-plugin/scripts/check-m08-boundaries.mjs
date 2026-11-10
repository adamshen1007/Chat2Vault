import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const M08_PRODUCTION_INVENTORY = Object.freeze([
  "main.js",
  "manifest.json",
  "native/keychain.node",
  "native/source_observer.node",
  "styles.css",
  "worker.js",
]);

const providerNames = new Set([
  "fetch",
  "requestUrl",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "sendOpenAICompatibleRequest",
]);
const browserNames = new Set([
  "browser",
  "chrome",
  "indexedDB",
  "localStorage",
  "sessionStorage",
]);
const scanNames = new Set(["getFiles", "getMarkdownFiles", "recurseChildren"]);
const mutationNames = new Set([
  "delete",
  "modify",
  "modifyBinary",
  "process",
  "remove",
  "rename",
  "trash",
  "trashFile",
]);

function member(node) {
  if (ts.isPropertyAccessExpression(node))
    return { receiver: node.expression.getText(), name: node.name.text };
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression !== undefined &&
    (ts.isStringLiteral(node.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
  )
    return {
      receiver: node.expression.getText(),
      name: node.argumentExpression.text,
    };
  return undefined;
}

function auditNodes(parsed, roots) {
  const failures = [];
  const seen = new Set();
  const visit = (node) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (ts.isIdentifier(node)) {
      if (providerNames.has(node.text))
        failures.push(`provider/network capability ${node.text}`);
      if (browserNames.has(node.text))
        failures.push(`browser/session capability ${node.text}`);
    }
    const property = member(node);
    if (property !== undefined) {
      if (property.name === "read" || property.name === "readText") {
        if (/(?:^|\.)clipboard$/u.test(property.receiver))
          failures.push(`clipboard read capability ${property.name}`);
      }
      if (
        ["cookie", "history", "location"].includes(property.name) &&
        ["document", "globalThis", "window"].includes(property.receiver)
      )
        failures.push(`browser/session capability ${property.name}`);
      if (scanNames.has(property.name))
        failures.push(`automatic staging scan ${property.name}`);
      if (
        mutationNames.has(property.name) &&
        /(?:^|\.)(?:adapter|io|vault)$/u.test(property.receiver)
      )
        failures.push(`destructive capture mutation ${property.name}`);
    }
    ts.forEachChild(node, visit);
  };
  for (const root of roots) visit(root);
  return [...new Set(failures)];
}

function selectedSourceRoots(parsed, fileName) {
  if (!new Set(["main.ts", "view.ts"]).has(fileName)) return [parsed];
  const roots = [];
  const visit = (node) => {
    if (
      ts.isMethodDeclaration(node) &&
      /capture/iu.test(node.name.getText(parsed))
    )
      roots.push(node);
    if (
      ts.isPropertyDeclaration(node) &&
      /capture/iu.test(node.name.getText(parsed))
    )
      roots.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return roots;
}

export function checkM08CaptureSource(source, fileName = "capture-fixture.ts") {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const failures = [
    ...parsed.parseDiagnostics.map(() => "invalid capture source"),
    ...auditNodes(parsed, selectedSourceRoots(parsed, fileName)),
  ];
  return { ok: failures.length === 0, failures };
}

export function checkM08CaptureArtifact(source) {
  const parsed = ts.createSourceFile(
    "main.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const roots = [];
  let controllerClasses = 0;
  const visit = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const names = node.members
        .filter(ts.isMethodDeclaration)
        .map((method) => method.name.getText(parsed));
      if (names.includes("previewPaste") && names.includes("previewStaging")) {
        roots.push(node);
        controllerClasses += 1;
      } else
        for (const method of node.members)
          if (
            ts.isMethodDeclaration(method) &&
            /capture/iu.test(method.name.getText(parsed))
          )
            roots.push(method);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const failures = [
    ...parsed.parseDiagnostics.map(() => "invalid built capture artifact"),
    ...auditNodes(parsed, roots),
  ];
  if (controllerClasses !== 1)
    failures.push("M08 capture controller class missing or ambiguous");
  if (!source.includes("ChatGPT page capture"))
    failures.push("M08 capture UI marker missing");
  return { ok: failures.length === 0, failures };
}

export function checkM08ProductionInventory(paths) {
  const actual = [...paths].sort();
  const expected = [...M08_PRODUCTION_INVENTORY].sort();
  const failures = [];
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    failures.push("M08 production artifact inventory mismatch");
  if (actual.some((path) => path.includes("source_observer_test.node")))
    failures.push("test-only native addon entered production inventory");
  return { ok: failures.length === 0, failures };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const failures = [];
  for (const name of [
    "capture-controller.ts",
    "capture-vault-adapter.ts",
    "capture-reconciliation.ts",
    "main.ts",
    "view.ts",
  ])
    failures.push(
      ...checkM08CaptureSource(
        readFileSync(join(pluginRoot, "src", name), "utf8"),
        name,
      ).failures.map((failure) => `${name}: ${failure}`),
    );
  failures.push(
    ...checkM08CaptureArtifact(
      readFileSync(join(pluginRoot, "main.js"), "utf8"),
    ).failures.map((failure) => `main.js: ${failure}`),
  );
  const productionBinary = readFileSync(
    join(pluginRoot, "native/source_observer.node"),
  ).toString("latin1");
  for (const marker of [
    "barrier-after-temporary-mkdir",
    "barrier-before-publish",
    "partial-write",
    "queue-failure",
  ])
    if (productionBinary.includes(marker))
      failures.push(`production native addon contains test fault ${marker}`);
  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write("M08 capture source/artifact boundary PASS\n");
}
