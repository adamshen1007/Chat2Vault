/* global Buffer, URL */
const SHA256 = /^[0-9a-f]{64}$/u;
const MINIMUM_URL =
  "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.7.4/Obsidian-1.7.4.dmg";
const MINIMUM_SHA256 =
  "af77521f1df2ec1ce36d6609c17c325827934726b68cb31587357b356a510dbe";
const STABLE_METADATA_URL =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json";

export const M07_RUNTIME_SCENARIO_IDS = Object.freeze([
  "exact-duplicate-blocked",
  "combined-preview-approved",
  "create-only-combined-note",
  "inputs-unchanged",
  "provider-not-called",
]);

export const M07_PRODUCTION_ARTIFACT_PATHS = Object.freeze([
  "main.js",
  "manifest.json",
  "native/keychain.node",
  "native/source_observer.node",
  "styles.css",
  "worker.js",
]);
export const M07_EXPECTED_INPUTS = Object.freeze([
  Object.freeze({
    path: "Sources/synthetic-existing.md",
    beforeHash:
      "b54a893dc3fa19c4054b274c5291bc082abab43ed533afc5b1311adbec4b1aa3",
    afterHash:
      "b54a893dc3fa19c4054b274c5291bc082abab43ed533afc5b1311adbec4b1aa3",
    unchanged: true,
  }),
  Object.freeze({
    path: "Sources/synthetic-candidate.md",
    beforeHash:
      "31a908c7499ad1fcf91d64184f3625c10da95e54bc03b8d38f755131675612d5",
    afterHash:
      "31a908c7499ad1fcf91d64184f3625c10da95e54bc03b8d38f755131675612d5",
    unchanged: true,
  }),
  Object.freeze({
    path: "Knowledge/Synthetic runtime knowledge--0ffe11ddbfec.md",
    beforeHash:
      "9835de2c9cb1c806396676efa071882e1977b90800b86b9b20313b03153b7728",
    afterHash:
      "9835de2c9cb1c806396676efa071882e1977b90800b86b9b20313b03153b7728",
    unchanged: true,
  }),
]);
export const M07_EXPECTED_COMBINED = Object.freeze({
  path: "Knowledge/Synthetic runtime knowledge--c87f70b2535e.md",
  status: "created",
  sha256: "4cdb914c4a25e81bf45685ca0ecb5b4b3eab229d69074ce39409c5f694abf465",
  schema: 2,
  combinedFrom: "Knowledge/Synthetic runtime knowledge--0ffe11ddbfec.md",
});
export const M07_EXPECTED_CANDIDATE_HASH =
  "f0e164891b4b587cdf06e9b556c2a0db9a0ec17eea0bba1a2480f545e7eded33";

const INHERITED_M05_PROVIDER_EXERCISE =
  "const prepared=await view.distillationController.prepare();const providerOperation=view.runProvider();await Promise.resolve();const pendingCancel=view.contentEl.querySelector('.c2v-provider-cancel');const pendingCancelFocused=document.activeElement===pendingCancel;const pendingCancelRect=pendingCancel?.getBoundingClientRect();await providerOperation;const providerSnapshot=view.providerController.snapshot;const status=view.contentEl.querySelector('[role=\"status\"]');window.__c2vM05ViewStatus=status;";
const M07_OFFLINE_VIEW_SNAPSHOT =
  "const prepared=await view.distillationController.prepare();const pendingCancelFocused=false;const pendingCancelRect=undefined;const providerSnapshot=view.providerController.snapshot;const status=view.contentEl.querySelector('[role=\"status\"]');window.__c2vM05ViewStatus=status;";

export function removeInheritedM05ProviderExercise(source) {
  if (source.split(INHERITED_M05_PROVIDER_EXERCISE).length !== 2)
    throw new Error(
      "M07 runtime harness contract is ambiguous: inherited M05 provider exercise",
    );
  const rewritten = source.replace(
    INHERITED_M05_PROVIDER_EXERCISE,
    M07_OFFLINE_VIEW_SNAPSHOT,
  );
  if (rewritten.includes("view.runProvider()"))
    throw new Error("M07 runtime driver retains a provider request");
  return rewritten;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function relativePath(value) {
  return (
    typeof value === "string" &&
    value !== "" &&
    !value.startsWith("/") &&
    !value.includes("..")
  );
}

function validArtifact(value, file) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.file === file &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256)
  );
}

