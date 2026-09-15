/* global Buffer, URL, WebSocket, clearTimeout, fetch, setTimeout */
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:https";
import { homedir, networkInterfaces, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import process from "node:process";
import esbuild from "esbuild";
import { compareM05RuntimeArtifacts } from "./compare-m05-runtime-artifact.mjs";

const run = promisify(execFile);
const pluginRoot = new URL("..", import.meta.url).pathname;
const repositoryRoot = resolve(pluginRoot, "../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );

async function artifact(path) {
  const bytes = await readFile(path);
  return { file: basename(path), bytes: bytes.length, sha256: sha256(bytes) };
}

const requiredAuthorities = {
  m05: {
    path: "docs/M05_SPEC.md",
    sha256: "895504880bc369bfbe64d60f60f675064f538458a563b2476fb9cf2e9c4876fd",
  },
  m05FileKeychainAmendment: {
    path: "docs/M05_FILE_KEYCHAIN_AMENDMENT.md",
    sha256: "0f3f24e43343705ec411730453b2e92acab75c32cb283d5737fc441163b4ba78",
  },
  m04: {
    path: "docs/M04_SPEC.md",
    sha256: "12a6fdd8346b80e1b015c099b78c2d26c3b736b6d09dfecc55254d648df5193c",
  },
  m031: {
    path: "docs/M03_MACOS_SCOPE_AMENDMENT.md",
    sha256: "6cd26a318e74e7299376020cbf37608a267bf903d068aacf6debdfdc5bc02dad",
  },
};

async function collectAuthorityEvidence() {
  const evidence = {};
  for (const [id, authority] of Object.entries(requiredAuthorities)) {
    const identity = await artifact(join(repositoryRoot, authority.path));
    if (identity.sha256 !== authority.sha256)
      throw new Error(`M05 runtime authority mismatch: ${id}`);
    evidence[id] = { file: authority.path, ...identity };
  }
  return evidence;
}

async function resolveOfficialStableMetadata() {
  const response = await fetch(
    "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json",
    { cache: "no-store", redirect: "error" },
  );
  if (!response.ok)
    throw new Error(
      `M05_RUNTIME_HOST_BLOCKED: official stable metadata status ${String(response.status)}`,
    );
  const bytes = Buffer.from(await response.arrayBuffer());
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (
    typeof parsed.latestVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(parsed.latestVersion) ||
    typeof parsed.downloadUrl !== "string" ||
    typeof parsed.hash !== "string"
  )
    throw new Error(
      "M05_RUNTIME_HOST_BLOCKED: official stable metadata invalid",
    );
  const expectedAsset = `obsidian-${parsed.latestVersion}.asar.gz`;
  const download = new URL(parsed.downloadUrl);
  if (
    download.protocol !== "https:" ||
    download.hostname !== "github.com" ||
    !download.pathname.endsWith(
      `/obsidianmd/obsidian-releases/releases/download/v${parsed.latestVersion}/${expectedAsset}`,
    )
  )
    throw new Error(
      "M05_RUNTIME_HOST_BLOCKED: official stable download metadata invalid",
    );
  return {
    sourceRepository: "obsidianmd/obsidian-releases",
    sourceFile: "desktop-releases.json",
    fetchedAt: new Date().toISOString(),
    metadataBytes: bytes.length,
    metadataSha256: sha256(bytes),
    latestVersion: parsed.latestVersion,
    releaseAsset: expectedAsset,
    releaseHash: parsed.hash,
  };
}

async function collectMacosIdentity() {
  const productVersion = (
    await run("sw_vers", ["-productVersion"])
  ).stdout.trim();
  const buildVersion = (await run("sw_vers", ["-buildVersion"])).stdout.trim();
  if (!productVersion || !buildVersion)
    throw new Error("M05 runtime macOS identity unavailable");
  return { productVersion, buildVersion };
}

async function collectObsidianSourceMetadata(row) {
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
  if (row.asarPath !== undefined) source.asar = await artifact(row.asarPath);
  return source;
}

async function buildEvidence(directory) {
  const worker = await readFile(join(pluginRoot, "worker.js"), "utf8");
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
  const trackedMain = await artifact(join(pluginRoot, "main.js"));
  if (
    trackedMain.bytes !== production.artifact.bytes ||
    trackedMain.sha256 !== production.artifact.sha256
  )
    throw new Error(
      "tracked main.js does not match the final production build",
    );
  return { production, runtime, comparison };
}

async function createCertificates(directory) {
  const caKey = join(directory, "ca.key");
  const caCertificate = join(directory, "ca.pem");
  const serverKey = join(directory, "server.key");
  const request = join(directory, "server.csr");
  const serverCertificate = join(directory, "server.pem");
  const extension = join(directory, "server.ext");
  await writeFile(
    extension,
    [
      "subjectAltName=DNS:m05.invalid",
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "subjectKeyIdentifier=hash",
      "authorityKeyIdentifier=keyid,issuer",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=Chat2Vault M05 Synthetic CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
    "-addext",
    "subjectKeyIdentifier=hash",
    "-keyout",
    caKey,
    "-out",
    caCertificate,
    "-days",
    "1",
  ]);
  await run("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=m05.invalid",
    "-keyout",
    serverKey,
    "-out",
    request,
  ]);
  await run("openssl", [
    "x509",
    "-req",
    "-in",
    request,
    "-CA",
    caCertificate,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    serverCertificate,
    "-days",
    "1",
    "-extfile",
    extension,
  ]);
  return {
    caKey,
    caCertificate,
    serverKey,
    serverCertificate,
    identities: {
      ca: await artifact(caCertificate),
      server: await artifact(serverCertificate),
    },
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
    for (const index of [2, 3]) {
      if (bytes[states + index] !== 0x30 && bytes[states + index] !== 0x31)
        throw new Error("Electron fuse state is not mutable");
      bytes[states + index] = 0x31;
    }
    instrumentedFuseStates.push(
      bytes.subarray(states, states + bytes[header + 1]).toString("ascii"),
    );
    offset = bytes.indexOf(sentinel, offset + sentinel.length);
  }
  if (originalFuseStates.length === 0)
    throw new Error("Electron fuse sentinel mismatch");
  await writeFile(framework, bytes);
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

async function connectDevtools(
  port,
  targetPredicate,
  attempts = 80,
  commandTimeoutMs = 5_000,
) {
  let target;
  let lastTargetCount = 0;
  let lastTargetTypes = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const targets = await fetch(
        `http://127.0.0.1:${String(port)}/json/list`,
      ).then((response) => response.json());
      if (Array.isArray(targets)) {
        lastTargetCount = targets.length;
        lastTargetTypes = [
          ...new Set(
            targets.map((candidate) =>
              typeof candidate?.type === "string"
                ? candidate.type.replaceAll(/[^A-Za-z0-9_-]/gu, "").slice(0, 32)
                : "unknown",
            ),
          ),
        ].filter((type) => type.length > 0);
        target = targets.find((candidate) => {
          try {
            return (
              targetPredicate(candidate) &&
              typeof candidate?.webSocketDebuggerUrl === "string" &&
              candidate.webSocketDebuggerUrl.length > 0
            );
          } catch {
            return false;
          }
        });
        if (target !== undefined) break;
      }
    } catch {
      // The isolated Obsidian renderer is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (target === undefined)
    throw new Error(
      `Obsidian DevTools target unavailable count=${String(lastTargetCount)} types=${lastTargetTypes.join(",") || "none"}`,
    );
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, "open");
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
    if (handlers !== undefined) {
      pending.delete(message.id);
      clearTimeout(handlers.timer);
      handlers.resolve(message);
    }
  });
  socket.addEventListener("close", () => {
    rejectPending(new Error("Obsidian DevTools connection closed"));
  });
  socket.addEventListener("error", () => {
    rejectPending(new Error("Obsidian DevTools connection failed"));
  });
  const command = (
    method,
    params = {},
    probeStage = method,
    timeoutMs = commandTimeoutMs,
  ) =>
    new Promise((resolve, reject) => {
      const id = ++identifier;
      const stage = String(probeStage)
        .replaceAll(/[^A-Za-z0-9_.-]/gu, "-")
        .slice(0, 48);
      const boundedTimeoutMs =
        Number.isSafeInteger(timeoutMs) && timeoutMs > 0
          ? timeoutMs
          : commandTimeoutMs;
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(
          new Error(`M05_CDP_COMMAND_TIMEOUT stage=${stage || "unclassified"}`),
        );
      }, boundedTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  await command("Runtime.enable", {}, "runtime-enable");
  return { socket, command, targetId: target.id };
}

function sanitizedProbeError(stage, error) {
  const errorClass =
    error instanceof Error
      ? error.name.replaceAll(/[^A-Za-z]/gu, "")
      : "Unknown";
  const rawCode =
    error !== null && typeof error === "object" && "code" in error
      ? String(error.code)
      : "UNCLASSIFIED";
  const code = rawCode.replaceAll(/[^A-Za-z0-9_-]/gu, "").slice(0, 48);
  return new Error(
    `M05_RUNTIME_PROBE_FAILED stage=${stage} class=${errorClass || "Error"} code=${code || "UNCLASSIFIED"}`,
  );
}

