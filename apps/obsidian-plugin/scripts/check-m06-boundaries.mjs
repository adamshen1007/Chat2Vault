import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import ts from "typescript";

const pluginRoot = new URL("..", import.meta.url).pathname;
const repositoryRoot = join(pluginRoot, "../..");
const pluginSourceRoot = join(pluginRoot, "src");
const coreSourceRoot = join(repositoryRoot, "packages/core/src");
const failures = [];

const providerServiceKeys = Object.freeze([
  "buildRequest",
  "current",
  "onCandidatesChanged",
  "parseResponse",
  "readCredential",
  "transport",
  "validateResult",
]);
const knowledgeCapabilityKeys = Object.freeze([
  "checkpointKnowledgeTarget",
  "createKnowledgeNote",
  "observeKnowledgeTarget",
  "readKnowledgeNote",
  "resolveKnowledgeSources",
]);
const providerSettingsKeys = Object.freeze([
  "endpoint",
  "model",
  "timeoutMs",
  "maxOutputTokens",
  "cloudDisclosureAccepted",
]);
const settingsV4Keys = Object.freeze([
  "schemaVersion",
  "installationId",
  "previewMessagesPerPage",
  "sourceRoot",
  "knowledgeRoot",
  "provider",
]);
const networkImports =
  /^(?:https?:|(?:node:)?(?:http|https|http2|net|tls|dgram|dns|child_process)(?:\/|$)|electron(?:\/|$))/u;
const browserNetworkNames = new Set([
  "fetch",
  "requestUrl",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
]);
let forbiddenVaultMutations;
const forbiddenContentSinks = new Set([
  "console",
  "localStorage",
  "sessionStorage",
  "indexedDB",
]);

function parse(file) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const diagnostic of source.parseDiagnostics)
    failures.push(
      `${basename(file)}: TypeScript parse failure ${String(diagnostic.code)}`,
    );
  return { file, text, source };
}

function propertyName(node, source) {
  if (node === undefined) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  return node.getText(source);
}

function interfaceKeys(record, name) {
  const declaration = record.source.statements.find(
    (statement) =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
  if (declaration === undefined) {
    failures.push(`${basename(record.file)}: missing interface ${name}`);
    return [];
  }
  return declaration.members
    .map((member) => propertyName(member.name, record.source))
    .filter((value) => value !== undefined)
    .sort();
}

function classMethodKeys(record, name) {
  const declaration = record.source.statements.find(
    (statement) =>
      ts.isClassDeclaration(statement) && statement.name?.text === name,
  );
  if (declaration === undefined) {
    failures.push(`${basename(record.file)}: missing class ${name}`);
    return [];
  }
  return declaration.members
    .filter(ts.isMethodDeclaration)
    .map((member) => propertyName(member.name, record.source))
    .filter((value) => value !== undefined)
    .sort();
}

function constStringArray(record, name) {
  for (const statement of record.source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name)
        continue;
      let initializer = declaration.initializer;
      if (initializer !== undefined && ts.isAsExpression(initializer))
        initializer = initializer.expression;
      if (
        initializer === undefined ||
        !ts.isArrayLiteralExpression(initializer)
      )
        return [];
      return initializer.elements
        .filter(ts.isStringLiteral)
        .map((element) => element.text);
    }
  }
  failures.push(`${basename(record.file)}: missing array ${name}`);
  return [];
}

function sameKeys(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort()))
    failures.push(
      `${label}: allowlist mismatch (${actual.join(",") || "empty"})`,
    );
}

const runtimeMutationLedger = parse(
  join(pluginSourceRoot, "runtime-test-mutation-ledger.ts"),
);
forbiddenVaultMutations = new Set(
  constStringArray(runtimeMutationLedger, "M06_MUTATION_METHODS"),
);
if (forbiddenVaultMutations.size === 0)
  failures.push("runtime-test-mutation-ledger.ts: empty mutation authority");

function closedDiagnosticCode(node) {
  return (
    ts.isStringLiteral(node) ||
    (ts.isIdentifier(node) && node.text === "code") ||
    (ts.isConditionalExpression(node) &&
      closedDiagnosticCode(node.whenTrue) &&
      closedDiagnosticCode(node.whenFalse))
  );
}

