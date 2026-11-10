/* global Buffer, WebSocket, clearTimeout, fetch, setTimeout */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);

const FAILURE_INPUT_KEYS = Object.freeze([
  "commandId",
  "error",
  "executable",
  "failedAt",
  "listenerPids",
  "pid",
  "port",
  "processState",
  "row",
  "sessionId",
  "stage",
  "startedAt",
  "stderr",
  "targetId",
]);

const READINESS_DIAGNOSTIC_INPUT_KEYS = Object.freeze([
  "capturedAt",
  "commandId",
  "host",
  "listenerPids",
  "renderer",
  "row",
  "sessionId",
  "stage",
  "target",
]);

function exactOwnKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function safeToken(value, fallback = "unclassified") {
  if (typeof value !== "string") return fallback;
  const safe = value.replaceAll(/[^A-Za-z0-9_.-]/gu, "-").slice(0, 80);
  return safe === "" ? fallback : safe;
}

function classifyStderr(stderr) {
  const text = stderr.toLowerCase();
  if (/another instance|single.?instance|profile.*lock|singleton/u.test(text))
    return "single-instance";
  if (/code.?sign|signature|killed:\s*9/u.test(text)) return "code-signing";
  if (/permission denied|eacces|operation not permitted/u.test(text))
    return "permission";
  if (/segmentation|sigabrt|abort|crash/u.test(text)) return "crash";
  if (/asar.*(?:missing|not found)|enoent/u.test(text))
    return "artifact-missing";
  if (/sandbox/u.test(text)) return "sandbox";
  return "unclassified";
}

export function selectFreshTarget(targets, predicate, staleTargetIds) {
  if (!Array.isArray(targets)) return undefined;
  return targets.find((candidate) => {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      typeof candidate.id !== "string" ||
      staleTargetIds.has(candidate.id) ||
      typeof candidate.webSocketDebuggerUrl !== "string" ||
      candidate.webSocketDebuggerUrl === ""
    )
      return false;
    try {
      return predicate(candidate);
    } catch {
      return false;
    }
  });
}

export function assertFreshLaunchIdentity(previous, current) {
  if (
    !Number.isSafeInteger(previous?.pid) ||
    !Number.isSafeInteger(current?.pid) ||
    current.pid === previous.pid ||
    !Array.isArray(current.listenerPids) ||
    !current.listenerPids.includes(current.pid) ||
    current.targetId === previous.targetId ||
    current.sessionId === previous.sessionId
  )
    throw new Error("M08 fresh host identity was not established");
}

export function makeHostFailureRecord(value) {
  if (!exactOwnKeys(value, FAILURE_INPUT_KEYS))
    throw new Error("M08 failure record input is not closed");
  const stderr = typeof value.stderr === "string" ? value.stderr : "";
  const retained = Buffer.from(stderr).subarray(0, 8_192);
  const error = value.error;
  const errorClass =
    error instanceof Error
      ? safeToken(error.name, "Error").replaceAll(/[^A-Za-z]/gu, "") || "Error"
      : "Unknown";
  const errorCode =
    error !== null && typeof error === "object" && "code" in error
      ? safeToken(String(error.code), "UNCLASSIFIED")
      : "UNCLASSIFIED";
  const processState = value.processState;
  if (!exactOwnKeys(processState, ["alive", "exitCode", "exited", "signal"]))
    throw new Error("M08 failure record process state is not closed");
  return {
    schemaVersion: 1,
    row: safeToken(value.row),
    stage: safeToken(value.stage),
    commandId: Number.isSafeInteger(value.commandId) ? value.commandId : 0,
    targetId: safeToken(value.targetId, "none"),
    sessionId: safeToken(value.sessionId, "none"),
    pid: Number.isSafeInteger(value.pid) ? value.pid : 0,
    executable: basename(String(value.executable ?? "unknown")).replaceAll(
      /[^A-Za-z0-9_.-]/gu,
      "-",
    ),
    port: Number.isSafeInteger(value.port) ? value.port : 0,
    listenerPids: Array.isArray(value.listenerPids)
      ? value.listenerPids.filter(Number.isSafeInteger)
      : [],
    processState: {
      alive: processState.alive === true,
      exited: processState.exited === true,
      exitCode: Number.isInteger(processState.exitCode)
        ? processState.exitCode
        : null,
      signal:
        typeof processState.signal === "string"
          ? safeToken(processState.signal, "none")
          : null,
    },
    startedAt: new Date(String(value.startedAt)).toISOString(),
    failedAt: new Date(String(value.failedAt)).toISOString(),
    stderrSummary: {
      category: classifyStderr(retained.toString("utf8")),
      bytes: Buffer.byteLength(stderr),
      truncated: Buffer.byteLength(stderr) > retained.length,
    },
    errorClass,
    errorCode,
  };
}

