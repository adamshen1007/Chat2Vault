/* global Buffer, URL */
const SHA256 = /^[0-9a-f]{64}$/u;

export const M06_RUNTIME_SCENARIO_IDS = Object.freeze([
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

export const MINIMUM_OFFICIAL_DMG_URL =
  "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.7.4/Obsidian-1.7.4.dmg";
export const STABLE_METADATA_URL =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json";

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

function validArtifact(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.file === "string" &&
    value.file !== "" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256)
  );
}

function validMinimum(version, source) {
  const signature = source?.codeSignature;
  return (
    version === "1.7.4" &&
    source?.kind === "official-dmg" &&
    source.appVersion === version &&
    source.downloadUrl === MINIMUM_OFFICIAL_DMG_URL &&
    validArtifact(source.download) &&
    source.download.file === "Obsidian-1.7.4.dmg" &&
    signature?.identifier === "md.obsidian" &&
    signature.teamIdentifier === "6JSW4SJWN9" &&
    Array.isArray(signature.authorities) &&
    signature.authorities[0] ===
      "Developer ID Application: Dynalist Inc. (6JSW4SJWN9)" &&
    signature.authorities.includes("Apple Root CA") &&
    SHA256.test(signature.designatedRequirementSha256 ?? "") &&
    signature.assessment === "accepted" &&
    signature.assessmentSource === "Notarized Developer ID"
  );
}

function validStable(version, source) {
  const expectedAsset = `obsidian-${version}.asar.gz`;
  const expectedSuffix = `/obsidianmd/obsidian-releases/releases/download/v${version}/${expectedAsset}`;
  let download;
  try {
    download = new URL(source?.downloadUrl ?? "");
  } catch {
    return false;
  }
  let releaseSha256;
  try {
    const releaseBytes = Buffer.from(source?.releaseHash ?? "", "base64");
    releaseSha256 =
      releaseBytes.length === 32 ? releaseBytes.toString("hex") : undefined;
  } catch {
    return false;
  }
  return (
    source?.kind === "official-stable-asar" &&
    typeof source.appVersion === "string" &&
    /^\d+\.\d+\.\d+$/u.test(source.appVersion) &&
    source.metadataUrl === STABLE_METADATA_URL &&
    validArtifact(source.metadata) &&
    source.metadata.file === "desktop-releases.json" &&
    download.protocol === "https:" &&
    download.hostname === "github.com" &&
    download.pathname.endsWith(expectedSuffix) &&
    typeof source.releaseHash === "string" &&
    releaseSha256 === source.download?.sha256 &&
    validArtifact(source.download) &&
    source.download.file === expectedAsset &&
    validArtifact(source.asar) &&
    source.asar.file === `obsidian-${version}.asar`
  );
}

export function validateM06RuntimeProvenance(row, version, source) {
  if (row === "minimum")
    return validMinimum(version, source)
      ? []
      : ["minimum official DMG provenance missing"];
  if (row === "stable")
    return validStable(version, source)
      ? []
      : ["stable official release provenance missing"];
  return ["unknown M06 runtime row"];
}

function expectedScenarios() {
  return M06_RUNTIME_SCENARIO_IDS.map((id) => ({
    id,
    outcome: "success",
    attempts: 0,
    mutations: id === "verified-create" ? 2 : 0,
  }));
}

function relativePath(value) {
  return (
    typeof value === "string" &&
    value !== "" &&
    !value.startsWith("/") &&
    !value.includes("..")
  );
}

