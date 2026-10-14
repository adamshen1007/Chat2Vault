/* global Buffer */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { URL } from "node:url";
import {
  canonicalJson,
  M07_PRODUCTION_ARTIFACT_PATHS,
  removeInheritedM05ProviderExercise,
  validateM07RetainedPacket,
  validateM07RuntimeArtifacts,
} from "./m07-runtime-provenance.mjs";
import { prepareOfficialRuntimeSources } from "./prepare-official-runtime-sources.mjs";

const run = promisify(execFile);
const pluginRoot = new URL("..", import.meta.url).pathname;
const repositoryRoot = resolve(pluginRoot, "../..");
const legacyHarness = join(pluginRoot, "scripts/check-m05-runtime.mjs");
const retainedPacketHashes = Object.freeze({
  minimum: "c145b77c332b3f95733fb646db142170e326826c2e9569f89e53db84bfde76be",
  stable: "31c10e6d4299c62f9643dee11119d8a03e0351b4efbcc0d0aed0d3087fdcf3f7",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requestedRow() {
  const index = process.argv.indexOf("--row");
  const row = index < 0 ? undefined : process.argv[index + 1];
  if (row !== "minimum" && row !== "stable")
    throw new Error("usage: check-m07-runtime.mjs --row minimum|stable");
  return row;
}

function replaceOnce(source, search, replacement, label) {
  if (source.split(search).length !== 2)
    throw new Error(`M07 runtime harness contract is ambiguous: ${label}`);
  return source.replace(search, replacement);
}

function acceptanceFunction() {
  return String.raw`
function assertCompleteM07RuntimeRows(rows, expectedIdentity, requestedRow) {
  if (rows.length !== 1 || rows[0]?.id !== requestedRow)
    throw new Error("M07 runtime row selection incomplete");
  const row = rows[0];
  const expectedVersion = requestedRow === "minimum" ? "1.7.4" : expectedIdentity.officialStable.latestVersion;
  if (
    row.version !== expectedVersion ||
    row.platform !== "darwin" ||
    row.arch !== "x64" ||
    row.macos?.productVersion !== expectedIdentity.macos.productVersion ||
    row.macos?.buildVersion !== expectedIdentity.macos.buildVersion
  ) throw new Error("M07 runtime identity mismatch");
  const sourceFailures = validateM07RuntimeSourceProvenance(requestedRow, row.version, row.sourceMetadata);
  const evidenceFailures = validateM07RuntimeEvidence(row.m07);
  if (
    sourceFailures.length !== 0 ||
    evidenceFailures.length !== 0 ||
    row.mutationCount !== 1 ||
    row.persistenceViolationCount !== 0 ||
    row.networkAttemptCount !== 0 ||
    row.backgroundAttemptCount !== 0
  ) throw new Error("M07 runtime acceptance predicate failed: "+JSON.stringify({sourceFailures,evidenceFailures,mutationCount:row.mutationCount,persistenceViolationCount:row.persistenceViolationCount,networkAttemptCount:row.networkAttemptCount,backgroundAttemptCount:row.backgroundAttemptCount,mutationAttempts:row.m07?.mutationAttempts}));
}
`;
}

function buildDriver(source, row) {
  let driver = source;
  driver = replaceOnce(
    driver,
    'import {\n  compareM05RuntimeArtifacts,\n  compareTrackedReleaseArtifacts,\n} from "./compare-m05-runtime-artifact.mjs";\n',
    `import { compareM05RuntimeArtifacts, compareTrackedReleaseArtifacts } from ${JSON.stringify(new URL("./compare-m05-runtime-artifact.mjs", import.meta.url).href)};\nimport { validateM07RuntimeArtifacts, validateM07RuntimeEvidence, validateM07RuntimeSourceProvenance } from ${JSON.stringify(new URL("./m07-runtime-provenance.mjs", import.meta.url).href)};\n`,
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
    throw new Error("M07 runtime harness contract changed: evidence call");
  driver = driver.replace(
    evidenceCall,
    "await new Promise((resolve)=>setTimeout(resolve,3000));const evidence=await plugin.runM07RuntimeScenarios();return{",
  );
  driver = replaceOnce(
    driver,
    'await app.plugins.enablePlugin("chat-to-vault");let runtimeLeaf=',
    'await app.plugins.enablePlugin("chat-to-vault");await new Promise((resolve)=>setTimeout(resolve,3000));const plugin=app.plugins.plugins["chat-to-vault"];plugin.installM07MutationLedger();await plugin.prepareM07RuntimeVault();let runtimeLeaf=',
    "M07 interception and fixture setup before view construction",
  );
  driver = replaceOnce(
    driver,
    'const plugin=app.plugins.plugins["chat-to-vault"];await plugin.importSynthetic',
    "await plugin.importSynthetic",
    "M07 early plugin reference",
  );
  driver = removeInheritedM05ProviderExercise(driver);
  driver = replaceOnce(
    driver,
    '  if (process.argv.includes("--artifacts-only")) {\n    process.stdout.write(',
    '  if (process.argv.includes("--artifacts-only")) {\n    process.stdout.write(`M07_RUNTIME_ARTIFACT=${JSON.stringify(evidenceBuild.runtime.artifact)}\\n`);\n    process.stdout.write(',
    "exact runtime artifact identity",
  );
  const legacyUiExercise =
    /hostUiEvidence = await exerciseAccessibilityAndZoom\([\s\S]*?markStage,\n {14}\);/u;
  if (!legacyUiExercise.test(driver))
    throw new Error("M07 runtime harness contract changed: M05 UI exercise");
  driver = driver.replace(legacyUiExercise, "hostUiEvidence = undefined;");
  const rowLoop =
    /for \(const rowInput of \[([\s\S]*?)\]\) \{\n {6}const row =/u;
  if (!rowLoop.test(driver))
    throw new Error("M07 runtime harness contract changed: row loop");
  driver = driver.replace(
    rowLoop,
    "for (const rowInput of [$1].filter(({ id }) => id === requestedRow)) {\n      const row =",
  );
  driver = replaceOnce(
    driver,
    "            keychain: value.evidence.keychain,",
    "            keychain: value.evidence.keychain,\n            m07: value.evidence,",
    "row evidence retention",
  );
  driver = replaceOnce(
    driver,
    "    assertCompleteRuntimeRows(rows, { authorities, macos, officialStable });",
    "    assertCompleteM07RuntimeRows(rows, { macos, officialStable }, requestedRow);",
    "row acceptance call",
  );
  return `${driver}\n${acceptanceFunction()}`;
}

function safeArtifact(value) {
  if (value === undefined) return undefined;
  return { file: value.file, bytes: value.bytes, sha256: value.sha256 };
}

function sanitizePacket(packet, rowId) {
  const row = packet.rows?.find(({ id }) => id === rowId);
  if (row === undefined) throw new Error("M07 runtime selected row missing");
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
      candidateHash: row.m07?.candidateHash,
      mutationAttempts: row.m07?.mutationAttempts,
      inputs: row.m07?.inputs,
      combined: row.m07?.combined,
      provider: row.m07?.provider,
      counts: row.m07?.counts,
      privacy: row.m07?.privacy,
      scenarios: row.m07?.scenarios,
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
  const artifactFailures = validateM07RuntimeArtifacts(
    sanitized.productionArtifacts,
  );
  if (
    artifactFailures.length !== 0 ||
    sanitized.runtimeArtifact?.file !== "runtime-test.js" ||
    !Number.isSafeInteger(sanitized.runtimeArtifact.bytes) ||
    sanitized.runtimeArtifact.bytes <= 0 ||
    !/^[0-9a-f]{64}$/u.test(sanitized.runtimeArtifact.sha256 ?? "")
  )
    throw new Error(
      `M07 runtime artifact evidence invalid: ${artifactFailures.join("; ")}`,
    );
  return {
    ...sanitized,
    artifactHash: sha256(Buffer.from(canonicalJson(sanitized))),
  };
}

async function verifyRetainedPackets(runtimeArtifact) {
  const productionArtifacts = Object.fromEntries(
    await Promise.all(
      M07_PRODUCTION_ARTIFACT_PATHS.map(async (path) => {
        const bytes = await readFile(join(pluginRoot, path));
        return [
          path,
          {
            file: path.slice(path.lastIndexOf("/") + 1),
            bytes: bytes.length,
            sha256: sha256(bytes),
          },
        ];
      }),
    ),
  );
  const hashes = {};
  for (const rowId of ["minimum", "stable"]) {
    const text = (
      await readFile(
        join(repositoryRoot, `docs/evidence/m07-runtime-${rowId}.json`),
        "utf8",
      )
    ).trim();
    const hash = sha256(Buffer.from(text));
    if (hash !== retainedPacketHashes[rowId])
      throw new Error(`M07 retained ${rowId} packet hash mismatch`);
    const packet = JSON.parse(text);
    const failures = validateM07RetainedPacket(
      packet,
      rowId,
      productionArtifacts,
      runtimeArtifact,
    );
    if (failures.length !== 0)
      throw new Error(
        `M07 retained ${rowId} packet stale: ${failures.join("; ")}`,
      );
    hashes[rowId] = hash;
  }
  return hashes;
}

const artifactsOnly = process.argv.includes("--artifacts-only");
const row = artifactsOnly ? "minimum" : requestedRow();
const temporaryRoot = await mkdtemp(
  join(pluginRoot, "scripts/.m07-runtime-driver-"),
);
const driverPath = join(temporaryRoot, `check-m07-runtime-${randomUUID()}.mjs`);
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
    const identityLine = result.stdout
      .split("\n")
      .find((candidate) => candidate.startsWith("M07_RUNTIME_ARTIFACT="));
    if (identityLine === undefined)
      throw new Error("M07 exact runtime artifact identity missing");
    const runtimeArtifact = JSON.parse(
      identityLine.slice("M07_RUNTIME_ARTIFACT=".length),
    );
    const retainedHashes = await verifyRetainedPackets(runtimeArtifact);
    const line = result.stdout
      .split("\n")
      .find((candidate) =>
        candidate.startsWith("M05 runtime artifact gate passed"),
      );
    if (line === undefined)
      throw new Error("M07 runtime artifact result missing");
    process.stdout.write(
      `${line.replace("M05", "M07").replace("runtime=", "runtime-with-m07-seam=")}\n`,
    );
    process.stdout.write(
      `M07 retained packet hashes: minimum=${retainedHashes.minimum}; stable=${retainedHashes.stable}.\n`,
    );
  } else {
    const line = result.stdout
      .split("\n")
      .findLast((candidate) => candidate.startsWith('{"status":"PASS"'));
    if (line === undefined) throw new Error("M07 runtime packet missing");
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
        { mode: 0o600 },
      );
    }
    const text = JSON.stringify(sanitized);
    if (
      text.includes(repositoryRoot) ||
      text.includes("/Users/") ||
      text.includes("M07_RUNTIME_SENTINEL_CONTENT")
    )
      throw new Error("M07 runtime packet privacy scan failed");
    process.stdout.write(`${text}\n`);
  }
} catch (error) {
  failure = error;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
if (failure !== undefined) throw failure;