export function validateM07RuntimeSourceProvenance(row, version, source) {
  if (row === "minimum") {
    const signature = source?.codeSignature;
    return version === "1.7.4" &&
      source?.kind === "official-dmg" &&
      source.appVersion === version &&
      source.downloadUrl === MINIMUM_URL &&
      validArtifact(source.download, "Obsidian-1.7.4.dmg") &&
      source.download.sha256 === MINIMUM_SHA256 &&
      signature?.identifier === "md.obsidian" &&
      signature.teamIdentifier === "6JSW4SJWN9" &&
      Array.isArray(signature.authorities) &&
      signature.authorities[0] ===
        "Developer ID Application: Dynalist Inc. (6JSW4SJWN9)" &&
      signature.authorities.includes("Apple Root CA") &&
      SHA256.test(signature.designatedRequirementSha256 ?? "") &&
      signature.assessment === "accepted" &&
      signature.assessmentSource === "Notarized Developer ID"
      ? []
      : ["minimum official DMG provenance missing"];
  }
  if (row === "stable") {
    const expectedAsset = `obsidian-${version}.asar.gz`;
    let download;
    let releaseSha256;
    try {
      download = new URL(source?.downloadUrl ?? "");
      const releaseBytes = Buffer.from(source?.releaseHash ?? "", "base64");
      releaseSha256 =
        releaseBytes.length === 32 ? releaseBytes.toString("hex") : undefined;
    } catch {
      return ["stable official release provenance missing"];
    }
    return source?.kind === "official-stable-asar" &&
      typeof source.appVersion === "string" &&
      /^\d+\.\d+\.\d+$/u.test(source.appVersion) &&
      source.metadataUrl === STABLE_METADATA_URL &&
      validArtifact(source.metadata, "desktop-releases.json") &&
      download.protocol === "https:" &&
      download.hostname === "github.com" &&
      download.pathname.endsWith(
        `/obsidianmd/obsidian-releases/releases/download/v${version}/${expectedAsset}`,
      ) &&
      validArtifact(source.download, expectedAsset) &&
      releaseSha256 === source.download.sha256 &&
      validArtifact(source.asar, `obsidian-${version}.asar`)
      ? []
      : ["stable official release provenance missing"];
  }
  return ["unknown M07 runtime row"];
}

export function validateM07RuntimeArtifacts(artifacts) {
  const failures = [];
  if (
    artifacts === null ||
    typeof artifacts !== "object" ||
    canonicalJson(Object.keys(artifacts).sort()) !==
      canonicalJson([...M07_PRODUCTION_ARTIFACT_PATHS]) ||
    M07_PRODUCTION_ARTIFACT_PATHS.some(
      (path) =>
        !validArtifact(artifacts[path], path.slice(path.lastIndexOf("/") + 1)),
    )
  )
    failures.push("exact production artifact inventory missing");
  return failures;
}

export function validateM07RetainedPacket(
  packet,
  rowId,
  productionArtifacts,
  runtimeArtifact,
) {
  const failures = [];
  const row = packet?.row;
  const expectedVersion =
    rowId === "minimum" ? "1.7.4" : row?.officialStable?.latestVersion;
  if (
    packet?.status !== "PASS" ||
    row?.id !== rowId ||
    row?.version !== expectedVersion ||
    row?.platform !== "darwin" ||
    row?.arch !== "x64" ||
    !/^\d+\.\d+\.\d+$/u.test(row?.version ?? "")
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
    validateM07RuntimeArtifacts(packet?.productionArtifacts).length !== 0 ||
    canonicalJson(packet?.productionArtifacts) !==
      canonicalJson(productionArtifacts)
  )
    failures.push("retained production artifacts differ from current build");
  if (
    !validArtifact(packet?.runtimeArtifact, "runtime-test.js") ||
    canonicalJson(packet?.runtimeArtifact) !== canonicalJson(runtimeArtifact)
  )
    failures.push("retained runtime seam differs from current build");
  const scenarios = row?.scenarios;
  const evidence = {
    scenarioRegistry: Array.isArray(scenarios)
      ? scenarios.map((scenario) => scenario?.id)
      : undefined,
    scenarios,
    observations: scenarios,
    mutationAttempts: row?.mutationAttempts,
    inputs: row?.inputs,
    combined: row?.combined,
    provider: row?.provider,
    counts: row?.counts,
    candidateHash: row?.candidateHash,
    privacy: row?.privacy,
  };
  failures.push(...validateM07RuntimeEvidence(evidence));
  if (
    row?.mutationCount !== 1 ||
    row?.persistenceViolationCount !== 0 ||
    row?.networkAttemptCount !== 0 ||
    row?.backgroundAttemptCount !== 0
  )
    failures.push("retained row counts mismatch");
  return failures;
}

