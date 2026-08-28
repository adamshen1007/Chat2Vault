import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
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
const mainSourceText = readFileSync(join(sourceRoot, "main.ts"), "utf8");

if (
  !/export function sourceWriterPlatformEligible\([\s\S]*?platform === "darwin" && arch === "x64";/u.test(
    mainSourceText,
  )
)
  failures.push("source writer production eligibility must require darwin/x64");
if (
  !mainSourceText.includes(
    "sourceWriterPlatformEligible(process.platform, process.arch)",
  )
)
  failures.push("source writer view gate must use the production predicate");

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
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleName = node.moduleSpecifier.text;
      if (moduleName === "node:fs/promises") {
        const allowedByFile = new Map([
          ["containment.ts", new Set(["lstat", "realpath"])],
          ["native-observer.ts", new Set(["lstat", "realpath"])],
          ["source-vault-adapter.ts", new Set(["readdir"])],
        ]);
        const imports = node.importClause?.namedBindings;
        const names =
          imports !== undefined && ts.isNamedImports(imports)
            ? imports.elements.map((element) => element.name.text)
            : [];
        const allowed = allowedByFile.get(basename(file));
        if (
          allowed === undefined ||
          names.length === 0 ||
          names.some((name) => !allowed.has(name))
        )
          failures.push(`${file}: unauthorized native read import`);
      } else if (forbiddenImports.test(moduleName)) {
        failures.push(`${file}: forbidden import ${moduleName}`);
      }
    }
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
    if (ts.isIdentifier(node) && node.text === "clipboard") {
      const property = node.parent;
      const write = property?.parent;
      const allowed =
        basename(file) === "main.ts" &&
        ts.isPropertyAccessExpression(property) &&
        property.name === node &&
        property.expression.getText(source) === "navigator" &&
        ts.isPropertyAccessExpression(write) &&
        write.expression === property &&
        write.name.text === "writeText";
      if (!allowed) failures.push(`${file}: forbidden clipboard API`);
    }
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
    if (ts.isPropertyAccessExpression(node)) {
      const vaultMutations = [
        "create",
        "createFolder",
        "modify",
        "delete",
        "rename",
        "trash",
        "copy",
      ];
      if (
        vaultMutations.includes(node.name.text) &&
        /(?:vault|adapter|\bio\b)/iu.test(node.expression.getText(source))
      ) {
        const fileName = basename(file);
        const allowed =
          (fileName === "source-vault-adapter.ts" &&
            ["create", "createFolder"].includes(node.name.text)) ||
          (fileName === "source-executor.ts" &&
            node.name.text === "createFolder");
        if (!allowed)
          failures.push(`${file}: forbidden vault mutation ${node.name.text}`);
      }
    }
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
  ["automatic clipboard API", /\b(?:readText|execCommand)\b/u],
  ["unsafe execution API", /\beval\s*\(|\bnew\s+Function\b/u],
  [
    "forbidden Node or Electron import",
    /require\s*\(\s*["'](?:node:)?(?:fs(?!\/promises)|http|https|http2|net|tls|dgram|dns|child_process|cluster|vm)(?:\/[^"']*)?["']\s*\)|require\s*\(\s*["']electron(?:\/[^"']*)?["']\s*\)/u,
  ],
  ["hard-coded Obsidian config directory", /\.obsidian/u],
];
for (const bundle of bundles)
  for (const [label, pattern] of forbiddenBundlePatterns)
    if (pattern.test(bundle.text))
      failures.push(`${bundle.name} contains ${label}`);
const clipboardWrites =
  bundles[0].text.match(/\.clipboard\.writeText\(/gu) ?? [];
if (clipboardWrites.length !== 1)
  failures.push(
    `main.js must contain exactly one explicit clipboard write (found ${String(clipboardWrites.length)})`,
  );

const nativeSource = readFileSync(
  join(root, "native/source_observer.cc"),
  "utf8",
);
const nativeBinary = readFileSync(join(root, "native/source_observer.node"));
const nativeBinaryText = nativeBinary.toString("latin1");
for (const required of [
  "getattrlist",
  "ATTR_CMN_RETURNED_ATTRS",
  "ATTR_VOL_INFO",
  "ATTR_VOL_MOUNTPOINT",
  "FSOPT_NOFOLLOW_ANY",
  "FSOPT_REPORT_FULLSIZE",
  "FILE_ATTRIBUTE_REPARSE_POINT",
  "GetFileAttributesW",
  "FatalUtf8",
  "rawMountBytesHex",
])
  if (!nativeSource.includes(required))
    failures.push(`native observer missing ${required}`);
if (/\b(?:mount|unmount|setattrlist)\s*\(/u.test(nativeSource))
  failures.push("native observer exposes a forbidden filesystem mutation");
if (
  nativeBinaryText.includes(root) ||
  /\/(?:Users|home)\//u.test(nativeBinaryText)
)
  failures.push("native observer contains an absolute user/build path");

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Plugin static gate passed (${String(files.length)} source files; ${bundles.map((bundle) => `${bundle.name}=${String(bundle.text.length)} bytes`).join(", ")}).\n`,
  );
}
