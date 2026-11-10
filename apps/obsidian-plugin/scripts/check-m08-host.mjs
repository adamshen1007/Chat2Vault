/* global setTimeout */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import {
  assertFreshLaunchIdentity,
  connectDevtools,
  hostFailureStage,
  listenerPids,
  observeChildLifecycle,
  processLivenessSample,
  stopDirectChild,
  waitForListenerOwner,
  waitForListenerRelease,
  writeHostFailureRecord,
  writeReadinessDiagnostic,
} from "./m08-host-primitives.mjs";
import {
  buildM08Evidence,
  installDisposableVault,
  prepareM08HostRow,
  productionArtifacts,
} from "./m08-host-preparation.mjs";
import { validateM07RuntimeSourceProvenance } from "./m07-runtime-provenance.mjs";
import { validateM08RuntimeEvidence } from "./m08-runtime-provenance.mjs";

const APP_EXPRESSION =
  'typeof app === "object" && app !== null && typeof app.workspace === "object" && typeof app.plugins === "object"';
let readinessDiagnosticRetained = false;

function requestedRow() {
  const index = process.argv.indexOf("--row");
  const row = index < 0 ? undefined : process.argv[index + 1];
  if (row !== "minimum" && row !== "stable")
    throw new Error("usage: check-m08-host.mjs --row minimum|stable");
  return row;
}

function failureFile(rowId) {
  const index = process.argv.indexOf("--failure-file");
  const path = index < 0 ? undefined : process.argv[index + 1];
  if (index >= 0 && path === undefined)
    throw new Error("--failure-file requires a path");
  return resolve(
    path ?? join(tmpdir(), `chat2vault-m08-host-failure-${rowId}.json`),
  );
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("M08 ephemeral port unavailable");
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}