export function hostFailureStage(error, fallback) {
  const match =
    error instanceof Error
      ? /(?:^|\s)stage=([A-Za-z0-9_.-]{1,80})(?:\s|$)/u.exec(error.message)
      : null;
  return match?.[1] ?? safeToken(fallback);
}

function projectProcessSample(value) {
  if (!exactOwnKeys(value, ["alive", "elapsed", "pid", "state"]))
    throw new Error("M08 readiness diagnostic process sample is not closed");
  return {
    pid: Number.isSafeInteger(value.pid) && value.pid > 0 ? value.pid : 0,
    alive: value.alive === true,
    state:
      typeof value.state === "string" &&
      /^[A-Za-z0-9+<>-]{1,16}$/u.test(value.state)
        ? value.state
        : "unavailable",
    elapsed:
      typeof value.elapsed === "string" &&
      /^[0-9:-]{1,32}$/u.test(value.elapsed)
        ? value.elapsed
        : "unavailable",
  };
}

export function makeReadinessDiagnostic(value) {
  if (!exactOwnKeys(value, READINESS_DIAGNOSTIC_INPUT_KEYS))
    throw new Error("M08 readiness diagnostic input is not closed");
  if (!exactOwnKeys(value.target, ["id", "type", "urlScheme"]))
    throw new Error("M08 readiness diagnostic target is not closed");
  return {
    schemaVersion: 1,
    row: safeToken(value.row),
    stage: safeToken(value.stage),
    commandId: Number.isSafeInteger(value.commandId) ? value.commandId : 0,
    host: projectProcessSample(value.host),
    renderer: projectProcessSample(value.renderer),
    listenerPids: Array.isArray(value.listenerPids)
      ? value.listenerPids.filter((pid) => Number.isSafeInteger(pid) && pid > 0)
      : [],
    target: {
      id: safeToken(value.target.id, "none"),
      type: safeToken(value.target.type, "none"),
      urlScheme: safeToken(value.target.urlScheme, "none"),
    },
    sessionId: safeToken(value.sessionId, "none"),
    capturedAt: new Date(String(value.capturedAt)).toISOString(),
    stackSample: "skipped-privacy",
  };
}

export async function processLivenessSample(pid) {
  const validPid = Number.isSafeInteger(pid) && pid > 0 ? pid : 0;
  let alive = false;
  if (validPid > 0) {
    try {
      process.kill(validPid, 0);
      alive = true;
    } catch {
      alive = false;
    }
  }
  let state = "unavailable";
  let elapsed = "unavailable";
  if (alive) {
    try {
      const { stdout } = await run(
        "/bin/ps",
        ["-p", String(validPid), "-o", "state=,etime="],
        { timeout: 2_000 },
      );
      const match = /^\s*([^\s]{1,16})\s+([0-9:-]{1,32})\s*$/u.exec(stdout);
      if (match !== null) {
        state = match[1];
        elapsed = match[2];
      }
    } catch {
      // Preserve only the independently established liveness bit.
    }
  }
  return { pid: validPid, alive, state, elapsed };
}

export async function listenerPids(port) {
  try {
    const { stdout } = await run(
      "/usr/sbin/lsof",
      ["-nP", `-iTCP:${String(port)}`, "-sTCP:LISTEN", "-Fp"],
      { timeout: 2_000 },
    );
    return [
      ...new Set(
        stdout
          .split("\n")
          .map((line) => /^p([0-9]+)$/u.exec(line)?.[1] ?? "")
          .filter((value) => value !== "")
          .map(Number)
          .filter((value) => Number.isSafeInteger(value) && value > 0),
      ),
    ].sort((left, right) => left - right);
  } catch {
    return [];
  }
}

export async function waitForListenerOwner(port, expectedPid, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const owners = await listenerPids(port);
    if (owners.includes(expectedPid)) return owners;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("M08 DevTools listener ownership unavailable");
}

export async function waitForListenerRelease(port, priorPids, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const owners = await listenerPids(port);
    if (owners.every((pid) => !priorPids.includes(pid))) return owners;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("M08 stale DevTools listener remains owned");
}

