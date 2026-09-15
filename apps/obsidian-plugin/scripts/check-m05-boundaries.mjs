import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import ts from "typescript";

const pluginRoot = new URL("..", import.meta.url).pathname;
const repositoryRoot = join(pluginRoot, "../..");
const sourceRoot = join(pluginRoot, "src");
const productionFiles = readdirSync(sourceRoot)
  .filter((name) => name.endsWith(".ts") && !name.startsWith("runtime-test-"))
  .map((name) => join(sourceRoot, name));
const failures = [];
const allowedNetworkFile = "provider-transport.ts";
const networkImports = new Set(["node:dns", "node:https", "node:tls"]);
const forbiddenOutsideTransport = [
  "fetch(",
  "requestUrl(",
  "XMLHttpRequest",
  "WebSocket",
];
const forbiddenEverywhere = [
  "rejectUnauthorized: false",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "NODE_EXTRA_CA_CERTS",
  '"Accept-Encoding"',
  "node:child_process",
  "exec(",
  "spawn(",
  "Ollama",
];
const mutationNames = new Set([
  "create",
  "createBinary",
  "createFolder",
  "modify",
  "modifyBinary",
  "delete",
  "rename",
  "trash",
  "writeFile",
  "appendFile",
]);

for (const file of productionFiles) {
  const text = readFileSync(file, "utf8");
  const name = basename(file);
  for (const token of forbiddenEverywhere)
    if (text.includes(token)) failures.push(`${name}: forbidden ${token}`);
  if (name !== allowedNetworkFile)
    for (const token of forbiddenOutsideTransport)
      if (text.includes(token))
        failures.push(`${name}: network surface ${token}`);
  if (
    /runtime-test-|alternateAccount|socketDestination|loopbackBypass/u.test(
      text,
    )
  )
    failures.push(`${name}: runtime-only selector in production graph`);

  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      networkImports.has(node.moduleSpecifier.text) &&
      name !== allowedNetworkFile
    )
      failures.push(`${name}: unauthorized ${node.moduleSpecifier.text}`);
    if (
      [
        "provider-controller.ts",
        "provider-transport.ts",
        "keychain.ts",
      ].includes(name) &&
      ts.isPropertyAccessExpression(node) &&
      mutationNames.has(node.name.text) &&
      /(?:vault|adapter|fileManager)/iu.test(node.expression.getText(source))
    )
      failures.push(`${name}: forbidden vault mutation ${node.name.text}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const providerTransport = readFileSync(
  join(sourceRoot, "provider-transport.ts"),
  "utf8",
);
for (const required of [
  "agent: false",
  "rejectUnauthorized: true",
  'minVersion: "TLSv1.2"',
  "nodeCheckServerIdentity",
  "dependencies.classifyAddress",
])
  if (!providerTransport.includes(required))
    failures.push(`provider-transport.ts: missing ${required}`);
if ((providerTransport.match(/Authorization:/gu) ?? []).length !== 1)
  failures.push("provider-transport.ts: expected one Authorization site");

const keychain = readFileSync(join(sourceRoot, "keychain.ts"), "utf8");
const nativeKeychain = readFileSync(
  join(pluginRoot, "native/keychain.cc"),
  "utf8",
);
if ((keychain.match(/keychain\.node/gu) ?? []).length !== 1)
  failures.push("keychain.ts: expected one keychain.node validation site");
for (const required of [
  "SecKeychainCopyDefault",
  "kSecMatchSearchList",
  "kSecUseKeychain",
])
  if (!nativeKeychain.includes(required))
    failures.push(`keychain.cc: missing ${required}`);
for (const forbidden of [
  "kSecAttrAccessible",
  "kSecAttrAccessControl",
  "kSecAttrAccessGroup",
  "kSecAttrSynchronizable",
  "kSecUseDataProtectionKeychain",
  "SecKeychainOpen",
  "SecKeychainSetDefault",
  "SecKeychainSetSearchList",
])
  if (nativeKeychain.includes(forbidden))
    failures.push(`keychain.cc: forbidden ${forbidden}`);

const settingsModel = readFileSync(
  join(sourceRoot, "settings-model.ts"),
  "utf8",
);
for (const required of [
  'const V3_KEYS = [\n  "schemaVersion",\n  "installationId",\n  "previewMessagesPerPage",\n  "sourceRoot",\n  "provider",\n] as const;',
  'const PROVIDER_KEYS = [\n  "endpoint",\n  "model",\n  "timeoutMs",\n  "maxOutputTokens",\n  "cloudDisclosureAccepted",\n] as const;',
])
  if (!settingsModel.includes(required))
    failures.push("settings-model.ts: persistence allowlist mismatch");
for (const forbidden of [
  "secret",
  "account",
  "prompt",
  "response",
  "candidate",
  "usage",
])
  if (
    new RegExp(`^[ \\t]*["']?${forbidden}["']?\\??:`, "imu").test(settingsModel)
  )
    failures.push(`settings-model.ts: forbidden persisted field ${forbidden}`);

const bundle = readFileSync(join(pluginRoot, "main.js"), "utf8");
for (const token of [
  "runtime-test-entry",
  "runtime-test-network-seam",
  "runtime-test-keychain",
  "NODE_EXTRA_CA_CERTS",
  "127.0.0.1",
  "127.0.0.2",
])
  if (bundle.includes(token)) failures.push(`main.js: runtime token ${token}`);
if ((bundle.match(/Bearer /gu) ?? []).length !== 1)
  failures.push("main.js: expected one Authorization construction site");

const coreM05Files = [
  join(repositoryRoot, "packages/core/src/provider/address.ts"),
  join(repositoryRoot, "packages/core/src/provider/config.ts"),
  join(repositoryRoot, "packages/core/src/provider/envelope.ts"),
];
for (const file of coreM05Files) {
  const text = readFileSync(file, "utf8");
  if (
    /\b(?:obsidian|Vault|Adapter|FileManager|node:https|node:dns)\b/u.test(text)
  )
    failures.push(`${basename(file)}: dependency boundary violation`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `M05 boundary gate passed (${String(productionFiles.length)} production modules; one HTTPS transport; one Keychain loader; zero runtime seams or M05 vault mutations).\n`,
  );
}
