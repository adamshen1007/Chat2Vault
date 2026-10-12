/* global Buffer, URL, fetch */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import {
  MINIMUM_OFFICIAL_DMG_SHA256,
  MINIMUM_OFFICIAL_DMG_URL,
  STABLE_METADATA_URL,
} from "./m06-runtime-provenance.mjs";

const run = promisify(execFile);
const decompress = promisify(gunzip);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );

async function download(url, destination) {
  const partial = `${destination}.${randomUUID()}.partial`;
  try {
    await run("/usr/bin/curl", [
      "--fail",
      "--location",
      "--proto",
      "=https",
      "--tlsv1.2",
      "--silent",
      "--show-error",
      "--output",
      partial,
      url,
    ]);
    await rename(partial, destination);
  } finally {
    await rm(partial, { force: true });
  }
}

export async function prepareOfficialRuntimeSources(directory) {
  const cache = "/private/tmp/chat2vault-official-1.7.4";
  await mkdir(cache, { recursive: true });
  const minimumDmg = join(cache, "Obsidian-1.7.4.dmg");
  if (!(await exists(minimumDmg)))
    await download(MINIMUM_OFFICIAL_DMG_URL, minimumDmg);
  const dmgBytes = await readFile(minimumDmg);
  if (sha256(dmgBytes) !== MINIMUM_OFFICIAL_DMG_SHA256)
    throw new Error("official minimum DMG identity mismatch");

  const mount = join(directory, "minimum-dmg");
  const minimumApp = join(directory, "official-minimum", "Obsidian.app");
  await mkdir(mount, { recursive: true });
  await mkdir(join(directory, "official-minimum"), { recursive: true });
  let attached = false;
  try {
    await run("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mount,
      minimumDmg,
    ]);
    attached = true;
    await run("/usr/bin/ditto", [join(mount, "Obsidian.app"), minimumApp]);
  } finally {
    if (attached) await run("hdiutil", ["detach", mount]);
  }

  const metadataResponse = await fetch(STABLE_METADATA_URL, {
    cache: "no-store",
    redirect: "error",
  });
  if (!metadataResponse.ok)
    throw new Error(
      `official stable metadata status ${String(metadataResponse.status)}`,
    );
  const metadata = JSON.parse(await metadataResponse.text());
  const expectedAsset = `obsidian-${String(metadata.latestVersion)}.asar.gz`;
  const stableUrl = new URL(String(metadata.downloadUrl));
  if (
    stableUrl.protocol !== "https:" ||
    stableUrl.hostname !== "github.com" ||
    !stableUrl.pathname.endsWith(
      `/obsidianmd/obsidian-releases/releases/download/v${String(metadata.latestVersion)}/${expectedAsset}`,
    )
  )
    throw new Error("official stable asset URL invalid");
  const stableDownload = join(directory, expectedAsset);
  await download(stableUrl.href, stableDownload);
  const compressed = await readFile(stableDownload);
  const releaseBytes = Buffer.from(String(metadata.hash), "base64");
  if (
    releaseBytes.length !== 32 ||
    releaseBytes.toString("hex") !== sha256(compressed)
  )
    throw new Error("official stable asset identity mismatch");
  const stableAsar = join(
    directory,
    `obsidian-${String(metadata.latestVersion)}.asar`,
  );
  await writeFile(stableAsar, await decompress(compressed));
  return {
    C2V_M05_OBSIDIAN_174_APP: minimumApp,
    C2V_M05_OBSIDIAN_STABLE_ASAR: stableAsar,
    C2V_M06_MINIMUM_DMG: minimumDmg,
    C2V_M06_MINIMUM_DMG_URL: MINIMUM_OFFICIAL_DMG_URL,
    C2V_M06_STABLE_DOWNLOAD: stableDownload,
  };
}