const pluginRecords = readdirSync(pluginSourceRoot)
  .filter((name) => name.endsWith(".ts") && !name.startsWith("runtime-test-"))
  .map((name) => parse(join(pluginSourceRoot, name)));
const knowledgePluginRecords = pluginRecords.filter((record) =>
  basename(record.file).startsWith("knowledge-"),
);
const adversarialIndex = process.argv.indexOf("--adversarial-file");
if (adversarialIndex >= 0) {
  const adversarialFile = process.argv[adversarialIndex + 1];
  if (adversarialFile === undefined)
    failures.push("--adversarial-file requires a path");
  else knowledgePluginRecords.push(parse(adversarialFile));
}
const providerPluginRecords = pluginRecords.filter((record) =>
  ["provider-controller.ts", "provider-transport.ts", "keychain.ts"].includes(
    basename(record.file),
  ),
);
const knowledgeCoreRecords = readdirSync(
  join(coreSourceRoot, "knowledge-writer"),
)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => parse(join(coreSourceRoot, "knowledge-writer", name)));

const providerController = parse(
  join(pluginSourceRoot, "provider-controller.ts"),
);
sameKeys(
  interfaceKeys(providerController, "ProviderControllerServices"),
  providerServiceKeys,
  "provider-controller.ts ProviderControllerServices",
);

const knowledgeAdapter = parse(
  join(pluginSourceRoot, "knowledge-vault-adapter.ts"),
);
sameKeys(
  interfaceKeys(knowledgeAdapter, "KnowledgeVaultAdapter"),
  knowledgeCapabilityKeys,
  "knowledge-vault-adapter.ts KnowledgeVaultAdapter",
);
sameKeys(
  classMethodKeys(knowledgeAdapter, "ObsidianKnowledgeVaultAdapter"),
  knowledgeCapabilityKeys,
  "knowledge-vault-adapter.ts implementation",
);

const settingsModel = parse(join(pluginSourceRoot, "settings-model.ts"));
sameKeys(
  constStringArray(settingsModel, "V4_KEYS").sort(),
  settingsV4Keys,
  "settings-model.ts V4_KEYS",
);
sameKeys(
  constStringArray(settingsModel, "PROVIDER_KEYS").sort(),
  providerSettingsKeys,
  "settings-model.ts PROVIDER_KEYS",
);

for (const record of pluginRecords) {
  const name = basename(record.file);
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const imported = node.moduleSpecifier.text;
      if (imported.includes("runtime-test-"))
        failures.push(`${name}: runtime seam imported by production`);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      failures.push(`${name}: dynamic import is forbidden`);
    if (ts.isIdentifier(node) && forbiddenContentSinks.has(node.text))
      failures.push(`${name}: forbidden log/persistence API ${node.text}`);
    ts.forEachChild(node, visit);
  };
  visit(record.source);
}

for (const record of providerPluginRecords) {
  const name = basename(record.file);
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /(?:knowledge-|knowledge-writer)/u.test(node.moduleSpecifier.text)
    )
      failures.push(`${name}: provider imports knowledge authority`);
    if (
      ts.isPropertyAccessExpression(node) &&
      /(?:knowledge|vault|adapter|fileManager|source)/iu.test(
        node.expression.getText(record.source),
      ) &&
      (forbiddenVaultMutations.has(node.name.text) ||
        ["create", "createBinary", "createFolder"].includes(node.name.text))
    )
      failures.push(
        `${name}: provider reaches vault mutation ${node.name.text}`,
      );
    ts.forEachChild(node, visit);
  };
  visit(record.source);
}

function mutationAccess(node) {
  if (ts.isPropertyAccessExpression(node))
    return { receiver: node.expression, method: node.name.text };
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;
    return {
      receiver: node.expression,
      method:
        argument !== undefined &&
        (ts.isStringLiteral(argument) ||
          ts.isNoSubstitutionTemplateLiteral(argument))
          ? argument.text
          : undefined,
    };
  }
  return undefined;
}

