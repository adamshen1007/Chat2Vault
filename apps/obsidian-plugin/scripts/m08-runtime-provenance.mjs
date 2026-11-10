import { createHash } from "node:crypto";
import {
  canonicalJson,
  validateM07RuntimeSourceProvenance,
} from "./m07-runtime-provenance.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const GIT_MODE = /^(?:100644|100755|120000|160000)$/u;
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]+$/u;

export const M08_CANDIDATE_MANIFEST_EXCLUSIONS = Object.freeze([
  "docs/26_M08_IMPLEMENTATION_REPORT.md",
  "docs/evidence/m08-runtime-minimum.json",
  "docs/evidence/m08-runtime-stable.json",
]);

export const M08_RUNTIME_SCENARIO_IDS = Object.freeze([
  "staging-created",
  "manual-created",
  "duplicate-no-op",
  "changed-content-versioned",
  "stale-preview-blocked",
  "prepared-crash-reload-blocked",
  "published-crash-reload-blocked",
  "clear-failure-reload-blocked",
  "protected-notes-unchanged",
  "provider-not-called",
]);

export const M08_PRODUCTION_ARTIFACT_PATHS = Object.freeze([
  "main.js",
  "manifest.json",
  "native/keychain.node",
  "native/source_observer.node",
  "styles.css",
  "worker.js",
]);

function exactRecord(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function manifestEntry(value) {
  return (
    exactRecord(value, ["path", "mode", "type", "size", "sha256"]) &&
    relativePath(value.path) &&
    !M08_CANDIDATE_MANIFEST_EXCLUSIONS.includes(value.path) &&
    typeof value.mode === "string" &&
    GIT_MODE.test(value.mode) &&
    value.type === (value.mode === "160000" ? "commit" : "blob") &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256)
  );
}

export function validateM08CandidateManifest(value) {
  const failures = [];
  if (
    !exactRecord(value, [
      "schemaVersion",
      "baseCommit",
      "exclusions",
      "entryCount",
      "entries",
      "manifestDigest",
    ])
  ) {
    failures.push("candidate manifest shape is not closed");
    return failures;
  }
  if (
    value.schemaVersion !== 1 ||
    typeof value.baseCommit !== "string" ||
    !COMMIT_SHA.test(value.baseCommit) ||
    canonicalJson(value.exclusions) !==
      canonicalJson(M08_CANDIDATE_MANIFEST_EXCLUSIONS)
  )
    failures.push("candidate manifest authority mismatch");
  if (
    !Array.isArray(value.entries) ||
    !value.entries.every(manifestEntry) ||
    value.entryCount !== value.entries.length ||
    canonicalJson(value.entries.map(({ path }) => path)) !==
      canonicalJson(value.entries.map(({ path }) => path).sort()) ||
    new Set(value.entries.map(({ path }) => path)).size !== value.entries.length
  )
    failures.push("candidate manifest entries mismatch");
  const digest = sha256Canonical({
    schemaVersion: value.schemaVersion,
    baseCommit: value.baseCommit,
    exclusions: value.exclusions,
    entries: value.entries,
  });
  if (value.manifestDigest !== digest)
    failures.push("candidate manifest digest mismatch");
  return failures;
}

export function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function candidateBinding(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    baseCommit: manifest.baseCommit,
    exclusions: [...manifest.exclusions],
    entryCount: manifest.entryCount,
    manifestDigest: manifest.manifestDigest,
  };
}

function validCandidateBinding(value) {
  return (
    exactRecord(value, [
      "schemaVersion",
      "baseCommit",
      "exclusions",
      "entryCount",
      "manifestDigest",
    ]) &&
    value.schemaVersion === 1 &&
    typeof value.baseCommit === "string" &&
    COMMIT_SHA.test(value.baseCommit) &&
    canonicalJson(value.exclusions) ===
      canonicalJson(M08_CANDIDATE_MANIFEST_EXCLUSIONS) &&
    Number.isSafeInteger(value.entryCount) &&
    value.entryCount > 0 &&
    typeof value.manifestDigest === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(value.manifestDigest)
  );
}

function artifact(value, file) {
  return (
    exactRecord(value, ["file", "bytes", "sha256"]) &&
    value.file === file &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256)
  );
}

function relativePath(value) {
  return typeof value === "string" && RELATIVE_PATH.test(value);
}

export function validateM08RuntimeArtifacts(value) {
  const failures = [];
  if (!exactRecord(value, M08_PRODUCTION_ARTIFACT_PATHS)) {
    failures.push("production artifact inventory mismatch");
    return failures;
  }
  for (const path of M08_PRODUCTION_ARTIFACT_PATHS)
    if (!artifact(value[path], path.slice(path.lastIndexOf("/") + 1)))
      failures.push(`invalid production artifact ${path}`);
  if (Object.keys(value).some((path) => path.includes("source_observer_test")))
    failures.push("test-only native addon entered production inventory");
  return failures;
}

function validCreated(value) {
  return (
    exactRecord(value, ["path", "sha256"]) &&
    relativePath(value.path) &&
    value.path.startsWith("Sources/") &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256)
  );
}

function validProtected(value) {
  return (
    exactRecord(value, ["path", "beforeHash", "afterHash", "unchanged"]) &&
    relativePath(value.path) &&
    typeof value.beforeHash === "string" &&
    SHA256.test(value.beforeHash) &&
    value.afterHash === value.beforeHash &&
    value.unchanged === true
  );
}

