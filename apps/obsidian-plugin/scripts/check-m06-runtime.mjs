/* global Buffer */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import process from "node:process";
import { URL } from "node:url";

const run = promisify(execFile);
const pluginRoot = new URL("..", import.meta.url).pathname;
const repositoryRoot = resolve(pluginRoot, "../..");
const legacyHarness = join(pluginRoot, "scripts/check-m05-runtime.mjs");
const expectedScenarios = Object.freeze([
  "review-accept-edit-reject",
  "multi-select-dry-run",
  "stale-preview-disabled",
  "verified-create",
  "idempotent-retry-no-op",
  "conflict-refusal",
  "source-backlink",
  "source-note-unchanged",
  "provider-not-called",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requestedRow() {
  const index = process.argv.indexOf("--row");
  const row = index < 0 ? undefined : process.argv[index + 1];
  if (row !== "minimum" && row !== "stable")
    throw new Error("usage: check-m06-runtime.mjs --row minimum|stable");
  return row;
}

function replaceOnce(source, search, replacement, label) {
  if (source.split(search).length !== 2)
    throw new Error(`M06 runtime harness contract is ambiguous: ${label}`);
  return source.replace(search, replacement);
}

function m06ArtifactComparisonFunction() {
  return String.raw`
function compareM06RuntimeArtifacts(production, runtime) {
  const failures = [];
  if (JSON.stringify(production.buildOptions) !== JSON.stringify(runtime.buildOptions))
    failures.push("build option mismatch");
  const normalizeInput = (record, input) =>
    resolve(record.pluginRoot, input).slice(resolve(record.pluginRoot).length + 1).replaceAll("\\", "/");
  const productionInputs = new Map(
    Object.keys(production.metafile.inputs).map((input) => [normalizeInput(production, input), production.metafile.inputs[input].bytes]),
  );
  const runtimeInputs = new Map(
    Object.keys(runtime.metafile.inputs).map((input) => [normalizeInput(runtime, input), runtime.metafile.inputs[input].bytes]),
  );
  const allowedRuntimeOnly = new Set([
    "src/runtime-test-entry.ts",
    "src/runtime-test-network-seam.ts",
    "src/runtime-test-keychain.ts",
    "src/runtime-test-m06.ts",
  ]);
  for (const [input, bytes] of productionInputs) {
    if (!runtimeInputs.has(input)) failures.push("runtime graph omitted shared input " + input);
    else if (runtimeInputs.get(input) !== bytes) failures.push("shared input byte mismatch " + input);
  }
  for (const input of runtimeInputs.keys())
    if (!productionInputs.has(input) && !allowedRuntimeOnly.has(input))
      failures.push("unexpected runtime-only input " + input);
  for (const input of allowedRuntimeOnly)
    if (!runtimeInputs.has(input)) failures.push("missing runtime-only input " + input);
  if (!runtimeInputs.has("src/main.ts")) failures.push("runtime graph omitted production composition");
  if (runtimeInputs.has("main.js")) failures.push("runtime graph imported generated production artifact");
  return {
    ok: failures.length === 0,
    failures,
    sharedInputCount: productionInputs.size,
    runtimeOnlyInputs: [...allowedRuntimeOnly],
    providerTransport: {},
  };
}

function assertCompleteM06RuntimeRows(rows, expectedIdentity, requestedRow) {
  if (rows.length !== 1 || rows[0]?.id !== requestedRow)
    throw new Error("M06 runtime row selection incomplete");
  const row = rows[0];
  const expectedVersion = requestedRow === "minimum" ? "1.7.4" : expectedIdentity.officialStable.latestVersion;
  if (
    row.version !== expectedVersion ||
    row.platform !== "darwin" ||
    row.arch !== "x64" ||
    row.macos?.productVersion !== expectedIdentity.macos.productVersion ||
    row.macos?.buildVersion !== expectedIdentity.macos.buildVersion
  ) throw new Error("M06 runtime identity mismatch");
  const evidence = row.m06;
  if (
    JSON.stringify(evidence?.scenarioRegistry) !== JSON.stringify(${JSON.stringify(expectedScenarios)}) ||
    evidence?.scenarios?.length !== ${String(expectedScenarios.length)} ||
    evidence.scenarios.some((scenario) => scenario.outcome !== "success") ||
    evidence.source?.unchanged !== true ||
    evidence.source.beforeHash !== evidence.source.afterHash ||
    evidence.counts?.candidates !== 3 ||
    evidence.counts?.selected !== 2 ||
    evidence.counts?.created !== 2 ||
    evidence.counts?.noOp !== 2 ||
    evidence.counts?.conflicts !== 1 ||
    evidence.counts?.providerCalls !== 0 ||
    evidence.privacy?.relativePathsOnly !== true ||
    evidence.privacy?.retainedContent !== false ||
    row.mutationCount !== 4 ||
    row.persistenceViolationCount !== 0 ||
    row.networkAttemptCount !== 1 ||
    row.backgroundAttemptCount !== 0
  ) throw new Error("M06 runtime acceptance predicate failed");
  if (
    typeof evidence.candidateHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(evidence.candidateHash) ||
    evidence.knowledge.some(({ path, sha256 }) =>
      typeof path !== "string" || path.startsWith("/") || path.includes("..") || !/^[0-9a-f]{64}$/u.test(sha256)
    )
  ) throw new Error("M06 runtime retained evidence is unsafe");
}
`;
}

function buildDriver(source, row) {
  let driver = source;
  driver = replaceOnce(
    driver,
    'import { compareM05RuntimeArtifacts } from "./compare-m05-runtime-artifact.mjs";\n',
    "",
    "legacy comparison import",
  );
  driver = replaceOnce(
    driver,
    'const pluginRoot = new URL("..", import.meta.url).pathname;',
    `const pluginRoot = ${JSON.stringify(pluginRoot)};\nconst requestedRow = ${JSON.stringify(row)};`,
    "plugin root",
  );
  driver = replaceOnce(
    driver,
    'const root = await mkdtemp(join(tmpdir(), "chat2vault-m05-runtime-"));',
    'const root = await (await import("node:fs/promises")).realpath(await mkdtemp(join(tmpdir(), "chat2vault-m05-runtime-")));',
    "physical temporary vault root",
  );
  driver = replaceOnce(
    driver,
    "const comparison = compareM05RuntimeArtifacts(production, runtime);",
    "const comparison = compareM06RuntimeArtifacts(production, runtime);",
    "artifact comparison",
  );
  driver = replaceOnce(
    driver,
    'const worker = await readFile(join(pluginRoot, "worker.js"), "utf8");',
    `await esbuild.build({
    absWorkingDir: pluginRoot,
    bundle: true,
    external: ["obsidian", "../native/source_observer.node"],
    format: "cjs",
    platform: "node",
    target: "node20",
    minify: true,
    sourcemap: false,
    logLevel: "silent",
    metafile: true,
    entryPoints: { worker: "src/worker.ts" },
    outdir: directory,
    entryNames: "worker",
  });
  const worker = await readFile(join(directory, "worker.js"), "utf8");`,
    "fresh worker source",
  );
  driver = replaceOnce(
    driver,
    `if (
    trackedMain.bytes !== production.artifact.bytes ||
    trackedMain.sha256 !== production.artifact.sha256
  )`,
    `if (
    !process.argv.includes("--artifacts-only") &&
    (trackedMain.bytes !== production.artifact.bytes ||
      trackedMain.sha256 !== production.artifact.sha256)
  )`,
    "generated production artifact requirement",
  );
  const evidenceCall =
    /const evidence=await plugin\.runM05RuntimeScenarios\(\{port:[\s\S]*?secret:"synthetic-m05-credential"\}\);return\{/u;
  if (!evidenceCall.test(driver))
    throw new Error(
      "M06 runtime harness contract changed: renderer evidence call",
    );
  driver = driver.replace(
    evidenceCall,
    "const evidence=await plugin.runM06RuntimeScenarios();return{",
  );
  const legacyUiExercise =
    /hostUiEvidence = await exerciseAccessibilityAndZoom\([\s\S]*?markStage,\n {14}\);/u;
  if (!legacyUiExercise.test(driver))
    throw new Error("M06 runtime harness contract changed: M05 UI exercise");
  driver = driver.replace(legacyUiExercise, "hostUiEvidence = undefined;");
  const rowLoop =
    /for \(const rowInput of \[([\s\S]*?)\]\) \{\n {6}const row =/u;
  if (!rowLoop.test(driver))
    throw new Error("M06 runtime harness contract changed: row loop");
  driver = driver.replace(
    rowLoop,
    "for (const rowInput of [$1].filter(({ id }) => id === requestedRow)) {\n      const row =",
  );
  driver = replaceOnce(
    driver,
    "            keychain: value.evidence.keychain,",
    "            keychain: value.evidence.keychain,\n            m06: value.evidence,",
    "row evidence retention",
  );
  driver = replaceOnce(
    driver,
    "    assertCompleteRuntimeRows(rows, { authorities, macos, officialStable });",
    "    assertCompleteM06RuntimeRows(rows, { macos, officialStable }, requestedRow);",
    "row acceptance call",
  );
  return `${driver}\n${m06ArtifactComparisonFunction()}`;
}

function safeArtifact(value) {
  if (value === undefined) return undefined;
  return {
    file: value.file,
    bytes: value.bytes,
    sha256: value.sha256,
  };
}

function sanitizePacket(packet, rowId) {
  const row = packet.rows?.find(({ id }) => id === rowId);
  if (row === undefined) throw new Error("M06 runtime selected row missing");
  const sanitized = {
    status: "PASS",
    row: {
      id: row.id,
      version: row.version,
      electron: row.electron,
      chromium: row.chromium,
      node: row.node,
      platform: row.platform,
      arch: row.arch,
      macos: row.macos,
      officialStable: {
        latestVersion: row.officialStable?.latestVersion,
        metadataBytes: row.officialStable?.metadataBytes,
        metadataSha256: row.officialStable?.metadataSha256,
        releaseAsset: row.officialStable?.releaseAsset,
        releaseHash: row.officialStable?.releaseHash,
      },
      sourceMetadata: {
        kind: row.sourceMetadata?.kind,
        appVersion: row.sourceMetadata?.appVersion,
        appInfoPlist: safeArtifact(row.sourceMetadata?.appInfoPlist),
        sourceFramework: safeArtifact(row.sourceMetadata?.sourceFramework),
        ...(row.sourceMetadata?.asar === undefined
          ? {}
          : { asar: safeArtifact(row.sourceMetadata.asar) }),
      },
      candidateHash: row.m06?.candidateHash,
      source: row.m06?.source,
      knowledge: row.m06?.knowledge,
      counts: row.m06?.counts,
      privacy: row.m06?.privacy,
      scenarios: row.m06?.scenarios,
      mutationCount: row.mutationCount,
      persistenceViolationCount: row.persistenceViolationCount,
      networkAttemptCount: row.networkAttemptCount,
      backgroundAttemptCount: row.backgroundAttemptCount,
    },
    productionArtifacts: Object.fromEntries(
      Object.entries(packet.productionArtifacts ?? {}).map(([path, value]) => [
        path,
        safeArtifact(value),
      ]),
    ),
    runtimeArtifact: safeArtifact(packet.runtimeArtifact),
  };
  const encoded = Buffer.from(JSON.stringify(sanitized));
  return { ...sanitized, artifactHash: sha256(encoded) };
}

const artifactsOnly = process.argv.includes("--artifacts-only");
const row = artifactsOnly ? "minimum" : requestedRow();
const temporaryRoot = await mkdtemp(
  join(pluginRoot, "scripts/.m06-runtime-driver-"),
);
const driverPath = join(temporaryRoot, `check-m06-runtime-${randomUUID()}.mjs`);
let failure;
try {
  const legacySource = await readFile(legacyHarness, "utf8");
  await writeFile(driverPath, buildDriver(legacySource, row), { mode: 0o600 });
  const result = await run(
    process.execPath,
    [driverPath, ...(artifactsOnly ? ["--artifacts-only"] : [])],
    {
      cwd: repositoryRoot,
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (artifactsOnly) {
    const line = result.stdout
      .split("\n")
      .find((candidate) =>
        candidate.startsWith("M05 runtime artifact gate passed"),
      );
    if (line === undefined)
      throw new Error("M06 runtime artifact result missing");
    process.stdout.write(
      `${line.replace("M05", "M06").replace("runtime=", "runtime-with-m06-seam=")}\n`,
    );
  } else {
    const line = result.stdout
      .split("\n")
      .findLast((candidate) => candidate.startsWith('{"status":"PASS"'));
    if (line === undefined) throw new Error("M06 runtime packet missing");
    const sanitized = sanitizePacket(JSON.parse(line), row);
    const text = JSON.stringify(sanitized);
    if (
      text.includes(repositoryRoot) ||
      text.includes("/Users/") ||
      text.includes("M06_RUNTIME_SENTINEL_CONTENT")
    )
      throw new Error("M06 runtime packet privacy scan failed");
    process.stdout.write(`${text}\n`);
  }
} catch (error) {
  failure = error;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
if (failure !== undefined) throw failure;