function scanKnowledgeMutations(record) {
  const name = basename(record.file);
  const at = (node) =>
    record.source.getLineAndCharacterOfPosition(node.getStart(record.source))
      .line + 1;
  const isKnowledgeAdapter = record.file === knowledgeAdapter.file;
  const rawIdentifiers = new Set();
  const contextIdentifiers = new Set();
  const containerIdentifiers = new Set();
  const rawMembers = new Set();
  const contextMembers = new Set();
  const topLevelFunctions = new Map(
    record.source.statements
      .filter(
        (statement) =>
          ts.isFunctionDeclaration(statement) && statement.name !== undefined,
      )
      .map((statement) => [statement.name.text, statement]),
  );
  if (!isKnowledgeAdapter) rawIdentifiers.add("adapter");

  const keyOf = (node) => {
    if (
      node !== undefined &&
      (ts.isIdentifier(node) ||
        ts.isPrivateIdentifier(node) ||
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node))
    )
      return node.text;
    return undefined;
  };
  const unwrap = (node) => {
    let current = node;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    )
      current = current.expression;
    return current;
  };
  const seed = (node) => {
    if (!ts.isIdentifier(node.name)) return;
    const type = node.type?.getText(record.source);
    if (
      type === "SourceVaultIO" ||
      /^(?:DataAdapter|Vault|FileManager)$/u.test(type ?? "")
    )
      rawIdentifiers.add(node.name.text);
    if (type === "AdapterContext") contextIdentifiers.add(node.name.text);
    if (
      !isKnowledgeAdapter &&
      ["io", "vault", "adapter", "fileManager"].includes(node.name.text)
    )
      rawIdentifiers.add(node.name.text);
  };
  const seedVisit = (node) => {
    if (ts.isParameter(node)) seed(node);
    if (ts.isPropertyDeclaration(node) && node.type !== undefined) {
      const key = keyOf(node.name);
      if (
        key !== undefined &&
        node.type.getText(record.source) === "AdapterContext"
      )
        contextMembers.add(key);
      if (
        key !== undefined &&
        /^(?:SourceVaultIO|DataAdapter|Vault|FileManager)$/u.test(
          node.type.getText(record.source),
        )
      )
        rawMembers.add(key);
    }
    ts.forEachChild(node, seedVisit);
  };
  seedVisit(record.source);

  const kindOf = (input) => {
    const node = unwrap(input);
    if (ts.isIdentifier(node)) {
      if (rawIdentifiers.has(node.text)) return "raw";
      if (contextIdentifiers.has(node.text)) return "context";
      if (containerIdentifiers.has(node.text)) return "container";
      return undefined;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const key = node.name.text;
      if (rawMembers.has(key)) return "raw";
      if (contextMembers.has(key)) return "context";
      const receiver = kindOf(node.expression);
      if (receiver === "context") return key === "io" ? "raw" : undefined;
      if (receiver === "raw")
        return ["basePath", "configDir"].includes(key) ? undefined : "raw";
      if (receiver === "container") return "raw";
      return undefined;
    }
    if (ts.isElementAccessExpression(node)) {
      const receiver = kindOf(node.expression);
      const key =
        node.argumentExpression === undefined
          ? undefined
          : keyOf(unwrap(node.argumentExpression));
      if (key !== undefined && rawMembers.has(key)) return "raw";
      if (key !== undefined && contextMembers.has(key)) return "context";
      if (receiver === "context") return key === "io" ? "raw" : undefined;
      if (receiver === "raw" || receiver === "container") return "raw";
      return undefined;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          kindOf(property.initializer) !== undefined
        )
          return "container";
        if (
          ts.isShorthandPropertyAssignment(property) &&
          kindOf(property.name) !== undefined
        )
          return "container";
        if (
          ts.isSpreadAssignment(property) &&
          kindOf(property.expression) !== undefined
        )
          return "container";
      }
      return undefined;
    }
    if (ts.isArrayLiteralExpression(node))
      return node.elements.some((element) => kindOf(element) !== undefined)
        ? "container"
        : undefined;
    if (ts.isConditionalExpression(node))
      return kindOf(node.whenTrue) ?? kindOf(node.whenFalse);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      return closureContainsAuthority(node) ? "container" : undefined;
    return undefined;
  };
  const closureContainsAuthority = (closure) => {
    let found = false;
    const visit = (node) => {
      if (found) return;
      if (
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)
      ) {
        if (kindOf(node) !== undefined) found = true;
        return;
      }
      if (ts.isIdentifier(node) && kindOf(node) !== undefined) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(closure.body);
    return found;
  };
  const markIdentifier = (identifier, kind) => {
    if (kind === "raw") rawIdentifiers.add(identifier.text);
    else if (kind === "context") contextIdentifiers.add(identifier.text);
    else containerIdentifiers.add(identifier.text);
  };
  const markBinding = (pattern, kind) => {
    if (ts.isIdentifier(pattern)) {
      markIdentifier(pattern, kind);
      return;
    }
    if (ts.isObjectBindingPattern(pattern)) {
      for (const element of pattern.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const key = keyOf(element.propertyName ?? element.name);
        if (kind === "context") {
          if (key === "io") markIdentifier(element.name, "raw");
        } else markIdentifier(element.name, "raw");
      }
      return;
    }
    if (ts.isArrayBindingPattern(pattern))
      for (const element of pattern.elements)
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name))
          markIdentifier(element.name, "raw");
  };
  const memberTarget = (node, kind) => {
    if (ts.isIdentifier(node)) {
      markIdentifier(node, kind);
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression === undefined
          ? undefined
          : keyOf(unwrap(node.argumentExpression));
      if (key !== undefined) {
        if (kind === "context") contextMembers.add(key);
        else rawMembers.add(key);
      }
      let root = node.expression;
      while (
        ts.isPropertyAccessExpression(root) ||
        ts.isElementAccessExpression(root)
      )
        root = root.expression;
      if (ts.isIdentifier(root)) containerIdentifiers.add(root.text);
      return;
    }
    if (ts.isObjectLiteralExpression(node))
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        memberTarget(property.initializer, "raw");
      }
  };
  const exactContextConstruction = (node) => {
    if (!isKnowledgeAdapter || !ts.isBinaryExpression(node)) return false;
    if (
      node.left.getText(record.source) !== "this.#context" ||
      !ts.isObjectLiteralExpression(node.right)
    )
      return false;
    const keys = node.right.properties.map((property) => keyOf(property.name));
    let ancestor = node.parent;
    while (ancestor !== undefined && !ts.isConstructorDeclaration(ancestor))
      ancestor = ancestor.parent;
    const expectedKeys = [
      "io",
      "native",
      "sourceRoot",
      "knowledgeRoot",
      "platform",
      "arch",
    ];
    return (
      ancestor !== undefined &&
      ts.isClassDeclaration(ancestor.parent) &&
      ancestor.parent.name?.text === "ObsidianKnowledgeVaultAdapter" &&
      JSON.stringify(keys) === JSON.stringify(expectedKeys) &&
      node.right.properties.every(
        (property, index) =>
          ts.isShorthandPropertyAssignment(property) &&
          property.name.text === expectedKeys[index],
      )
    );
  };
  const exactLocalAuthorityArgument = (call, index, kind) => {
    if (!isKnowledgeAdapter || !ts.isIdentifier(call.expression)) return false;
    const declaration = topLevelFunctions.get(call.expression.text);
    const parameter = declaration?.parameters[index];
    const type = parameter?.type?.getText(record.source);
    if (kind === "context") return type === "AdapterContext";
    return declaration?.name?.text === "nativePath" && type === "SourceVaultIO";
  };
  const exactVariableTransfer = (node, kind) => {
    if (!isKnowledgeAdapter || !ts.isVariableDeclaration(node)) return false;
    if (
      kind === "context" &&
      ts.isIdentifier(node.name) &&
      node.name.text === "context" &&
      node.initializer?.getText(record.source) === "this.#context"
    )
      return true;
    return (
      kind === "context" &&
      ts.isObjectBindingPattern(node.name) &&
      node.name.getText(record.source) === "{ io, native }" &&
      node.initializer?.getText(record.source) === "context"
    );
  };
  const authorityReceiver = (node) =>
    kindOf(node) !== undefined ||
    /(?:^|[.#])(?:io|vault|adapter|fileManager)(?:$|\.|#|\[)/iu.test(
      node.getText(record.source),
    );
  const allowedCreateReference = (node, access) => {
    const call = node.parent;
    if (
      record.file !== knowledgeAdapter.file ||
      access.method !== "create" ||
      access.receiver.getText(record.source) !== "this.#context.io" ||
      !ts.isCallExpression(call) ||
      call.expression !== node ||
      call.arguments.length !== 2 ||
      call.arguments[0]?.getText(record.source) !== "resolvedPath" ||
      call.arguments[1]?.getText(record.source) !== "content"
    )
      return false;
    let ancestor = call.parent;
    while (ancestor !== undefined && !ts.isMethodDeclaration(ancestor))
      ancestor = ancestor.parent;
    return (
      ancestor !== undefined &&
      propertyName(ancestor.name, record.source) === "createKnowledgeNote"
    );
  };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const kind = kindOf(node.initializer);
      if (kind !== undefined) {
        markBinding(node.name, kind);
        if (!exactVariableTransfer(node, kind))
          failures.push(
            `${name}:${String(at(node))}: knowledge transfers writer authority`,
          );
      }
    }
    if (ts.isPropertyDeclaration(node) && node.initializer !== undefined) {
      const kind = kindOf(node.initializer);
      const key = keyOf(node.name);
      if (kind !== undefined && key !== undefined) {
        if (kind === "context") contextMembers.add(key);
        else rawMembers.add(key);
        failures.push(
          `${name}:${String(at(node))}: knowledge stores writer authority in field`,
        );
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const kind = kindOf(node.right);
      if (kind !== undefined) {
        const isContextConstruction = exactContextConstruction(node);
        memberTarget(node.left, isContextConstruction ? "context" : kind);
        if (!isContextConstruction)
          failures.push(
            `${name}:${String(at(node))}: knowledge assigns writer authority`,
          );
      }
    }
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      if (kindOf(node.expression) !== undefined)
        failures.push(
          `${name}:${String(at(node))}: knowledge returns writer authority`,
        );
    }
    if (ts.isCallExpression(node)) {
      node.arguments.forEach((argument, index) => {
        const kind = kindOf(argument);
        if (
          kind !== undefined &&
          !exactLocalAuthorityArgument(node, index, kind)
        )
          failures.push(
            `${name}:${String(at(argument))}: knowledge passes writer authority`,
          );
      });
      const access = mutationAccess(node.expression);
      if (
        access !== undefined &&
        authorityReceiver(access.receiver) &&
        (access.method === undefined ||
          forbiddenVaultMutations.has(access.method)) &&
        !allowedCreateReference(node.expression, access)
      )
        failures.push(
          `${name}: knowledge references mutation ${access.method ?? "computed"}`,
        );
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const access = mutationAccess(node);
      if (
        access !== undefined &&
        kindOf(node) !== undefined &&
        authorityReceiver(access.receiver) &&
        (access.method === undefined ||
          forbiddenVaultMutations.has(access.method)) &&
        !allowedCreateReference(node, access)
      )
        failures.push(
          `${name}: knowledge references mutation ${access.method ?? "computed"}`,
        );
      if (
        access !== undefined &&
        kindOf(node) !== undefined &&
        authorityReceiver(access.receiver) &&
        access.method !== undefined &&
        !forbiddenVaultMutations.has(access.method) &&
        node.parent !== undefined &&
        !(
          ts.isCallExpression(node.parent) && node.parent.expression === node
        ) &&
        !(
          (ts.isPropertyAccessExpression(node.parent) ||
            ts.isElementAccessExpression(node.parent)) &&
          node.parent.expression === node
        ) &&
        !(
          ts.isCallExpression(node.parent) &&
          node.parent.arguments.includes(node) &&
          exactLocalAuthorityArgument(
            node.parent,
            node.parent.arguments.indexOf(node),
            kindOf(node),
          )
        ) &&
        !["basePath", "configDir"].includes(access.method)
      )
        failures.push(
          `${name}:${String(at(node))}: knowledge escapes writer authority member`,
        );
    }
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      closureContainsAuthority(node) &&
      !(
        ts.isCallExpression(node.parent) &&
        node.parent.arguments.includes(node) &&
        kindOf(node) === undefined
      )
    ) {
      const parent = node.parent;
      if (
        !ts.isVariableDeclaration(parent) &&
        !ts.isPropertyDeclaration(parent) &&
        !ts.isReturnStatement(parent) &&
        !ts.isCallExpression(parent)
      )
        failures.push(
          `${name}:${String(at(node))}: knowledge closure captures writer authority`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(record.source);
}

for (const record of [...knowledgePluginRecords, ...knowledgeCoreRecords]) {
  const name = basename(record.file);
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const imported = node.moduleSpecifier.text;
      if (
        networkImports.test(imported) ||
        /(?:provider-controller|provider-transport|keychain)/u.test(imported)
      )
        failures.push(
          `${name}: knowledge imports network/provider ${imported}`,
        );
      if (/(?:source-controller|source-executor)/u.test(imported))
        failures.push(`${name}: knowledge imports source mutation authority`);
    }
    if (ts.isIdentifier(node) && browserNetworkNames.has(node.text))
      failures.push(`${name}: knowledge reaches network API ${node.text}`);
    if (
      ts.isIdentifier(node) &&
      [
        "saveData",
        "loadData",
        "settings",
        "diagnosticDetails",
        "logger",
      ].includes(node.text)
    )
      failures.push(
        `${name}: knowledge reaches persistence/content sink ${node.text}`,
      );
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "m06Diagnostic" &&
      (node.arguments.length !== 1 ||
        node.arguments[0] === undefined ||
        !closedDiagnosticCode(node.arguments[0]))
    )
      failures.push(`${name}: dynamic M06 diagnostic content`);
    ts.forEachChild(node, visit);
  };
  visit(record.source);
  scanKnowledgeMutations(record);
}

