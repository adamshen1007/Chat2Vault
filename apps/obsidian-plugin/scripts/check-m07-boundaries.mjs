import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import ts from "typescript";

const plugin = dirname(dirname(fileURLToPath(import.meta.url)));
// Exact reviewed identities. Any module or built gate edit requires boundary review.
const approvedDedupModuleSha256 =
  "7c09e074c606e8ddfb7ca533d81b12352ab865a6a89c68b4c0afdbfe2452419f";
const approvedBuiltGateClassSha256 =
  "5a83b50a87cfffc2b3316a91f4b9bb1ab5d493e0c00eeb6ff0a3f77c20e70590";
const approvedBuiltArtifactSha256 =
  "ea10c033443a81595d7e4e42e4a4887ed0f694a8b384a1ef5c33843abe2cba33";
const forbidden = new Set([
  "modify",
  "delete",
  "rename",
  "trash",
  "fetch",
  "requestUrl",
  "sendOpenAICompatibleRequest",
]);
const sensitiveRoots = new Set([
  "vault",
  "knowledgeController",
  "knowledgeGate",
]);
const providerNames = new Set([
  "fetch",
  "requestUrl",
  "XMLHttpRequest",
  "WebSocket",
  "sendOpenAICompatibleRequest",
]);
const vaultMutations = new Set([
  "append",
  "appendBinary",
  "copy",
  "create",
  "createBinary",
  "createFolder",
  "delete",
  "modify",
  "modifyBinary",
  "process",
  "remove",
  "rename",
  "trash",
  "write",
  "writeBinary",
]);

function member(node) {
  if (ts.isPropertyAccessExpression(node))
    return { receiver: node.expression, name: node.name.text };
  if (ts.isElementAccessExpression(node))
    return {
      receiver: node.expression,
      name: ts.isStringLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : undefined,
    };
  return undefined;
}

