import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import ts from "typescript";

const pluginRoot = new URL("..", import.meta.url).pathname;
const repositoryRoot = join(pluginRoot, "../..");
const files = [
  join(repositoryRoot, "packages/core/src/distillation/contracts.ts"),
  join(repositoryRoot, "packages/core/src/distillation/request.ts"),
  join(repositoryRoot, "packages/core/src/distillation/result.ts"),
  join(pluginRoot, "src/distillation-controller.ts"),
  join(pluginRoot, "src/distillation-model.ts"),
];
const forbiddenImports =
  /^(?:https?:|(?:node:)?(?:fs|http|https|http2|net|tls|dgram|dns|child_process)(?:\/|$)|electron(?:\/|$)|obsidian$)/u;
const forbiddenIdentifiers = new Set([
  "fetch",
  "requestUrl",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "clipboard",
  "Vault",
  "Adapter",
  "FileManager",
]);
const forbiddenMutations = new Set([
  "create",
  "createBinary",
  "createFolder",
  "modify",
  "modifyBinary",
  "process",
  "rename",
  "delete",
  "trash",
  "trashFile",
  "write",
  "writeFile",
  "appendFile",
  "mkdir",
  "rm",
  "unlink",
  "truncate",
  "chmod",
  "chown",
  "link",
  "symlink",
]);
const failures = [];

for (const file of files) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      forbiddenImports.test(node.moduleSpecifier.text)
    )
      failures.push(
        `${basename(file)}: forbidden import ${node.moduleSpecifier.text}`,
      );
    if (ts.isIdentifier(node) && forbiddenIdentifiers.has(node.text))
      failures.push(`${basename(file)}: forbidden API ${node.text}`);
    if (
      ts.isPropertyAccessExpression(node) &&
      forbiddenMutations.has(node.name.text)
    )
      failures.push(`${basename(file)}: forbidden mutation ${node.name.text}`);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      failures.push(`${basename(file)}: dynamic import is forbidden`);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const main = readFileSync(join(pluginRoot, "src/main.ts"), "utf8");
const view = readFileSync(join(pluginRoot, "src/view.ts"), "utf8");
const writeMatches =
  main.match(/navigator\.clipboard\.writeText\(text\)/gu) ?? [];
if (writeMatches.length !== 1)
  failures.push("main.ts: M04 requires exactly one explicit clipboard write");
if (/clipboard\.(?:readText|read|write)(?!Text\(text\))/u.test(main))
  failures.push("main.ts: automatic or non-contract clipboard access");
const manualStart = view.indexOf("private drawManualDistillation");
const manualEnd = view.indexOf("private async previewSource", manualStart);
const manualView = view.slice(manualStart, manualEnd);
for (const token of [
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "renderText(",
  "MarkdownRenderer",
  ".href",
  ".src",
  "fetch(",
  "requestUrl(",
])
  if (manualView.includes(token))
    failures.push(`view.ts manual distillation region: forbidden ${token}`);
for (const label of ["Accept", "Edit", "Reject", "Merge", "Save candidate"])
  if (manualView.includes(`"${label}"`))
    failures.push(
      `view.ts manual distillation region: forbidden control ${label}`,
    );

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `M04 boundary gate passed (${String(files.length)} isolated production modules; one explicit clipboard write; zero network or mutation surfaces).\n`,
  );
}
