/* global WebSocket, fetch */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import {
  approvedDocumentBindingsPass,
  mainProcessZoomCallLogPasses,
  screenshotTargetPasses,
  viewWidthMatches,
  zoomContractPasses,
  zoomReadbackMatches,
} from "./m03-runtime-contracts.mjs";

const artifactFiles = {
  main: new URL("../main.js", import.meta.url),
  worker: new URL("../worker.js", import.meta.url),
  manifest: new URL("../manifest.json", import.meta.url),
  styles: new URL("../styles.css", import.meta.url),
  nativeObserver: new URL("../native/source_observer.node", import.meta.url),
  frozenSpec: new URL("../../../docs/M03_SPEC.md", import.meta.url),
  scopeAmendment: new URL(
    "../../../docs/M03_MACOS_SCOPE_AMENDMENT.md",
    import.meta.url,
  ),
};
const finalProductionArtifacts = Object.fromEntries(
  await Promise.all(
    Object.entries(artifactFiles).map(async ([name, url]) => {
      const bytes = await readFile(url);
      return [
        name,
        {
          file: url.pathname.split("/Chat2Vault/").at(-1),
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ];
    }),
  ),
);
if (!approvedDocumentBindingsPass(finalProductionArtifacts))
  throw new Error("Approved M03 document identity mismatch");

const [portText, fixturePath, outputPath, sourceRoot, mainInspectorPortText] =
  process.argv.slice(2);
if (!portText || !fixturePath || !outputPath || !sourceRoot)
  throw new Error(
    "usage: m03-runtime-smoke.mjs PORT FIXTURE OUTPUT SOURCE_ROOT [MAIN_INSPECTOR_PORT]",
  );
const port = Number(portText);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
  (response) => response.json(),
);
const target = targets.find(
  (candidate) =>
    candidate.type === "page" && candidate.url.startsWith("app://obsidian.md"),
);
if (!target) throw new Error("Obsidian page target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let identifier = 0;
const pending = new Map();
const runtimeEvents = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    const settle = pending.get(message.id);
    pending.delete(message.id);
    settle(message);
  } else if (message.method) runtimeEvents.push(message);
});
const command = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++identifier;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
await command("Runtime.enable");
await command("Log.enable");
process.stderr.write("C2V_HOST_ZOOM_STAGE: renderer-connected\n");
const literal = (value) => JSON.stringify(value);
const expression = `(async()=>{
  await app.plugins.loadManifests();
  await app.plugins.setEnable(true);
  await app.plugins.loadPlugin("chat-to-vault");
  await app.plugins.enablePlugin("chat-to-vault");
  const plugin=app.plugins.plugins["chat-to-vault"];
  const setting=await plugin.saveSourceRoot(${literal(sourceRoot)});
  await app.commands.executeCommandById("chat-to-vault:import-chatgpt-export");
  const bytes=require("node:fs").readFileSync(${literal(fixturePath)});
  await plugin.controller.import([{name:"synthetic-runtime.json",size:bytes.length,arrayBuffer:()=>Promise.resolve(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))}]);
  const leaf=app.workspace.getLeavesOfType("chat-to-vault-preview")[0];
  const view=leaf.view;
  view.contentEl.querySelector(".c2v-row").click();
  const firstPreviewPromise=view.sourceController.preview();
  const overlappingPreview=await view.sourceController.preview();
  const firstPreview=await firstPreviewPromise;
  const installed=view.sourceController.installedPreview;
  const savePromise=view.sourceController.save();
  const previewDuringSave=await view.sourceController.preview();
  const save=await savePromise;
  const duplicate=await view.sourceController.preview();
  const created=save?.createdPath?app.vault.getAbstractFileByPath(save.createdPath):null;
  const content=created?await app.vault.read(created):null;
  const zoomRootSetting=await plugin.saveSourceRoot(${literal(`${sourceRoot}/Zoom`)});
  const zoomPreview=await view.sourceController.preview();
  const crypto=require("node:crypto");
  const path=require("node:path");
  const nativePath=path.join(app.vault.adapter.getBasePath(),plugin.manifest.dir,"native","source_observer.node");
  const installedPluginDirectory=path.join(app.vault.adapter.getBasePath(),plugin.manifest.dir);
  const installedArtifact=(relativePath)=>{const artifactBytes=require("node:fs").readFileSync(path.join(installedPluginDirectory,relativePath));return{file:"installed-plugin/"+relativePath,bytes:artifactBytes.length,sha256:crypto.createHash("sha256").update(artifactBytes).digest("hex")}};
  const native=require(nativePath);
  const vaultReal=require("node:fs").realpathSync(app.vault.adapter.getBasePath());
  const mountResult=native.observeMacOSMountPoint(app.vault.adapter.getBasePath());
  const mountReal=mountResult.kind==="mount-path"?require("node:fs").realpathSync(mountResult.mountPath):null;
  const fixtureNativePath=path.join(app.vault.adapter.getBasePath(),${literal(sourceRoot)});
  const fixtureReal=require("node:fs").realpathSync(fixtureNativePath);
  const fixtureMountResult=native.observeMacOSMountPoint(fixtureNativePath);
  const fixtureMountReal=fixtureMountResult.kind==="mount-path"?require("node:fs").realpathSync(fixtureMountResult.mountPath):null;
  view.sourcePreviewResult=zoomPreview;
  view.draw(plugin.controller.snapshot);
  await app.workspace.setActiveLeaf(leaf,{focus:true});
  view.contentEl.scrollIntoView({block:"start",inline:"nearest"});
  return {
    identity:{appVersion:document.title.match(/Obsidian v?([0-9.]+)/u)?.[1],identitySource:"document-title",electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch},
    setting,
    persistedSettings:plugin.settings,
    importState:plugin.controller.snapshot.state,
    preview:{status:firstPreview.status,disposition:firstPreview.plan?.disposition,targetPath:firstPreview.plan?.targetPath,foldersToCreate:firstPreview.plan?.foldersToCreate,noteContentFingerprint:firstPreview.plan?.noteContentFingerprint,diagnostics:firstPreview.plan?.diagnostics},
    arbitration:{overlappingPreview:overlappingPreview.status,previewDuringSave:previewDuringSave.status},
    display:installed?.display,
    save,
    readBack:{path:save?.createdPath,length:content?.length,sha256:content?"sha256:"+crypto.createHash("sha256").update(content).digest("hex"):null},
    duplicate:{status:duplicate.status,disposition:duplicate.plan?.disposition,existingPath:duplicate.plan?.existingPath,diagnostics:duplicate.plan?.diagnostics},
    zoomPreparation:{setting:zoomRootSetting,previewStatus:zoomPreview.status,disposition:zoomPreview.plan?.disposition},
    installedProductionArtifacts:{main:installedArtifact("main.js"),worker:installedArtifact("worker.js"),manifest:installedArtifact("manifest.json"),styles:installedArtifact("styles.css"),nativeObserver:installedArtifact("native/source_observer.node")},
    nativeCapability:{modulePath:nativePath,vault:{rawResult:mountResult,mountReal,vaultReal,equal:mountReal===vaultReal},fixture:{nativePath:fixtureNativePath,objectReal:fixtureReal,rawResult:fixtureMountResult,mountReal:fixtureMountReal,equal:fixtureMountReal===fixtureReal}},
  };
})()`;
process.stderr.write("C2V_HOST_ZOOM_STAGE: renderer-evaluation-start\n");
const evaluation = await command("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
});
process.stderr.write("C2V_HOST_ZOOM_STAGE: renderer-evaluation-finished\n");
if (evaluation.result?.exceptionDetails)
  throw new Error(JSON.stringify(evaluation.result.exceptionDetails));