function pinnedClass(source, fileName, expected, select) {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  const classes = [];
  const visit = (node) => {
    if (
      (ts.isClassDeclaration(node) || ts.isClassExpression(node)) &&
      select(node, parsed)
    )
      classes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const actual =
    classes.length === 1
      ? createHash("sha256").update(classes[0].getText(parsed)).digest("hex")
      : undefined;
  const failures = [
    ...parsed.parseDiagnostics.map(() => "invalid pinned class source"),
  ];
  if (actual !== expected)
    failures.push("reviewed M07 gate class identity changed");
  return { ok: failures.length === 0, failures };
}

export function checkM07PinnedSource(source) {
  const actual = createHash("sha256").update(source, "utf8").digest("hex");
  const failures =
    actual === approvedDedupModuleSha256
      ? []
      : ["reviewed M07 dedup controller module identity changed"];
  return { ok: failures.length === 0, failures };
}

export function checkM07PinnedArtifact(source) {
  const gate = pinnedClass(
    source,
    "main.js",
    approvedBuiltGateClassSha256,
    (node, parsed) =>
      node.members.some(
        (memberNode) =>
          ts.isMethodDeclaration(memberNode) &&
          memberNode.name.getText(parsed) === "previewCombined",
      ),
  );
  const actual = createHash("sha256").update(source, "utf8").digest("hex");
  const failures = [...gate.failures];
  if (actual !== approvedBuiltArtifactSha256)
    failures.push("reviewed M07 built artifact identity changed");
  return { ok: failures.length === 0, failures };
}

const approvedBaseMembers = new Set([
  "ordinaryAuthority",
  "installCandidates",
  "decide",
  "edit",
  "select",
  "selectAllEligible",
  "invalidate",
  "preview",
  "snapshot",
]);

/** No M06 controller reference may escape or be acquired via computed access. */
export function isApprovedM07BaseAccess(node, parsed, fileName) {
  if (
    !["knowledge-dedup-controller.ts", "main.js"].includes(fileName) ||
    !ts.isPropertyAccessExpression(node) ||
    node.expression.getText(parsed) !== "this" ||
    node.name.text !== "base"
  )
    return false;
  const parent = node.parent;
  if (
    fileName === "main.js" &&
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(parent.right) &&
    ts.isConstructorDeclaration(parent.parent?.parent?.parent) &&
    parent.parent.parent.parent.parameters.some(
      (parameter) => parameter.name.getText(parsed) === parent.right.text,
    )
  )
    return true;
  return (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === node &&
    (approvedBaseMembers.has(parent.name.text) ||
      isApprovedM07OrdinaryWrite(parent, parsed, fileName))
  );
}

/** Only the final M07 runWrite return after its fail-closed authority guard. */
export function isApprovedM07OrdinaryWrite(node, parsed, fileName) {
  if (
    !["knowledge-dedup-controller.ts", "main.js"].includes(fileName) ||
    !ts.isPropertyAccessExpression(node) ||
    node.name.text !== "write" ||
    node.expression.getText(parsed) !== "this.base"
  )
    return false;
  const call = node.parent;
  const awaited = call?.parent;
  if (fileName === "main.js") {
    const conditional = awaited?.parent;
    const returned = conditional?.parent;
    const block = returned?.parent;
    const condition = conditional?.condition;
    if (
      !ts.isCallExpression(call) ||
      call.expression !== node ||
      call.arguments.length !== 0 ||
      !ts.isAwaitExpression(awaited) ||
      !ts.isConditionalExpression(conditional) ||
      conditional.whenFalse !== awaited ||
      !ts.isReturnStatement(returned) ||
      returned.expression !== conditional ||
      !ts.isBlock(block) ||
      block.statements.at(-1) !== returned ||
      !ts.isBinaryExpression(condition) ||
      condition.operatorToken.kind !== ts.SyntaxKind.BarBarToken ||
      !ts.isBinaryExpression(condition.left) ||
      condition.left.operatorToken.kind !== ts.SyntaxKind.GreaterThanToken ||
      !ts.isPropertyAccessExpression(condition.left.left) ||
      condition.left.left.name.text !== "length" ||
      !ts.isCallExpression(condition.left.left.expression) ||
      condition.left.right.getText(parsed) !== "0" ||
      !ts.isPrefixUnaryExpression(condition.right) ||
      condition.right.operator !== ts.SyntaxKind.ExclamationToken ||
      !ts.isCallExpression(condition.right.operand) ||
      condition.right.operand.expression.getText(parsed) !==
        "this.authorityCurrent" ||
      condition.right.operand.arguments.length !== 1 ||
      !ts.isCallExpression(conditional.whenTrue)
    )
      return false;
    let method = block.parent;
    while (method && !ts.isMethodDeclaration(method)) method = method.parent;
    return (
      method?.name.getText(parsed) === "runWrite" &&
      method.parameters.length === 1 &&
      condition.right.operand.arguments[0].getText(parsed) ===
        method.parameters[0].name.getText(parsed) &&
      (ts.isClassDeclaration(method.parent) ||
        ts.isClassExpression(method.parent)) &&
      method.parent.members.some(
        (memberNode) =>
          ts.isMethodDeclaration(memberNode) &&
          memberNode.name.getText(parsed) === "previewCombined",
      )
    );
  }
  const returned = awaited?.parent;
  const block = returned?.parent;
  if (
    !ts.isCallExpression(call) ||
    call.expression !== node ||
    call.arguments.length !== 0 ||
    !ts.isAwaitExpression(awaited) ||
    !ts.isReturnStatement(returned) ||
    returned.expression !== awaited ||
    !ts.isBlock(block)
  )
    return false;
  const index = block.statements.indexOf(returned);
  const guard = block.statements[index - 1];
  if (
    index < 2 ||
    !ts.isIfStatement(guard) ||
    !ts.isPrefixUnaryExpression(guard.expression) ||
    guard.expression.operator !== ts.SyntaxKind.ExclamationToken ||
    !ts.isCallExpression(guard.expression.operand) ||
    guard.expression.operand.expression.getText(parsed) !==
      "this.authorityCurrent" ||
    guard.expression.operand.arguments.length !== 1 ||
    guard.thenStatement.getText(parsed).replace(/\s/gu, "") !== "returnstale();"
  )
    return false;
  let method = block.parent;
  while (method && !ts.isMethodDeclaration(method)) method = method.parent;
  if (
    !method ||
    method.name.getText(parsed) !== "runWrite" ||
    method.parameters.length !== 1 ||
    guard.expression.operand.arguments[0].getText(parsed) !==
      method.parameters[0].name.getText(parsed)
  )
    return false;
  return (
    ts.isClassDeclaration(method.parent) &&
    method.parent.name?.text === "KnowledgeDedupController" &&
    block.statements[index - 2]?.getText(parsed).replace(/\s/gu, "") ===
      "if(duplicateCandidateIds(refreshed).length>0)returnstale();"
  );
}

function checkNode(parsed, root = parsed, fileName = "m07-fixture.ts") {
  const failures = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer?.kind === ts.SyntaxKind.ThisKeyword
    )
      failures.push("aliased M07 controller instance");
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer?.getText(parsed) === "knowledgeGate" &&
      node.name.getText(parsed) !== "knowledgeGate"
    )
      failures.push("aliased knowledge gate authority");
    if (
      ts.isIdentifier(node) &&
      [
        "vault",
        "fetch",
        "requestUrl",
        "XMLHttpRequest",
        "WebSocket",
        "sendOpenAICompatibleRequest",
      ].includes(node.text)
    ) {
      // Capability acquisition is forbidden, including aliases that are called later.
      if (
        !ts.isPropertyAccessExpression(node.parent) ||
        node.parent.name !== node
      )
        failures.push(`forbidden capability ${node.text}`);
    }
    const property = member(node);
    if (property !== undefined) {
      const receiver = property.receiver.getText(parsed);
      if (
        receiver === "this" &&
        (property.name === "base" || property.name === undefined) &&
        !isApprovedM07BaseAccess(node, parsed, fileName)
      )
        failures.push("unapproved M06 writer capability acquisition");
      if (
        receiver === "this.base" &&
        (property.name === undefined ||
          ["write", "writeAfterDedupGate"].includes(property.name)) &&
        !isApprovedM07OrdinaryWrite(node, parsed, fileName)
      )
        failures.push("unchecked internal M06 writer authority");
      if (receiver === "Reflect")
        failures.push("reflective capability acquisition");
      if (providerNames.has(property.name ?? ""))
        failures.push(`provider capability ${property.name}`);
      if (sensitiveRoots.has(receiver) && property.name === undefined)
        failures.push("dynamic capability lookup");
      if (
        (receiver === "knowledgeGate" && property.name === "base") ||
        (receiver === "knowledgeController" &&
          ["write", "preview"].includes(property.name ?? ""))
      )
        failures.push("unchecked M06 writer authority");
      if (
        (receiver === "vault" ||
          receiver.endsWith(".vault") ||
          receiver === "app.vault") &&
        vaultMutations.has(property.name ?? "")
      )
        failures.push(`vault mutation ${property.name}`);
      if (
        receiver === "globalThis" &&
        (property.name === undefined || providerNames.has(property.name))
      )
        failures.push("global provider capability");
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.expression.getText(parsed) === "Object" &&
        node.arguments[0]?.getText(parsed) === "this"
      )
        failures.push("reflective controller capability acquisition");
      const name =
        member(callee)?.name ?? (ts.isIdentifier(callee) ? callee.text : "");
      if (
        (forbidden.has(name) &&
          !isApprovedM07OrdinaryWrite(callee, parsed, fileName)) ||
        name === "writeAfterDedupGate" ||
        name === "writeKnowledge" ||
        (member(callee) !== undefined &&
          ["write", "create"].includes(name) &&
          ["knowledgeController", "vault", "app.vault"].includes(
            member(callee).receiver.getText(parsed),
          ))
      )
        failures.push(`forbidden ${name}`);
      if (
        name === "get" &&
        member(callee)?.receiver.getText(parsed) === "Reflect"
      ) {
        const target = node.arguments[0]?.getText(parsed);
        const key = node.arguments[1];
        if (
          target === "globalThis" ||
          target === "vault" ||
          target === "knowledgeGate" ||
          key === undefined ||
          !ts.isStringLiteral(key)
        )
          failures.push("reflective capability lookup");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return { ok: failures.length === 0, failures };
}