function sanitizedProbeMessage(stage, error) {
  return error instanceof Error &&
    (error.message.startsWith("M05_CDP_EVALUATION_FAILED") ||
      error.message.startsWith("M05_CDP_COMMAND_TIMEOUT") ||
      error.message.startsWith("M05_RUNTIME_PROBE_FAILED"))
    ? error.message
    : sanitizedProbeError(stage, error).message;
}

async function evaluateChecked(
  command,
  expression,
  stage,
  awaitPromise = false,
  timeoutMs,
) {
  const response = await command(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise,
      returnByValue: true,
    },
    stage,
    timeoutMs,
  );
  const details = response.result?.exceptionDetails;
  if (details !== undefined) {
    const detailText = String(details.text ?? "exception");
    const detailDescription = String(details.exception?.description ?? "");
    const settingsMarker = "M05_SETTINGS_SURFACE_UNAVAILABLE";
    const settingsStart = `${detailText} ${detailDescription}`.indexOf(
      settingsMarker,
    );
    const settingsDiagnosticMatch =
      stage === "settings-configure-focus" && settingsStart >= 0
        ? /^M05_SETTINGS_SURFACE_UNAVAILABLE(?: [A-Za-z]+=(?:true|false|[0-9]+)){33}/u.exec(
            `${detailText} ${detailDescription}`.slice(
              settingsStart,
              settingsStart + 1_024,
            ),
          )?.[0]
        : undefined;
    const settingsDiagnostic = settingsDiagnosticMatch
      ?.replace(" ownedTab=", " ownedTabExists=")
      .replace(" ownedTabContainer=", " ownedTabContainerPresent=");
    const text = String(settingsDiagnostic ?? detailText)
      .replaceAll(/[^A-Za-z0-9 _.-]/gu, "")
      .slice(0, settingsDiagnostic === undefined ? 80 : 1_024);
    throw new Error(
      `M05_CDP_EVALUATION_FAILED stage=${stage} text=${text || "exception"} line=${String(details.lineNumber ?? -1)} column=${String(details.columnNumber ?? -1)}`,
    );
  }
  return response.result?.result?.value;
}

function mainEvaluate(command, expression, stage, awaitPromise = false) {
  return evaluateChecked(command, expression, stage, awaitPromise);
}

async function verifyStandaloneTls(port, caCertificate, destination) {
  const script = `const https=require("node:https");const destination=process.argv[2];const request=https.request({hostname:"m05.invalid",port:Number(process.argv[1]),method:"POST",rejectUnauthorized:true,servername:"m05.invalid",agent:false,lookup:(_h,options,cb)=>options.all?cb(null,[{address:destination,family:4}]):cb(null,destination,4),headers:{"content-type":"application/json","content-length":"2"}},(response)=>{response.resume();response.once("end",()=>process.exit(response.statusCode===200?0:2))});request.once("error",(error)=>{process.stderr.write(String(error.code??"TLS_UNKNOWN"));process.exit(3)});request.end("{}");`;
  const result = await run(
    process.execPath,
    ["-e", script, String(port), destination],
    {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: caCertificate },
    },
  ).catch((error) => {
    throw new Error(
      `standalone inherited-CA TLS failed: ${String(error.stderr).trim()}`,
    );
  });
  return { outcome: "success", stdoutBytes: result.stdout.length };
}

function selectMismatchAddress() {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter(
      (entry) =>
        entry !== undefined && entry.family === "IPv4" && !entry.internal,
    )
    .map((entry) => entry.address)
    .sort();
  if (addresses.length === 0)
    throw new Error(
      "M05_RUNTIME_HOST_BLOCKED: no active external IPv4 interface",
    );
  return addresses[0];
}

async function dispatchTab(
  command,
  reverse = false,
  documentExpression = "document",
) {
  const modifiers = reverse ? 8 : 0;
  await command(
    "Input.dispatchKeyEvent",
    {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 48,
      modifiers,
    },
    reverse ? "focus-shift-tab-keydown" : "focus-tab-keydown",
  );
  await command(
    "Input.dispatchKeyEvent",
    {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 48,
      modifiers,
    },
    reverse ? "focus-shift-tab-keyup" : "focus-tab-keyup",
  );
  return evaluateChecked(
    command,
    `(()=>{const element=(${documentExpression}).activeElement;return element?element.getAttribute("aria-label")||element.textContent?.trim()||element.tagName:""})()`,
    reverse ? "focus-shift-tab" : "focus-tab",
  );
}

