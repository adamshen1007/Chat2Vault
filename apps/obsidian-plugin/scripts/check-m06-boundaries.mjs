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
  const authorityAliases = new Set(["io", "vault", "adapter", "fileManager"]);
  const authorityReceiver = (node) => {
    const text = node.getText(record.source);
    return (
      authorityAliases.has(text) ||
      /(?:^|[.#])(?:io|vault|adapter|fileManager)(?:$|\.|#|\[)/iu.test(text)
    );
  };
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
      if (ts.isIdentifier(node.name)) {
        if (authorityReceiver(node.initializer))
          authorityAliases.add(node.name.text);
      } else if (
        ts.isObjectBindingPattern(node.name) &&
        authorityReceiver(node.initializer)
      ) {
        for (const element of node.name.elements) {
          const method = propertyName(
            element.propertyName ?? element.name,
            record.source,
          );
          if (method !== undefined && forbiddenVaultMutations.has(method))
            failures.push(`${name}: knowledge references mutation ${method}`);
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      if (ts.isIdentifier(node.left) && authorityReceiver(node.right))
        authorityAliases.add(node.left.text);
      if (
        ts.isObjectLiteralExpression(node.left) &&
        authorityReceiver(node.right)
      ) {
        for (const property of node.left.properties) {
          const method = propertyName(property.name, record.source);
          if (method !== undefined && forbiddenVaultMutations.has(method))
            failures.push(`${name}: knowledge references mutation ${method}`);
        }
      }
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const access = mutationAccess(node);
      if (
        access !== undefined &&
        authorityReceiver(access.receiver) &&
        (access.method === undefined ||
          forbiddenVaultMutations.has(access.method)) &&
        !allowedCreateReference(node, access)
      )
        failures.push(
          `${name}: knowledge references mutation ${access.method ?? "computed"}`,
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