const adapterCreateCalls = [];
const adapterVisit = (node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ["create", "createBinary", "createFolder"].includes(
      node.expression.name.text,
    )
  )
    adapterCreateCalls.push(node.expression.getText(knowledgeAdapter.source));
  ts.forEachChild(node, adapterVisit);
};
adapterVisit(knowledgeAdapter.source);
if (
  JSON.stringify(adapterCreateCalls) !==
  JSON.stringify(["this.#context.io.create"])
)
  failures.push(
    `knowledge-vault-adapter.ts: create authority mismatch (${adapterCreateCalls.join(",") || "empty"})`,
  );

const main = parse(join(pluginSourceRoot, "main.ts"));
let clipboardWrites = 0;
let settingsSaveSites = 0;
const mainVisit = (node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression)
  ) {
    const call = node.expression;
    if (
      call.name.text === "writeText" &&
      call.expression.getText(main.source) === "navigator.clipboard"
    )
      clipboardWrites += 1;
    if (call.name.text === "saveData") {
      settingsSaveSites += 1;
      if (
        node.arguments.length !== 1 ||
        node.arguments[0]?.getText(main.source) !== "settings"
      )
        failures.push("main.ts: non-settings persistence payload");
    }
  }
  ts.forEachChild(node, mainVisit);
};
mainVisit(main.source);
if (clipboardWrites !== 1)
  failures.push(
    `main.ts: expected one explicit clipboard write, found ${clipboardWrites}`,
  );