async function dismissRestrictedMode(command) {
  const target = await evaluateChecked(
    command,
    `(()=>{const modal=document.querySelector(".modal-container");const buttons=[...(modal?.querySelectorAll("button")??[])].filter((button)=>button.getClientRects().length>0);const restricted=buttons.length===2?buttons[0]:undefined;if(!restricted)return null;const rect=restricted.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()`,
    "restricted-mode-target",
  );
  if (Number.isFinite(target?.x) && Number.isFinite(target?.y)) {
    for (const type of ["mousePressed", "mouseReleased"])
      await command(
        "Input.dispatchMouseEvent",
        {
          type,
          x: target.x,
          y: target.y,
          button: "left",
          buttons: type === "mousePressed" ? 1 : 0,
          clickCount: 1,
        },
        `restricted-mode-${type}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await evaluateChecked(
    command,
    `(()=>{app.setting.close();return true})()`,
    "restricted-mode-settings-close",
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  const remaining = await evaluateChecked(
    command,
    `(()=>{const buttons=[...document.querySelectorAll(".modal-container button")].filter((button)=>button.getClientRects().length>0);const modalCount=[...document.querySelectorAll(".modal-container .modal")].filter((modal)=>modal.getClientRects().length>0).length;return{count:buttons.length,modalCount,classes:buttons.map((button)=>[...button.classList].sort().join(".").replaceAll(/[^A-Za-z0-9_.-]/gu,"").slice(0,80))}})()`,
    "restricted-mode-verify",
  );
  if (remaining?.count >= 2)
    throw new Error(
      `M05_RUNTIME_PROBE_FAILED stage=restricted-mode-dismiss class=Error code=MODAL_REMAINED count=${String(remaining.count)} modals=${String(remaining.modalCount)} classes=${remaining.classes.join(",")}`,
    );
}

async function fitSurfaceWidth(
  rendererCommand,
  mainCommand,
  surfaceExpression,
  windowExpression,
  stage,
) {
  const widths = [];
  const hostWidths = [];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const clientWidth = await evaluateChecked(
      rendererCommand,
      `${surfaceExpression}?.clientWidth??0`,
      `${stage}-measure`,
    );
    widths.push(clientWidth);
    if (clientWidth >= 358 && clientWidth <= 362)
      return { clientWidth, attempts: attempt + 1 };
    if (!Number.isFinite(clientWidth) || clientWidth <= 0)
      throw new Error(
        `M05_RUNTIME_PROBE_FAILED stage=${stage} class=Error code=INVALID_WIDTH`,
      );
    const previousWidth = widths.at(-2);
    const cssDelta = 360 - clientWidth;
    const physicalDelta =
      previousWidth === clientWidth
        ? Math.sign(cssDelta) * 96
        : Math.round(cssDelta * 2);
    const adjusted = await mainEvaluate(
      mainCommand,
      `(()=>{const electron=process.mainModule.require("electron");const window=${windowExpression};if(!window)throw new Error("surface window unavailable");const bounds=window.getContentBounds();const minimum=window.getMinimumSize();window.setMinimumSize(320,minimum[1]);const width=Math.max(320,bounds.width+${String(physicalDelta)});window.setContentBounds({...bounds,width});const applied=window.getContentBounds();return{width:applied.width,minimumWidth:window.getMinimumSize()[0],maximized:window.isMaximized(),fullScreen:window.isFullScreen()}})()`,
      `${stage}-resize`,
    );
    hostWidths.push(
      `${String(adjusted?.width ?? -1)}-${String(adjusted?.minimumWidth ?? -1)}-${String(adjusted?.maximized === true)}-${String(adjusted?.fullScreen === true)}`,
    );
    if (
      adjusted?.width === 320 &&
      previousWidth === clientWidth &&
      clientWidth !== 360
    )
      await evaluateChecked(
        rendererCommand,
        `(()=>{const surface=${surfaceExpression};if(!surface)throw new Error("surface unavailable");surface.style.boxSizing="border-box";surface.style.width="360px";surface.style.maxWidth="360px";return surface.clientWidth})()`,
        `${stage}-surface-constraint`,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `M05_RUNTIME_PROBE_FAILED stage=${stage} class=Error code=WIDTH_NOT_CONVERGED widths=${widths.map((width) => String(width)).join(",")} host=${hostWidths.join(",")}`,
  );
}

async function exerciseAccessibilityAndZoom(
  rendererCommand,
  mainCommand,
  rendererPort,
  workspaceTargetId,
  rowId,
  screenshotDirectory,
  runtimePort,
  markProbeStage,
) {
  let zoomStart;
  let result;
  let primaryFailure;
  let restorationFailure;
  const settingsFocus = [];
  const candidateFocus = [];
  const runtimeEndpoint = `https://m05.invalid:${String(runtimePort)}/v1/chat/completions`;
  let settingsDevtools;
  try {
    markProbeStage("ui-main-identify");
    const identity = await mainEvaluate(
      mainCommand,
      `(()=>{const electron=process.mainModule.require("electron");const candidates=electron.webContents.getAllWebContents().filter((item)=>item.getURL().startsWith("app://obsidian.md"));if(candidates.length!==1)throw new Error("exact Chat2Vault webContents unavailable");const contents=candidates[0];const window=electron.BrowserWindow.fromWebContents(contents);if(!window)throw new Error("exact Chat2Vault window unavailable");return{webContentsId:contents.id,initial:contents.getZoomFactor(),bounds:window.getContentBounds(),minimumSize:window.getMinimumSize()}})()`,
      "ui-main-identify",
    );
    zoomStart = identity;
    markProbeStage("ui-main-focus");
    const focus = await mainEvaluate(
      mainCommand,
      `(async()=>{const electron=process.mainModule.require("electron");const contents=electron.webContents.fromId(${String(identity?.webContentsId ?? -1)});const window=electron.BrowserWindow.fromWebContents(contents);if(!contents||!window)throw new Error("exact Chat2Vault focus target unavailable");electron.app.focus({steal:true});window.show();window.focus();contents.focus();await new Promise((resolve)=>setTimeout(resolve,250));const result={visible:window.isVisible(),focused:window.isFocused(),contentsFocused:contents.isFocused()};if(!result.visible||!result.focused||!result.contentsFocused)throw new Error("Chat2Vault focus assertion failed");return result})()`,
      "ui-main-focus",
      true,
    );
    Object.assign(zoomStart, focus);
    markProbeStage("ui-main-zoom-one");
    zoomStart.atOne = await mainEvaluate(
      mainCommand,
      `(()=>{const electron=process.mainModule.require("electron");const contents=electron.webContents.fromId(${String(identity?.webContentsId ?? -1)});if(!contents)throw new Error("Chat2Vault zoom target unavailable");contents.setZoomFactor(1);return contents.getZoomFactor()})()`,
      "ui-main-zoom-one",
    );
    markProbeStage("ui-main-zoom-two");
    zoomStart.atTwo = await mainEvaluate(
      mainCommand,
      `(()=>{const electron=process.mainModule.require("electron");const contents=electron.webContents.fromId(${String(identity?.webContentsId ?? -1)});if(!contents)throw new Error("Chat2Vault zoom target unavailable");contents.setZoomFactor(2);return contents.getZoomFactor()})()`,
      "ui-main-zoom-two",
    );
    markProbeStage("ui-settings-open-width");
    const settingsLocation = await evaluateChecked(
      rendererCommand,
      `(async()=>{app.setting.open();const opened=app.setting.openTabById("chat-to-vault");if(opened?.then)await opened;await new Promise((resolve)=>setTimeout(resolve,250));const tab=app.setting.pluginTabs?.find?.((candidate)=>candidate?.id==="chat-to-vault")??app.setting.settingTabs?.find?.((candidate)=>candidate?.id==="chat-to-vault");return{separate:tab?.containerEl?.ownerDocument!==document}})()`,
      "ui-settings-open-width",
      true,
    );
    await fitSurfaceWidth(
      rendererCommand,
      mainCommand,
      `app.setting.pluginTabs.find((candidate)=>candidate?.id==="chat-to-vault")?.containerEl?.querySelector(".c2v-provider-settings")`,
      `(()=>{const workspace=electron.webContents.fromId(${String(identity?.webContentsId ?? -1)});const windows=electron.BrowserWindow.getAllWindows().filter((candidate)=>candidate.isVisible()&&candidate.webContents.id!==workspace?.id);return windows.length===1?windows[0]:electron.BrowserWindow.fromWebContents(workspace)})()`,
      "ui-settings-width",
    );
    if (settingsLocation?.separate === true)
      settingsDevtools = await connectDevtools(
        rendererPort,
        (candidate) =>
          candidate.type === "page" && candidate.id !== workspaceTargetId,
        80,
      );
    const settingsCommand = settingsDevtools?.command ?? rendererCommand;
    markProbeStage("ui-settings-open-config-save-settle");
    await evaluateChecked(
      rendererCommand,
      `(async()=>{const boundedLayout=(stage)=>Promise.race([new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),new Promise((_,reject)=>setTimeout(()=>reject(new Error("bounded layout timeout "+stage)),1000))]);const pollLayout=(stage)=>Promise.race([boundedLayout(stage).catch(()=>undefined),new Promise((resolve)=>setTimeout(resolve,50))]);await pollLayout("settings-open-before");app.setting.open();const openResult=app.setting.openTabById("chat-to-vault");const openPromiseLike=openResult!==null&&(typeof openResult==="object"||typeof openResult==="function")&&typeof openResult.then==="function";if(openPromiseLike)await openResult;const settingsRoot=app.setting?.pluginTabs?.find?.((candidate)=>candidate?.id==="chat-to-vault")?.containerEl??app.setting?.settingTabs?.find?.((candidate)=>candidate?.id==="chat-to-vault")?.containerEl;const controlsDeadline=Date.now()+5000;let surface;let endpoint;let model;let disclosure;let controlsReady=false;while(Date.now()<controlsDeadline){await pollLayout("settings-controls");surface=settingsRoot?.querySelector('.c2v-provider-settings');endpoint=settingsRoot?.querySelector('[aria-label="Provider endpoint"]');model=settingsRoot?.querySelector('[aria-label="Provider model"]');disclosure=settingsRoot?.querySelector('[aria-label="Accept cloud data disclosure"]');controlsReady=surface?.getClientRects().length>0&&endpoint?.getClientRects().length>0&&model?.getClientRects().length>0&&disclosure?.getClientRects().length>0&&surface.contains(endpoint)&&surface.contains(model)&&surface.contains(disclosure);if(controlsReady)break}if(!controlsReady||!endpoint||!model||!disclosure){const tabsValue=app.setting?.settingTabs;const tabsArray=Array.isArray(tabsValue);const tabs=tabsArray?tabsValue:[];const tabsObjects=tabs.every((tab)=>tab!==null&&typeof tab==="object");const pluginTabsValue=app.setting?.pluginTabs;const pluginTabsArray=Array.isArray(pluginTabsValue);const pluginTabs=pluginTabsArray?pluginTabsValue:[];const combinedTabs=[...tabs,...pluginTabs];const plugin=app.plugins?.plugins?.['chat-to-vault'];const pluginExactTab=pluginTabs.find((tab)=>tab?.id==="chat-to-vault");const exactTab=combinedTabs.find((tab)=>tab?.id==="chat-to-vault");const ownedTab=pluginTabs.find((tab)=>tab?.plugin===plugin);const ref=plugin?.runtimeSettingTab;const directEntry=pluginTabs.find((entry)=>entry===ref);const tabEntry=pluginTabs.find((entry)=>entry?.tab===ref);const settingTabEntry=pluginTabs.find((entry)=>entry?.settingTab===ref);const instanceEntry=pluginTabs.find((entry)=>entry?.instance===ref);const settingEntry=pluginTabs.find((entry)=>entry?.setting===ref);const containerEntry=ref?.containerEl?pluginTabs.find((entry)=>entry?.containerEl===ref.containerEl):undefined;const matchedEntry=directEntry??tabEntry??settingTabEntry??instanceEntry??settingEntry??containerEntry;const visible=(element)=>Boolean(element?.getClientRects?.().length);throw new Error("M05_SETTINGS_SURFACE_UNAVAILABLE setting="+String(Boolean(app.setting))+" open="+String(visible(app.setting?.containerEl))+" tabsArray="+String(tabsArray)+" tabsObjects="+String(tabsObjects)+" tabCount="+String(tabs.length)+" pluginTabsArray="+String(pluginTabsArray)+" pluginTabCount="+String(pluginTabs.length)+" pluginExactTab="+String(Boolean(pluginExactTab))+" exactTab="+String(Boolean(exactTab))+" tabSurface="+String(Boolean(exactTab?.containerEl?.contains?.(surface)))+" ownedTab="+String(Boolean(ownedTab))+" ownedTabIdPresent="+String(typeof ownedTab?.id==="string"&&ownedTab.id.length>0)+" ownedTabIdExact="+String(ownedTab?.id==="chat-to-vault")+" ownedTabContainer="+String(Boolean(ownedTab?.containerEl))+" refPresent="+String(Boolean(ref))+" directIdentity="+String(Boolean(directEntry))+" tabIdentity="+String(Boolean(tabEntry))+" settingTabIdentity="+String(Boolean(settingTabEntry))+" instanceIdentity="+String(Boolean(instanceEntry))+" settingIdentity="+String(Boolean(settingEntry))+" containerIdentity="+String(Boolean(containerEntry))+" matchedIdPresent="+String(typeof matchedEntry?.id==="string"&&matchedEntry.id.length>0)+" matchedIdExact="+String(matchedEntry?.id==="chat-to-vault")+" surface="+String(Boolean(surface))+" surfaceVisible="+String(visible(surface))+" endpoint="+String(Boolean(endpoint))+" endpointVisible="+String(visible(endpoint))+" model="+String(Boolean(model))+" modelVisible="+String(visible(model))+" disclosure="+String(Boolean(disclosure))+" disclosureVisible="+String(visible(disclosure))+" activeExact="+String(app.setting?.activeTab?.id==="chat-to-vault")+" promiseLike="+String(openPromiseLike))}window.__c2vM05SettingsStatus=settingsRoot.querySelector('.c2v-provider-settings [role="status"]');endpoint.value=${JSON.stringify(runtimeEndpoint)};endpoint.dispatchEvent(new Event('input',{bubbles:true}));endpoint.dispatchEvent(new Event('change',{bubbles:true}));model.value="synthetic-m05-model";model.dispatchEvent(new Event('input',{bubbles:true}));model.dispatchEvent(new Event('change',{bubbles:true}));disclosure.checked=true;disclosure.dispatchEvent(new Event('change',{bubbles:true}));const save=[...settingsRoot.querySelectorAll('.c2v-provider-settings button')].find((button)=>button.textContent==='Save provider settings');if(!save||save.disabled)throw new Error("provider save control unavailable after configured setup");save.click();let settled=false;const saveDeadline=Date.now()+5000;while(Date.now()<saveDeadline){await pollLayout("provider-save-settle");const plugin=app.plugins.plugins['chat-to-vault'];const controls=[...settingsRoot.querySelectorAll('.c2v-provider-settings input,.c2v-provider-settings select,.c2v-provider-settings button')].filter((element)=>element.getClientRects().length>0);settled=plugin?.providerSettingsStatusCode!=="PROVIDER_SETTINGS_SAVING"&&controls.length===10&&controls.every((element)=>!element.disabled);if(settled)break}const enabledLabels=[...settingsRoot.querySelectorAll('.c2v-provider-settings input,.c2v-provider-settings select,.c2v-provider-settings button')].filter((element)=>!element.disabled&&element.getClientRects().length>0).map((element)=>element.getAttribute('aria-label')||element.textContent?.trim());window.__c2vM05ProviderSaveState={settled,enabledLabels};if(!settled)throw new Error("provider save did not settle to enabled configured controls");settingsRoot.querySelector('[aria-label="Provider endpoint"]')?.focus();return true})()`,
      "settings-configure-focus",
      true,
      15_000,
    );
    markProbeStage("ui-settings-final-width");
    await fitSurfaceWidth(
      rendererCommand,
      mainCommand,
      `app.setting.pluginTabs.find((candidate)=>candidate?.id==="chat-to-vault")?.containerEl?.querySelector(".c2v-provider-settings")`,
      `(()=>{const workspace=electron.webContents.fromId(${String(identity?.webContentsId ?? -1)});const windows=electron.BrowserWindow.getAllWindows().filter((candidate)=>candidate.isVisible()&&candidate.webContents.id!==workspace?.id);return windows.length===1?windows[0]:electron.BrowserWindow.fromWebContents(workspace)})()`,
      "ui-settings-final-width",
    );
    await evaluateChecked(
      rendererCommand,
      `(()=>{const root=app.setting.pluginTabs.find((candidate)=>candidate?.id==="chat-to-vault")?.containerEl;const endpoint=root?.querySelector('[aria-label="Provider endpoint"]');endpoint?.focus();return Boolean(endpoint)})()`,
      "settings-refocus-after-width",
    );
    markProbeStage("ui-settings-focus-traversal");
    settingsFocus.push(
      await evaluateChecked(
        settingsCommand,
        `document.activeElement?.getAttribute("aria-label")`,
        "settings-initial-focus",
      ),
    );
    for (let index = 0; index < 9; index += 1)
      settingsFocus.push(await dispatchTab(settingsCommand, false));
    const settingsReverse = await dispatchTab(settingsCommand, true);
    markProbeStage("ui-settings-geometry");
    const settingsGeometry = await evaluateChecked(
      rendererCommand,
      `(()=>{const root=app.setting.pluginTabs.find((candidate)=>candidate?.id==="chat-to-vault").containerEl;const controls=[...root.querySelectorAll('.c2v-provider-settings input,.c2v-provider-settings select,.c2v-provider-settings button')].filter((element)=>!element.disabled&&element.getClientRects().length>0);const panel=root.querySelector('.c2v-provider-settings');const status=root.querySelector('.c2v-provider-settings [role="status"]');const rect=(element)=>{const value=element.getBoundingClientRect();return{x:value.x,y:value.y,width:value.width,height:value.height,right:value.right,bottom:value.bottom}};return{clientWidth:panel?.clientWidth??0,scrollWidth:panel?.scrollWidth??0,bounds:rect(panel),controls:controls.map((element)=>({name:element.getAttribute('aria-label')||element.textContent?.trim(),rect:rect(element)})),providerSaveState:window.__c2vM05ProviderSaveState,status:status?{rect:rect(status),role:status.getAttribute('role'),live:status.getAttribute('aria-live'),atomic:status.getAttribute('aria-atomic'),persistent:status===window.__c2vM05SettingsStatus}:null,disclosure:rect(root.querySelector('.c2v-provider-disclosure'))}})()`,
      "settings-geometry",
    );
    markProbeStage("ui-candidate-open-focus");
    await evaluateChecked(
      rendererCommand,
      `(async()=>{app.setting.close();await new Promise((resolve)=>setTimeout(resolve,250));return true})()`,
      "candidate-settings-close",
      true,
    );
    await dismissRestrictedMode(rendererCommand);
    await evaluateChecked(
      rendererCommand,
      `(()=>{const leaf=app.workspace.getLeavesOfType('chat-to-vault-preview')[0];const view=leaf?.view;const prepare=document.querySelector('[aria-label="Prepare manual prompt"]');if(!view||!prepare)throw new Error("candidate view unavailable");prepare.focus();return true})()`,
      "candidate-initial-focus",
    );
    markProbeStage("ui-candidate-width");
    await fitSurfaceWidth(
      rendererCommand,
      mainCommand,
      `document.querySelector(".c2v-preview")`,
      `electron.BrowserWindow.fromWebContents(electron.webContents.fromId(${String(identity?.webContentsId ?? -1)}))`,
      "ui-candidate-width",
    );
    await evaluateChecked(
      rendererCommand,
      `document.querySelector('[aria-label="Prepare manual prompt"]')?.focus()`,
      "candidate-refocus-after-width",
    );
    candidateFocus.push(
      await evaluateChecked(
        rendererCommand,
        `document.activeElement?.getAttribute("aria-label")`,
        "candidate-focus-readback",
      ),
    );
    markProbeStage("ui-candidate-focus-traversal");
    for (let index = 0; index < 4; index += 1)
      candidateFocus.push(await dispatchTab(rendererCommand));
    const candidateReverse = await dispatchTab(rendererCommand, true);
    markProbeStage("ui-candidate-geometry");
    const candidateGeometry = await evaluateChecked(
      rendererCommand,
      `(()=>{const root=document.querySelector('.c2v-preview');const selectors=['[aria-label="Prepare manual prompt"]','[aria-label="Copy prompt"]','[aria-label="Paste strict JSON"]','[aria-label="Validate result"]','.c2v-provider-distill','.c2v-provider-cancel','.c2v-candidate-preview','[aria-label="Previous page"]','[aria-label="Next page"]','.c2v-provider-preflight','.c2v-provider-status'];const rect=(element)=>{const value=element.getBoundingClientRect();return{x:value.x,y:value.y,width:value.width,height:value.height,right:value.right,bottom:value.bottom}};return{clientWidth:root?.clientWidth??0,scrollWidth:root?.scrollWidth??0,bounds:rect(root),rectangles:selectors.map((selector)=>{const element=document.querySelector(selector);return element&&element.getClientRects().length>0?{selector,rect:rect(element),disabled:Boolean(element.disabled)}:null}).filter(Boolean),livePersistent:document.querySelector('.c2v-preview [role="status"]')===window.__c2vM05ViewStatus}})()`,
      "candidate-geometry",
    );
    markProbeStage("ui-screenshot-window-restore");
    await mainEvaluate(
      mainCommand,
      `(()=>{const electron=process.mainModule.require("electron");const contents=electron.webContents.fromId(${String(identity?.webContentsId ?? -1)});const window=electron.BrowserWindow.fromWebContents(contents);if(!window)throw new Error("Chat2Vault screenshot window unavailable");window.setContentBounds(${JSON.stringify(identity?.bounds)});return window.getContentBounds()})()`,
      "ui-screenshot-window-restore",
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    markProbeStage("ui-screenshot");
    const screenshot = join(screenshotDirectory, `${rowId}-200-percent.png`);
    const capture = await evaluateChecked(
      mainCommand,
      `(async()=>{const electron=process.mainModule.require("electron");const fs=process.mainModule.require("node:fs");const contents=electron.webContents.fromId(${String(identity?.webContentsId ?? -1)});if(!contents)throw new Error("Chat2Vault screenshot contents unavailable");const image=await contents.capturePage();const bytes=image.toPNG();fs.writeFileSync(${JSON.stringify(screenshot)},bytes);return{bytes:bytes.length}})()`,
      "screenshot-capture",
      true,
      30_000,
    );
    if (!Number.isSafeInteger(capture?.bytes) || capture.bytes <= 0)
      throw new Error(
        "M05_RUNTIME_PROBE_FAILED stage=screenshot-capture class=Error code=EMPTY_SCREENSHOT",
      );
    const settingsFocusPassed =
      settingsFocus.join("|") ===
        "Provider endpoint|Provider model|Provider timeout|Maximum output tokens|Accept cloud data disclosure|Save provider settings|Provider API key|Save API key|Delete API key|Refresh Keychain status" &&
      settingsReverse === "Delete API key";
    const candidateFocusPassed =
      candidateFocus.join("|") ===
        "Prepare manual prompt|Copy prompt|Paste strict JSON|Distill with provider|Candidates per page" &&
      candidateReverse === "Distill with provider";
    result = {
      zoom: zoomStart,
      accessibility: {
        passed: settingsFocusPassed && candidateFocusPassed,
        settingsFocusPassed,
        candidateFocusPassed,
        settingsFocus,
        settingsReverse,
        candidateFocus,
        candidateReverse,
        settings: settingsGeometry,
        candidate: candidateGeometry,
      },
      screenshot: await artifact(screenshot),
    };
  } catch (error) {
    primaryFailure = error;
  } finally {
    settingsDevtools?.socket.close();
    if (Number.isSafeInteger(zoomStart?.webContentsId)) {
      try {
        markProbeStage("ui-main-zoom-restore");
        zoomStart.restored = await mainEvaluate(
          mainCommand,
          `(()=>{const electron=process.mainModule.require("electron");const contents=electron.webContents.fromId(${String(zoomStart.webContentsId)});if(!contents)throw new Error("Chat2Vault webContents lost before zoom restore");const window=electron.BrowserWindow.fromWebContents(contents);if(!window)throw new Error("Chat2Vault window lost before bounds restore");contents.setZoomFactor(1);window.setMinimumSize(...${JSON.stringify(zoomStart.minimumSize)});window.setContentBounds(${JSON.stringify(zoomStart.bounds)});return contents.getZoomFactor()})()`,
          "main-zoom-restore",
        );
      } catch (error) {
        restorationFailure = error;
      }
    }
  }
  if (primaryFailure !== undefined) {
    if (restorationFailure !== undefined)
      throw new Error(
        `${sanitizedProbeMessage("exercise", primaryFailure)}; restoration=${sanitizedProbeMessage("main-zoom-restore", restorationFailure)}`,
      );
    throw primaryFailure;
  }
  if (restorationFailure !== undefined)
    throw new Error(
      sanitizedProbeMessage("main-zoom-restore", restorationFailure),
    );
  if (result === undefined)
    throw new Error(
      "M05_RUNTIME_PROBE_FAILED stage=exercise class=Error code=NO_EVIDENCE",
    );
  return result;
}

function rectanglesOverlap(left, right) {
  return (
    left.right > right.x + 1 &&
    right.right > left.x + 1 &&
    left.bottom > right.y + 1 &&
    right.bottom > left.y + 1
  );
}

function geometryPass(accessibility, pendingCancelRect) {
  const surfaces = [accessibility?.settings, accessibility?.candidate];
  if (
    surfaces.some(
      (surface) =>
        surface === undefined ||
        surface.clientWidth < 358 ||
        surface.clientWidth > 362 ||
        surface.scrollWidth > surface.clientWidth + 1,
    )
  )
    return false;
  for (const surface of surfaces) {
    const records = surface.controls ?? surface.rectangles ?? [];
    const rectangles = records
      .filter((record) => record.disabled !== true)
      .map((record) => record.rect);
    if (
      rectangles.some(
        (rect) =>
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.x < surface.bounds.x - 1 ||
          rect.right > surface.bounds.right + 1,
      )
    )
      return false;
    for (let left = 0; left < rectangles.length; left += 1)
      for (let right = left + 1; right < rectangles.length; right += 1)
        if (rectanglesOverlap(rectangles[left], rectangles[right]))
          return false;
  }
  return (
    pendingCancelRect !== null &&
    pendingCancelRect !== undefined &&
    pendingCancelRect.width > 0 &&
    pendingCancelRect.height > 0 &&
    accessibility.settings?.status?.role === "status" &&
    accessibility.settings?.status?.live === "polite" &&
    accessibility.settings?.status?.atomic === "true"
  );
}

function classifyLaunchStderr(bytes) {
  const text = bytes.toString("utf8").toLowerCase();
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

function observeChildLifecycle(child, stderrByteCap = 8_192) {
  const stderrChunks = [];
  let stderrBytes = 0;
  let stderrTruncated = false;
  let spawnErrorClass;
  let spawnErrorCode;
  let exited = false;
  let exitCode = null;
  let signal = null;
  let resolveExit;
  const exitObserved = new Promise((resolve) => {
    resolveExit = resolve;
  });
  child.stderr?.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (stderrBytes >= stderrByteCap) {
      stderrTruncated ||= bytes.length > 0;
      return;
    }
    const retained = bytes.subarray(0, stderrByteCap - stderrBytes);
    stderrTruncated ||= retained.length < bytes.length;
    stderrChunks.push(retained);
    stderrBytes += retained.length;
  });
  child.on("error", (error) => {
    spawnErrorClass =
      error !== null &&
      typeof error === "object" &&
      "name" in error &&
      typeof error.name === "string"
        ? error.name.replaceAll(/[^A-Za-z]/gu, "").slice(0, 32)
        : "Unknown";
    spawnErrorCode =
      error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
            .replaceAll(/[^A-Za-z0-9_-]/gu, "")
            .slice(0, 48)
        : "UNCLASSIFIED";
  });
  child.on("exit", (code, exitSignal) => {
    exited = true;
    exitCode = Number.isInteger(code) ? code : null;
    signal =
      typeof exitSignal === "string"
        ? exitSignal.replaceAll(/[^A-Z0-9]/gu, "").slice(0, 16)
        : null;
    resolveExit();
  });
  return {
    snapshot() {
      return {
        alive: !exited && child.exitCode === null && child.signalCode === null,
        exited,
        exitCode,
        signal,
        spawnErrorClass: spawnErrorClass ?? "none",
        spawnErrorCode: spawnErrorCode ?? "none",
        stderrCategory: classifyLaunchStderr(Buffer.concat(stderrChunks)),
        stderrBytes,
        stderrTruncated,
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

async function stopDirectChild(
  child,
  lifecycle,
  { termWaitMs = 2_000, killWaitMs = 2_000, drainMs = 500 } = {},
) {
  if (!lifecycle.snapshot().exited) child.kill("SIGTERM");
  let exited = await lifecycle.waitForExit(termWaitMs);
  if (!exited && lifecycle.snapshot().alive) {
    child.kill("SIGKILL");
    exited = await lifecycle.waitForExit(killWaitMs);
  }
  const final = lifecycle.snapshot();
  if (!exited && final.alive)
    throw new Error("M05_RUNTIME_CLEANUP_FAILED directChildAlive=true");
  await new Promise((resolve) => setTimeout(resolve, drainMs));
}

function launchProbeFailure(stage, error, childLifecycle) {
  const lifecycle = childLifecycle.snapshot();
  return new Error(
    `${sanitizedProbeMessage(stage, error)} alive=${String(lifecycle.alive)} exited=${String(lifecycle.exited)} exitCode=${lifecycle.exitCode === null ? "none" : String(lifecycle.exitCode)} signal=${lifecycle.signal ?? "none"} spawnClass=${lifecycle.spawnErrorClass} spawnCode=${lifecycle.spawnErrorCode} stderrCategory=${lifecycle.stderrCategory} stderrBytes=${String(lifecycle.stderrBytes)} stderrTruncated=${String(lifecycle.stderrTruncated)}`,
  );
}

async function installDisposableVault(vault, runtimeBundle) {
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
  return installed;
}

function parseKeychainList(stdout) {
  return stdout
    .split("\n")
    .map((line) => /^\s*"([^"]+)"\s*$/u.exec(line)?.[1])
    .filter((value) => value !== undefined);
}

async function withSecondaryCollision(directory, account, action) {
  const keychainPath = join(directory, "secondary-runtime.keychain-db");
  const password = `synthetic-${randomUUID()}`;
  const prior = parseKeychainList(
    (await run("security", ["list-keychains", "-d", "user"])).stdout,
  );
  let created = false;
  let value;
  let cleanupEvidence;
  let actionError;
  try {
    await run("security", ["create-keychain", "-p", password, keychainPath]);
    created = true;
    await run("security", ["unlock-keychain", "-p", password, keychainPath]);
    await run("security", [
      "add-generic-password",
      "-s",
      "com.chat2vault.obsidian.openai-compatible",
      "-a",
      account,
      "-w",
      "synthetic-secondary-collision",
      keychainPath,
    ]);
    await run("security", [
      "list-keychains",
      "-d",
      "user",
      "-s",
      keychainPath,
      ...prior,
    ]);
    value = await action();
    await run("security", [
      "find-generic-password",
      "-s",
      "com.chat2vault.obsidian.openai-compatible",
      "-a",
      account,
      keychainPath,
    ]);
  } catch (error) {
    actionError = error;
  } finally {
    await run("security", ["list-keychains", "-d", "user", "-s", ...prior]);
    if (created) await run("security", ["delete-keychain", keychainPath]);
    await rm(keychainPath, { force: true });
    const restored = parseKeychainList(
      (await run("security", ["list-keychains", "-d", "user"])).stdout,
    );
    const searchListRestored =
      JSON.stringify(restored) === JSON.stringify(prior);
    const keychainFileAbsent = !(await exists(keychainPath));
    cleanupEvidence = {
      searchListRestored,
      keychainFileAbsent,
      finalAbsent: searchListRestored && keychainFileAbsent,
    };
  }
  if (!cleanupEvidence.finalAbsent)
    throw new Error("secondary Keychain cleanup verification failed");
  if (actionError !== undefined) throw actionError;
  return { value, cleanupEvidence };
}

async function runRow(row, shared) {
  let stage = "prepare";
  const simulatorAttemptStart = shared.simulatorAttempts();
  const markStage = (next) => {
    stage = next;
    process.stderr.write(`M05_RUNTIME_STAGE ${row.id} ${next}\n`);
  };
  const rowRoot = join(shared.root, row.id);
  const profile = join(rowRoot, "profile");
  const vault = join(rowRoot, "vault");
  await mkdir(profile, { recursive: true });
  await mkdir(vault, { recursive: true });
  if (row.asarPath !== undefined)
    await cp(row.asarPath, join(profile, `obsidian-${row.version}.asar`));
  const installed = await installDisposableVault(vault, shared.runtimeBundle);
  await writeFile(
    join(profile, "obsidian.json"),
    JSON.stringify({
      vaults: { synthetic: { path: vault, ts: Date.now(), open: true } },
    }),
  );
  const inspectorPort = 19_000 + Math.floor(Math.random() * 1_000);
  const mainInspectorPort = inspectorPort + 1_000;
  const runtimeInstallationId = randomUUID();
  const runtimeAccount = `installation/${runtimeInstallationId}`;
  const child = spawn(
    row.executable,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${String(inspectorPort)}`,
      `--inspect=${String(mainInspectorPort)}`,
      vault,
    ],
    {
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: shared.certificates.caCertificate,
        C2V_M05_RUNTIME_PORT: String(shared.serverPort),
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const childLifecycle = observeChildLifecycle(child);
  let rowTimedOut = false;
  const rowTimer = setTimeout(() => {
    rowTimedOut = true;
    child.kill("SIGTERM");
  }, 120_000);
  try {
    markStage("secondary-keychain");
    const collisionResult = await withSecondaryCollision(
      rowRoot,
      runtimeAccount,
      async () => {
        markStage("renderer-connect");
        let renderer;
        try {
          renderer = await connectDevtools(
            inspectorPort,
            (candidate) =>
              candidate.type === "page" &&
              candidate.url.startsWith("app://obsidian.md"),
            160,
          );
        } catch (error) {
          throw launchProbeFailure("renderer-connect", error, childLifecycle);
        }
        const { socket, command } = renderer;
        try {
          markStage("application-ready");
          let appReady = false;
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const readiness = await command("Runtime.evaluate", {
              expression:
                'typeof app === "object" && app !== null && typeof app.workspace === "object" && typeof app.plugins === "object"',
              returnByValue: true,
            });
            if (readiness.result?.result?.value === true) {
              appReady = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (!appReady)
            throw new Error("Obsidian application API unavailable");
          markStage("scenario-evaluation");
          const fixture = JSON.stringify([
            {
              id: "synthetic-runtime-conversation",
              current_node: "node-1",
              mapping: {
                "node-1": {
                  id: "node-1",
                  parent: null,
                  children: [],
                  message: {
                    id: "message-1",
                    author: { role: "user" },
                    content: { parts: ["Synthetic M05 runtime input."] },
                  },
                },
              },
            },
          ]);
          const expression = `(async()=>{if(!app.workspace.layoutReady)await new Promise((resolve)=>app.workspace.onLayoutReady(resolve));await app.plugins.loadManifests();await app.plugins.setEnable(true);await app.plugins.loadPlugin("chat-to-vault");await app.plugins.enablePlugin("chat-to-vault");let runtimeLeaf=app.workspace.getLeavesOfType("chat-to-vault-preview")[0];if(!runtimeLeaf){runtimeLeaf=app.workspace.getLeaf("tab");await runtimeLeaf.setViewState({type:"chat-to-vault-preview",active:true});await app.workspace.revealLeaf(runtimeLeaf)}const plugin=app.plugins.plugins["chat-to-vault"];await plugin.importSynthetic(new TextEncoder().encode(${JSON.stringify(
            fixture,
          )}));const mutationMethods=["create","createBinary","modify","modifyBinary","delete","rename"];const originalMutations=new Map();let mutationCount=0;for(const name of mutationMethods){if(typeof app.vault[name]==="function"){const original=app.vault[name].bind(app.vault);originalMutations.set(name,app.vault[name]);app.vault[name]=(...args)=>{mutationCount+=1;return original(...args)}}}const originalSaveData=plugin.saveData.bind(plugin);let persistenceAttemptCount=0;plugin.saveData=(value)=>{persistenceAttemptCount+=1;return originalSaveData(value)};try{const view=app.workspace.getLeavesOfType("chat-to-vault-preview")[0].view;view.contentEl.querySelector(".c2v-row").click();const prepared=await view.distillationController.prepare();const providerOperation=view.runProvider();await Promise.resolve();const pendingCancel=view.contentEl.querySelector('.c2v-provider-cancel');const pendingCancelFocused=document.activeElement===pendingCancel;const pendingCancelRect=pendingCancel?.getBoundingClientRect();await providerOperation;const providerSnapshot=view.providerController.snapshot;const status=view.contentEl.querySelector('[role="status"]');window.__c2vM05ViewStatus=status;const evidence=await plugin.runM05RuntimeScenarios({port:${String(
            shared.serverPort,
          )},mismatchAddress:${JSON.stringify(
            shared.mismatchAddress,
          )},nativePath:${JSON.stringify(
            join(installed, "native/keychain.node"),
          )},account:${JSON.stringify(
            runtimeAccount,
          )},installationId:${JSON.stringify(
            runtimeInstallationId,
          )},secret:"synthetic-m05-credential"});return{version:document.title.match(/Obsidian v?([0-9.]+)/u)?.[1],electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch,hostTrust:{extraCaPresent:typeof process.env.NODE_EXTRA_CA_CERTS==="string",rootCertificateCount:require("node:tls").rootCertificates.length},evidence,mutationCount,persistenceAttemptCount,ui:{prepared:prepared.status,providerResult:providerSnapshot.status,candidateCount:providerSnapshot.candidates.length,pendingCancelFocused,pendingCancelRect:pendingCancelRect?{x:pendingCancelRect.x,y:pendingCancelRect.y,width:pendingCancelRect.width,height:pendingCancelRect.height}:null,liveRole:status?.getAttribute("role"),livePolite:status?.getAttribute("aria-live"),liveAtomic:status?.getAttribute("aria-atomic")}}}finally{plugin.saveData=originalSaveData;for(const [name,original] of originalMutations)app.vault[name]=original}})()`;
          const response = await command(
            "Runtime.evaluate",
            {
              expression,
              awaitPromise: true,
              returnByValue: true,
            },
            "scenario-evaluation",
            60_000,
          );
          if (response.result?.exceptionDetails !== undefined) {
            const details = response.result.exceptionDetails;
            throw new Error(
              `runtime renderer evaluation failed: ${String(details.text)} at ${String(details.lineNumber)}:${String(details.columnNumber)} ${String(details.exception?.description ?? "")}`,
            );
          }
          const value = response.result?.result?.value;
          markStage("main-inspector-connect");
          let main;
          try {
            main = await connectDevtools(mainInspectorPort, () => true, 80);
          } catch (error) {
            throw launchProbeFailure(
              "main-inspector-connect",
              error,
              childLifecycle,
            );
          }
          let mainTrust;
          let hostUiEvidence;
          try {
            markStage("main-inspector-trust");
            let trust;
            try {
              trust = await mainEvaluate(
                main.command,
                '({extraCaPresent:typeof process.env.NODE_EXTRA_CA_CERTS==="string",pid:process.pid})',
                "main-inspector-trust",
              );
              if (trust === null || typeof trust !== "object")
                throw new Error("main trust evidence unavailable");
            } catch (error) {
              if (
                error instanceof Error &&
                error.message.startsWith("M05_CDP_EVALUATION_FAILED")
              )
                throw error;
              throw sanitizedProbeError("main-inspector-trust", error);
            }
            try {
              mainTrust = {
                inspectorAvailable: true,
                ...trust,
              };
              markStage("main-inspector-exercise");
              hostUiEvidence = await exerciseAccessibilityAndZoom(
                command,
                main.command,
                inspectorPort,
                renderer.targetId,
                row.id,
                rowRoot,
                shared.serverPort,
                markStage,
              );
            } catch (error) {
              if (
                error instanceof Error &&
                (error.message.startsWith("M05_CDP_EVALUATION_FAILED") ||
                  error.message.startsWith("M05_CDP_COMMAND_TIMEOUT") ||
                  error.message.startsWith("M05_RUNTIME_PROBE_FAILED"))
              )
                throw error;
              throw sanitizedProbeError("main-inspector-exercise", error);
            }
          } finally {
            main.socket.close();
          }
          if (
            value?.version !== row.version ||
            value?.arch !== "x64" ||
            value?.platform !== "darwin"
          )
            throw new Error(`runtime identity mismatch for ${row.id}`);
          const attemptsAfterScenarios = shared.simulatorAttempts();
          await new Promise((resolve) => setTimeout(resolve, 250));
          const attemptsAfterQuietPeriod = shared.simulatorAttempts();
          markStage("complete");
          return {
            id: row.id,
            version: value.version,
            electron: value.electron,
            chromium: value.chromium,
            node: value.node,
            platform: value.platform,
            arch: value.arch,
            hostTrust: value.hostTrust,
            mainTrust,
            spawnedPid: child.pid,
            hostInstrumentation: row.hostInstrumentation,
            scenarioRegistry: value.evidence.scenarioRegistry,
            scenarios: value.evidence.scenarios,
            observations: value.evidence.observations,
            keychain: value.evidence.keychain,
            mutationCount: value.mutationCount,
            persistenceViolationCount: value.persistenceAttemptCount,
            networkAttemptCount: attemptsAfterScenarios - simulatorAttemptStart,
            backgroundAttemptCount:
              attemptsAfterQuietPeriod - attemptsAfterScenarios,
            accessibility: hostUiEvidence?.accessibility ?? {
              passed: false,
              liveRegionAttributesPassed:
                value.ui.liveRole === "status" &&
                value.ui.livePolite === "polite" &&
                value.ui.liveAtomic === "true",
              focusTransitions: [],
            },
            zoom: {
              passed:
                mainTrust.inspectorAvailable === true &&
                Math.abs((hostUiEvidence?.zoom?.initial ?? 0) - 1) <= 0.01 &&
                Math.abs((hostUiEvidence?.zoom?.atOne ?? 0) - 1) <= 0.01 &&
                Math.abs((hostUiEvidence?.zoom?.atTwo ?? 0) - 2) <= 0.01 &&
                Math.abs((hostUiEvidence?.zoom?.restored ?? 0) - 1) <= 0.01 &&
                geometryPass(
                  hostUiEvidence?.accessibility,
                  value.ui.pendingCancelRect,
                ),
              mainInspectorAvailable: mainTrust.inspectorAvailable,
              callLog:
                hostUiEvidence === undefined
                  ? []
                  : [
                      hostUiEvidence.zoom.initial,
                      hostUiEvidence.zoom.atOne,
                      hostUiEvidence.zoom.atTwo,
                      hostUiEvidence.zoom.restored,
                    ],
              screenshot: hostUiEvidence?.screenshot,
            },
            ui: value.ui,
          };
        } finally {
          socket.close();
        }
      },
    );
    const completedRow = collisionResult.value;
    completedRow.secondaryKeychain = collisionResult.cleanupEvidence;
    if (
      completedRow.keychain?.finalAbsent === true &&
      completedRow.keychain?.isolationFinalAbsent === true &&
      completedRow.secondaryKeychain?.finalAbsent === true
    )
      completedRow.scenarios = completedRow.scenarios.map((scenario) =>
        scenario.id === "keychain-default-secondary-collision-cleanup"
          ? { ...scenario, outcome: "success" }
          : scenario,
      );
    const externalGroups = {
      "settings-focus-live-region":
        completedRow.accessibility?.settingsFocusPassed === true &&
        completedRow.accessibility?.settings?.status?.persistent === true &&
        completedRow.accessibility?.settings?.providerSaveState?.settled ===
          true,
      "candidate-focus-live-region":
        completedRow.accessibility?.candidateFocusPassed === true &&
        completedRow.accessibility?.candidate?.livePersistent === true &&
        completedRow.ui?.pendingCancelFocused === true,
      "host-zoom-geometry-screenshot":
        completedRow.zoom?.passed === true &&
        completedRow.zoom?.screenshot?.bytes > 0,
    };
    completedRow.scenarios = completedRow.scenarios.map((scenario) =>
      externalGroups[scenario.id] === true
        ? { ...scenario, outcome: "success" }
        : scenario,
    );
    return completedRow;
  } catch (error) {
    if (rowTimedOut)
      throw new Error(`M05 runtime row timed out: ${row.id}/${stage}`);
    throw error;
  } finally {
    clearTimeout(rowTimer);
    await stopDirectChild(child, childLifecycle);
  }
}

function assertCompleteRuntimeRows(rows, expectedIdentity) {
  if (
    rows.length !== 2 ||
    rows[0]?.version !== "1.7.4" ||
    rows[1]?.version !== expectedIdentity.officialStable.latestVersion
  )
    throw new Error("M05 runtime row identity matrix incomplete");
  for (const row of rows) {
    if (
      row.macos?.productVersion !== expectedIdentity.macos.productVersion ||
      row.macos?.buildVersion !== expectedIdentity.macos.buildVersion ||
      row.authorities?.m05?.sha256 !== requiredAuthorities.m05.sha256 ||
      row.authorities?.m04?.sha256 !== requiredAuthorities.m04.sha256 ||
      row.authorities?.m031?.sha256 !== requiredAuthorities.m031.sha256 ||
      row.officialStable?.latestVersion !==
        expectedIdentity.officialStable.latestVersion ||
      row.sourceMetadata?.appInfoPlist?.sha256 === undefined ||
      row.sourceMetadata?.sourceFramework?.sha256 === undefined
    )
      throw new Error(`M05 runtime evidence identity incomplete: ${row.id}`);
    const expectedOutcomes = {
      "transport-success": "success",
      "pinned-peer-mismatch": "PROVIDER_DNS_UNSAFE",
      "unsafe-dns": "PROVIDER_DNS_UNSAFE",
      redirect: "PROVIDER_REDIRECT_REJECTED",
      authentication: "PROVIDER_AUTH_REJECTED",
      "rate-limit": "PROVIDER_RATE_LIMITED",
      "oversized-response": "PROVIDER_RESPONSE_TOO_LARGE",
      "malformed-metadata": "PROVIDER_RESPONSE_METADATA_INVALID",
    };
    for (const scenario of row.observations)
      if (
        Object.hasOwn(expectedOutcomes, scenario.id) &&
        expectedOutcomes[scenario.id] !== scenario.outcome
      )
        throw new Error(
          `M05 runtime closed outcome mismatch: ${scenario.id}=${scenario.outcome}; extraCa=${String(row.hostTrust?.extraCaPresent)}; roots=${String(row.hostTrust?.rootCertificateCount)}`,
        );
    if (
      !Array.isArray(row.scenarioRegistry) ||
      row.scenarioRegistry.length === 0 ||
      new Set(row.scenarioRegistry).size !== row.scenarioRegistry.length
    )
      throw new Error(`M05 runtime scenario registry invalid: ${row.id}`);
    const ids = row.scenarios.map((scenario) => scenario.id);
    if (
      ids.length !== row.scenarioRegistry.length ||
      ids.some((id, index) => id !== row.scenarioRegistry[index])
    )
      throw new Error(`M05 runtime scenario emission mismatch: ${row.id}`);
    const externalIncomplete = row.scenarios.some(
      (scenario) =>
        [
          "settings-focus-live-region",
          "candidate-focus-live-region",
          "host-zoom-geometry-screenshot",
        ].includes(scenario.id) && scenario.outcome !== "success",
    );
    if (
      externalIncomplete ||
      row.accessibility?.passed !== true ||
      row.zoom?.passed !== true
    ) {
      const settingsStatus = row.accessibility?.settings?.status;
      throw new Error(
        `M05 runtime accessibility validator failed: ${JSON.stringify({
          row: row.id,
          settingsFocus: row.accessibility?.settingsFocus ?? [],
          settingsReverse: row.accessibility?.settingsReverse,
          candidateFocus: row.accessibility?.candidateFocus ?? [],
          candidateReverse: row.accessibility?.candidateReverse,
          enabledSettingsControls:
            row.accessibility?.settings?.providerSaveState?.enabledLabels ?? [],
          providerSaveSettled:
            row.accessibility?.settings?.providerSaveState?.settled === true,
          settingsStatusPersistent: settingsStatus?.persistent === true,
          settingsStatusRole: settingsStatus?.role === "status",
          settingsStatusLive: settingsStatus?.live === "polite",
          settingsStatusAtomic: settingsStatus?.atomic === "true",
          candidateStatusPersistent:
            row.accessibility?.candidate?.livePersistent === true,
          pendingCancelFocused: row.ui?.pendingCancelFocused === true,
          pendingCancelRect: row.ui?.pendingCancelRect,
          zoomCallLog: row.zoom?.callLog ?? [],
          settingsGeometry: row.accessibility?.settings,
          candidateGeometry: row.accessibility?.candidate,
          zoomPassed: row.zoom?.passed === true,
        })}`,
      );
    }
    for (const scenario of row.scenarios)
      if (scenario.outcome !== "success")
        throw new Error(
          `M05 runtime scenario incomplete: ${scenario.id}/${scenario.outcome}`,
        );
    const expectedNetworkAttempts =
      1 +
      row.observations.reduce(
        (total, observation) => total + observation.attempts,
        0,
      );
    if (
      row.keychain?.finalAbsent !== true ||
      row.secondaryKeychain?.finalAbsent !== true ||
      row.secondaryKeychain?.searchListRestored !== true ||
      row.secondaryKeychain?.keychainFileAbsent !== true ||
      row.mutationCount !== 0 ||
      row.persistenceViolationCount !== 0 ||
      row.networkAttemptCount !== expectedNetworkAttempts ||
      row.backgroundAttemptCount !== 0 ||
      row.accessibility?.passed !== true ||
      row.zoom?.passed !== true
    )
      throw new Error(
        `M05 runtime acceptance predicate failed: ${JSON.stringify({
          row: row.id,
          keychainFinalAbsent: row.keychain?.finalAbsent === true,
          keychainIsolationFinalAbsent:
            row.keychain?.isolationFinalAbsent === true,
          secondaryFinalAbsent: row.secondaryKeychain?.finalAbsent === true,
          mutationCount: row.mutationCount,
          persistenceViolationCount: row.persistenceViolationCount,
          networkAttemptCount: row.networkAttemptCount,
          expectedNetworkAttempts,
          backgroundAttemptCount: row.backgroundAttemptCount,
          accessibilityPassed: row.accessibility?.passed === true,
          zoomPassed: row.zoom?.passed === true,
        })}`,
      );
  }
}

const root = await mkdtemp(join(tmpdir(), "chat2vault-m05-runtime-"));
const retainedEvidenceDirectory = process.env.C2V_M05_EVIDENCE_DIR
  ? resolve(process.env.C2V_M05_EVIDENCE_DIR)
  : undefined;
if (
  retainedEvidenceDirectory === root ||
  retainedEvidenceDirectory?.startsWith(`${root}/`)
)
  throw new Error(
    "retained evidence directory must be outside the runtime root",
  );
let server;
let mismatchServer;
let failure;
let simulatorAttemptCount = 0;
try {
  const evidenceBuild = await buildEvidence(root);
  if (process.argv.includes("--artifacts-only")) {
    process.stdout.write(
      `M05 runtime artifact gate passed (production=${evidenceBuild.production.artifact.sha256}; runtime=${evidenceBuild.runtime.artifact.sha256}).\n`,
    );
  } else {
    const officialStable = await resolveOfficialStableMetadata();
    const authorities = await collectAuthorityEvidence();
    const macos = await collectMacosIdentity();
    const minimumApp =
      process.env.C2V_M05_OBSIDIAN_174_APP ??
      "/private/tmp/chat2vault-m05-hosts/1.7.4/Obsidian.app";
    const stableApp =
      process.env.C2V_M05_OBSIDIAN_STABLE_APP ?? "/Applications/Obsidian.app";
    const stableAsar =
      process.env.C2V_M05_OBSIDIAN_STABLE_ASAR ??
      join(
        homedir(),
        `Library/Application Support/obsidian/obsidian-${officialStable.latestVersion}.asar`,
      );
    if (
      !(await exists(minimumApp)) ||
      !(await exists(stableAsar)) ||
      !(await exists(stableApp))
    )
      throw new Error(
        "M05_RUNTIME_HOST_BLOCKED: required Obsidian applications are unavailable",
      );
    const instrumentedRoot = join(root, "instrumented-hosts");
    await mkdir(instrumentedRoot, { recursive: true });
    const minimumHost = await prepareInstrumentedApp(
      minimumApp,
      join(instrumentedRoot, "minimum.app"),
      "minimum",
    );
    const stableHost = await prepareInstrumentedApp(
      stableApp,
      join(instrumentedRoot, "stable.app"),
      "stable",
    );
    const certificates = await createCertificates(root);
    const tlsOptions = {
      key: await readFile(certificates.serverKey),
      cert: await readFile(certificates.serverCertificate),
    };
    const simulatorHandler = async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const outer = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const directScenario = outer.synthetic;
      const directResponses = {
        redirect: [302, {}],
        authentication: [401, {}],
        "rate-limit": [429, { "Retry-After": "7" }],
        "oversized-response": [
          200,
          { "Content-Type": "application/json", "Content-Length": "1048577" },
        ],
        "malformed-metadata": [
          200,
          { "Content-Type": "application/json", "Content-Encoding": "gzip" },
        ],
      };
      if (Object.hasOwn(directResponses, directScenario)) {
        const [status, headers] = directResponses[directScenario];
        response.writeHead(status, headers);
        response.end("{}");
        return;
      }
      const prompt = outer.messages?.[0]?.content;
      const match =
        /BEGIN_CHAT2VAULT_REQUEST_JSON\n([\s\S]*?)\nEND_CHAT2VAULT_REQUEST_JSON/u.exec(
          prompt,
        );
      if (match?.[1] === undefined) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
        return;
      }
      const requestContract = JSON.parse(match[1]);
      const content = JSON.stringify({
        schemaVersion: 1,
        contractVersion: "m04-manual-v1",
        requestId: requestContract.requestId,
        conversationFingerprint: requestContract.conversationFingerprint,
        candidates: [
          {
            type: "insight",
            title: "Synthetic runtime insight",
            summary: "Synthetic runtime summary.",
            body: "Synthetic runtime candidate body.",
            confidence: "high",
            sourceMessageFingerprints: [
              requestContract.messages[0].fingerprint,
            ],
            suggestedLinks: [],
            suggestedTags: ["synthetic-runtime"],
          },
        ],
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    };
    const mismatchAddress = selectMismatchAddress();
    server = createServer(tlsOptions, simulatorHandler);
    mismatchServer = createServer(tlsOptions, simulatorHandler);
    server.on("connection", () => {
      simulatorAttemptCount += 1;
    });
    mismatchServer.on("connection", () => {
      simulatorAttemptCount += 1;
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("synthetic HTTPS server did not bind");
    mismatchServer.listen(address.port, mismatchAddress);
    await once(mismatchServer, "listening");
    await verifyStandaloneTls(
      address.port,
      certificates.caCertificate,
      "127.0.0.1",
    );
    await verifyStandaloneTls(
      address.port,
      certificates.caCertificate,
      mismatchAddress,
    );
    const shared = {
      root,
      certificates,
      serverPort: address.port,
      mismatchAddress,
      simulatorAttempts: () => simulatorAttemptCount,
      runtimeBundle: join(root, "runtime-test.js"),
    };
    const rows = [];
    for (const rowInput of [
      {
        id: "minimum",
        version: "1.7.4",
        sourceApp: minimumApp,
        executable: minimumHost.executable,
        hostInstrumentation: minimumHost,
      },
      {
        id: "stable",
        version: officialStable.latestVersion,
        sourceApp: stableApp,
        executable: stableHost.executable,
        hostInstrumentation: stableHost,
        asarPath: stableAsar,
      },
    ]) {
      const row = {
        ...rowInput,
        authorities,
        macos,
        officialStable,
        sourceMetadata: await collectObsidianSourceMetadata(rowInput),
      };
      const result = await runRow(row, shared);
      result.authorities = row.authorities;
      result.macos = row.macos;
      result.officialStable = row.officialStable;
      result.sourceMetadata = row.sourceMetadata;
      rows.push(result);
    }
    assertCompleteRuntimeRows(rows, { authorities, macos, officialStable });
    const retainedScreenshots = [];
    if (retainedEvidenceDirectory !== undefined) {
      await mkdir(retainedEvidenceDirectory, { recursive: true });
      for (const row of rows) {
        const file = `${row.id}-200-percent.png`;
        const destination = join(retainedEvidenceDirectory, file);
        await cp(join(root, row.id, file), destination);
        const identity = await artifact(destination);
        if (
          identity.bytes !== row.zoom.screenshot.bytes ||
          identity.sha256 !== row.zoom.screenshot.sha256
        )
          throw new Error(`retained screenshot identity mismatch: ${row.id}`);
        retainedScreenshots.push(identity);
      }
    }
    const productionArtifacts = {};
    for (const path of [
      "main.js",
      "worker.js",
      "manifest.json",
      "styles.css",
      "native/source_observer.node",
      "native/keychain.node",
    ])
      productionArtifacts[path] = await artifact(join(pluginRoot, path));
    process.stdout.write(
      `${JSON.stringify({
        status: "PASS",
        rows,
        productionArtifacts,
        runtimeArtifact: evidenceBuild.runtime.artifact,
        retainedScreenshots,
        certificates: certificates.identities,
      })}\n`,
    );
  }
} catch (error) {
  failure = error;
} finally {
  if (server !== undefined)
    await new Promise((resolve) => server.close(resolve));
  if (mismatchServer !== undefined)
    await new Promise((resolve) => mismatchServer.close(resolve));
  await rm(root, { recursive: true, force: true });
  if (await exists(root)) failure = new Error("runtime cleanup failed");
}
if (failure !== undefined) throw failure;
