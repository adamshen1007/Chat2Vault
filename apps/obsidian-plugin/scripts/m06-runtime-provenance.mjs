/* global Buffer, URL */
const SHA256 = /^[0-9a-f]{64}$/u;

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