if (settingsSaveSites !== 1)
  failures.push(
    `main.ts: expected one settings persistence site, found ${settingsSaveSites}`,
  );

const distillationFiles = [
  "distillation-controller.ts",
  "distillation-model.ts",
];
for (const name of distillationFiles) {
  const record = parse(join(pluginSourceRoot, name));
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      networkImports.test(node.moduleSpecifier.text)
    )
      failures.push(`${name}: M04 boundary imports network`);
    if (ts.isIdentifier(node) && browserNetworkNames.has(node.text))
      failures.push(`${name}: M04 boundary reaches network ${node.text}`);
    if (
      ts.isPropertyAccessExpression(node) &&
      (forbiddenVaultMutations.has(node.name.text) ||
        ["create", "createBinary", "createFolder"].includes(node.name.text))
    )
      failures.push(`${name}: M04 boundary reaches mutation ${node.name.text}`);
    ts.forEachChild(node, visit);
  };
  visit(record.source);
}

if (failures.length > 0) {
  process.stderr.write(`${[...new Set(failures)].join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `M06 boundary gate passed (${String(pluginRecords.length)} production modules; exact ${String(providerServiceKeys.length)}-key provider and ${String(knowledgeCapabilityKeys.length)}-capability writer allowlists; create-only knowledge authority; closed diagnostics/settings/logs; prior M04/M05 isolation retained).\n`,
  );
}
