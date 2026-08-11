import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import ts from "typescript";

const root = new URL("..", import.meta.url).pathname;
const sourceRoot = join(root, "src");
const files = readdirSync(sourceRoot)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join(sourceRoot, name));
const forbiddenImports =
  /^(?:https?:|(?:node:)?(?:fs|http|https|http2|net|tls|dgram|dns|child_process|cluster|vm)(?:\/|$)|electron(?:\/|$))/u;
const forbiddenNames = new Set([
  "fetch",
  "WebSocket",
  "XMLHttpRequest",
  "EventSource",
  "requestUrl",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "showOpenFilePicker",
  "showSaveFilePicker",
  "showDirectoryPicker",
  "sendBeacon",
  "caches",
  "serviceWorker",
  "clipboard",
  "execCommand",
  "createWritable",
  "createSyncAccessHandle",
  "getDirectory",
  "DOMParser",
  "MarkdownRenderer",
  "eval",
  "Function",
  "console",
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
      failures.push(`${file}: forbidden import ${node.moduleSpecifier.text}`);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      failures.push(`${file}: dynamic import is forbidden`);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    )
      failures.push(`${file}: CommonJS require is forbidden in plugin source`);
    if (ts.isIdentifier(node) && forbiddenNames.has(node.text))
      failures.push(`${file}: forbidden API ${node.text}`);
    if (
      ts.isPropertyAccessExpression(node) &&
      [
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "write",
        "appendFile",
        "writeFile",
        "createContextualFragment",
        "srcdoc",
        "href",
        "src",
        "srcset",
      ].includes(node.name.text)
    )
      failures.push(`${file}: forbidden property ${node.name.text}`);
    if (
      ts.isPropertyAccessExpression(node) &&
      ["create", "modify", "delete", "rename", "trash", "copy"].includes(
        node.name.text,
      ) &&
      /(?:vault|adapter)/iu.test(node.expression.getText(source))
    )
      failures.push(`${file}: forbidden vault mutation ${node.name.text}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
if (
  manifest.id !== "chat-to-vault" ||
  manifest.isDesktopOnly !== true ||
  manifest.minAppVersion !== "1.7.4"
)
  failures.push("manifest contract mismatch");
if (
  JSON.stringify(packageJson.dependencies) !==
  JSON.stringify({ "@chat2vault/core": "workspace:*" })
)
  failures.push("runtime dependency contract mismatch");
const lockfile = readFileSync(join(root, "../../pnpm-lock.yaml"), "utf8");
if (
  !lockfile.includes("apps/obsidian-plugin:") ||
  !lockfile.includes("specifier: workspace:*")
)
  failures.push("plugin lockfile importer contract missing");
const bundles = ["main.js", "worker.js"].map((name) => ({
  name,
  text: readFileSync(join(root, name), "utf8"),
}));
const forbiddenBundlePatterns = [
  ["remote URL", /https?:\/\//u],
  [
    "browser network API",
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|requestUrl)\b/u,
  ],
  [
    "browser persistence API",
    /\b(?:localStorage|sessionStorage|indexedDB|caches|serviceWorker)\b/u,
  ],
  [
    "filesystem access API",
    /\b(?:showOpenFilePicker|showSaveFilePicker|showDirectoryPicker|createWritable|createSyncAccessHandle|getDirectory|FileSystemFileHandle|FileSystemDirectoryHandle|FileSystemSyncAccessHandle)\b/u,
  ],
  [
    "unsafe DOM API",
    /\b(?:innerHTML|outerHTML|insertAdjacentHTML|srcdoc|DOMParser|createContextualFragment|MarkdownRenderer)\b/u,
  ],
  ["clipboard API", /\b(?:clipboard|execCommand)\b/u],
  ["unsafe execution API", /\beval\s*\(|\bnew\s+Function\b/u],
  [
    "forbidden Node or Electron import",
    /require\s*\(\s*["'](?:node:)?(?:fs(?:\/promises)?|http|https|http2|net|tls|dgram|dns|child_process|cluster|vm)(?:\/[^"']*)?["']\s*\)|require\s*\(\s*["']electron(?:\/[^"']*)?["']\s*\)/u,
  ],
  ["hard-coded Obsidian config directory", /\.obsidian/u],
];
for (const bundle of bundles)
  for (const [label, pattern] of forbiddenBundlePatterns)
    if (pattern.test(bundle.text))
      failures.push(`${bundle.name} contains ${label}`);

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Plugin static gate passed (${String(files.length)} source files; ${bundles.map((bundle) => `${bundle.name}=${String(bundle.text.length)} bytes`).join(", ")}).\n`,
  );
}
