/* global Buffer */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import process from "node:process";
import { URL } from "node:url";
import { canonicalJson } from "./m06-runtime-provenance.mjs";
import { prepareOfficialRuntimeSources } from "./prepare-official-runtime-sources.mjs";

const run = promisify(execFile);
const pluginRoot = new URL("..", import.meta.url).pathname;
const repositoryRoot = resolve(pluginRoot, "../..");
const legacyHarness = join(pluginRoot, "scripts/check-m05-runtime.mjs");

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

function m06AcceptanceFunction() {
  return String.raw`
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
  const provenanceFailures = validateM06RuntimeProvenance(requestedRow, row.version, row.sourceMetadata);
  const evidenceFailures = validateM06RuntimeEvidence(evidence);
  if (
    provenanceFailures.length !== 0 ||
    evidenceFailures.length !== 0 ||
    row.mutationCount !== 3 ||
    row.persistenceViolationCount !== 0 ||
    row.networkAttemptCount !== 1 ||
    row.backgroundAttemptCount !== 0
  ) throw new Error("M06 runtime acceptance predicate failed: "+JSON.stringify({provenanceFailures,evidenceFailures,mutationCount:row.mutationCount,persistenceViolationCount:row.persistenceViolationCount,networkAttemptCount:row.networkAttemptCount,backgroundAttemptCount:row.backgroundAttemptCount,mutationAttempts:evidence?.mutationAttempts}));
  if (
    typeof evidence.candidateHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(evidence.candidateHash) ||
    !Array.isArray(evidence.knowledge)
  ) throw new Error("M06 runtime retained evidence is unsafe");
}
`;
}

function buildDriver(source, row) {
  let driver = source;
  driver = replaceOnce(
    driver,
    'import {\n  compareM05RuntimeArtifacts,\n  compareTrackedReleaseArtifacts,\n} from "./compare-m05-runtime-artifact.mjs";\n',
    `import { compareM05RuntimeArtifacts, compareTrackedReleaseArtifacts } from ${JSON.stringify(new URL("./compare-m05-runtime-artifact.mjs", import.meta.url).href)};\nimport { validateM06RuntimeEvidence, validateM06RuntimeProvenance } from ${JSON.stringify(new URL("./m06-runtime-provenance.mjs", import.meta.url).href)};\n`,
    "legacy comparison import",
  );
  driver = replaceOnce(
    driver,
    'import { prepareOfficialRuntimeSources } from "./prepare-official-runtime-sources.mjs";\n',
    `import { prepareOfficialRuntimeSources } from ${JSON.stringify(new URL("./prepare-official-runtime-sources.mjs", import.meta.url).href)};\n`,
    "official source preparation import",
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
  const evidenceCall =
    /const evidence=await plugin\.runM05RuntimeScenarios\(\{port:[\s\S]*?secret:"synthetic-m05-credential"\}\);return\{/u;
  if (!evidenceCall.test(driver))
    throw new Error(
      "M06 runtime harness contract changed: renderer evidence call",
    );
  driver = driver.replace(
    evidenceCall,
    "await new Promise((resolve)=>setTimeout(resolve,3000));const evidence=await plugin.runM06RuntimeScenarios();return{",
  );
  driver = replaceOnce(
    driver,
    'await app.plugins.enablePlugin("chat-to-vault");let runtimeLeaf=',
    'await app.plugins.enablePlugin("chat-to-vault");await new Promise((resolve)=>setTimeout(resolve,3000));const plugin=app.plugins.plugins["chat-to-vault"];plugin.installM06MutationLedger();await plugin.prepareM06RuntimeVault();let runtimeLeaf=',
    "M06 interception and fixture setup before view construction",
  );
  driver = replaceOnce(
    driver,
    'const plugin=app.plugins.plugins["chat-to-vault"];await plugin.importSynthetic',
    "await plugin.importSynthetic",
    "M06 early plugin reference",
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
  return `${driver}\n${m06AcceptanceFunction()}`;
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
        metadataUrl: row.officialStable?.metadataUrl,
        downloadUrl: row.officialStable?.downloadUrl,
        metadata: safeArtifact(row.officialStable?.metadata),
      },
      sourceMetadata: {
        kind: row.sourceMetadata?.kind,
        appVersion: row.sourceMetadata?.appVersion,
        appInfoPlist: safeArtifact(row.sourceMetadata?.appInfoPlist),
        sourceFramework: safeArtifact(row.sourceMetadata?.sourceFramework),
        downloadUrl: row.sourceMetadata?.downloadUrl,
        download: safeArtifact(row.sourceMetadata?.download),
        metadataUrl: row.sourceMetadata?.metadataUrl,
        metadata: safeArtifact(row.sourceMetadata?.metadata),
        releaseHash: row.sourceMetadata?.releaseHash,
        codeSignature: row.sourceMetadata?.codeSignature,
        ...(row.sourceMetadata?.asar === undefined
          ? {}
          : { asar: safeArtifact(row.sourceMetadata.asar) }),
      },
      candidateHash: row.m06?.candidateHash,
      source: row.m06?.source,
      mutationAttempts: row.m06?.mutationAttempts,
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
  const encoded = Buffer.from(canonicalJson(sanitized));
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
  const officialSourceEnv = artifactsOnly
    ? {}
    : await prepareOfficialRuntimeSources(temporaryRoot);
  const legacySource = await readFile(legacyHarness, "utf8");
  await writeFile(driverPath, buildDriver(legacySource, row), { mode: 0o600 });
  const result = await run(
    process.execPath,
    [driverPath, ...(artifactsOnly ? ["--artifacts-only"] : [])],
    {
      cwd: repositoryRoot,
      env: { ...process.env, ...officialSourceEnv },
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
    const evidenceIndex = process.argv.indexOf("--evidence-file");
    const evidenceFile =
      evidenceIndex < 0 ? undefined : process.argv[evidenceIndex + 1];
    if (evidenceIndex >= 0 && evidenceFile === undefined)
      throw new Error("--evidence-file requires a path");
    if (evidenceFile !== undefined) {
      const destination = resolve(evidenceFile);
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(
        destination,
        canonicalJson({ ...sanitized, artifactHash: undefined }),
        {
          mode: 0o600,
        },
      );
    }
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