export function checkM07BoundarySource(source) {
  const parsed = ts.createSourceFile(
    "m07-fixture.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const result = checkNode(parsed);
  const failures = [
    ...parsed.parseDiagnostics.map(() => "invalid source"),
    ...result.failures,
  ];
  return { ok: failures.length === 0, failures };
}

export function checkM07DedupControllerSource(source) {
  const parsed = ts.createSourceFile(
    "knowledge-dedup-controller.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const result = checkNode(parsed, parsed, "knowledge-dedup-controller.ts");
  let approvedCalls = 0;
  const count = (node) => {
    if (
      isApprovedM07OrdinaryWrite(node, parsed, "knowledge-dedup-controller.ts")
    )
      approvedCalls += 1;
    ts.forEachChild(node, count);
  };
  count(parsed);
  const failures = [
    ...parsed.parseDiagnostics.map(() => "invalid dedup controller source"),
    ...result.failures,
  ];
  if (approvedCalls !== 1)
    failures.push("missing or ambiguous revalidated ordinary write call");
  return { ok: failures.length === 0, failures };
}

export function checkM07BoundaryArtifact(source) {
  const parsed = ts.createSourceFile(
    "main.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const classes = [];
  const collect = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node))
      classes.push(node);
    ts.forEachChild(node, collect);
  };
  collect(parsed);
  const ui = classes.filter((node) =>
    node.getText(parsed).includes("Create combined note"),
  );
  const gate = classes.filter((node) =>
    node.members.some(
      (memberNode) =>
        ts.isMethodDeclaration(memberNode) &&
        memberNode.name.getText(parsed) === "previewCombined",
    ),
  );
  const failures = [
    ...parsed.parseDiagnostics.map(() => "invalid built artifact"),
  ];
  if (ui.length !== 1 || gate.length !== 1)
    failures.push("M07 UI/gate class identity missing or ambiguous");
  for (const selected of new Set([...ui, ...gate]))
    failures.push(...checkNode(parsed, selected, "main.js").failures);
  if (gate.length === 1) {
    let approvedCalls = 0;
    const count = (node) => {
      if (isApprovedM07OrdinaryWrite(node, parsed, "main.js"))
        approvedCalls += 1;
      ts.forEachChild(node, count);
    };
    count(gate[0]);
    if (approvedCalls !== 1)
      failures.push("missing or ambiguous built ordinary write call");
  }
  return { ok: failures.length === 0, failures };
}