async function createNetworkSentinel() {
  let attempts = 0;
  const server = createServer((socket) => {
    attempts += 1;
    socket.destroy();
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("M08 network sentinel unavailable");
  return {
    port: address.port,
    attempts: () => attempts,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

function stageLine(row, stage) {
  process.stderr.write(`M08_RUNTIME_STAGE ${row.id} ${stage}\n`);
}

async function setupVault(row, root, runtimeBundle, name) {
  const probeRoot = join(root, name);
  const profile = join(probeRoot, "profile");
  const vault = join(probeRoot, "vault");
  await mkdir(profile, { recursive: true });
  await mkdir(vault, { recursive: true });
  if (row.asarPath !== undefined)
    await cp(row.asarPath, join(profile, `obsidian-${row.version}.asar`));
  await installDisposableVault(vault, runtimeBundle);
  await writeFile(
    join(profile, "obsidian.json"),
    JSON.stringify({
      vaults: { synthetic: { path: vault, ts: Date.now(), open: true } },
    }),
  );
  return { profile, vault };
}

function launchHost(row, profile, vault, port, sentinelPort) {
  const startedAt = new Date().toISOString();
  const child = spawn(
    row.executable,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${String(port)}`,
      vault,
    ],
    {
      env: { ...process.env, C2V_M05_RUNTIME_PORT: String(sentinelPort) },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0)
    throw new Error("M08 disposable child PID unavailable");
  return {
    child,
    lifecycle: observeChildLifecycle(child),
    port,
    startedAt,
    listenerPids: [],
    targetId: "none",
    targetType: "none",
    targetUrlScheme: "none",
    sessionId: "none",
    rendererPid: 0,
    commandId: 0,
  };
}

async function retainReadinessDiagnostic(row, attempt, error, basePath) {
  if (readinessDiagnosticRetained) return;
  readinessDiagnosticRetained = true;
  try {
    const [host, renderer, owners] = await Promise.all([
      processLivenessSample(attempt.child.pid),
      processLivenessSample(attempt.rendererPid),
      listenerPids(attempt.port),
    ]);
    const suffix = `${row.id}-readiness-diagnostic-${Date.now()}.json`;
    const path = basePath.endsWith(".json")
      ? `${basePath.slice(0, -5)}-${suffix}`
      : `${basePath}-${suffix}`;
    await writeReadinessDiagnostic(path, {
      row: row.id,
      stage: "m08-application-ready",
      commandId:
        Number.isSafeInteger(error?.commandId) && error.commandId > 0
          ? error.commandId
          : attempt.commandId,
      host,
      renderer,
      listenerPids: owners,
      target: {
        id: attempt.targetId,
        type: attempt.targetType,
        urlScheme: attempt.targetUrlScheme,
      },
      sessionId: attempt.sessionId,
      capturedAt: new Date().toISOString(),
    });
    process.stderr.write(
      `M08_RUNTIME_READINESS_DIAGNOSTIC row=${row.id} file=${basename(path)}\n`,
    );
  } catch {
    process.stderr.write(
      `M08_RUNTIME_DIAGNOSTIC_SKIPPED row=${row.id} reason=privacy-safe-capture-unavailable\n`,
    );
  }
}

async function recordAttemptFailure(row, stage, attempt, error, basePath) {
  const suffix = `${row.id}-${stage}-${Date.now()}.json`;
  const path = basePath.endsWith(".json")
    ? `${basePath.slice(0, -5)}-${suffix}`
    : `${basePath}-${suffix}`;
  const stderr = attempt.lifecycle.stderr();
  await writeHostFailureRecord(path, {
    row: row.id,
    stage,
    commandId:
      Number.isSafeInteger(error?.commandId) && error.commandId > 0
        ? error.commandId
        : attempt.commandId,
    targetId: attempt.targetId,
    sessionId: attempt.sessionId,
    pid: attempt.child.pid,
    executable: row.executable,
    port: attempt.port,
    listenerPids: attempt.listenerPids,
    processState: attempt.lifecycle.snapshot(),
    startedAt: attempt.startedAt,
    failedAt: new Date().toISOString(),
    stderr: stderr.text,
    error,
  });
  process.stderr.write(
    `M08_RUNTIME_FAILURE_RECORD row=${row.id} stage=${stage} file=${basename(path)}\n`,
  );
}

async function commandValue(
  connection,
  expression,
  stage,
  awaitPromise = false,
) {
  const response = await connection.command(
    "Runtime.evaluate",
    { expression, awaitPromise, returnByValue: true },
    stage,
    awaitPromise ? 60_000 : 15_000,
  );
  connection.commandId = connection.lastCommandId();
  const details = response.result?.exceptionDetails;
  if (details !== undefined)
    throw new Error(
      `M08_CDP_EVALUATION_FAILED stage=${stage} class=Error code=RENDERER_EXCEPTION`,
    );
  return response.result?.result?.value;
}

async function connectApplication(
  row,
  attempt,
  failurePath,
  staleTargetIds = new Set(),
) {
  attempt.listenerPids = await waitForListenerOwner(
    attempt.port,
    attempt.child.pid,
  );
  const connection = await connectDevtools({
    port: attempt.port,
    staleTargetIds,
    attempts: 160,
    commandTimeoutMs: 15_000,
    targetPredicate: (candidate) =>
      candidate.type === "page" &&
      typeof candidate.url === "string" &&
      candidate.url.startsWith("app://obsidian.md"),
  });
  attempt.targetId = connection.targetId;
  attempt.targetType = connection.targetType;
  attempt.targetUrlScheme = connection.targetUrlScheme;
  attempt.sessionId = connection.sessionId;
  attempt.commandId = connection.lastCommandId();
  const connected = await commandValue(
    connection,
    "({rendererPid:process.pid,sessionId:(window.__c2vM08SessionId??=crypto.randomUUID())})",
    "m08-cdp-session-identity",
  );
  if (
    !Number.isSafeInteger(connected?.rendererPid) ||
    typeof connected?.sessionId !== "string"
  )
    throw new Error("M08 renderer session identity unavailable");
  attempt.rendererPid = connected.rendererPid;
  attempt.sessionId = connected.sessionId;
  let appReady = false;
  for (let index = 0; index < 80; index += 1) {
    try {
      appReady =
        (await commandValue(
          connection,
          APP_EXPRESSION,
          "m08-application-ready",
        )) === true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith(
          "M08_CDP_COMMAND_TIMEOUT stage=m08-application-ready",
        )
      )
        await retainReadinessDiagnostic(row, attempt, error, failurePath);
      throw error;
    }
    if (appReady) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  if (!appReady) throw new Error("M08 application API unavailable");
  const pluginReady = await commandValue(
    connection,
    '(async()=>{if(!app.workspace.layoutReady)await new Promise((resolve)=>app.workspace.onLayoutReady(resolve));await app.plugins.loadManifests();await app.plugins.setEnable(true);await app.plugins.loadPlugin("chat-to-vault");await app.plugins.enablePlugin("chat-to-vault");const plugin=app.plugins.plugins["chat-to-vault"];return Boolean(plugin&&typeof plugin.runM08RuntimeScenarios==="function"&&typeof plugin.prepareM08CrashProbe==="function")})()',
    "m08-plugin-ready",
    true,
  );
  if (pluginReady !== true) throw new Error("M08 plugin readiness unavailable");
  return connection;
}

async function stopAttempt(attempt) {
  await stopDirectChild(attempt.child, attempt.lifecycle);
  await waitForListenerRelease(attempt.port, attempt.listenerPids);
}

async function withAttempt(row, details, action, failurePath) {
  const attempt = launchHost(
    row,
    details.profile,
    details.vault,
    await unusedPort(),
    details.sentinelPort,
  );
  let stage = details.stage;
  try {
    stageLine(row, stage);
    return await action(attempt, (next) => {
      stage = next;
      stageLine(row, next);
    });
  } catch (error) {
    if (typeof error?.targetId === "string") attempt.targetId = error.targetId;
    if (typeof error?.sessionId === "string")
      attempt.sessionId = error.sessionId;
    await recordAttemptFailure(
      row,
      hostFailureStage(error, stage),
      attempt,
      error,
      failurePath,
    );
    throw error;
  } finally {
    if (attempt.lifecycle.snapshot().alive) await stopAttempt(attempt);
  }
}

function createViewExpression() {
  return 'let leaf=app.workspace.getLeavesOfType("chat-to-vault-preview")[0];if(!leaf){leaf=app.workspace.getLeaf("tab");await leaf.setViewState({type:"chat-to-vault-preview",active:true})}';
}

async function runCrashProbe(
  row,
  root,
  runtimeBundle,
  sentinel,
  effect,
  failurePath,
) {
  const fixture = await setupVault(row, root, runtimeBundle, `crash-${effect}`);
  let prepared;
  const beforeNetwork = sentinel.attempts();
  const killed = await withAttempt(
    row,
    {
      ...fixture,
      sentinelPort: sentinel.port,
      stage: `crash-${effect}-prepare`,
    },
    async (attempt, markStage) => {
      const connection = await connectApplication(row, attempt, failurePath);
      try {
        markStage(`crash-${effect}-boundary`);
        prepared = await commandValue(
          connection,
          `(async()=>{${createViewExpression()}const plugin=app.plugins.plugins["chat-to-vault"];return plugin.prepareM08CrashProbe(${JSON.stringify(effect)})})()`,
          `m08-crash-${effect}-prepare`,
          true,
        );
        if (
          prepared?.durable !== true ||
          prepared.targetPresent !== (effect === "published")
        )
          throw new Error("M08 crash boundary was not durably established");
        const identity = {
          pid: attempt.child.pid,
          targetId: attempt.targetId,
          sessionId: attempt.sessionId,
          port: attempt.port,
          listenerPids: [...attempt.listenerPids],
        };
        connection.socket.close();
        attempt.child.kill("SIGKILL");
        if (
          !(await attempt.lifecycle.waitForExit(5_000)) ||
          attempt.lifecycle.snapshot().signal !== "SIGKILL"
        )
          throw new Error("M08 exact disposable child did not exit by SIGKILL");
        await waitForListenerRelease(attempt.port, attempt.listenerPids);
        return identity;
      } finally {
        connection.socket.close();
      }
    },
    failurePath,
  );
  const recovered = await withAttempt(
    row,
    {
      ...fixture,
      sentinelPort: sentinel.port,
      stage: `crash-${effect}-recovery`,
    },
    async (attempt, markStage) => {
      const connection = await connectApplication(
        row,
        attempt,
        failurePath,
        new Set([killed.targetId]),
      );
      try {
        assertFreshLaunchIdentity(killed, {
          pid: attempt.child.pid,
          executable: basename(row.executable),
          targetId: attempt.targetId,
          sessionId: attempt.sessionId,
          listenerPids: attempt.listenerPids,
        });
        markStage(`crash-${effect}-inspect`);
        const value = await commandValue(
          connection,
          `(async()=>{${createViewExpression()}return app.plugins.plugins["chat-to-vault"].inspectM08CrashRecovery(${JSON.stringify(prepared.targetPath)})})()`,
          `m08-crash-${effect}-recovery`,
          true,
        );
        if (
          value?.unresolvedAtLoad !== true ||
          value.reloadBlocked !== true ||
          value.blockedWriteDelta !== 0 ||
          value.targetPresent !== (effect === "published") ||
          value.providerCalls !== 0
        )
          throw new Error("M08 crash recovery did not fail closed");
        return value;
      } finally {
        connection.socket.close();
      }
    },
    failurePath,
  );
  if (sentinel.attempts() !== beforeNetwork)
    throw new Error("M08 crash probe made a network attempt");
  return {
    targetPresent: recovered.targetPresent,
    reloadBlocked: true,
    blockedWriteDelta: 0,
    unresolvedAtLoad: true,
    providerCalls: 0,
    networkAttempts: 0,
    crashSignal: "SIGKILL",
  };
}

async function runClearFailureProbe(
  row,
  root,
  runtimeBundle,
  sentinel,
  failurePath,
) {
  const fixture = await setupVault(row, root, runtimeBundle, "clear-failure");
  const beforeNetwork = sentinel.attempts();
  const recovered = await withAttempt(
    row,
    {
      ...fixture,
      sentinelPort: sentinel.port,
      stage: "clear-failure-prepare",
    },
    async (attempt, markStage) => {
      const connection = await connectApplication(row, attempt, failurePath);
      try {
        const prepared = await commandValue(
          connection,
          `(async()=>{${createViewExpression()}return app.plugins.plugins["chat-to-vault"].prepareM08ClearFailureProbe()})()`,
          "m08-clear-failure-prepare",
          true,
        );
        if (
          prepared?.durable !== true ||
          prepared.targetPresent !== true ||
          prepared.saveEffect !== "published"
        )
          throw new Error("M08 clear-failure boundary unavailable");
        markStage("clear-failure-reload");
        const value = await commandValue(
          connection,
          `(async()=>{app.workspace.detachLeavesOfType("chat-to-vault-preview");await app.plugins.disablePlugin("chat-to-vault");await app.plugins.enablePlugin("chat-to-vault");${createViewExpression()}return app.plugins.plugins["chat-to-vault"].inspectM08CrashRecovery(${JSON.stringify(prepared.targetPath)})})()`,
          "m08-clear-failure-reload",
          true,
        );
        if (
          value?.unresolvedAtLoad !== true ||
          value.reloadBlocked !== true ||
          value.blockedWriteDelta !== 0 ||
          value.targetPresent !== true ||
          value.providerCalls !== 0
        )
          throw new Error("M08 clear-failure reload did not fail closed");
        return value;
      } finally {
        connection.socket.close();
      }
    },
    failurePath,
  );
  if (sentinel.attempts() !== beforeNetwork)
    throw new Error("M08 clear-failure probe made a network attempt");
  return {
    targetPresent: recovered.targetPresent,
    saveEffect: "published",
    reloadBlocked: true,
    blockedWriteDelta: 0,
    unresolvedAtLoad: true,
    providerCalls: 0,
    networkAttempts: 0,
    reloadMethod: "plugin-disable-enable",
  };
}

async function runNormalRow(
  row,
  root,
  runtimeBundle,
  sentinel,
  crashEvidence,
  failurePath,
) {
  const fixture = await setupVault(row, root, runtimeBundle, "normal");
  const beforeNetwork = sentinel.attempts();
  const value = await withAttempt(
    row,
    { ...fixture, sentinelPort: sentinel.port, stage: "normal-scenarios" },
    async (attempt, markStage) => {
      const connection = await connectApplication(row, attempt, failurePath);
      try {
        markStage("normal-fixture");
        const result = await commandValue(
          connection,
          `(async()=>{const plugin=app.plugins.plugins["chat-to-vault"];await plugin.prepareM08RuntimeVault();${createViewExpression()}const evidence=await plugin.runM08RuntimeScenarios();return{version:document.title.match(/Obsidian v?([0-9.]+)/u)?.[1],electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch,evidence}})()`,
          "m08-normal-scenarios",
          true,
        );
        if (
          result?.version !== row.version ||
          result.platform !== "darwin" ||
          result.arch !== "x64"
        )
          throw new Error("M08 runtime identity mismatch");
        return result;
      } finally {
        connection.socket.close();
      }
    },
    failurePath,
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  if (sentinel.attempts() !== beforeNetwork)
    throw new Error("M08 normal scenarios made a network attempt");
  const m08 = {
    ...value.evidence,
    reconciliation: crashEvidence,
  };
  const failures = validateM08RuntimeEvidence(m08);
  if (failures.length !== 0)
    throw new Error(`M08 runtime evidence invalid: ${failures.join("; ")}`);
  return {
    id: row.id,
    version: value.version,
    electron: value.electron,
    chromium: value.chromium,
    node: value.node,
    platform: value.platform,
    arch: value.arch,
    spawnedPid: 0,
    hostInstrumentation: row.hostInstrumentation,
    m08,
    mutationCount: m08.counts.created,
    persistenceViolationCount: m08.counts.reconciliationPersistenceAttempts,
    networkAttemptCount: 0,
    backgroundAttemptCount: 0,
    macos: row.macos,
    officialStable: row.officialStable,
    sourceMetadata: row.sourceMetadata,
  };
}

function assertCompleteRow(row) {
  const sourceFailures = validateM07RuntimeSourceProvenance(
    row.id,
    row.version,
    row.sourceMetadata,
  );
  const evidenceFailures = validateM08RuntimeEvidence(row.m08);
  if (
    sourceFailures.length !== 0 ||
    evidenceFailures.length !== 0 ||
    row.persistenceViolationCount !== 13 ||
    row.networkAttemptCount !== 0 ||
    row.backgroundAttemptCount !== 0
  )
    throw new Error(
      `M08 runtime acceptance predicate failed: ${JSON.stringify({ sourceFailures, evidenceFailures })}`,
    );
}

const artifactsOnly = process.argv.includes("--artifacts-only");
const rowId = artifactsOnly ? "minimum" : requestedRow();
const failurePath = failureFile(rowId);
const root = await realpath(
  await mkdtemp(join(tmpdir(), "chat2vault-m08-host-")),
);
let sentinel;
let failure;
try {
  const evidenceBuild = await buildM08Evidence(root);
  if (artifactsOnly) {
    process.stdout.write(
      `M08_RUNTIME_ARTIFACT=${JSON.stringify(evidenceBuild.runtime.artifact)}\n`,
    );
    process.stdout.write(
      `M08 runtime artifact gate passed (production=${evidenceBuild.production.artifact.sha256}; runtime=${evidenceBuild.runtime.artifact.sha256}).\n`,
    );
  } else {
    const rowAuthority = await prepareM08HostRow(rowId, root);
    sentinel = await createNetworkSentinel();
    const runtimeBundle = join(root, "runtime-test.js");
    const preparedBeforePublish = await runCrashProbe(
      rowAuthority,
      root,
      runtimeBundle,
      sentinel,
      "prepared",
      failurePath,
    );
    const publishedBeforeClear = await runCrashProbe(
      rowAuthority,
      root,
      runtimeBundle,
      sentinel,
      "published",
      failurePath,
    );
    const clearPersistenceFailure = await runClearFailureProbe(
      rowAuthority,
      root,
      runtimeBundle,
      sentinel,
      failurePath,
    );
    const row = await runNormalRow(
      rowAuthority,
      root,
      runtimeBundle,
      sentinel,
      {
        preparedBeforePublish,
        publishedBeforeClear,
        clearPersistenceFailure,
      },
      failurePath,
    );
    assertCompleteRow(row);
    process.stdout.write(
      `${JSON.stringify({
        status: "PASS",
        rows: [row],
        productionArtifacts: await productionArtifacts(),
        runtimeArtifact: evidenceBuild.runtime.artifact,
      })}\n`,
    );
  }
} catch (error) {
  failure = error;
} finally {
  if (sentinel !== undefined) await sentinel.close();
  await rm(root, { recursive: true, force: true });
}
if (failure !== undefined) throw failure;