function expectedScenarios() {
  return M07_RUNTIME_SCENARIO_IDS.map((id) => ({
    id,
    outcome: "success",
    mutations: id === "create-only-combined-note" ? 1 : 0,
  }));
}

function validMutationSequence(evidence) {
  const attempts = evidence?.mutationAttempts;
  if (!Array.isArray(attempts) || attempts.length !== 12) return false;
  const expected = [
    ["vault", "createFolder", "Sources", "fixture-setup"],
    ["adapter", "mkdir", "Sources", "fixture-setup"],
    ["vault", "createFolder", "Knowledge", "fixture-setup"],
    ["adapter", "mkdir", "Knowledge", "fixture-setup"],
    ...M07_EXPECTED_INPUTS.flatMap(({ path }) => [
      ["vault", "create", path, "fixture-setup"],
      ["adapter", "write", path, "fixture-setup"],
    ]),
    [
      "vault",
      "create",
      M07_EXPECTED_COMBINED.path,
      "create-only-combined-note",
    ],
    [
      "adapter",
      "write",
      M07_EXPECTED_COMBINED.path,
      "create-only-combined-note",
    ],
  ];
  return attempts.every(
    (attempt, index) =>
      attempt !== null &&
      typeof attempt === "object" &&
      attempt.blocked === false &&
      relativePath(attempt.path) &&
      canonicalJson([
        attempt.surface,
        attempt.method,
        attempt.path,
        attempt.phase,
      ]) === canonicalJson(expected[index]),
  );
}

export function validateM07RuntimeEvidence(evidence) {
  const failures = [];
  const expected = expectedScenarios();
  if (
    canonicalJson(evidence?.scenarioRegistry) !==
      canonicalJson(M07_RUNTIME_SCENARIO_IDS) ||
    canonicalJson(evidence?.scenarios) !== canonicalJson(expected) ||
    canonicalJson(evidence?.observations) !== canonicalJson(expected)
  )
    failures.push("scenario registry, order, uniqueness, or counters mismatch");

  if (!validMutationSequence(evidence))
    failures.push("mutation attempt sequence mismatch");

  const inputs = evidence?.inputs;
  if (
    !Array.isArray(inputs) ||
    canonicalJson(inputs) !== canonicalJson(M07_EXPECTED_INPUTS)
  )
    failures.push("immutable input identity mismatch");

  const combined = evidence?.combined;
  if (canonicalJson(combined) !== canonicalJson(M07_EXPECTED_COMBINED))
    failures.push("combined-note evidence mismatch");

  if (
    canonicalJson(evidence?.provider) !==
      canonicalJson({ beforeCalls: 0, afterCalls: 0 }) ||
    evidence?.counts?.providerCalls !== evidence?.provider?.afterCalls
  )
    failures.push("absolute provider-call evidence mismatch");

  if (
    evidence?.candidateHash !== M07_EXPECTED_CANDIDATE_HASH ||
    canonicalJson(evidence?.counts) !==
      canonicalJson({
        exactDuplicates: 1,
        combinedCreated: 1,
        providerCalls: 0,
      }) ||
    canonicalJson(evidence?.privacy) !==
      canonicalJson({ relativePathsOnly: true, retainedContent: false })
  )
    failures.push("closed counts or privacy evidence mismatch");

  return failures;
}