export function observeChildLifecycle(child, stderrByteCap = 8_192) {
  const stderrChunks = [];
  let stderrBytes = 0;
  let stderrTruncated = false;
  let stderrText = "";
  let exited = false;
  let exitCode = null;
  let signal = null;
  let resolveExit;
  const exitObserved = new Promise((resolve) => {
    resolveExit = resolve;
  });
  child.stderr?.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stderrText += bytes.toString("utf8");
    if (stderrBytes >= stderrByteCap) {
      stderrTruncated ||= bytes.length > 0;
      return;
    }
    const retained = bytes.subarray(0, stderrByteCap - stderrBytes);
    stderrTruncated ||= retained.length < bytes.length;
    stderrChunks.push(retained);
    stderrBytes += retained.length;
  });
  child.on("exit", (code, exitSignal) => {
    exited = true;
    exitCode = Number.isInteger(code) ? code : null;
    signal = typeof exitSignal === "string" ? safeToken(exitSignal) : null;
    resolveExit();
  });
  return {
    snapshot() {
      return {
        alive: !exited && child.exitCode === null && child.signalCode === null,
        exited,
        exitCode,
        signal,
      };
    },
    stderr() {
      return {
        text: stderrText,
        category: classifyStderr(Buffer.concat(stderrChunks).toString("utf8")),
        bytes: Buffer.byteLength(stderrText),
        truncated: stderrTruncated,
      };
    },
    async waitForExit(timeoutMs) {
      if (exited) return true;
      let timer;
      const timedOut = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      const observed = await Promise.race([
        exitObserved.then(() => true),
        timedOut,
      ]);
      clearTimeout(timer);
      return observed === true || exited;
    },
  };
}

export async function stopDirectChild(child, lifecycle) {
  if (!lifecycle.snapshot().exited) child.kill("SIGTERM");
  let exited = await lifecycle.waitForExit(2_000);
  if (!exited && lifecycle.snapshot().alive) {
    child.kill("SIGKILL");
    exited = await lifecycle.waitForExit(2_000);
  }
  if (!exited && lifecycle.snapshot().alive)
    throw new Error("M08 runtime cleanup failed");
  await new Promise((resolve) => setTimeout(resolve, 250));
}

export async function connectDevtools({
  port,
  targetPredicate,
  staleTargetIds = new Set(),
  attempts = 80,
  commandTimeoutMs = 5_000,
}) {
  let target;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const targets = await fetch(
        `http://127.0.0.1:${String(port)}/json/list`,
      ).then((response) => response.json());
      target = selectFreshTarget(targets, targetPredicate, staleTargetIds);
      if (target !== undefined) break;
    } catch {
      // The exact isolated host is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (target === undefined)
    throw new Error("M08 fresh DevTools target unavailable");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, "open");
  const sessionId = randomUUID();
  let identifier = 0;
  const pending = new Map();
  const rejectPending = (reason) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    pending.clear();
  };
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const handlers = pending.get(message.id);
    if (handlers === undefined) return;
    pending.delete(message.id);
    clearTimeout(handlers.timer);
    handlers.resolve(message);
  });
  socket.addEventListener("close", () =>
    rejectPending(new Error("M08 DevTools connection closed")),
  );
  socket.addEventListener("error", () =>
    rejectPending(new Error("M08 DevTools connection failed")),
  );
  const command = (
    method,
    params = {},
    probeStage = method,
    timeoutMs = commandTimeoutMs,
  ) =>
    new Promise((resolve, reject) => {
      const id = ++identifier;
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        const error = new Error(
          `M08_CDP_COMMAND_TIMEOUT stage=${safeToken(probeStage)}`,
        );
        error.commandId = id;
        reject(error);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  try {
    await command("Runtime.enable", {}, "runtime-enable");
  } catch (error) {
    if (error !== null && typeof error === "object") {
      error.targetId = target.id;
      error.sessionId = sessionId;
    }
    throw error;
  }
  return {
    socket,
    command,
    targetId: target.id,
    targetType: safeToken(target.type, "none"),
    targetUrlScheme:
      /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(String(target.url))?.[1] ?? "none",
    sessionId,
    lastCommandId: () => identifier,
  };
}

export async function writeHostFailureRecord(path, value) {
  const record = makeHostFailureRecord(value);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  return record;
}

export async function writeReadinessDiagnostic(path, value) {
  const record = makeReadinessDiagnostic(value);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  return record;
}