export function validateM08RuntimeEvidence(value) {
  const failures = [];
  if (
    !exactRecord(value, [
      "scenarioRegistry",
      "scenarios",
      "created",
      "duplicate",
      "stale",
      "protected",
      "stagingFixture",
      "provider",
      "reconciliation",
      "counts",
      "privacy",
    ])
  ) {
    failures.push("runtime evidence shape is not closed");
    return failures;
  }
  const expectedScenarios = M08_RUNTIME_SCENARIO_IDS.map((id) => ({
    id,
    outcome: "success",
  }));
  if (
    canonicalJson(value.scenarioRegistry) !==
      canonicalJson(M08_RUNTIME_SCENARIO_IDS) ||
    canonicalJson(value.scenarios) !== canonicalJson(expectedScenarios)
  )
    failures.push("scenario registry or outcomes mismatch");
  if (
    !Array.isArray(value.created) ||
    value.created.length !== 5 ||
    !value.created.every(validCreated) ||
    new Set(value.created.map(({ path }) => path)).size !== 5
  )
    failures.push("created capture evidence mismatch");
  if (
    canonicalJson(value.duplicate) !==
    canonicalJson({ status: "existing-identical", mutationDelta: 0 })
  )
    failures.push("duplicate no-op evidence mismatch");
  if (
    canonicalJson(value.stale) !==
    canonicalJson({ status: "stale", mutationDelta: 0 })
  )
    failures.push("stale preview evidence mismatch");
  if (
    !Array.isArray(value.protected) ||
    value.protected.length !== 2 ||
    !value.protected.every(validProtected) ||
    canonicalJson(value.protected.map(({ path }) => path).sort()) !==
      canonicalJson(["Knowledge/existing.md", "Sources/existing.md"])
  )
    failures.push("protected-note identity mismatch");
  if (
    canonicalJson(value.stagingFixture) !==
    canonicalJson({
      writer: "runtime-harness",
      qualification: "synthetic-staging-contract",
    })
  )
    failures.push("synthetic staging fixture label mismatch");
  if (
    canonicalJson(value.reconciliation) !==
    canonicalJson({
      preparedBeforePublish: {
        targetPresent: false,
        reloadBlocked: true,
        blockedWriteDelta: 0,
        unresolvedAtLoad: true,
        providerCalls: 0,
        networkAttempts: 0,
        crashSignal: "SIGKILL",
      },
      publishedBeforeClear: {
        targetPresent: true,
        reloadBlocked: true,
        blockedWriteDelta: 0,
        unresolvedAtLoad: true,
        providerCalls: 0,
        networkAttempts: 0,
        crashSignal: "SIGKILL",
      },
      clearPersistenceFailure: {
        targetPresent: true,
        saveEffect: "published",
        reloadBlocked: true,
        blockedWriteDelta: 0,
        unresolvedAtLoad: true,
        providerCalls: 0,
        networkAttempts: 0,
        reloadMethod: "plugin-disable-enable",
      },
    })
  )
    failures.push("durable reconciliation host evidence mismatch");
  if (
    canonicalJson(value.provider) !==
      canonicalJson({ beforeCalls: 0, afterCalls: 0 }) ||
    canonicalJson(value.counts) !==
      canonicalJson({
        created: 5,
        providerCalls: 0,
        reconciliationPersistenceAttempts: 13,
        reconciliationWrites: 12,
        reconciliationFailures: 1,
      })
  )
    failures.push("absolute provider or create counts mismatch");
  if (
    canonicalJson(value.privacy) !==
    canonicalJson({ relativePathsOnly: true, retainedContent: false })
  )
    failures.push("privacy evidence mismatch");
  return failures;
}

export function validateM08RetainedPacket(
  packet,
  rowId,
  productionArtifacts,
  runtimeArtifact,
  candidateManifest,
) {
  const failures = [];
  const row = packet?.row;
  const expectedVersion =
    rowId === "minimum" ? "1.7.4" : row?.officialStable?.latestVersion;
  if (
    !exactRecord(packet, [
      "status",
      "row",
      "productionArtifacts",
      "runtimeArtifact",
      "candidate",
    ]) ||
    validateM08CandidateManifest(candidateManifest).length !== 0 ||
    !validCandidateBinding(packet?.candidate) ||
    canonicalJson(packet?.candidate) !==
      canonicalJson(candidateBinding(candidateManifest))
  )
    failures.push("retained candidate content binding mismatch");
  if (
    packet?.status !== "PASS" ||
    row?.id !== rowId ||
    row?.version !== expectedVersion ||
    row?.platform !== "darwin" ||
    row?.arch !== "x64"
  )
    failures.push("retained row identity mismatch");
  failures.push(
    ...validateM07RuntimeSourceProvenance(
      rowId,
      row?.version,
      row?.sourceMetadata,
    ),
  );
  if (
    validateM08RuntimeArtifacts(packet?.productionArtifacts).length !== 0 ||
    canonicalJson(packet?.productionArtifacts) !==
      canonicalJson(productionArtifacts)
  )
    failures.push("retained production artifacts differ from current build");
  if (
    !artifact(packet?.runtimeArtifact, "runtime-test.js") ||
    canonicalJson(packet?.runtimeArtifact) !== canonicalJson(runtimeArtifact)
  )
    failures.push("retained runtime seam differs from current build");
  failures.push(...validateM08RuntimeEvidence(row?.m08));
  if (
    row?.networkAttemptCount !== 0 ||
    row?.backgroundAttemptCount !== 0 ||
    row?.persistenceViolationCount !== 13 ||
    row?.m08?.counts?.reconciliationPersistenceAttempts !== 13 ||
    row?.m08?.counts?.reconciliationWrites !== 12 ||
    row?.m08?.counts?.reconciliationFailures !== 1
  )
    failures.push("retained side-effect counts mismatch");
  return failures;
}