const result = evaluation.result?.result?.value;
for (const name of ["main", "worker", "manifest", "styles", "nativeObserver"]) {
  const repositoryArtifact = finalProductionArtifacts[name];
  const installedArtifact = result?.installedProductionArtifacts?.[name];
  if (
    repositoryArtifact?.bytes !== installedArtifact?.bytes ||
    repositoryArtifact?.sha256 !== installedArtifact?.sha256
  )
    throw new Error(`Installed runtime artifact mismatch: ${name}`);
}
process.stderr.write("C2V_HOST_ZOOM_STAGE: artifacts-validated\n");
let zoom200 = { status: "not-verified", reason: "main-inspector-unavailable" };
let zoomScreenshot;
const mainProcessCallLog = [];
if (mainInspectorPortText) {
  process.stderr.write("C2V_HOST_ZOOM_STAGE: main-connect-start\n");
  const mainTargets = await fetch(
    `http://127.0.0.1:${Number(mainInspectorPortText)}/json/list`,
  ).then((response) => response.json());
  const mainTarget = mainTargets[0];
  if (!mainTarget?.webSocketDebuggerUrl)
    throw new Error("Electron main-process inspector target unavailable");
  const mainSocket = new WebSocket(mainTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    mainSocket.addEventListener("open", resolve, { once: true });
    mainSocket.addEventListener("error", reject, { once: true });
  });
  let mainIdentifier = 0;
  const mainPending = new Map();
  mainSocket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && mainPending.has(message.id)) {
      const settle = mainPending.get(message.id);
      mainPending.delete(message.id);
      mainProcessCallLog.push({
        sequence: mainProcessCallLog.length + 1,
        request: settle.request,
        response: message,
      });
      settle.resolve(message);
    }
  });
  const mainCommand = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++mainIdentifier;
      const request = { id, method, params };
      mainPending.set(id, { request, resolve });
      mainSocket.send(JSON.stringify(request));
    });
  await mainCommand("Runtime.enable");
  process.stderr.write("C2V_HOST_ZOOM_STAGE: main-connected\n");
  const mainEvaluate = async (body) => {
    const reply = await mainCommand("Runtime.evaluate", {
      expression: body,
      awaitPromise: true,
      returnByValue: true,
    });
    if (reply.result?.exceptionDetails)
      throw new Error(JSON.stringify(reply.result.exceptionDetails));
    return reply.result?.result?.value;
  };
  const electronExpression = `process.mainModule.require("electron")`;
  const webContentsExpression = `${electronExpression}.webContents.getAllWebContents().find((value)=>value.getURL().startsWith("app://obsidian.md"))`;
  const originalBounds = await mainEvaluate(
    `(()=>{const electron=${electronExpression};const contents=${webContentsExpression};const window=electron.BrowserWindow.fromWebContents(contents);return window.getContentBounds()})()`,
  );
  process.stderr.write("C2V_HOST_ZOOM_STAGE: original-bounds-read\n");
  const hostWindowFocus = await mainEvaluate(
    `(async()=>{const electron=${electronExpression};const contents=${webContentsExpression};const window=electron.BrowserWindow.fromWebContents(contents);electron.app.focus({steal:true});window.show();window.focus();contents.focus();await new Promise((resolve)=>setTimeout(resolve,250));return{visible:window.isVisible(),focused:window.isFocused(),contentsFocused:contents.isFocused()}})()`,
  );
  if (
    hostWindowFocus?.visible !== true ||
    hostWindowFocus?.focused !== true ||
    hostWindowFocus?.contentsFocused !== true
  )
    throw new Error("Disposable host window could not receive real focus");
  let restoreFailure = false;
  try {
    const zoom1 = await mainEvaluate(
      `(()=>{const contents=${webContentsExpression};contents.setZoomFactor(1);return contents.getZoomFactor()})()`,
    );
    process.stderr.write(`C2V_HOST_ZOOM_STAGE: zoom1-${String(zoom1)}\n`);
    if (!zoomReadbackMatches(zoom1, 1))
      throw new Error("Host-level 1.0 zoom readback failed");
    const zoom2 = await mainEvaluate(
      `(()=>{const contents=${webContentsExpression};contents.setZoomFactor(2);return contents.getZoomFactor()})()`,
    );
    process.stderr.write(`C2V_HOST_ZOOM_STAGE: zoom2-${String(zoom2)}\n`);
    if (!zoomReadbackMatches(zoom2, 2))
      throw new Error("Host-level 2.0 zoom readback failed");
    let width = originalBounds.width;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const measured = await command("Runtime.evaluate", {
        expression:
          'app.workspace.getLeavesOfType("chat-to-vault-preview")[0].view.contentEl.clientWidth',
        returnByValue: true,
      });
      const clientWidth = measured.result?.result?.value;
      process.stderr.write(
        `C2V_HOST_ZOOM_STAGE: width-${String(attempt)}-${String(clientWidth)}\n`,
      );
      if (viewWidthMatches(clientWidth)) break;
      width = Math.max(420, width + Math.round((360 - clientWidth) * zoom2));
      await mainEvaluate(
        `(()=>{const electron=${electronExpression};const contents=${webContentsExpression};const window=electron.BrowserWindow.fromWebContents(contents);const bounds=window.getContentBounds();window.setContentBounds({...bounds,width:${width}});return window.getContentBounds()})()`,
      );
      process.stderr.write(
        `C2V_HOST_ZOOM_STAGE: bounds-${String(attempt)}-${String(width)}\n`,
      );
      await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
    process.stderr.write("C2V_HOST_ZOOM_STAGE: focus-start\n");
    await command("Runtime.evaluate", {
      expression:
        'app.workspace.getLeavesOfType("chat-to-vault-preview")[0].view.contentEl.querySelector("button")?.focus()',
      returnByValue: true,
    });
    process.stderr.write("C2V_HOST_ZOOM_STAGE: focus-initialized\n");
    const focusTransitions = [
      {
        input: "programmatic-start",
        ...(
          await command("Runtime.evaluate", {
            expression:
              "({tag:document.activeElement?.tagName,label:document.activeElement?.textContent?.trim(),className:document.activeElement?.className})",
            returnByValue: true,
          })
        ).result?.result?.value,
      },
    ];
    for (let index = 0; index < 64; index += 1) {
      await command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
      });
      await command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Tab",
        code: "Tab",
      });
      const focused = await command("Runtime.evaluate", {
        expression:
          "({tag:document.activeElement?.tagName,label:document.activeElement?.textContent?.trim(),className:document.activeElement?.className})",
        returnByValue: true,
      });
      focusTransitions.push({
        input: "Tab",
        ...focused.result?.result?.value,
      });
      if (
        focusTransitions.some(
          (transition) =>
            transition.input === "Tab" &&
            transition.label === "Preview source note",
        ) &&
        focusTransitions.some(
          (transition) =>
            transition.input === "Tab" &&
            transition.label === "Save source note",
        )
      )
        break;
    }
    process.stderr.write("C2V_HOST_ZOOM_STAGE: focus-finished\n");
    await command("Runtime.evaluate", {
      expression:
        '(async()=>{const leaf=app.workspace.getLeavesOfType("chat-to-vault-preview")[0];await app.workspace.setActiveLeaf(leaf,{focus:true});leaf.view.contentEl.scrollIntoView({block:"start",inline:"nearest"});await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true})()',
      awaitPromise: true,
      returnByValue: true,
    });
    await command("Runtime.evaluate", {
      expression:
        "new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
      awaitPromise: true,
      returnByValue: true,
    });
    process.stderr.write("C2V_HOST_ZOOM_STAGE: frames-finished\n");
    const metrics = await command("Runtime.evaluate", {
      expression: `(()=>{const view=app.workspace.getLeavesOfType("chat-to-vault-preview")[0].view;const rect=(element)=>element?({x:element.getBoundingClientRect().x,y:element.getBoundingClientRect().y,width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height,right:element.getBoundingClientRect().right,bottom:element.getBoundingClientRect().bottom}):null;const source=view.contentEl.querySelector(".c2v-source");const viewRect=rect(view.contentEl);const overflowElements=[...view.contentEl.querySelectorAll("*")].map((element)=>({tag:element.tagName,className:element.className,text:element.textContent?.trim().slice(0,80),clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,rect:rect(element),whiteSpace:getComputedStyle(element).whiteSpace,overflowX:getComputedStyle(element).overflowX})).filter((row)=>row.scrollWidth>row.clientWidth+1||row.rect.right>viewRect.right+1).slice(0,40);return {viewRect,viewClientWidth:view.contentEl.clientWidth,viewScrollWidth:view.contentEl.scrollWidth,overflow:view.contentEl.scrollWidth>view.contentEl.clientWidth+1,overflowElements,sourceRegionRect:rect(source),controls:[...view.contentEl.querySelectorAll(".c2v-source button")].map((element)=>({label:element.textContent?.trim(),enabled:!element.disabled,rect:rect(element),visible:element.getClientRects().length>0})),rawPreviewRect:rect(view.contentEl.querySelector(".c2v-source pre"))}})()`,
      returnByValue: true,
    });
    const metricValue = metrics.result?.result?.value;
    process.stderr.write("C2V_HOST_ZOOM_STAGE: metrics-read\n");
    const screenshotTarget = (
      await command("Runtime.evaluate", {
        expression:
          '(()=>{const leaf=app.workspace.getLeavesOfType("chat-to-vault-preview")[0];const view=leaf.view;const visible=(element)=>element instanceof HTMLElement&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=="hidden"&&getComputedStyle(element).display!=="none";return{leafVisible:visible(leaf.containerEl),leafActive:app.workspace.activeLeaf===leaf,viewInDocument:document.contains(view.contentEl),previewVisible:visible([...view.contentEl.querySelectorAll("button")].find((element)=>element.textContent?.trim()==="Preview source note")),saveVisible:visible([...view.contentEl.querySelectorAll("button")].find((element)=>element.textContent?.trim()==="Save source note")),rawPreviewVisible:visible(view.contentEl.querySelector(".c2v-source pre"))}})()',
        returnByValue: true,
      })
    ).result?.result?.value;
    if (!screenshotTargetPasses(screenshotTarget))
      throw new Error(
        `Chat2Vault screenshot target is not active and visible: ${JSON.stringify(screenshotTarget)}`,
      );
    if (
      !zoomContractPasses({
        zoom1,
        zoom2,
        animationFrameTurns: 2,
        metrics: metricValue,
        focusTransitions,
      })
    )
      throw new Error(
        `Exact 2.0 zoom viewport/control contract failed: ${JSON.stringify({ zoom1, zoom2, metricValue, focusTransitions })}`,
      );
    zoom200 = {
      status: "verified",
      control: "electron-main-webContents",
      hostWindowFocus,
      zoom1,
      zoom2,
      ...metricValue,
      focusTransitions,
      screenshotTarget,
    };
    process.stderr.write("C2V_HOST_ZOOM_STAGE: contract-passed\n");
    zoomScreenshot = await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    process.stderr.write("C2V_HOST_ZOOM_STAGE: screenshot-captured\n");
  } finally {
    const restoredZoom = await mainEvaluate(
      `(()=>{const contents=${webContentsExpression};contents.setZoomFactor(1);return contents.getZoomFactor()})()`,
    );
    restoreFailure = !zoomReadbackMatches(restoredZoom, 1);
    await mainEvaluate(
      `(()=>{const electron=${electronExpression};const contents=${webContentsExpression};const window=electron.BrowserWindow.fromWebContents(contents);window.setContentBounds(${JSON.stringify(originalBounds)});return window.getContentBounds()})()`,
    );
    zoom200.restoredZoom = restoredZoom;
    zoom200.mainProcessCallLog = mainProcessCallLog;
    process.stderr.write("C2V_HOST_ZOOM_STAGE: restored\n");
  }
  if (!mainProcessZoomCallLogPasses(mainProcessCallLog))
    throw new Error("Raw Electron main-process zoom call log is incomplete");
  mainSocket.close();
  if (restoreFailure)
    throw new Error("Host-level 1.0 zoom restore readback failed");
}
result.zoom200 = zoom200;
socket.close();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), finalProductionArtifacts, result, runtimeEvents }, null, 2)}\n`,
);
process.stderr.write("C2V_HOST_ZOOM_STAGE: json-written\n");
if (zoomScreenshot !== undefined) {
  await writeFile(
    `${outputPath}.png`,
    Buffer.from(zoomScreenshot.result.data, "base64"),
  );
  process.stderr.write("C2V_HOST_ZOOM_STAGE: screenshot-written\n");
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