function expectedMutationAttempts(evidence) {
  const created = evidence?.knowledge?.filter(
    ({ status }) => status === "created",
  );
  const conflicts = evidence?.knowledge?.filter(
    ({ status }) => status === "conflict",
  );
  if (created?.length !== 2 || conflicts?.length !== 1) return undefined;
  return [
    {
      surface: "vault",
      method: "createFolder",
      path: "Sources",
      phase: "fixture-setup",
      blocked: false,
    },
    {
      surface: "adapter",
      method: "mkdir",
      path: "Sources",
      phase: "fixture-setup",
      blocked: false,
    },
    {
      surface: "vault",
      method: "createFolder",
      path: "Knowledge",
      phase: "fixture-setup",
      blocked: false,
    },
    {
      surface: "adapter",
      method: "mkdir",
      path: "Knowledge",
      phase: "fixture-setup",
      blocked: false,
    },
    {
      surface: "vault",
      method: "create",
      path: "Sources/synthetic-source.md",
      phase: "fixture-setup",
      blocked: false,
    },
    {
      surface: "adapter",
      method: "write",
      path: "Sources/synthetic-source.md",
      phase: "fixture-setup",
      blocked: false,
    },
    ...created.flatMap(({ path }) => [
      {
        surface: "vault",
        method: "create",
        path,
        phase: "verified-create",
        blocked: false,
      },
      {
        surface: "adapter",
        method: "write",
        path,
        phase: "verified-create",
        blocked: false,
      },
    ]),
    {
      surface: "vault",
      method: "create",
      path: conflicts[0].path,
      phase: "conflict-fixture",
      blocked: false,
    },
    {
      surface: "adapter",
      method: "write",
      path: conflicts[0].path,
      phase: "conflict-fixture",
      blocked: false,
    },
  ];
}

export function validateM06RuntimeEvidence(evidence) {
  const failures = [];
  const expected = expectedScenarios();
  const expectedIds = [...M06_RUNTIME_SCENARIO_IDS];
  const scenarioIds = evidence?.scenarios?.map(({ id }) => id);
  if (
    !Array.isArray(scenarioIds) ||
    new Set(scenarioIds).size !== expectedIds.length ||
    canonicalJson(scenarioIds) !== canonicalJson(expectedIds) ||
    canonicalJson(evidence.scenarios) !== canonicalJson(expected) ||
    canonicalJson(evidence.observations) !== canonicalJson(expected) ||
    canonicalJson(evidence.scenarioRegistry) !== canonicalJson(expectedIds)
  )
    failures.push("scenario registry, order, uniqueness, or counters mismatch");

  const expectedAttempts = expectedMutationAttempts(evidence);
  if (
    expectedAttempts === undefined ||
    !Array.isArray(evidence?.mutationAttempts) ||
    canonicalJson(evidence.mutationAttempts) !== canonicalJson(expectedAttempts)
  )
    failures.push("mutation attempt sequence mismatch");

  const knowledge = evidence?.knowledge;
  if (
    !Array.isArray(knowledge) ||
    knowledge.length !== 5 ||
    knowledge.some(
      ({ path, sha256 }) => !relativePath(path) || !SHA256.test(sha256 ?? ""),
    ) ||
    knowledge[0]?.status !== "created" ||
    knowledge[1]?.status !== "created" ||
    knowledge[2]?.status !== "identical-no-op" ||
    knowledge[3]?.status !== "identical-no-op" ||
    knowledge[4]?.status !== "conflict" ||
    knowledge[0]?.path !== knowledge[2]?.path ||
    knowledge[0]?.sha256 !== knowledge[2]?.sha256 ||
    knowledge[1]?.path !== knowledge[3]?.path ||
    knowledge[1]?.sha256 !== knowledge[3]?.sha256
  )
    failures.push("knowledge artifact inventory mismatch");

  if (
    evidence?.source?.path !== "Sources/synthetic-source.md" ||
    evidence.source.unchanged !== true ||
    !SHA256.test(evidence.source.beforeHash ?? "") ||
    evidence.source.beforeHash !== evidence.source.afterHash
  )
    failures.push("source identity mismatch");

  if (
    canonicalJson(evidence?.counts) !==
      canonicalJson({
        candidates: 3,
        selected: 2,
        created: 2,
        noOp: 2,
        conflicts: 1,
        providerCalls: 0,
      }) ||
    canonicalJson(evidence?.privacy) !==
      canonicalJson({ relativePathsOnly: true, retainedContent: false })
  )
    failures.push("closed counts or privacy evidence mismatch");

  return failures;
}
