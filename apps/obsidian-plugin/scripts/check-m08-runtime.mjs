/* global Buffer */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { URL } from "node:url";
import { format } from "prettier";
import { canonicalJson } from "./m07-runtime-provenance.mjs";
import {
  M08_PRODUCTION_ARTIFACT_PATHS,
  M08_CANDIDATE_MANIFEST_EXCLUSIONS,
  candidateBinding,
  sha256Canonical,
  validateM08CandidateManifest,
  validateM08RetainedPacket,
  validateM08RuntimeArtifacts,
  validateM08RuntimeEvidence,
} from "./m08-runtime-provenance.mjs";
import { prepareOfficialRuntimeSources } from "./prepare-official-runtime-sources.mjs";

const run = promisify(execFile);
const pluginRoot = new URL("..", import.meta.url).pathname;
const repositoryRoot = resolve(pluginRoot, "../..");
const hostHarness = new URL("./check-m08-host.mjs", import.meta.url).pathname;
const sterileRun = process.env.CHAT2VAULT_M08_STERILE_RUN === "1";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createCandidateSnapshot() {
  const root = await mkdtemp(join(tmpdir(), "chat2vault-m08-candidate-"));
  const indexPath = join(root, "index");
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    await run("git", ["read-tree", "HEAD"], { cwd: repositoryRoot, env });
    await run("git", ["add", "-A", "--", "."], {
      cwd: repositoryRoot,
      env,
    });
    const { stdout: staged } = await run("git", ["ls-files", "--stage", "-z"], {
      cwd: repositoryRoot,
      env,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    const entries = [];
    for (const record of staged.toString("utf8").split("\0")) {
      if (record === "") continue;
      const match = /^(\d{6}) ([0-9a-f]{40}) 0\t([\s\S]+)$/u.exec(record);
      if (match === null)
        throw new Error("candidate index contains an unmerged entry");
      const [, mode, objectId, path] = match;
      if (M08_CANDIDATE_MANIFEST_EXCLUSIONS.includes(path)) continue;
      const type = mode === "160000" ? "commit" : "blob";
      const bytes =
        type === "commit"
          ? Buffer.from(objectId, "utf8")
          : (
              await run("git", ["cat-file", "blob", objectId], {
                cwd: repositoryRoot,
                encoding: "buffer",
                maxBuffer: 64 * 1024 * 1024,
              })
            ).stdout;
      entries.push({
        path,
        mode,
        type,
        size: bytes.length,
        sha256: sha256(bytes),
      });
    }
    entries.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
    const { stdout: baseCommitOutput } = await run(
      "git",
      ["rev-parse", "HEAD"],
      {
        cwd: repositoryRoot,
      },
    );
    const authority = {
      schemaVersion: 1,
      baseCommit: baseCommitOutput.trim(),
      exclusions: [...M08_CANDIDATE_MANIFEST_EXCLUSIONS],
      entries,
    };
    const manifest = {
      ...authority,
      entryCount: entries.length,
      manifestDigest: sha256Canonical(authority),
    };
    const failures = validateM08CandidateManifest(manifest);
    if (failures.length !== 0)
      throw new Error(`candidate manifest invalid: ${failures.join("; ")}`);
    const { stdout: treeOutput } = await run("git", ["write-tree"], {
      cwd: repositoryRoot,
      env,
    });
    return { root, indexPath, tree: treeOutput.trim(), manifest };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function loadCandidateManifest() {
  const path = process.env.CHAT2VAULT_M08_CANDIDATE_MANIFEST;
  if (path === undefined) {
    const snapshot = await createCandidateSnapshot();
    try {
      return snapshot.manifest;
    } finally {
      await rm(snapshot.root, { recursive: true, force: true });
    }
  }
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const failures = validateM08CandidateManifest(manifest);
  if (failures.length !== 0)
    throw new Error(
      `injected candidate manifest invalid: ${failures.join("; ")}`,
    );
  return manifest;
}

async function runFromSterileCandidate() {
  const snapshot = await createCandidateSnapshot();
  const sterileRoot = join(snapshot.root, "worktree");
  const archivePath = join(snapshot.root, "candidate.tar");
  const manifestPath = join(snapshot.root, "candidate-manifest.json");
  try {
    await mkdir(sterileRoot);
    await writeFile(manifestPath, canonicalJson(snapshot.manifest), {
      mode: 0o600,
    });
    await run("git", ["archive", `--output=${archivePath}`, snapshot.tree], {
      cwd: repositoryRoot,
    });
    await run("tar", ["-xf", archivePath, "-C", sterileRoot]);
    await run("pnpm", ["install", "--offline", "--frozen-lockfile"], {
      cwd: sterileRoot,
      env: { ...process.env, CI: "true" },
      maxBuffer: 64 * 1024 * 1024,
    });
    await run("pnpm", ["--filter", "@chat2vault/core", "build"], {
      cwd: sterileRoot,
      env: { ...process.env, CI: "true" },
      maxBuffer: 64 * 1024 * 1024,
    });
    const childScript = join(
      sterileRoot,
      "apps/obsidian-plugin/scripts/check-m08-runtime.mjs",
    );
    const childArgs = process.argv.slice(2);
    const evidenceIndex = childArgs.indexOf("--evidence-file");
    if (evidenceIndex >= 0 && childArgs[evidenceIndex + 1] !== undefined)
      childArgs[evidenceIndex + 1] = resolve(childArgs[evidenceIndex + 1]);
    const result = await run(process.execPath, [childScript, ...childArgs], {
      cwd: sterileRoot,
      env: {
        ...process.env,
        CHAT2VAULT_M08_STERILE_RUN: "1",
        CHAT2VAULT_M08_CANDIDATE_MANIFEST: manifestPath,
      },
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  } finally {
    await rm(snapshot.root, { recursive: true, force: true });
  }
}

function requestedRow() {
  const index = process.argv.indexOf("--row");
  const row = index < 0 ? undefined : process.argv[index + 1];
  if (row !== "minimum" && row !== "stable")
    throw new Error("usage: check-m08-runtime.mjs --row minimum|stable");
  return row;
}

function safeArtifact(value) {
  if (value === undefined) return undefined;
  return { file: value.file, bytes: value.bytes, sha256: value.sha256 };
}

function sanitizePacket(packet, rowId, candidateManifest) {
  const row = packet.rows?.find(({ id }) => id === rowId);
  if (row === undefined) throw new Error("M08 runtime selected row missing");
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
      m08: row.m08,
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
    candidate: candidateBinding(candidateManifest),
  };
  const failures = validateM08RuntimeArtifacts(sanitized.productionArtifacts);
  failures.push(...validateM08RuntimeEvidence(sanitized.row.m08));
  if (failures.length !== 0)
    throw new Error(`M08 runtime evidence invalid: ${failures.join("; ")}`);
  return {
    ...sanitized,
    artifactHash: sha256(Buffer.from(canonicalJson(sanitized))),
  };
}

async function currentArtifacts() {
  return Object.fromEntries(
    await Promise.all(
      M08_PRODUCTION_ARTIFACT_PATHS.map(async (path) => {
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
}

async function verifyRetainedPackets(runtimeArtifact, candidateManifest) {
  const productionArtifacts = await currentArtifacts();
  const hashes = {};
  for (const rowId of ["minimum", "stable"]) {
    const path = join(
      repositoryRoot,
      `docs/evidence/m08-runtime-${rowId}.json`,
    );
    const text = (await readFile(path, "utf8")).trim();
    const packet = JSON.parse(text);
    const failures = validateM08RetainedPacket(
      packet,
      rowId,
      productionArtifacts,
      runtimeArtifact,
      candidateManifest,
    );
    if (failures.length !== 0)
      throw new Error(
        `M08 retained ${rowId} packet stale: ${failures.join("; ")}`,
      );
    hashes[rowId] = sha256(Buffer.from(text));
  }
  return hashes;
}

const artifactsOnly = process.argv.includes("--artifacts-only");
const row = artifactsOnly ? "minimum" : requestedRow();
if (!artifactsOnly && !sterileRun) {
  await runFromSterileCandidate();
  process.exitCode = 0;
} else {
  const candidateManifest = await loadCandidateManifest();
  const temporaryRoot = await mkdtemp(
    join(pluginRoot, "scripts/.m08-runtime-driver-"),
  );
  let failure;
  try {
    const officialSourceEnv = artifactsOnly
      ? {}
      : await prepareOfficialRuntimeSources(temporaryRoot);
    const failureIndex = process.argv.indexOf("--failure-file");
    const requestedFailureFile =
      failureIndex < 0 ? undefined : process.argv[failureIndex + 1];
    const defaultFailureFile = resolve(
      join(tmpdir(), `chat2vault-m08-host-failure-${row}.json`),
    );
    const result = await run(
      process.execPath,
      [
        hostHarness,
        ...(artifactsOnly
          ? ["--artifacts-only"]
          : [
              "--row",
              row,
              "--failure-file",
              resolve(requestedFailureFile ?? defaultFailureFile),
            ]),
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, ...officialSourceEnv },
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (artifactsOnly) {
      const identityLine = result.stdout
        .split("\n")
        .find((candidate) => candidate.startsWith("M08_RUNTIME_ARTIFACT="));
      if (identityLine === undefined)
        throw new Error("M08 exact runtime artifact identity missing");
      const runtimeArtifact = JSON.parse(
        identityLine.slice("M08_RUNTIME_ARTIFACT=".length),
      );
      const retainedHashes = await verifyRetainedPackets(
        runtimeArtifact,
        candidateManifest,
      );
      const line = result.stdout
        .split("\n")
        .find((candidate) =>
          candidate.startsWith("M08 runtime artifact gate passed"),
        );
      if (line === undefined)
        throw new Error("M08 runtime artifact result missing");
      process.stdout.write(`${line}\n`);
      process.stdout.write(
        `M08 retained packet hashes: minimum=${retainedHashes.minimum}; stable=${retainedHashes.stable}.\n`,
      );
    } else {
      const line = result.stdout
        .split("\n")
        .findLast((candidate) => candidate.startsWith('{"status":"PASS"'));
      if (line === undefined) throw new Error("M08 runtime packet missing");
      const sanitized = sanitizePacket(
        JSON.parse(line),
        row,
        candidateManifest,
      );
      const evidenceIndex = process.argv.indexOf("--evidence-file");
      const evidenceFile =
        evidenceIndex < 0 ? undefined : process.argv[evidenceIndex + 1];
      if (evidenceIndex >= 0 && evidenceFile === undefined)
        throw new Error("--evidence-file requires a path");
      if (evidenceFile !== undefined) {
        const destination = resolve(evidenceFile);
        await mkdir(resolve(destination, ".."), { recursive: true });
        const formattedPacket = await format(
          canonicalJson({ ...sanitized, artifactHash: undefined }),
          { parser: "json" },
        );
        await writeFile(destination, formattedPacket, { mode: 0o600 });
      }
      const text = JSON.stringify(sanitized);
      if (
        text.includes(repositoryRoot) ||
        text.includes("/Users/") ||
        text.includes("Synthetic manual capture") ||
        text.includes("Synthetic staged capture text")
      )
        throw new Error("M08 runtime packet privacy scan failed");
      process.stdout.write(`${text}\n`);
    }
  } catch (error) {
    failure = error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  if (failure !== undefined) throw failure;
}
