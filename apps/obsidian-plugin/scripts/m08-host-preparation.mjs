/* global Buffer, URL, fetch */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import process from "node:process";
import esbuild from "esbuild";
import {
  compareM05RuntimeArtifacts,
  compareTrackedReleaseArtifacts,
} from "./compare-m05-runtime-artifact.mjs";
import { prepareOfficialRuntimeSources } from "./prepare-official-runtime-sources.mjs";

const run = promisify(execFile);
const pluginRoot = new URL("..", import.meta.url).pathname;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );

export async function artifact(path) {
  const bytes = await readFile(path);
  return { file: basename(path), bytes: bytes.length, sha256: sha256(bytes) };
}

export async function buildM08Evidence(directory) {
  await esbuild.build({
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
  const worker = await readFile(join(directory, "worker.js"), "utf8");
  const buildOptions = {
    bundle: true,
    external: ["obsidian", "../native/source_observer.node"],
    format: "cjs",
    platform: "node",
    target: "node20",
    minify: true,
    sourcemap: false,
    logLevel: "silent",
    metafile: true,
    define: { __C2V_WORKER_SOURCE__: JSON.stringify(worker) },
  };
  const buildOne = async (entryPoint, outfile) => {
    const result = await esbuild.build({
      ...buildOptions,
      absWorkingDir: pluginRoot,
      entryPoints: [entryPoint],
      outfile,
    });
    return {
      pluginRoot,
      buildOptions,
      entryPoint,
      metafile: result.metafile,
      artifact: await artifact(outfile),
    };
  };
  const production = await buildOne(
    "src/main.ts",
    join(directory, "production.js"),
  );
  const runtime = await buildOne(
    "src/runtime-test-entry.ts",
    join(directory, "runtime-test.js"),
  );
  const comparison = compareM05RuntimeArtifacts(production, runtime);
  if (!comparison.ok) throw new Error(comparison.failures.join("; "));
  const releaseComparison = compareTrackedReleaseArtifacts(
    {
      "main.js": production.artifact,
      "worker.js": await artifact(join(directory, "worker.js")),
    },
    {
      "main.js": await artifact(join(pluginRoot, "main.js")),
      "worker.js": await artifact(join(pluginRoot, "worker.js")),
    },
  );
  if (!releaseComparison.ok)
    throw new Error(releaseComparison.failures.join("; "));
  return { production, runtime };
}

async function resolveOfficialStableMetadata() {
  const metadataUrl =
    "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json";
  const response = await fetch(metadataUrl, {
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      `M08_RUNTIME_HOST_BLOCKED stable metadata status ${String(response.status)}`,
    );
  const bytes = Buffer.from(await response.arrayBuffer());
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (
    typeof parsed.latestVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(parsed.latestVersion) ||
    typeof parsed.downloadUrl !== "string" ||
    typeof parsed.hash !== "string"
  )
    throw new Error("M08_RUNTIME_HOST_BLOCKED stable metadata invalid");
  return {
    metadataUrl,
    downloadUrl: parsed.downloadUrl,
    metadata: {
      file: "desktop-releases.json",
      bytes: bytes.length,
      sha256: sha256(bytes),
    },
    metadataBytes: bytes.length,
    metadataSha256: sha256(bytes),
    latestVersion: parsed.latestVersion,
    releaseAsset: `obsidian-${parsed.latestVersion}.asar.gz`,
    releaseHash: parsed.hash,
  };
}

async function collectMacosIdentity() {
  const productVersion = (
    await run("sw_vers", ["-productVersion"])
  ).stdout.trim();
  const buildVersion = (await run("sw_vers", ["-buildVersion"])).stdout.trim();
  if (productVersion === "" || buildVersion === "")
    throw new Error("M08 runtime macOS identity unavailable");
  return { productVersion, buildVersion };
}

async function collectCodeSignature(appPath) {
  const details = await run("codesign", ["-dv", "--verbose=4", appPath]);
  const text = `${details.stdout}\n${details.stderr}`;
  const value = (key) =>
    new RegExp(`^${key}=(.+)$`, "mu").exec(text)?.[1]?.trim();
  const authorities = [...text.matchAll(/^Authority=(.+)$/gmu)].map((match) =>
    match[1]?.trim(),
  );
  const requirementResult = await run("codesign", ["-dr", "-", appPath]);
  const requirementText = `${requirementResult.stdout}\n${requirementResult.stderr}`;
  const requirement =
    /^designated => (.+)$/mu.exec(requirementText)?.[1]?.trim() ?? "";
  if (requirement === "")
    throw new Error("M08 runtime designated requirement unavailable");
  let assessment = "rejected";
  let assessmentSource = "unavailable";
  try {
    const assessed = await run("spctl", [
      "-a",
      "-vv",
      "--type",
      "execute",
      appPath,
    ]);
    const assessmentText = `${assessed.stdout}\n${assessed.stderr}`;
    assessment = assessmentText.includes("accepted") ? "accepted" : "rejected";
    assessmentSource =
      /^source=(.+)$/mu.exec(assessmentText)?.[1]?.trim() ??
      (assessmentText.includes("security disabled")
        ? "security-disabled"
        : "unavailable");
  } catch (error) {
    const assessmentText = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    assessment = assessmentText.includes("accepted") ? "accepted" : "rejected";
    assessmentSource =
      /^source=(.+)$/mu.exec(assessmentText)?.[1]?.trim() ?? "unavailable";
  }
  return {
    identifier: value("Identifier"),
    teamIdentifier: value("TeamIdentifier"),
    authorities,
    designatedRequirementSha256: sha256(Buffer.from(requirement)),
    assessment,
    assessmentSource,
  };
}

async function prepareInstrumentedApp(sourceApp, destinationApp, hostId) {
  const frameworkRelative =
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework";
  const sourceFramework = join(sourceApp, frameworkRelative);
  const sourceIdentity = await artifact(sourceFramework);
  await run("/bin/cp", ["-cR", sourceApp, destinationApp]);
  const framework = join(destinationApp, frameworkRelative);
  const bytes = await readFile(framework);
  const sentinel = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX", "ascii");
  const originalFuseStates = [];
  const instrumentedFuseStates = [];
  let offset = bytes.indexOf(sentinel);
  while (offset >= 0) {
    const header = offset + sentinel.length;
    if (bytes[header] !== 1 || bytes[header + 1] < 4)
      throw new Error("Electron fuse schema mismatch");
    const states = header + 2;
    originalFuseStates.push(
      bytes.subarray(states, states + bytes[header + 1]).toString("ascii"),
    );
    for (const index of [2, 3]) bytes[states + index] = 0x31;
    instrumentedFuseStates.push(
      bytes.subarray(states, states + bytes[header + 1]).toString("ascii"),
    );
    offset = bytes.indexOf(sentinel, offset + sentinel.length);
  }
  if (originalFuseStates.length === 0)
    throw new Error("Electron fuse sentinel mismatch");
  await writeFile(framework, bytes);
  await run("/usr/bin/xattr", ["-cr", destinationApp]);
  await run("codesign", ["--force", "--deep", "--sign", "-", destinationApp]);
  const modifiedIdentity = await artifact(framework);
  if (sourceIdentity.sha256 === modifiedIdentity.sha256)
    throw new Error("Electron fuse instrumentation did not change host bytes");
  return {
    executable: join(destinationApp, "Contents/MacOS/Obsidian"),
    sourceFramework: sourceIdentity,
    instrumentedFramework: modifiedIdentity,
    hostId,
    originalFuseStates,
    instrumentedFuseStates,
    nodeOptionsEnabled: true,
    nodeCliInspectEnabled: true,
  };
}

async function collectSourceMetadata(row, officialStable, sourceEnvironment) {
  const infoPlist = join(row.sourceApp, "Contents/Info.plist");
  const appVersion = (
    await run("/usr/bin/plutil", [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      "-o",
      "-",
      infoPlist,
    ])
  ).stdout.trim();
  const source = {
    kind:
      row.id === "minimum"
        ? "official-release-application"
        : "installed-application-with-official-stable-asar",
    appVersion,
    appInfoPlist: await artifact(infoPlist),
    sourceFramework: row.hostInstrumentation.sourceFramework,
  };
  if (row.id === "minimum") {
    const downloadPath = sourceEnvironment.C2V_M06_MINIMUM_DMG;
    if (downloadPath !== undefined) {
      source.kind = "official-dmg";
      source.downloadUrl = sourceEnvironment.C2V_M06_MINIMUM_DMG_URL;
      source.download = await artifact(downloadPath);
      source.codeSignature = await collectCodeSignature(row.sourceApp);
    }
  } else {
    const downloadPath = sourceEnvironment.C2V_M06_STABLE_DOWNLOAD;
    if (downloadPath !== undefined) {
      source.kind = "official-stable-asar";
      source.metadataUrl = officialStable.metadataUrl;
      source.metadata = officialStable.metadata;
      source.downloadUrl = officialStable.downloadUrl;
      source.releaseHash = officialStable.releaseHash;
      source.download = await artifact(downloadPath);
    }
    source.asar = await artifact(row.asarPath);
  }
  return source;
}

export async function prepareM08HostRow(rowId, root) {
  const supplied =
    process.env.C2V_M05_OBSIDIAN_174_APP !== undefined &&
    process.env.C2V_M05_OBSIDIAN_STABLE_ASAR !== undefined &&
    process.env.C2V_M06_MINIMUM_DMG !== undefined &&
    process.env.C2V_M06_STABLE_DOWNLOAD !== undefined;
  const sourceEnvironment = supplied
    ? process.env
    : { ...process.env, ...(await prepareOfficialRuntimeSources(root)) };
  const officialStable = await resolveOfficialStableMetadata();
  const minimumApp =
    sourceEnvironment.C2V_M05_OBSIDIAN_174_APP ??
    "/private/tmp/chat2vault-m05-hosts/1.7.4/Obsidian.app";
  const stableApp =
    process.env.C2V_M05_OBSIDIAN_STABLE_APP ?? "/Applications/Obsidian.app";
  const stableAsar =
    sourceEnvironment.C2V_M05_OBSIDIAN_STABLE_ASAR ??
    join(
      homedir(),
      `Library/Application Support/obsidian/obsidian-${officialStable.latestVersion}.asar`,
    );
  const sourceApp = rowId === "minimum" ? minimumApp : stableApp;
  if (
    !(await exists(sourceApp)) ||
    (rowId === "stable" && !(await exists(stableAsar)))
  )
    throw new Error("M08_RUNTIME_HOST_BLOCKED required host unavailable");
  const instrumentedRoot = join(root, "instrumented-hosts");
  await mkdir(instrumentedRoot, { recursive: true });
  const host = await prepareInstrumentedApp(
    sourceApp,
    join(instrumentedRoot, `${rowId}.app`),
    rowId,
  );
  const row = {
    id: rowId,
    version: rowId === "minimum" ? "1.7.4" : officialStable.latestVersion,
    sourceApp,
    executable: host.executable,
    hostInstrumentation: host,
    ...(rowId === "stable" ? { asarPath: stableAsar } : {}),
    macos: await collectMacosIdentity(),
    officialStable,
  };
  row.sourceMetadata = await collectSourceMetadata(
    row,
    officialStable,
    sourceEnvironment,
  );
  return row;
}

export async function productionArtifacts() {
  const entries = [
    "main.js",
    "manifest.json",
    "native/keychain.node",
    "native/source_observer.node",
    "styles.css",
    "worker.js",
  ];
  return Object.fromEntries(
    await Promise.all(
      entries.map(async (path) => [
        path,
        await artifact(join(pluginRoot, path)),
      ]),
    ),
  );
}

export async function installDisposableVault(vault, runtimeBundle) {
  const installed = join(vault, ".obsidian/plugins/chat-to-vault");
  await mkdir(join(installed, "native"), { recursive: true });
  for (const name of ["manifest.json", "styles.css", "worker.js"])
    await cp(join(pluginRoot, name), join(installed, name));
  for (const name of ["keychain.node", "source_observer.node"])
    await cp(join(pluginRoot, "native", name), join(installed, "native", name));
  await cp(runtimeBundle, join(installed, "main.js"));
  await writeFile(
    join(vault, ".obsidian/community-plugins.json"),
    JSON.stringify(["chat-to-vault"]),
  );
}