export function checkM07WiringSource(source, constructorName) {
  const parsed = ts.createSourceFile(
    "m07-wiring.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const sites = [];
  const visit = (node) => {
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(parsed) === constructorName
    )
      sites.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const failures = [
    ...parsed.parseDiagnostics.map(() => "invalid wiring source"),
  ];
  if (sites.length !== 1)
    failures.push(`missing or ambiguous ${constructorName} wiring`);
  for (const site of sites) failures.push(...checkNode(parsed, site).failures);
  return { ok: failures.length === 0, failures };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = [
    "dedup-panel.ts",
    "knowledge-dedup-controller.ts",
    "knowledge-catalog-adapter.ts",
  ];
  const failures = files.flatMap((name) =>
    (name === "knowledge-dedup-controller.ts"
      ? checkM07DedupControllerSource
      : checkM07BoundarySource)(
      readFileSync(join(plugin, "src", name), "utf8"),
    ).failures.map((reason) => `${name}: ${reason}`),
  );
  failures.push(
    ...checkM07PinnedSource(
      readFileSync(
        join(plugin, "src", "knowledge-dedup-controller.ts"),
        "utf8",
      ),
    ).failures.map((reason) => `knowledge-dedup-controller.ts: ${reason}`),
  );
  for (const [file, constructorName] of [
    ["view.ts", "KnowledgeDedupController"],
    ["view.ts", "KnowledgeDedupPanel"],
    ["main.ts", "ObsidianKnowledgeCatalogAdapter"],
  ])
    failures.push(
      ...checkM07WiringSource(
        readFileSync(join(plugin, "src", file), "utf8"),
        constructorName,
      ).failures.map((reason) => `${file}: ${reason}`),
    );
  const bundle = join(plugin, "main.js");
  if (!existsSync(bundle)) failures.push("built plugin artifact missing");
  else {
    const bytes = readFileSync(bundle, "utf8");
    failures.push(
      ...checkM07BoundaryArtifact(bytes).failures.map(
        (reason) => `main.js: ${reason}`,
      ),
      ...checkM07PinnedArtifact(bytes).failures.map(
        (reason) => `main.js: ${reason}`,
      ),
    );
  }
  if (failures.length) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  } else
    process.stdout.write("M07 create-only source and artifact boundary PASS\n");
}
