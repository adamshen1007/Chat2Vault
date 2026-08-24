/* global WebSocket, fetch */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";
import { approvedDocumentBindingsPass } from "./m03-runtime-contracts.mjs";

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

const [portText, fixturePath, outputPath] = process.argv.slice(2);
if (!portText || !fixturePath || !outputPath)
  throw new Error("usage: m03-runtime-deep.mjs PORT FIXTURE OUTPUT");

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
const protocolEvents = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    const settle = pending.get(message.id);
    pending.delete(message.id);
    settle(message);
  } else if (message.method) {
    protocolEvents.push(message);
    if (message.method === "Runtime.consoleAPICalled") {
      const values = message.params?.args
        ?.map((arg) => arg.value)
        .filter(Boolean);
      if (values?.some((value) => String(value).startsWith("C2V_STAGE:")))
        process.stderr.write(`${values.join(" ")}\n`);
    }
  }
});
const command = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++identifier;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
await command("Runtime.enable");
await command("Network.enable");
const literal = (value) => JSON.stringify(value);
const expression = `(async()=>{
  const fs=require("node:fs");
  const path=require("node:path");
  const crypto=require("node:crypto");
  const pluginId="chat-to-vault";
  if(app.plugins.plugins[pluginId])await app.plugins.disablePlugin(pluginId);
  await app.plugins.loadManifests();
  await app.plugins.setEnable(true);
  await app.plugins.loadPlugin(pluginId);
  await app.plugins.enablePlugin(pluginId);
  let plugin=app.plugins.plugins[pluginId];
  const vaultBase=app.vault.adapter.getBasePath();
  const pluginDirectory=path.join(vaultBase,plugin.manifest.dir);
  const runtimeExports=plugin.constructor.m03RuntimeEvidence;
  if(!runtimeExports)throw new Error("M03 runtime evidence helpers unavailable");
  const dataPath=path.join(pluginDirectory,"data.json");
  const hash=(bytes)=>crypto.createHash("sha256").update(bytes).digest("hex");
  const raw=(filePath)=>fs.existsSync(filePath)?fs.readFileSync(filePath):null;
  const originalData=raw(dataPath);
  const loadFixtures=[
    {name:"valid-v1",bytes:'{"schemaVersion":1,"previewMessagesPerPage":10}'},
    {name:"non-nfc-valid-v2",bytes:'{"schemaVersion":2,"previewMessagesPerPage":25,"sourceRoot":"Cafe\\u0301"}'},
    {name:"invalid-root-v2",bytes:'{"schemaVersion":2,"previewMessagesPerPage":25,"sourceRoot":"bad/"}'},
    {name:"malformed",bytes:'{"schemaVersion":2,'},
    {name:"unsupported-future",bytes:'{"schemaVersion":99,"previewMessagesPerPage":50,"sourceRoot":"Future","future":true}'},
  ];
  const loadOnly=[];
  for(const fixture of loadFixtures){
    await app.plugins.disablePlugin(pluginId);
    fs.writeFileSync(dataPath,fixture.bytes);
    const before=fs.readFileSync(dataPath);
    await app.plugins.loadPlugin(pluginId);
    await app.plugins.enablePlugin(pluginId);
    plugin=app.plugins.plugins[pluginId];
    const after=fs.readFileSync(dataPath);
    loadOnly.push({name:fixture.name,before:{bytes:before.length,sha256:hash(before),base64:before.toString("base64")},after:{bytes:after.length,sha256:hash(after),base64:after.toString("base64")},byteIdentical:before.equals(after),inMemorySettings:plugin.settings,diagnostics:plugin.settingsLoadDiagnostics});
  }
  await app.plugins.disablePlugin(pluginId);
  if(originalData===null)fs.rmSync(dataPath,{force:true});else fs.writeFileSync(dataPath,originalData);
  await app.plugins.loadPlugin(pluginId);
  await app.plugins.enablePlugin(pluginId);
  plugin=app.plugins.plugins[pluginId];

  const manifest=(directory)=>{
    const rows=[];
    const walk=(current,relative)=>{
      for(const name of fs.readdirSync(current).sort()){
        const absolute=path.join(current,name);const next=relative===""?name:relative+"/"+name;const stat=fs.lstatSync(absolute);
        if(stat.isDirectory()){rows.push({path:next,type:"directory"});walk(absolute,next)}else if(stat.isFile()){try{const bytes=fs.readFileSync(absolute);rows.push({path:next,type:"file",bytes:bytes.length,sha256:hash(bytes)})}catch{rows.push({path:next,type:"unstable"})}}else rows.push({path:next,type:"other"});
      }
    };walk(directory,"");return rows;
  };
  const beforeManifest=manifest(vaultBase);
  const mutationTrace=[];
  const wrapMutation=(name)=>{const original=app.vault[name].bind(app.vault);app.vault[name]=async(...args)=>{mutationTrace.push({name,path:typeof args[0]==="string"?args[0]:args[0]?.path??null,phase:globalThis.__c2vEvidencePhase??"plugin"});return original(...args)};return()=>{app.vault[name]=original}};
  const restoreMutations=["create","createFolder","modify","delete","rename","trash"].filter((name)=>typeof app.vault[name]==="undefined"?false:true).map(wrapMutation);
  const layerA=[];
  const originalFetch=globalThis.fetch;
  const originalXhrOpen=globalThis.XMLHttpRequest?.prototype.open;
  const originalBeacon=globalThis.navigator?.sendBeacon;
  if(originalFetch)globalThis.fetch=(input,init)=>{layerA.push({kind:"fetch",url:String(input?.url??input),method:init?.method??"GET"});return originalFetch(input,init)};
  if(originalXhrOpen)globalThis.XMLHttpRequest.prototype.open=function(method,url,...rest){layerA.push({kind:"xhr",url:String(url),method:String(method)});return originalXhrOpen.call(this,method,url,...rest)};
  if(originalBeacon)globalThis.navigator.sendBeacon=function(url,data){layerA.push({kind:"beacon",url:String(url),bodyBytes:typeof data==="string"?data.length:null});return originalBeacon.call(this,url,data)};

  const clipboardCalls=[];
  let electronClipboard;
  const restoreClipboard=[];
  try{
    electronClipboard=require("electron").clipboard;
    for(const method of ["readText","readHTML","readImage","readBuffer","writeText","writeHTML","writeImage","writeBuffer","clear"]){
      if(typeof electronClipboard?.[method]!=="function")continue;
      const original=electronClipboard[method].bind(electronClipboard);
      electronClipboard[method]=(...args)=>{clipboardCalls.push({method,argTypes:args.map((value)=>typeof value)});return original(...args)};
      restoreClipboard.push(()=>{electronClipboard[method]=original});
    }
  }catch{}

  const disabledBaselines=[];
  await app.plugins.disablePlugin(pluginId);
  for(let ordinal=1;ordinal<=3;ordinal+=1){
    const manifestBefore=manifest(vaultBase);const layerABefore=layerA.length;
    await new Promise((resolve)=>setTimeout(resolve,100));
    const manifestAfter=manifest(vaultBase);
    disabledBaselines.push({ordinal,manifestBefore,manifestAfter,manifestEqual:JSON.stringify(manifestBefore)===JSON.stringify(manifestAfter),layerADelta:layerA.slice(layerABefore),clipboardDelta:clipboardCalls.length});
  }
  await app.plugins.loadPlugin(pluginId);
  await app.plugins.enablePlugin(pluginId);
  plugin=app.plugins.plugins[pluginId];

  await app.commands.executeCommandById("chat-to-vault:import-chatgpt-export");
  const fixtureBytes=fs.readFileSync(${literal(fixturePath)});
  await plugin.controller.import([{name:"synthetic-runtime.json",size:fixtureBytes.length,arrayBuffer:()=>Promise.resolve(fixtureBytes.buffer.slice(fixtureBytes.byteOffset,fixtureBytes.byteOffset+fixtureBytes.byteLength))}]);
  const view=app.workspace.getLeavesOfType("chat-to-vault-preview")[0].view;
  view.contentEl.querySelector(".c2v-row").click();
  const imported=plugin.controller.snapshot.result;
  const source=imported.source;
  const conversation=imported.conversations[0];
  const sourceController=view.sourceController;
  const cloneEvidence=(value)=>value===undefined?null:structuredClone(value);
  const controllerEvidence=()=>({generation:view.sourceGeneration+plugin.settingsController.sourceWriteGeneration,previewMutexHeld:sourceController.previewMutex.isHeld,writeMutexHeld:sourceController.writeMutex.isHeld,installedPreview:cloneEvidence(sourceController.installedPreview)});
  const retainArbitrationEvidence=(phases)=>({
    mutexOwnership:Object.fromEntries(Object.entries(phases).map(([phase,snapshot])=>[phase,{sourcePreviewMutex:snapshot.previewMutexHeld,sourceWriteMutex:snapshot.writeMutexHeld}])),
    installedPlanIdentity:Object.fromEntries(Object.entries(phases).map(([phase,snapshot])=>[phase,cloneEvidence(snapshot.installedPreview)])),
  });

  const settingsMatrix=[];
  const runPending=async(kind,settlement,value)=>{
    const originalSaveData=plugin.saveData.bind(plugin);let settle;
    plugin.saveData=(settings)=>new Promise((resolve,reject)=>{settle=async()=>{if(settlement==="fulfilled"){await originalSaveData(settings);resolve()}else reject(new Error("synthetic persistence rejection"))}});
    const before={settings:{...plugin.settings},generation:plugin.settingsController.sourceWriteGeneration};
    const first=kind==="page"?plugin.savePreviewMessagesPerPage(value):plugin.saveSourceRoot(value);
    await Promise.resolve();
    const pendingState=JSON.parse(JSON.stringify(plugin.settingsController.sourceRootPersistenceState));
    const reentry=await (kind==="page"?plugin.savePreviewMessagesPerPage(value):plugin.saveSourceRoot(value));
    const previewDuring=kind==="root"?await view.sourceController.preview():null;
    const saveDuring=kind==="root"?await view.sourceController.save():null;
    await settle();
    const firstResult=await first;
    plugin.saveData=originalSaveData;
    settingsMatrix.push({kind,settlement,value,before,pendingState,reentry,previewDuring,saveDuring,firstResult,after:{settings:{...plugin.settings},generation:plugin.settingsController.sourceWriteGeneration,persistenceState:plugin.settingsController.sourceRootPersistenceState}});
  };
  const pageFulfilledValue=plugin.settings.previewMessagesPerPage===50?25:50;
  const pageRejectedValue=pageFulfilledValue===10?25:10;
  const rootFulfilledValue=plugin.settings.sourceRoot==="Runtime-Root-Fulfilled"?"Runtime-Root-Fulfilled-2":"Runtime-Root-Fulfilled";
  const rootRejectedValue=rootFulfilledValue==="Runtime-Root-Rejected"?"Runtime-Root-Rejected-2":"Runtime-Root-Rejected";
  await runPending("page","fulfilled",pageFulfilledValue);
  await runPending("page","rejected",pageRejectedValue);
  await runPending("root","fulfilled",rootFulfilledValue);
  await runPending("root","rejected",rootRejectedValue);

  const crossTransactionMatrix=[];
  const beginDeferredRoot=async(value,settlement)=>{
    const originalSaveData=plugin.saveData.bind(plugin);let settle;
    plugin.saveData=(settings)=>new Promise((resolve,reject)=>{settle=async()=>{if(settlement==="fulfilled"){await originalSaveData(settings);resolve()}else reject(new Error("synthetic persistence rejection"))}});
    const promise=plugin.saveSourceRoot(value);await Promise.resolve();
    return{promise,settle,restore:()=>{plugin.saveData=originalSaveData}};
  };
  for(const settlement of ["fulfilled","rejected"]){
    const savedPlanner=sourceController.planner;
    const planned=await savedPlanner();let resolvePlanner;
    sourceController.planner=()=>new Promise((resolve)=>{resolvePlanner=resolve});
    sourceController.invalidate();
    const previewPromise=sourceController.preview();await Promise.resolve();
    const rootValue="Runtime-Cross-Preview-"+settlement+"-"+Date.now();
    const transaction=await beginDeferredRoot(rootValue,settlement);
    const pendingState=structuredClone(plugin.settingsController.sourceRootPersistenceState);
    resolvePlanner(planned);await transaction.settle();const rootResult=await transaction.promise;transaction.restore();
    const previewResult=await previewPromise;sourceController.planner=savedPlanner;
    const afterPreview=await sourceController.preview();
    crossTransactionMatrix.push({action:"preview-before-root-transaction",settlement,rootValue,pendingState,rootResult,previewResult,afterPreview,authoritativeRoot:plugin.settings.sourceRoot,generation:plugin.settingsController.sourceWriteGeneration});
  }
  for(const settlement of ["fulfilled","rejected"]){
    const savedExecutor=sourceController.executor;
    await plugin.saveSourceRoot("Runtime-Cross-Save-Setup-"+settlement+"-"+Date.now());
    sourceController.invalidate();await sourceController.preview();
    let releaseExecutor;const gate=new Promise((resolve)=>{releaseExecutor=resolve});
    sourceController.executor=async(...args)=>{await gate;return savedExecutor(...args)};
    const savePromise=sourceController.save();await Promise.resolve();
    const rootValue="Runtime-Cross-Save-"+settlement+"-"+Date.now();
    const transaction=await beginDeferredRoot(rootValue,settlement);
    const pendingState=structuredClone(plugin.settingsController.sourceRootPersistenceState);
    await transaction.settle();const rootResult=await transaction.promise;transaction.restore();releaseExecutor();
    const saveResult=await savePromise;sourceController.executor=savedExecutor;
    sourceController.invalidate();const afterPreview=await sourceController.preview();const afterSave=await sourceController.save();
    crossTransactionMatrix.push({action:"save-before-root-transaction-during-planning",settlement,rootValue,pendingState,rootResult,saveResult,afterPreview,afterSave,authoritativeRoot:plugin.settings.sourceRoot,generation:plugin.settingsController.sourceWriteGeneration});
  }

  globalThis.__c2vEvidencePhase="harness-fixture";
  for(const folder of ["Runtime-Existing","Runtime-Partial"]){if(!fs.existsSync(path.join(vaultBase,...folder.split("/"))))await app.vault.createFolder(folder)}
  const rawNfdParent="Runtime-NFD-Cafe\\u0301";
  const priorNfdParent=path.join(vaultBase,"Runtime-NFD-Café");
  if(fs.existsSync(priorNfdParent))fs.renameSync(priorNfdParent,\`\${priorNfdParent}.stale-\${Date.now()}\`);
  if(!fs.existsSync(path.join(vaultBase,rawNfdParent)))fs.mkdirSync(path.join(vaultBase,rawNfdParent));
  await app.vault.adapter.list("");
  globalThis.__c2vEvidencePhase="plugin-plan";
  const rootStates=[];
  for(const root of ["Runtime-Existing","Runtime-Partial/Deep","Runtime-Fully-Missing/Deep/Leaf","Runtime-NFD-Café/Deep"]){
    plugin.settings={...plugin.settings,sourceRoot:root};
    const adapter=plugin.createSourceAdapter(source,conversation);
    const snapshot=await adapter.rootSnapshot();
    const plan=await adapter.plan();
    rootStates.push({configuredRoot:root,snapshot:{status:snapshot.status,error:snapshot.error,foldersToCreate:snapshot.foldersToCreate,resolvedRoot:snapshot.resolvedRoot,resolvedFolders:[...snapshot.resolvedFolders.entries()],vaultRealPath:snapshot.vaultRealPath},plan});
  }

  const rootIngressMatrix=[];
  for(const [name,root] of [["lone-high","\\ud800"],["lone-low","\\udc00"],["mixed","safe/\\ud800tail"]]){
    plugin.settings={...plugin.settings,sourceRoot:root};
    const adapter=plugin.createSourceAdapter(source,conversation);
    const calls=[];
    for(const method of ["list","lookup","readBinary"]){const original=adapter.io[method].bind(adapter.io);adapter.io[method]=async(...args)=>{calls.push({surface:"io",method,args});return original(...args)}}
    for(const method of ["aliasCapability","lstat","realpath","observeMacOSMountPoint"]){const original=adapter.native?.[method]?.bind(adapter.native);if(original)adapter.native[method]=async(...args)=>{calls.push({surface:"native",method,args});return original(...args)}}
    rootIngressMatrix.push({name,inputUtf16:[...root].map((value)=>value.codePointAt(0)),plan:await adapter.plan(),calls});
  }

  const timestampMatrix=[];
  for(const fixture of [
    {name:"ordinary",importedAt:"2026-01-01T00:00:00.000Z",createdAt:"2024-02-29T00:00:00.000Z",updatedAt:"2025-01-01T00:00:00.000Z"},
    {name:"invalid-text",importedAt:"not-a-date",createdAt:"not-a-date",updatedAt:"not-a-date"},
    {name:"impossible",importedAt:"2025-02-30T00:00:00.000Z",createdAt:"2025-02-30T00:00:00.000Z",updatedAt:"2025-02-30T00:00:00.000Z"},
    {name:"leap-valid",importedAt:"2024-02-29T00:00:00.000Z",createdAt:"2024-02-29T00:00:00.000Z",updatedAt:"2024-02-29T00:00:00.000Z"},
    {name:"leap-invalid",importedAt:"2023-02-29T00:00:00.000Z",createdAt:"2023-02-29T00:00:00.000Z",updatedAt:"2023-02-29T00:00:00.000Z"},
    {name:"extended-year",importedAt:"+010000-01-01T00:00:00.000Z",createdAt:"+010000-01-01T00:00:00.000Z",updatedAt:"+010000-01-01T00:00:00.000Z"},
  ]){
    plugin.settings={...plugin.settings,sourceRoot:"Runtime-Existing"};
    const candidateSource={...source,importedAt:fixture.importedAt};
    const candidate={...conversation,createdAt:fixture.createdAt,updatedAt:fixture.updatedAt};
    const plan=await plugin.createSourceAdapter(candidateSource,candidate).plan();
    timestampMatrix.push({fixture,plan:{disposition:plan.disposition,diagnostics:plan.diagnostics,noteContent:plan.noteContent??null,noteContentFingerprint:plan.noteContentFingerprint??null}});
  }

  const durableUnicodeMatrix=[];
  for(const [name,apply] of [
    ["title",(candidate)=>candidate.title="Title \\ud800"],
    ["text",(candidate)=>candidate.messages[0].content[0].text="Text \\ud800"],
    ["code-text",(candidate)=>candidate.messages[0].content=[{type:"code",text:"Code \\ud800",language:"ts"}]],
    ["code-language",(candidate)=>candidate.messages[0].content=[{type:"code",text:"code",language:"ts\\ud800"}]],
    ["reference-text",(candidate)=>candidate.messages[0].content=[{type:"reference",text:"Ref \\ud800",url:"https://example.invalid/"}]],
    ["reference-url",(candidate)=>candidate.messages[0].content=[{type:"reference",text:"Ref",url:"https://example.invalid/\\ud800"}]],
    ["unsupported-description",(candidate)=>candidate.messages[0].content=[{type:"unsupported",description:"Unsupported \\ud800"}]],
    ["separator-scalars",(candidate)=>candidate.messages[0].content[0].text="Body \\u2028 and \\u2029"],
    ["frontmatter-separator-scalars",(candidate)=>candidate.providerConversationId="Frontmatter \\u2028 and \\u2029"],
  ]){
    const candidate=structuredClone(conversation);apply(candidate);candidate.contentFingerprint="sha256:"+name.charCodeAt(0).toString(16).padStart(64,"0");
    const plan=await plugin.createSourceAdapter(source,candidate).plan();
    const bytes=plan.noteContent?Buffer.from(plan.noteContent):null;
    durableUnicodeMatrix.push({name,disposition:plan.disposition,diagnostics:plan.diagnostics,noteContentBase64:bytes?.toString("base64")??null,replacementByteOffsets:bytes?[...bytes].flatMap((value,index)=>value===239&&bytes[index+1]===191&&bytes[index+2]===189?[index]:[]):[],fingerprint:plan.noteContentFingerprint??null});
  }

  const provenanceSentinel="C2V_PROVENANCE_COLLISION_SENTINEL";
  const provenanceCandidate=structuredClone(conversation);
  provenanceCandidate.title=provenanceSentinel;
  provenanceCandidate.providerConversationId=provenanceSentinel;
  provenanceCandidate.messages[0].providerMessageId=provenanceSentinel;
  provenanceCandidate.messages[0].metadata={...provenanceCandidate.messages[0].metadata,diagnostic:provenanceSentinel,arbitrary:provenanceSentinel};
  provenanceCandidate.metadata={...provenanceCandidate.metadata,chatgptGraph:{...provenanceCandidate.metadata.chatgptGraph,forbiddenGraph:provenanceSentinel}};
  provenanceCandidate.messages[0].content=[{type:"text",text:provenanceSentinel},{type:"code",language:provenanceSentinel,text:provenanceSentinel},{type:"reference",text:provenanceSentinel,url:provenanceSentinel},{type:"unsupported",description:provenanceSentinel}];
  provenanceCandidate.contentFingerprint="sha256:"+"c".repeat(64);
  const provenancePlan=await plugin.createSourceAdapter(source,provenanceCandidate).plan();
  const provenanceOccurrences=provenancePlan.noteContent?[...provenancePlan.noteContent.matchAll(new RegExp(provenanceSentinel,"gu"))].map((match)=>match.index):[];
  const provenanceChanged=structuredClone(provenanceCandidate);
  provenanceChanged.messages[0].metadata={...provenanceChanged.messages[0].metadata,diagnostic:"DIFFERENT_FORBIDDEN_ONLY",arbitrary:"DIFFERENT_FORBIDDEN_ONLY"};
  provenanceChanged.metadata.chatgptGraph={...provenanceChanged.metadata.chatgptGraph,forbiddenGraph:"DIFFERENT_FORBIDDEN_ONLY"};
  const provenanceCollision={plan:provenancePlan,occurrences:provenanceOccurrences,forbiddenOnlyMetadataChangedPlan:await plugin.createSourceAdapter(source,provenanceChanged).plan()};

  const previewDisplayMatrix=[];
  const originalPlanner=sourceController.planner;
  const originalExecutor=sourceController.executor;
  for(const [name,noteContent] of [["65535","x".repeat(65535)],["65536","x".repeat(65536)],["65537","x".repeat(65537)],["astral-boundary","x".repeat(65520)+"😀"+"y".repeat(32)]]){
    const noteContentFingerprint="sha256:"+hash(Buffer.from(noteContent));
    const syntheticPlan={disposition:"new",targetPath:"Runtime-Existing/"+name+".md",noteContent,noteContentFingerprint,foldersToCreate:[],diagnostics:[]};
    sourceController.invalidate();sourceController.planner=async()=>syntheticPlan;
    let executorRequest=null;
    sourceController.executor=async(request)=>{executorRequest={noteUtf16:request.plan.noteContent.length,noteSha256:hash(Buffer.from(request.plan.noteContent))};return{status:"saved",createdPath:request.plan.targetPath,noteContentFingerprint:request.plan.noteContentFingerprint,disposition:"new",acceptedFolderPaths:[],diagnostics:[]}};
    const previewResult=await sourceController.preview();const display=sourceController.installedPreview?.display;const saveResult=await sourceController.save();
    previewDisplayMatrix.push({name,previewResult:{status:previewResult.status},display:{...display,textSha256:display?hash(Buffer.from(display.text)):null},executorRequest,saveResult});
  }
  const arbitrationRuntimeMatrix=[];
  const arbitrationContent="arbitration";const arbitrationPlan={disposition:"new",targetPath:"Runtime-Existing/arbitration.md",noteContent:arbitrationContent,noteContentFingerprint:"sha256:"+hash(Buffer.from(arbitrationContent)),foldersToCreate:[],diagnostics:[]};
  for(const invalidator of ["import","selection","clear","root","view-close","unload"]){
    const beforeAction=controllerEvidence();
    let resolvePlanner;sourceController.invalidate();sourceController.planner=()=>new Promise((resolve)=>{resolvePlanner=resolve});
    const promise=sourceController.preview();await Promise.resolve();
    const afterAcceptedActionStart=controllerEvidence();
    if(invalidator==="unload")view.loaded=false;
    view.invalidateSourceState();const afterInvalidation=controllerEvidence();resolvePlanner(arbitrationPlan);const result=await promise;const atSettlement=controllerEvidence();
    arbitrationRuntimeMatrix.push({action:"preview-invalidator",invalidator,result,installedAfter:sourceController.installedPreview??null,generation:view.sourceGeneration,loaded:view.loaded,rawArbitration:retainArbitrationEvidence({beforeAction,afterAcceptedActionStart,afterInvalidation,atSettlement})});
    view.loaded=true;
  }
  let releasePreview;sourceController.invalidate();sourceController.planner=()=>new Promise((resolve)=>{releasePreview=()=>resolve(arbitrationPlan)});const previewBeforeAction=controllerEvidence();const activePreview=sourceController.preview();await Promise.resolve();const previewAfterAcceptedActionStart=controllerEvidence();const saveWhilePreview=sourceController.save();const previewReentry=await sourceController.preview();const previewAfterCrossMutexRejections=controllerEvidence();releasePreview();const activePreviewResult=await activePreview;const previewAtSettlement=controllerEvidence();arbitrationRuntimeMatrix.push({action:"preview-mutex",saveWhilePreview,previewReentry,activePreviewResult,rawArbitration:retainArbitrationEvidence({beforeAction:previewBeforeAction,afterAcceptedActionStart:previewAfterAcceptedActionStart,afterCrossMutexRejections:previewAfterCrossMutexRejections,atSettlement:previewAtSettlement})});
  sourceController.invalidate();sourceController.planner=async()=>arbitrationPlan;await sourceController.preview();let releaseSave;sourceController.executor=()=>new Promise((resolve)=>{releaseSave=()=>resolve({status:"saved",createdPath:arbitrationPlan.targetPath,noteContentFingerprint:arbitrationPlan.noteContentFingerprint,disposition:"new",acceptedFolderPaths:[],diagnostics:[]})});const saveBeforeAction=controllerEvidence();const activeSave=sourceController.save();await Promise.resolve();const saveAfterAcceptedActionStart=controllerEvidence();const previewWhileSave=await sourceController.preview();const saveReentry=sourceController.save();const saveAfterCrossMutexRejections=controllerEvidence();const installedAfterAcceptedSaveStart=sourceController.installedPreview??null;releaseSave();const activeSaveResult=await activeSave;const saveAtSettlement=controllerEvidence();arbitrationRuntimeMatrix.push({action:"save-mutex",previewWhileSave,saveReentry,installedAfterAcceptedSaveStart,activeSaveResult,installedAfterSettlement:sourceController.installedPreview??null,rawArbitration:retainArbitrationEvidence({beforeAction:saveBeforeAction,afterAcceptedActionStart:saveAfterAcceptedActionStart,afterCrossMutexRejections:saveAfterCrossMutexRejections,atSettlement:saveAtSettlement})});
  const refreshedContent="refreshed";const refreshedPlan={...arbitrationPlan,targetPath:"Runtime-Existing/refreshed.md",noteContent:refreshedContent,noteContentFingerprint:"sha256:"+hash(Buffer.from(refreshedContent))};sourceController.invalidate();sourceController.planner=async()=>arbitrationPlan;sourceController.executor=async()=>({status:"replanned",reason:"target-changed",plan:refreshedPlan,acceptedFolderPaths:[],diagnostics:[{code:"SOURCE_WRITE_TARGET_CHANGED",severity:"error",message:"synthetic refreshed plan"}]});await sourceController.preview();const replannedBeforeAction=controllerEvidence();const replannedSave=sourceController.save();const replannedAfterAcceptedActionStart=controllerEvidence();const replannedResult=await replannedSave;const replannedAtSettlement=controllerEvidence();arbitrationRuntimeMatrix.push({action:"replanned-ui-winner",replannedResult,installedAfter:sourceController.installedPreview,rawArbitration:retainArbitrationEvidence({beforeAction:replannedBeforeAction,afterAcceptedActionStart:replannedAfterAcceptedActionStart,atSettlement:replannedAtSettlement})});
  sourceController.planner=originalPlanner;sourceController.executor=originalExecutor;sourceController.invalidate();

  plugin.settings={...plugin.settings,sourceRoot:"Runtime-Existing"};view.selected=conversation;view.invalidateSourceState();await sourceController.preview();view.draw(plugin.controller.snapshot);
  const normalZoomRuntime=[];const viewContent=view.contentEl;const originalInline={width:viewContent.style.width,minWidth:viewContent.style.minWidth,maxWidth:viewContent.style.maxWidth};const bodyTheme={light:document.body.classList.contains("theme-light"),dark:document.body.classList.contains("theme-dark")};
  const rectValue=(element)=>{const rect=element.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height,right:rect.right,bottom:rect.bottom}};
  const zoomFactor=require("electron").webFrame.getZoomFactor();
  viewContent.style.width="360px";viewContent.style.minWidth="360px";viewContent.style.maxWidth="360px";
  for(const theme of ["light","dark"]){document.body.classList.toggle("theme-light",theme==="light");document.body.classList.toggle("theme-dark",theme==="dark");await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const interactive=[...viewContent.querySelectorAll("button,input,select,textarea,[tabindex]")].filter((element)=>{const style=getComputedStyle(element);const rect=element.getBoundingClientRect();return style.display!=="none"&&style.visibility!=="hidden"&&rect.width>0&&rect.height>0});const controls=interactive.map((element)=>({tag:element.tagName.toLowerCase(),label:element.getAttribute("aria-label")??element.textContent?.trim()??"",disabled:element.disabled===true,tabIndex:element.tabIndex,rect:rectValue(element),foreground:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor}));const focusTransitions=[];for(const element of interactive.filter((candidate)=>!candidate.disabled&&candidate.tabIndex>=0)){element.focus();focusTransitions.push({label:element.getAttribute("aria-label")??element.textContent?.trim()??"",active:document.activeElement===element})}const overlaps=[];for(let left=0;left<controls.length;left+=1)for(let right=left+1;right<controls.length;right+=1){const a=controls[left].rect,b=controls[right].rect;if(a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y)overlaps.push([controls[left].label,controls[right].label])}normalZoomRuntime.push({theme,zoomFactor,clientWidth:viewContent.clientWidth,scrollWidth:viewContent.scrollWidth,rect:rectValue(viewContent),controls,focusTransitions,allFocusable:focusTransitions.every((entry)=>entry.active),overlaps,sourceRegion:cloneEvidence(viewContent.querySelector(".c2v-source")?rectValue(viewContent.querySelector(".c2v-source")):null),rawPreview:cloneEvidence(viewContent.querySelector(".c2v-source pre")?rectValue(viewContent.querySelector(".c2v-source pre")):null),statusRoles:[...viewContent.querySelectorAll('[role="status"],[role="alert"]')].map((element)=>({role:element.getAttribute("role"),text:element.textContent?.trim()??""}))})}
  viewContent.style.width=originalInline.width;viewContent.style.minWidth=originalInline.minWidth;viewContent.style.maxWidth=originalInline.maxWidth;document.body.classList.toggle("theme-light",bodyTheme.light);document.body.classList.toggle("theme-dark",bodyTheme.dark);view.draw(plugin.controller.snapshot);

  const runtimeRoot="Runtime-Network-"+Date.now();
  globalThis.__c2vEvidencePhase="plugin-network-workflow";
  await plugin.saveSourceRoot(runtimeRoot);
  const networkPreview=await sourceController.preview();
  const networkSave=await sourceController.save();
  const networkDuplicate=await sourceController.preview();
  const originalSelected=view.selected;
  const changedConversation=structuredClone(originalSelected);
  changedConversation.contentFingerprint="sha256:"+"d".repeat(64);
  changedConversation.messages[0].content[0].text="Synthetic changed runtime version.";
  view.selected=changedConversation;view.invalidateSourceState();
  const networkVersionPreview=await sourceController.preview();
  const networkVersionSave=await sourceController.save();
  view.selected=originalSelected;view.invalidateSourceState();
  const parsedPersistedSettings=JSON.parse(fs.readFileSync(dataPath,"utf8"));
  const networkWorkflow={runtimeRoot,networkPreview,networkSave,networkDuplicate,networkVersionPreview,networkVersionSave,parsedPersistedSettings,persistedKeys:Object.keys(parsedPersistedSettings).sort()};
  console.log("C2V_STAGE:save-settlement");
  const saveSettlementRuntimeMatrix=[];
  const runSaveSettlement=async(name,rootExists,configure)=>{
    const root="Runtime-Save-Settlement-"+name+"-"+Date.now();
    if(rootExists){globalThis.__c2vEvidencePhase="harness-save-settlement-fixture";await app.vault.createFolder(root)}
    globalThis.__c2vEvidencePhase="plugin-save-settlement";plugin.settings={...plugin.settings,sourceRoot:root};view.selected=conversation;view.invalidateSourceState();
    const adapter=plugin.createSourceAdapter(source,conversation);const planRecords=[];const adapterPlan=adapter.plan.bind(adapter);adapter.plan=async()=>{const value=await adapterPlan();planRecords.push(cloneEvidence(value));return value};
    const savedCreateAdapter=plugin.createSourceAdapter.bind(plugin);plugin.createSourceAdapter=()=>adapter;
    const beforePreview=controllerEvidence();const previewResult=await sourceController.preview();const installedBeforeAction=controllerEvidence();const plan=cloneEvidence(sourceController.installedPreview?.plan);
    await configure(adapter,{root,plan,setCurrent:(value)=>{if(!value)view.invalidateSourceState()}});
    const mutationStart=mutationTrace.length;let settlement="fulfilled";let result;let afterAcceptedActionStart;
    try{const saveCall=sourceController.save();afterAcceptedActionStart=controllerEvidence();result=await saveCall}catch{settlement="rejected";result=null;afterAcceptedActionStart=controllerEvidence()}
    const afterResultPublication=controllerEvidence();plugin.createSourceAdapter=savedCreateAdapter;const refreshedPlan=planRecords.at(-1)??null;
    saveSettlementRuntimeMatrix.push({name,root,initialPlan:plan,previewResult,result,mutationDelta:mutationTrace.slice(mutationStart),rawRace:{generationBefore:installedBeforeAction.generation,generationAfter:afterResultPublication.generation,operationPlan:plan,displayedPlan:installedBeforeAction.installedPreview?.plan??null,expectedPlan:planRecords[1]??null,refreshedPlan,sourceWritePlanEqual:plan!==null&&refreshedPlan!==null?runtimeExports.sourceWritePlanEqual(plan,refreshedPlan):null,promiseSettlement:settlement,acceptedFolderPaths:result?.acceptedFolderPaths??[],executionResult:cloneEvidence(result),mutexOwnership:{beforePreview,atSaveEntry:installedBeforeAction,afterAcceptedActionStart,atSettlement:afterResultPublication},installedPlanIdentity:{beforeAction:installedBeforeAction.installedPreview,afterAcceptedActionStart:afterAcceptedActionStart.installedPreview,afterResultPublication:afterResultPublication.installedPreview}}});
  };
  await runSaveSettlement("pre-folder-blocked",false,async(adapter)=>{adapter.checkpointFolder=async()=>({status:"blocked"})});
  await runSaveSettlement("post-folder-indeterminate",false,async(adapter)=>{adapter.verifyFolder=async()=>({status:"blocked",indeterminate:true})});
  await runSaveSettlement("folder-rejected-exact-directory",false,async(adapter)=>{const original=adapter.createFolder.bind(adapter);adapter.createFolder=async(pathValue)=>{await original(pathValue);throw new Error("synthetic rejected folder create")}});
  await runSaveSettlement("folder-rejected-collision-root-change",false,async(adapter,state)=>{let rejected=false;const originalList=adapter.io.list.bind(adapter.io);adapter.createFolder=async()=>{rejected=true;throw new Error("synthetic rejected folder create")};adapter.io.list=async(pathValue)=>{const rows=await originalList(pathValue);return rejected&&pathValue===""?[...rows,{path:state.root.toLowerCase(),kind:"folder"}]:rows}});
  await runSaveSettlement("folder-rejected-generic",false,async(adapter)=>{adapter.createFolder=async()=>{throw new Error("synthetic rejected folder create")}});
  await runSaveSettlement("folder-rejected-stale",false,async(adapter,state)=>{adapter.createFolder=async()=>{state.setCurrent(false);throw new Error("synthetic rejected folder create")}});
  await runSaveSettlement("note-rejected-target-appeared",true,async(adapter)=>{const original=adapter.createNote.bind(adapter);adapter.createNote=async(pathValue,content)=>{await original(pathValue,content);throw new Error("synthetic rejected note create")}});
  await runSaveSettlement("note-rejected-generic",true,async(adapter)=>{adapter.createNote=async()=>{throw new Error("synthetic rejected note create")}});
  await runSaveSettlement("note-rejected-stale",true,async(adapter,state)=>{adapter.createNote=async()=>{state.setCurrent(false);throw new Error("synthetic rejected note create")}});
  await runSaveSettlement("created-folder-reenumeration-invalid-path",false,async(adapter)=>{let created=false;const create=adapter.createFolder.bind(adapter);adapter.createFolder=async(...args)=>{await create(...args);created=true};const list=adapter.io.list.bind(adapter.io);adapter.io.list=async(pathValue)=>created?[{path:"bad\\ud800created-folder",kind:"folder"}]:list(pathValue)});
  await runSaveSettlement("created-note-readback-invalid-path",true,async(adapter)=>{let created=false;const create=adapter.createNote.bind(adapter);adapter.createNote=async(...args)=>{await create(...args);created=true};const list=adapter.io.list.bind(adapter.io);adapter.io.list=async(pathValue)=>created?[{path:"bad\\ud800created-note.md",kind:"file"}]:list(pathValue)});
  console.log("C2V_STAGE:mutation-fence");
  const mutationFenceRuntimeMatrix=[];
  const runMutationFence=async(name,kind,configure)=>{
    const root="Runtime-Mutation-Fence-"+name+"-"+Date.now();
    if(kind==="note"){globalThis.__c2vEvidencePhase="harness-mutation-fence-fixture";await app.vault.createFolder(root)}
    globalThis.__c2vEvidencePhase="plugin-mutation-fence";plugin.settings={...plugin.settings,sourceRoot:root};view.selected=conversation;view.invalidateSourceState();
    const adapter=plugin.createSourceAdapter(source,conversation);let armed=false;let planCalls=0;const planRecords=[];
    const adapterPlan=adapter.plan.bind(adapter);adapter.plan=async()=>{const value=await adapterPlan();planCalls+=1;planRecords.push(cloneEvidence(value));if(planCalls===2)armed=true;return value};
    const state={invalidate:()=>{view.invalidateSourceState()},isArmed:()=>armed};await configure(adapter,state);
    const savedCreateAdapter=plugin.createSourceAdapter.bind(plugin);plugin.createSourceAdapter=()=>adapter;
    const beforePreview=controllerEvidence();const previewResult=await sourceController.preview();const installedBeforeAction=controllerEvidence();const operationPlan=cloneEvidence(sourceController.installedPreview?.plan);const generationBefore=installedBeforeAction.generation;
    const mutationStart=mutationTrace.length;let settlement="fulfilled";let result;let afterAcceptedActionStart;
    try{const saveCall=sourceController.save();afterAcceptedActionStart=controllerEvidence();result=await saveCall}catch{settlement="rejected";result=null;afterAcceptedActionStart=controllerEvidence()}
    const afterResultPublication=controllerEvidence();plugin.createSourceAdapter=savedCreateAdapter;
    const refreshedPlan=planRecords.at(-1)??null;
    mutationFenceRuntimeMatrix.push({name,kind,planCalls,previewResult,result,mutationDelta:mutationTrace.slice(mutationStart),rawRace:{generationBefore,generationAfter:afterResultPublication.generation,operationPlan,displayedPlan:installedBeforeAction.installedPreview?.plan??null,expectedPlan:planRecords[1]??null,refreshedPlan,sourceWritePlanEqual:operationPlan!==null&&refreshedPlan!==null?runtimeExports.sourceWritePlanEqual(operationPlan,refreshedPlan):null,promiseSettlement:settlement,acceptedFolderPaths:result?.acceptedFolderPaths??[],executionResult:cloneEvidence(result),mutexOwnership:{beforePreview,atSaveEntry:installedBeforeAction,afterAcceptedActionStart,atSettlement:afterResultPublication},installedPlanIdentity:{beforeAction:installedBeforeAction.installedPreview,afterAcceptedActionStart:afterAcceptedActionStart.installedPreview,afterResultPublication:afterResultPublication.installedPreview}}});
  };
  await runMutationFence("folder-collision-enumeration","folder",async(adapter,state)=>{const original=adapter.io.list.bind(adapter.io);adapter.io.list=async(...args)=>{const value=await original(...args);if(state.isArmed())state.invalidate();return value}});
  await runMutationFence("folder-vault-visibility","folder",async(adapter,state)=>{const original=adapter.io.list.bind(adapter.io);adapter.io.list=async(...args)=>{const value=await original(...args);if(state.isArmed())state.invalidate();return value}});
  await runMutationFence("folder-native-containment","folder",async(adapter,state)=>{const original=adapter.native.realpath.bind(adapter.native);adapter.native.realpath=async(...args)=>{const value=await original(...args);if(state.isArmed())state.invalidate();return value}});
  await runMutationFence("folder-after-final-yield","folder",async(adapter,state)=>{const original=adapter.checkpointFolder.bind(adapter);adapter.checkpointFolder=async(...args)=>{const value=await original(...args);state.invalidate();return value}});
  await runMutationFence("note-final-replan","note",async(adapter,state)=>{const original=adapter.plan.bind(adapter);let calls=0;adapter.plan=async(...args)=>{const value=await original(...args);calls+=1;if(calls===3)state.invalidate();return value}});
  await runMutationFence("note-final-occupancy","note",async(adapter,state)=>{const original=adapter.io.list.bind(adapter.io);adapter.io.list=async(...args)=>{const value=await original(...args);if(state.isArmed())state.invalidate();return value}});
  await runMutationFence("note-final-containment","note",async(adapter,state)=>{const original=adapter.native.realpath.bind(adapter.native);adapter.native.realpath=async(...args)=>{const value=await original(...args);if(state.isArmed())state.invalidate();return value}});
  await runMutationFence("note-after-final-yield","note",async(adapter,state)=>{const original=adapter.checkpointFinalParent.bind(adapter);adapter.checkpointFinalParent=async(...args)=>{const value=await original(...args);state.invalidate();return value}});
  const multiRoot="Runtime-Multi-Segment-"+Date.now()+"/Child/Grandchild";
  plugin.settings={...plugin.settings,sourceRoot:multiRoot};view.selected=conversation;view.invalidateSourceState();
  const multiAdapter=plugin.createSourceAdapter(source,conversation);const multiPlan=await multiAdapter.plan();const originalMultiCreate=multiAdapter.createFolder.bind(multiAdapter);let multiCreateCount=0;
  multiAdapter.createFolder=async(pathValue)=>{await originalMultiCreate(pathValue);multiCreateCount+=1;if(multiCreateCount===1){const descendant=multiPlan.foldersToCreate[1];if(descendant&&!app.vault.getAbstractFileByPath(descendant)){globalThis.__c2vEvidencePhase="harness-external-descendant";await app.vault.createFolder(descendant);globalThis.__c2vEvidencePhase="plugin-save-settlement"}}};
  const savedMultiCreateAdapter=plugin.createSourceAdapter.bind(plugin);plugin.createSourceAdapter=()=>multiAdapter;
  const multiToken={operationGeneration:0,selectedConversationContentFingerprint:conversation.contentFingerprint,normalizedSourceRoot:multiRoot};const multiRequest={plan:multiPlan,previewGeneration:0,selectedConversationContentFingerprint:conversation.contentFingerprint,settledSourceRoot:multiRoot};
  const multiSegmentRuntime={plan:multiPlan,result:await originalExecutor(multiRequest,multiToken,()=>true),createCount:multiCreateCount};plugin.createSourceAdapter=savedMultiCreateAdapter;
  console.log("C2V_STAGE:post-create");
  const postCreateRuntimeMatrix=[];
  const originalCreateAdapter=plugin.createSourceAdapter.bind(plugin);
  for(const outcome of ["mount-point","indeterminate","realpath-escape"]){
    for(const checkpoint of [1,2,3]){
      for(const stale of [false,true]){
        const root="Runtime-Post-Create-"+outcome+"-"+checkpoint+"-"+(stale?"stale":"current")+"-"+Date.now();
        globalThis.__c2vEvidencePhase="harness-post-create-fixture";await app.vault.createFolder(root);globalThis.__c2vEvidencePhase="plugin-post-create-race";
        plugin.settings={...plugin.settings,sourceRoot:root};view.selected=conversation;view.invalidateSourceState();
        const adapter=originalCreateAdapter(source,conversation);const planRecords=[];const adapterPlan=adapter.plan.bind(adapter);adapter.plan=async()=>{const value=await adapterPlan();planRecords.push(cloneEvidence(value));return value};plugin.createSourceAdapter=()=>adapter;
        const beforePreview=controllerEvidence();const previewResult=await sourceController.preview();const installedBeforeAction=controllerEvidence();const plan=cloneEvidence(sourceController.installedPreview?.plan);
        let created=false;let parentObservations=0;
        const originalCreate=adapter.io.create.bind(adapter.io);adapter.io.create=async(pathValue,content)=>{await originalCreate(pathValue,content);created=true};
        const originalObserve=adapter.native.observeMacOSMountPoint.bind(adapter.native);
        adapter.native.observeMacOSMountPoint=async(pathValue,realPath)=>{
          if(created&&pathValue.endsWith("/"+root)&&++parentObservations===checkpoint){if(stale)view.invalidateSourceState();return outcome==="mount-point"?{kind:"mount-point"}:{kind:outcome==="indeterminate"?"indeterminate":"not-mount-point"}}
          return originalObserve(pathValue,realPath);
        };
        if(outcome==="realpath-escape"){
          const originalRealpath=adapter.native.realpath.bind(adapter.native);let postCreateRootReads=0;
          adapter.native.realpath=async(pathValue)=>created&&pathValue.endsWith("/"+root)&&++postCreateRootReads===checkpoint?{kind:"resolved",realPath:"/private/tmp/c2v-runtime-outside"}:originalRealpath(pathValue);
        }
        let settlement="fulfilled";let result;let afterAcceptedActionStart;try{const saveCall=sourceController.save();afterAcceptedActionStart=controllerEvidence();result=await saveCall}catch{settlement="rejected";result=null;afterAcceptedActionStart=controllerEvidence()}
        const afterResultPublication=controllerEvidence();const refreshedPlan=planRecords.at(-1)??null;
        postCreateRuntimeMatrix.push({outcome,checkpoint,stale,previewResult,plan:{disposition:plan?.disposition,targetPath:plan?.targetPath},created,parentObservations,result,rawRace:{generationBefore:installedBeforeAction.generation,generationAfter:afterResultPublication.generation,operationPlan:plan,displayedPlan:installedBeforeAction.installedPreview?.plan??null,expectedPlan:planRecords[1]??null,refreshedPlan,sourceWritePlanEqual:plan!==null&&refreshedPlan!==null?runtimeExports.sourceWritePlanEqual(plan,refreshedPlan):null,promiseSettlement:settlement,acceptedFolderPaths:result?.acceptedFolderPaths??[],executionResult:cloneEvidence(result),mutexOwnership:{beforePreview,atSaveEntry:installedBeforeAction,afterAcceptedActionStart,atSettlement:afterResultPublication},installedPlanIdentity:{beforeAction:installedBeforeAction.installedPreview,afterAcceptedActionStart:afterAcceptedActionStart.installedPreview,afterResultPublication:afterResultPublication.installedPreview}}});
      }
    }
  }
  for(const stale of [false,true]){
    const root="Runtime-Post-Create-between-A-note-"+(stale?"stale":"current")+"-"+Date.now();
    globalThis.__c2vEvidencePhase="harness-post-create-fixture";await app.vault.createFolder(root);globalThis.__c2vEvidencePhase="plugin-post-create-race";
    plugin.settings={...plugin.settings,sourceRoot:root};view.selected=conversation;view.invalidateSourceState();
    const adapter=originalCreateAdapter(source,conversation);const planRecords=[];const adapterPlan=adapter.plan.bind(adapter);adapter.plan=async()=>{const value=await adapterPlan();planRecords.push(cloneEvidence(value));return value};plugin.createSourceAdapter=()=>adapter;const beforePreview=controllerEvidence();const previewResult=await sourceController.preview();const installedBeforeAction=controllerEvidence();const plan=cloneEvidence(sourceController.installedPreview?.plan);let created=false;let parentObservations=0;let createdNoteObserved=false;let aliasActivated=false;
    const originalCreate=adapter.io.create.bind(adapter.io);adapter.io.create=async(pathValue,content)=>{await originalCreate(pathValue,content);created=true};
    const originalObserve=adapter.native.observeMacOSMountPoint.bind(adapter.native);adapter.native.observeMacOSMountPoint=async(pathValue,realPath)=>{
      if(created&&pathValue.endsWith("/"+root)){parentObservations+=1;if(aliasActivated){if(stale)view.invalidateSourceState();return{kind:"mount-point"}}}
      else if(created&&pathValue.endsWith(".md")){createdNoteObserved=true;aliasActivated=true}
      return originalObserve(pathValue,realPath);
    };
    let settlement="fulfilled";let result;let afterAcceptedActionStart;try{const saveCall=sourceController.save();afterAcceptedActionStart=controllerEvidence();result=await saveCall}catch{settlement="rejected";result=null;afterAcceptedActionStart=controllerEvidence()}
    const afterResultPublication=controllerEvidence();const refreshedPlan=planRecords.at(-1)??null;postCreateRuntimeMatrix.push({outcome:"mount-point",timing:"between-A-and-created-note-observation",stale,previewResult,plan:{disposition:plan?.disposition,targetPath:plan?.targetPath},created,createdNoteObserved,aliasActivated,parentObservations,result,rawRace:{generationBefore:installedBeforeAction.generation,generationAfter:afterResultPublication.generation,operationPlan:plan,displayedPlan:installedBeforeAction.installedPreview?.plan??null,expectedPlan:planRecords[1]??null,refreshedPlan,sourceWritePlanEqual:plan!==null&&refreshedPlan!==null?runtimeExports.sourceWritePlanEqual(plan,refreshedPlan):null,promiseSettlement:settlement,acceptedFolderPaths:result?.acceptedFolderPaths??[],executionResult:cloneEvidence(result),mutexOwnership:{beforePreview,atSaveEntry:installedBeforeAction,afterAcceptedActionStart,atSettlement:afterResultPublication},installedPlanIdentity:{beforeAction:installedBeforeAction.installedPreview,afterAcceptedActionStart:afterAcceptedActionStart.installedPreview,afterResultPublication:afterResultPublication.installedPreview}}});
  }
  plugin.createSourceAdapter=originalCreateAdapter;view.selected=originalSelected;view.invalidateSourceState();
  globalThis.__c2vEvidencePhase="harness-registry-fixture";
  console.log("C2V_STAGE:registry-and-physical");
  const malformedRegistryRoot="Runtime-Malformed-Registry-"+Date.now();
  await app.vault.createFolder(malformedRegistryRoot);
  const malformedRegistryFixtures=[
    ["01-bom.md",Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('---\\ntype: "ai-conversation-source"\\nknowledge_status: "source"\\n---\\n')])],
    ["02-crlf.md",Buffer.from('---\\r\\ntype: "ai-conversation-source"\\r\\nknowledge_status: "source"\\r\\n---\\r\\n')],
    ["03-missing-close.md",Buffer.from('---\\ntype: "ai-conversation-source"\\nknowledge_status: "source"\\n')],
    ["04-broken-open.md",Buffer.from('--x\\ntype: "ai-conversation-source"\\nknowledge_status: "source"\\n---\\n')],
    ["05-body-only.md",Buffer.from('ordinary body type: "ai-conversation-source" knowledge_status: "source"')],
    ["06-invalid-timestamp.md",Buffer.from('---\\nchat2vault_schema: 1\\ntype: "ai-conversation-source"\\nsource_provider: "chatgpt"\\nsource_content_fingerprint: "sha256:'+"e".repeat(64)+'"\\nsource_import_fingerprint: "sha256:'+"f".repeat(64)+'"\\nsource_message_count: 1\\nimported_at: "not-a-date"\\nknowledge_status: "source"\\n---\\n')],
    ["07-extended-year.md",Buffer.from('---\\nchat2vault_schema: 1\\ntype: "ai-conversation-source"\\nsource_provider: "chatgpt"\\nsource_content_fingerprint: "sha256:'+"e".repeat(64)+'"\\nsource_import_fingerprint: "sha256:'+"f".repeat(64)+'"\\nsource_message_count: 1\\nimported_at: "+010000-01-01T00:00:00.000Z"\\nknowledge_status: "source"\\n---\\n')],
    ["08-invalid-utf8-id.md",Buffer.concat([Buffer.from('---\\nchat2vault_schema: 1\\ntype: "ai-conversation-source"\\nsource_provider: "chatgpt"\\nsource_conversation_id: "'),Buffer.from([0xff]),Buffer.from('"\\nsource_content_fingerprint: "sha256:'+"e".repeat(64)+'"\\nsource_import_fingerprint: "sha256:'+"f".repeat(64)+'"\\nsource_message_count: 1\\nimported_at: "2026-01-01T00:00:00.000Z"\\nknowledge_status: "source"\\n---\\n')])],
    ["09-decoded-lone-surrogate.md",Buffer.from('---\\nchat2vault_schema: 1\\ntype: "ai-conversation-source"\\nsource_provider: "chatgpt"\\nsource_conversation_id: "\\\\ud800"\\nsource_content_fingerprint: "sha256:'+"e".repeat(64)+'"\\nsource_import_fingerprint: "sha256:'+"f".repeat(64)+'"\\nsource_message_count: 1\\nimported_at: "2026-01-01T00:00:00.000Z"\\nknowledge_status: "source"\\n---\\n')],
    ["10-invalid-utf8-discriminator.md",Buffer.concat([Buffer.from('---\\ntype: "ai-conversation-'),Buffer.from([0xff]),Buffer.from('source"\\nknowledge_status: "source"\\n---\\n')])],
  ];
  for(const [name,bytes] of malformedRegistryFixtures)await app.vault.createBinary(malformedRegistryRoot+"/"+name,bytes);
  plugin.settings={...plugin.settings,sourceRoot:malformedRegistryRoot};
  const malformedRegistryPlan=await plugin.createSourceAdapter(source,conversation).plan();
  const malformedRegistryRuntime={root:malformedRegistryRoot,fixtures:malformedRegistryFixtures.map(([name,bytes])=>({name,bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString("base64")})),plan:malformedRegistryPlan};
  const registryAliasInstabilityRuntime=[];
  const aliasTargetRoot="Runtime-Registry-Alias-Target-"+Date.now();const nestedAliasRoot="Runtime-Registry-Nested-Alias-"+Date.now();await app.vault.createFolder(aliasTargetRoot);await app.vault.createFolder(nestedAliasRoot);
  fs.symlinkSync(path.join(vaultBase,aliasTargetRoot),path.join(vaultBase,nestedAliasRoot,"nested-alias"),"dir");await app.vault.adapter.list(nestedAliasRoot);
  plugin.settings={...plugin.settings,sourceRoot:nestedAliasRoot};registryAliasInstabilityRuntime.push({name:"nested-descendant-alias-not-traversed",plan:await plugin.createSourceAdapter(source,conversation).plan(),rawChildren:fs.readdirSync(path.join(vaultBase,nestedAliasRoot))});
  const directAliasRoot="Runtime-Registry-Direct-Alias-"+Date.now();await app.vault.createFolder(directAliasRoot);fs.symlinkSync(path.join(vaultBase,networkSave.createdPath),path.join(vaultBase,directAliasRoot,"direct-alias.md"));await app.vault.adapter.list(directAliasRoot);
  plugin.settings={...plugin.settings,sourceRoot:directAliasRoot};const directAliasAdapter=plugin.createSourceAdapter(source,conversation);const directAliasList=directAliasAdapter.io.list.bind(directAliasAdapter.io);directAliasAdapter.io.list=async(pathValue)=>pathValue===directAliasRoot?[{path:directAliasRoot+"/direct-alias.md",kind:"file"}]:directAliasList(pathValue);registryAliasInstabilityRuntime.push({name:"direct-child-registry-alias",plan:await directAliasAdapter.plan(),lstat:fs.lstatSync(path.join(vaultBase,directAliasRoot,"direct-alias.md")).isSymbolicLink()});
  const instabilityRoot="Runtime-Registry-Instability-"+Date.now();await app.vault.createFolder(instabilityRoot);const instabilityPath=instabilityRoot+"/trusted.md";const trustedRegistryBytes=await app.vault.readBinary(app.vault.getAbstractFileByPath(networkSave.createdPath));await app.vault.createBinary(instabilityPath,trustedRegistryBytes);
  plugin.settings={...plugin.settings,sourceRoot:instabilityRoot};const instabilityAdapter=plugin.createSourceAdapter(source,conversation);const instabilityList=instabilityAdapter.io.list.bind(instabilityAdapter.io);let instabilityLists=0;instabilityAdapter.io.list=async(pathValue)=>{const rows=await instabilityList(pathValue);if(pathValue===instabilityRoot&&++instabilityLists>=2)return[];return rows};registryAliasInstabilityRuntime.push({name:"registry-enumeration-read-instability",plan:await instabilityAdapter.plan(),listCalls:instabilityLists});
  const physicalRootRuntime=[];
  const symlinkRoot="Runtime-Root-Symlink-"+Date.now();fs.symlinkSync(path.join(vaultBase,"Runtime-Existing"),path.join(vaultBase,symlinkRoot),"dir");await app.vault.adapter.list("");plugin.settings={...plugin.settings,sourceRoot:symlinkRoot};physicalRootRuntime.push({name:"posix-symlink-ancestry",plan:await plugin.createSourceAdapter(source,conversation).plan(),lstatSymbolicLink:fs.lstatSync(path.join(vaultBase,symlinkRoot)).isSymbolicLink()});
  const hiddenRoot=".Runtime-Hidden-"+Date.now();await app.vault.createFolder(hiddenRoot);plugin.settings={...plugin.settings,sourceRoot:hiddenRoot};physicalRootRuntime.push({name:"hidden-dot-root",plan:await plugin.createSourceAdapter(source,conversation).plan()});
  const obstructedRoot="Runtime-Obstructed-"+Date.now();await app.vault.create(obstructedRoot,"ordinary file");plugin.settings={...plugin.settings,sourceRoot:obstructedRoot+"/Child"};physicalRootRuntime.push({name:"ordinary-file-obstruction",plan:await plugin.createSourceAdapter(source,conversation).plan()});
  const caseMissingRoot="Runtime-Case-Missing-"+Date.now();plugin.settings={...plugin.settings,sourceRoot:caseMissingRoot};const caseMissingAdapter=plugin.createSourceAdapter(source,conversation);const caseMissingList=caseMissingAdapter.io.list.bind(caseMissingAdapter.io);caseMissingAdapter.io.list=async(pathValue)=>pathValue===""?[...(await caseMissingList(pathValue)),{path:caseMissingRoot.toLowerCase(),kind:"folder"}]:caseMissingList(pathValue);physicalRootRuntime.push({name:"case-equivalent-missing-root",configuredRoot:caseMissingRoot,plan:await caseMissingAdapter.plan()});
  const normalizationCollisionConfigured="Runtime-Normalization-Café";const normalizationCollisionAdapter=plugin.createSourceAdapter(source,conversation);plugin.settings={...plugin.settings,sourceRoot:normalizationCollisionConfigured};const normalizationCollisionList=normalizationCollisionAdapter.io.list.bind(normalizationCollisionAdapter.io);normalizationCollisionAdapter.io.list=async(pathValue)=>pathValue===""?[...(await normalizationCollisionList(pathValue)),{path:normalizationCollisionConfigured,kind:"folder"},{path:"Runtime-Normalization-Cafe\\u0301",kind:"folder"}]:normalizationCollisionList(pathValue);physicalRootRuntime.push({name:"normalization-equivalent-second-root-child",configuredRoot:normalizationCollisionConfigured,plan:await normalizationCollisionAdapter.plan()});
  plugin.settings={...plugin.settings,sourceRoot:"Runtime-Existing"};const escapeAdapter=plugin.createSourceAdapter(source,conversation);const escapeRealpath=escapeAdapter.native.realpath.bind(escapeAdapter.native);const escapeNativePath=path.join(vaultBase,"Runtime-Existing");escapeAdapter.native.realpath=async(pathValue)=>pathValue===escapeNativePath?{kind:"resolved",realPath:"/private/tmp/chat2vault-root-walk-outside"}:escapeRealpath(pathValue);physicalRootRuntime.push({name:"root-walk-realpath-escape",plan:await escapeAdapter.plan(),escapedCandidate:escapeNativePath});
  const nfdLeaf="Deep-"+Date.now();const nfdConfigured="Runtime-NFD-Café/"+nfdLeaf;plugin.settings={...plugin.settings,sourceRoot:nfdConfigured};const nfdAdapter=plugin.createSourceAdapter(source,conversation);const nfdIoTrace=[];for(const method of ["list","lookup","readBinary","createFolder","create"]){const original=nfdAdapter.io[method].bind(nfdAdapter.io);nfdAdapter.io[method]=async(...args)=>{const value=await original(...args);nfdIoTrace.push({surface:"vault",method,args:cloneEvidence(args),result:method==="list"?cloneEvidence(value):method==="lookup"?cloneEvidence(value):method==="readBinary"?{bytes:value.length,sha256:hash(Buffer.from(value))}:null});return value}}for(const method of ["aliasCapability","lstat","realpath","observeMacOSMountPoint"]){const original=nfdAdapter.native[method].bind(nfdAdapter.native);nfdAdapter.native[method]=async(...args)=>{const value=await original(...args);nfdIoTrace.push({surface:"native",method,args:cloneEvidence(args),result:cloneEvidence(value)});return value}}const nfdPlan=await nfdAdapter.plan();const nfdSavedAdapter=plugin.createSourceAdapter.bind(plugin);plugin.createSourceAdapter=()=>nfdAdapter;const nfdMutationStart=mutationTrace.length;const nfdResult=await originalExecutor({plan:nfdPlan,previewGeneration:0,selectedConversationContentFingerprint:conversation.contentFingerprint,settledSourceRoot:nfdConfigured},{operationGeneration:0,selectedConversationContentFingerprint:conversation.contentFingerprint,normalizedSourceRoot:nfdConfigured},()=>true);plugin.createSourceAdapter=nfdSavedAdapter;physicalRootRuntime.push({name:"nfd-full-save-readback",configuredRoot:nfdConfigured,rawRoot:rawNfdParent+"/"+nfdLeaf,plan:nfdPlan,result:nfdResult,ioTrace:nfdIoTrace,mutationDelta:mutationTrace.slice(nfdMutationStart),rawExists:fs.existsSync(path.join(vaultBase,rawNfdParent,nfdLeaf)),rawNoteEntries:fs.existsSync(path.join(vaultBase,rawNfdParent,nfdLeaf))?fs.readdirSync(path.join(vaultBase,rawNfdParent,nfdLeaf)):[]});
  const collisionRuntimeMatrix=[];
  const mdDirectoryRoot="Runtime-Md-Directory-"+Date.now();await app.vault.createFolder(mdDirectoryRoot);plugin.settings={...plugin.settings,sourceRoot:mdDirectoryRoot};
  const mdAdapter=plugin.createSourceAdapter(source,conversation);const mdInitial=await mdAdapter.plan();await app.vault.createFolder(mdInitial.targetPath);const mdReplanned=await plugin.createSourceAdapter(source,conversation).plan();collisionRuntimeMatrix.push({name:"candidate-md-directory",initial:mdInitial,replanned:mdReplanned});
  const injectedCollisionRoot="Runtime-Injected-Collision-"+Date.now();await app.vault.createFolder(injectedCollisionRoot);plugin.settings={...plugin.settings,sourceRoot:injectedCollisionRoot};
  const collisionAdapter=plugin.createSourceAdapter(source,conversation);const collisionInitial=await collisionAdapter.plan();const collisionList=collisionAdapter.io.list.bind(collisionAdapter.io);
  collisionAdapter.io.list=async(pathValue)=>{const entries=await collisionList(pathValue);return pathValue===injectedCollisionRoot?[...entries,{path:collisionInitial.targetPath.toLowerCase(),kind:"folder"},{path:collisionInitial.targetPath.normalize("NFD"),kind:"folder"}]:entries};
  collisionRuntimeMatrix.push({name:"case-and-unicode-equivalent-occupancy",initial:collisionInitial,replanned:await collisionAdapter.plan()});
  plugin.settings={...plugin.settings,sourceRoot:runtimeRoot};
  const duplicateSourceFile=app.vault.getAbstractFileByPath(networkSave.createdPath);const duplicateBytes=await app.vault.readBinary(duplicateSourceFile);const duplicateCopyPath=runtimeRoot+"/duplicate-copy.md";await app.vault.createBinary(duplicateCopyPath,duplicateBytes);
  const duplicateAnomaly=await plugin.createSourceAdapter(source,conversation).plan();
  const runtimeSchemaMatrix=[];
  for(const [name,mutate] of [
    ["wrong-selected-path-type",(candidate)=>candidate.metadata.chatgptGraph.selectedPathNodeIds="bad"],
    ["wrong-alternative-element",(candidate)=>candidate.metadata.chatgptGraph.alternativeLeafNodeIds=[1]],
    ["duplicate-topology-id",(candidate)=>candidate.metadata.chatgptGraph.selectedPathNodeIds=[candidate.messages[0].metadata.providerNodeId,candidate.messages[0].metadata.providerNodeId]],
    ["orphan-current",(candidate)=>candidate.metadata.chatgptGraph.currentNodeId="missing-node"],
  ]){const candidate=structuredClone(conversation);mutate(candidate);candidate.contentFingerprint="sha256:"+hash(Buffer.from(name));runtimeSchemaMatrix.push({name,plan:await plugin.createSourceAdapter(source,candidate).plan()})}
  const positiveTopologyRuntime=[];
  const branchedCandidate=structuredClone(conversation);const branchMessage=structuredClone(branchedCandidate.messages[0]);const branchNode="synthetic-alternative-node";const branchParent=branchedCandidate.messages[1]?.metadata?.providerNodeId;branchMessage.metadata={...branchMessage.metadata,providerNodeId:branchNode};branchMessage.parentMessageId=branchParent;branchMessage.providerMessageId="synthetic-message-003";branchMessage.content=[{type:"text",text:"Synthetic alternative branch."}];branchedCandidate.messages.push(branchMessage);branchedCandidate.metadata.chatgptGraph={...branchedCandidate.metadata.chatgptGraph,nodeCount:branchedCandidate.metadata.chatgptGraph.nodeCount+1,alternativeLeafNodeIds:[branchNode]};branchedCandidate.contentFingerprint="sha256:"+"3".repeat(64);positiveTopologyRuntime.push({name:"branched-alternative-leaf",plan:await plugin.createSourceAdapter(source,branchedCandidate).plan()});
  const ambiguousCandidate=structuredClone(branchedCandidate);ambiguousCandidate.metadata.chatgptGraph={...ambiguousCandidate.metadata.chatgptGraph,currentNodeId:null,selectedPathNodeIds:[],alternativeLeafNodeIds:["m0001","m0003"]};ambiguousCandidate.contentFingerprint="sha256:"+"4".repeat(64);positiveTopologyRuntime.push({name:"ambiguous-two-leaf",plan:await plugin.createSourceAdapter(source,ambiguousCandidate).plan()});
  const hostileCandidate=structuredClone(conversation);hostileCandidate.title='../../<script>"\\nHostile';hostileCandidate.messages[0].content=[{type:"text",text:'---\\n<script>alert(1)</script>\\nC2V_RUNTIME_FORBIDDEN_ONLY'}];hostileCandidate.contentFingerprint="sha256:"+"a".repeat(64);
  const hostileContentRuntime=await plugin.createSourceAdapter(source,hostileCandidate).plan();
  const forbiddenOnlySentinel="C2V_RUNTIME_DEDICATED_FORBIDDEN_ONLY";const forbiddenOnlyCandidate=structuredClone(conversation);forbiddenOnlyCandidate.contentFingerprint="sha256:"+"7".repeat(64);forbiddenOnlyCandidate.metadata={...forbiddenOnlyCandidate.metadata,forbiddenOnly:forbiddenOnlySentinel};forbiddenOnlyCandidate.messages[0].metadata={...forbiddenOnlyCandidate.messages[0].metadata,forbiddenOnly:forbiddenOnlySentinel};const forbiddenOnlyRoot="Runtime-Forbidden-Only-"+Date.now();plugin.settings={...plugin.settings,sourceRoot:forbiddenOnlyRoot};const forbiddenOnlyAdapter=plugin.createSourceAdapter(source,forbiddenOnlyCandidate);const forbiddenOnlyPlan=await forbiddenOnlyAdapter.plan();const forbiddenOnlyAdapterFactory=plugin.createSourceAdapter.bind(plugin);plugin.createSourceAdapter=()=>forbiddenOnlyAdapter;const forbiddenOnlyResult=await originalExecutor({plan:forbiddenOnlyPlan,previewGeneration:0,selectedConversationContentFingerprint:forbiddenOnlyCandidate.contentFingerprint,settledSourceRoot:forbiddenOnlyRoot},{operationGeneration:0,selectedConversationContentFingerprint:forbiddenOnlyCandidate.contentFingerprint,normalizedSourceRoot:forbiddenOnlyRoot},()=>true);plugin.createSourceAdapter=forbiddenOnlyAdapterFactory;const forbiddenOnlyVaultHits=manifest(vaultBase).filter((entry)=>entry.type==="file"&&entry.bytes<=1048576).flatMap((entry)=>{try{return fs.readFileSync(path.join(vaultBase,entry.path),"utf8").includes(forbiddenOnlySentinel)?[entry.path]:[]}catch{return[]}});const forbiddenOnlyPersistence={sentinel:forbiddenOnlySentinel,planContainsSentinel:forbiddenOnlyPlan.noteContent?.includes(forbiddenOnlySentinel)??false,result:forbiddenOnlyResult,vaultHits:forbiddenOnlyVaultHits,storageHits:[...Object.keys(localStorage),...Object.keys(sessionStorage)].filter((key)=>(localStorage.getItem(key)??sessionStorage.getItem(key)??"").includes(forbiddenOnlySentinel)),clipboardCalls:[...clipboardCalls]};
  const preReloadPlugin=plugin;await app.plugins.disablePlugin(pluginId);await app.plugins.loadPlugin(pluginId);await app.plugins.enablePlugin(pluginId);plugin=app.plugins.plugins[pluginId];plugin.settings={...plugin.settings,sourceRoot:forbiddenOnlyRoot};const reloadRegistryRuntime={pluginInstanceChanged:plugin!==preReloadPlugin,plan:await plugin.createSourceAdapter(source,forbiddenOnlyCandidate).plan()};
  const sourceFilesBeforeRootChange=[networkSave.createdPath,networkVersionSave.createdPath].map((pathValue)=>{const file=app.vault.getAbstractFileByPath(pathValue);const bytes=fs.readFileSync(path.join(vaultBase,pathValue));return{path:pathValue,bytes:bytes.length,sha256:hash(bytes),vaultVisible:!!file}});
  const rootChangeResult=await plugin.saveSourceRoot("Runtime-Root-Change-"+Date.now());
  const sourceFilesAfterRootChange=sourceFilesBeforeRootChange.map(({path:pathValue})=>{const bytes=fs.readFileSync(path.join(vaultBase,pathValue));return{path:pathValue,bytes:bytes.length,sha256:hash(bytes),vaultVisible:!!app.vault.getAbstractFileByPath(pathValue)}});
  const rootChangeRuntime={rootChangeResult,sourceFilesBeforeRootChange,sourceFilesAfterRootChange,byteIdentical:JSON.stringify(sourceFilesBeforeRootChange)===JSON.stringify(sourceFilesAfterRootChange)};
  const performanceRuntime=[];
  plugin.settings={...plugin.settings,sourceRoot:"Runtime-Existing"};
  const nearLimitConversation=structuredClone(conversation);nearLimitConversation.messages[0].content=[{type:"text",text:"N".repeat(2*1024*1024)}];nearLimitConversation.contentFingerprint="sha256:"+"b".repeat(64);
  let performanceStart=performance.now();const nearLimitPlan=await plugin.createSourceAdapter(source,nearLimitConversation).plan();performanceRuntime.push({name:"two-mib-canonical-render",elapsedMs:performance.now()-performanceStart,disposition:nearLimitPlan.disposition,noteUtf16:nearLimitPlan.noteContent?.length??null,noteSha256:nearLimitPlan.noteContent?hash(Buffer.from(nearLimitPlan.noteContent)):null});
  const largeRegistryAdapter=plugin.createSourceAdapter(source,conversation);const largeList=largeRegistryAdapter.io.list.bind(largeRegistryAdapter.io);largeRegistryAdapter.io.list=async(pathValue)=>pathValue==="Runtime-Existing"?Array.from({length:2000},(_,index)=>({path:"Runtime-Existing/synthetic-"+String(index).padStart(4,"0")+".bin",kind:"file"})):largeList(pathValue);
  performanceStart=performance.now();const largeRegistryPlan=await largeRegistryAdapter.plan();performanceRuntime.push({name:"two-thousand-direct-child-registry",elapsedMs:performance.now()-performanceStart,disposition:largeRegistryPlan.disposition,diagnosticCount:largeRegistryPlan.diagnostics.length});
  globalThis.__c2vEvidencePhase="plugin-plan";
  const planMutationCountBefore=mutationTrace.length;
  plugin.settings={...plugin.settings,sourceRoot:"Runtime-Dry-Run/Deep/Leaf"};
  const dryRunPlan=await plugin.createSourceAdapter(source,conversation).plan();
  const dryRunMutationDelta=mutationTrace.slice(planMutationCountBefore);

  const faultMatrix=[];
  const faultCase=async(name,configure)=>{plugin.settings={...plugin.settings,sourceRoot:"Runtime-Existing"};const adapter=plugin.createSourceAdapter(source,conversation);configure(adapter);const before=mutationTrace.length;const plan=await adapter.plan();faultMatrix.push({name,plan,mutationDelta:mutationTrace.slice(before)})};
  await faultCase("capability-unavailable",(adapter)=>{adapter.native.aliasCapability=async()=>({kind:"unavailable",capability:"macos-mount-point"})});
  await faultCase("lstat-indeterminate",(adapter)=>{const original=adapter.native.lstat.bind(adapter.native);adapter.native.lstat=async(nativePath)=>nativePath.endsWith("Runtime-Existing")?{kind:"indeterminate"}:original(nativePath)});
  await faultCase("realpath-indeterminate",(adapter)=>{const original=adapter.native.realpath.bind(adapter.native);adapter.native.realpath=async(nativePath)=>nativePath.endsWith("Runtime-Existing")?{kind:"indeterminate"}:original(nativePath)});
  await faultCase("config-dir-invalid-unicode",(adapter)=>{adapter.io.configDir="bad\\ud800config"});
  await faultCase("invalid-content-fingerprint",(adapter)=>{adapter.conversation={...adapter.conversation,contentFingerprint:"invalid"}});
  await faultCase("ill-formed-provider-id",(adapter)=>{adapter.conversation={...adapter.conversation,providerConversationId:"bad\\ud800id"}});
  await faultCase("root-enumeration-invalid-path",(adapter)=>{adapter.io.list=async()=>[{path:"bad\\ud800path",kind:"folder"}]});
  await faultCase("registry-candidate-enumeration-invalid-path",(adapter)=>{const list=adapter.io.list.bind(adapter.io);adapter.io.list=async(pathValue)=>pathValue==="Runtime-Existing"?[{path:"Runtime-Existing/bad\\ud800candidate.md",kind:"file"}]:list(pathValue)});
  await faultCase("vault-base-invalid-path",(adapter)=>{adapter.io.basePath="bad\\ud800base"});
  await faultCase("native-realpath-invalid-return",(adapter)=>{adapter.native.realpath=async()=>({kind:"resolved",realPath:"bad\\ud800real"})});
  await faultCase("root-lstat-permission",(adapter)=>{const original=adapter.native.lstat.bind(adapter.native);adapter.native.lstat=async(nativePath)=>nativePath.endsWith("Runtime-Existing")?{kind:"indeterminate"}:original(nativePath)});
  await faultCase("root-lstat-io",(adapter)=>{const original=adapter.native.lstat.bind(adapter.native);adapter.native.lstat=async(nativePath)=>nativePath.endsWith("Runtime-Existing")?{kind:"indeterminate"}:original(nativePath)});
  await faultCase("root-lstat-capability-loss",(adapter)=>{const original=adapter.native.lstat.bind(adapter.native);adapter.native.lstat=async(nativePath)=>nativePath.endsWith("Runtime-Existing")?{kind:"indeterminate"}:original(nativePath)});
  await faultCase("root-lstat-unknown-rejection",(adapter)=>{const original=adapter.native.lstat.bind(adapter.native);adapter.native.lstat=async(nativePath)=>{if(nativePath.endsWith("Runtime-Existing"))throw new Error("synthetic unknown lstat rejection");return original(nativePath)}});
  await faultCase("root-realpath-permission",(adapter)=>{const original=adapter.native.realpath.bind(adapter.native);adapter.native.realpath=async(nativePath)=>nativePath.endsWith("Runtime-Existing")?{kind:"indeterminate"}:original(nativePath)});
  await faultCase("root-realpath-io",(adapter)=>{const original=adapter.native.realpath.bind(adapter.native);adapter.native.realpath=async(nativePath)=>nativePath.endsWith("Runtime-Existing")?{kind:"indeterminate"}:original(nativePath)});
  await faultCase("root-realpath-capability-loss",(adapter)=>{const original=adapter.native.realpath.bind(adapter.native);adapter.native.realpath=async(nativePath)=>nativePath.endsWith("Runtime-Existing")?{kind:"indeterminate"}:original(nativePath)});
  await faultCase("root-realpath-unknown-rejection",(adapter)=>{const original=adapter.native.realpath.bind(adapter.native);adapter.native.realpath=async(nativePath)=>{if(nativePath.endsWith("Runtime-Existing"))throw new Error("synthetic unknown realpath rejection");return original(nativePath)}});
  await faultCase("macos-mount-observation-permission",(adapter)=>{adapter.native.observeMacOSMountPoint=async()=>({kind:"indeterminate"})});
  await faultCase("macos-mount-observation-io",(adapter)=>{adapter.native.observeMacOSMountPoint=async()=>({kind:"indeterminate"})});
  await faultCase("macos-mount-observation-capability-loss",(adapter)=>{adapter.native.observeMacOSMountPoint=async()=>({kind:"indeterminate"})});
  await faultCase("macos-mount-observation-malformed",(adapter)=>{adapter.native.observeMacOSMountPoint=async()=>({kind:"indeterminate"})});
  await faultCase("macos-mount-observation-unknown-rejection",(adapter)=>{adapter.native.observeMacOSMountPoint=async()=>{throw new Error("synthetic mount observation rejection")}});
  await faultCase("target-authoritative-absence",()=>{});
  await faultCase("target-probe-indeterminate",(adapter)=>{const original=adapter.native.lstat.bind(adapter.native);adapter.native.lstat=async(nativePath)=>nativePath.endsWith(".md")?{kind:"indeterminate"}:original(nativePath)});

  const containmentFixtures=[
    {name:"posix-root-child",vaultRealPath:"/",candidateRealPath:"/child",separator:"/"},
    {name:"posix-terminated-root-child",vaultRealPath:"/vault/",candidateRealPath:"/vault/child",separator:"/"},
    {name:"posix-component-near-prefix",vaultRealPath:"/vault",candidateRealPath:"/vaulted/child",separator:"/"},
    {name:"windows-drive-root-child",vaultRealPath:"C:\\\\",candidateRealPath:"C:\\\\child",separator:"\\\\"},
    {name:"windows-share-root-child",vaultRealPath:"\\\\\\\\server\\\\share\\\\",candidateRealPath:"\\\\\\\\server\\\\share\\\\child",separator:"\\\\"},
    {name:"windows-component-near-prefix",vaultRealPath:"C:\\\\vault",candidateRealPath:"C:\\\\vaulted\\\\child",separator:"\\\\"},
  ].map((fixture)=>({...fixture,nativeContainmentPrefix:fixture.vaultRealPath.endsWith(fixture.separator)?fixture.vaultRealPath:fixture.vaultRealPath+fixture.separator,contained:runtimeExports.isNativePathContained(fixture.vaultRealPath,fixture.candidateRealPath,fixture.separator)}));
  const nativeComponentCases=[];
  const componentCase=async(name,configure)=>{const calls=[];const adapter={platform:"darwin",separator:"/",aliasCapability:async(value)=>{const result={kind:"available",capability:"macos-mount-point"};calls.push({method:"aliasCapability",args:[value],result});return result},lstat:async(value)=>{const result={kind:"present",objectKind:"directory"};calls.push({method:"lstat",args:[value],result});return result},realpath:async(value)=>{const result={kind:"resolved",realPath:value};calls.push({method:"realpath",args:[value],result});return result},observeWindowsReparsePoint:async(value)=>{const result={kind:"not-reparse-point"};calls.push({method:"observeWindowsReparsePoint",args:[value],result});return result},observeMacOSMountPoint:async(value,real)=>{const result={kind:"not-mount-point"};calls.push({method:"observeMacOSMountPoint",args:[value,real],result});return result}};configure(adapter,calls);const result=await runtimeExports.verifyNativeComponent(adapter,"/vault","/vault/root");nativeComponentCases.push({name,separator:adapter.separator,vaultRealPath:"/vault",candidatePath:"/vault/root",calls,result})};
  await componentCase("trusted-directory",()=>{});
  await componentCase("authoritative-missing-child",(adapter)=>{adapter.lstat=async(value)=>({kind:"absent"})});
  for(const name of ["lstat-permission","lstat-io","lstat-capability-loss"]){await componentCase(name,(adapter)=>{adapter.lstat=async()=>({kind:"indeterminate"})})}
  await componentCase("lstat-unknown-rejection",(adapter)=>{adapter.lstat=async()=>{throw new Error("synthetic lstat rejection")}});
  for(const name of ["realpath-permission","realpath-io","realpath-capability-loss"]){await componentCase(name,(adapter)=>{adapter.realpath=async()=>({kind:"indeterminate"})})}
  await componentCase("realpath-unknown-rejection",(adapter)=>{adapter.realpath=async()=>{throw new Error("synthetic realpath rejection")}});
  await componentCase("required-object-disappearance",(adapter)=>{adapter.realpath=async()=>({kind:"absent"})});
  await componentCase("capability-unavailable",(adapter)=>{adapter.aliasCapability=async()=>({kind:"unavailable",capability:"macos-mount-point"})});
  await componentCase("capability-unknown-rejection",(adapter)=>{adapter.aliasCapability=async()=>{throw new Error("synthetic capability rejection")}});
  for(const name of ["mount-permission","mount-io","mount-capability-loss","mount-malformed"]){await componentCase(name,(adapter)=>{adapter.observeMacOSMountPoint=async()=>({kind:"indeterminate"})})}
  await componentCase("mount-unknown-rejection",(adapter)=>{adapter.observeMacOSMountPoint=async()=>{throw new Error("synthetic mount rejection")}});
  await componentCase("contained-mount-alias",(adapter)=>{adapter.observeMacOSMountPoint=async()=>({kind:"mount-point"})});
  await componentCase("realpath-escape",(adapter)=>{adapter.realpath=async()=>({kind:"resolved",realPath:"/outside/root"})});
  plugin.settings={...plugin.settings,sourceRoot:"Runtime-Existing"};const actualNativeAdapter=plugin.createSourceAdapter(source,conversation);const actualNativeCalls=[];for(const method of ["aliasCapability","lstat","realpath","observeMacOSMountPoint"]){const original=actualNativeAdapter.native[method].bind(actualNativeAdapter.native);actualNativeAdapter.native[method]=async(...args)=>{const result=await original(...args);actualNativeCalls.push({method,args:cloneEvidence(args),result:cloneEvidence(result)});return result}}const actualNativePlan=await actualNativeAdapter.plan();const nativeQualificationRuntime={separator:actualNativeAdapter.native.separator,vaultBase,containmentFixtures,nativeComponentCases,actualOrdinaryRoot:{plan:actualNativePlan,calls:actualNativeCalls}};

  const forbiddenMarker="C2V_RUNTIME_FORBIDDEN_ONLY";
  const allowedMarker="Synthetic runtime input only.";
  const scanFiles=(needle)=>manifest(vaultBase).filter((entry)=>entry.type==="file"&&entry.bytes<=1048576).flatMap((entry)=>{try{const text=fs.readFileSync(path.join(vaultBase,entry.path),"utf8");return text.includes(needle)?[entry.path]:[]}catch{return[]}});
  const storageSnapshot={localStorage:Object.keys(localStorage).sort().map((key)=>({key,valueSha256:hash(Buffer.from(localStorage.getItem(key)??"")),containsForbidden:(localStorage.getItem(key)??"").includes(forbiddenMarker)})),sessionStorage:Object.keys(sessionStorage).sort().map((key)=>({key,valueSha256:hash(Buffer.from(sessionStorage.getItem(key)??"")),containsForbidden:(sessionStorage.getItem(key)??"").includes(forbiddenMarker)})),indexedDbNames:typeof indexedDB.databases==="function"?(await indexedDB.databases()).map((entry)=>entry.name??null):[]};
  console.log("C2V_STAGE:finalize");
  const afterManifest=manifest(vaultBase);
  for(const restore of restoreMutations)restore();
  for(const restore of restoreClipboard)restore();
  if(originalFetch)globalThis.fetch=originalFetch;
  if(originalXhrOpen)globalThis.XMLHttpRequest.prototype.open=originalXhrOpen;
  if(originalBeacon)globalThis.navigator.sendBeacon=originalBeacon;
  delete globalThis.__c2vEvidencePhase;
  return {identity:{appVersion:document.title.match(/Obsidian v?([0-9.]+)/u)?.[1],electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch},disabledBaselines,loadOnlySettings:loadOnly,settingsMatrix,crossTransactionMatrix,rootStates,rootIngressMatrix,timestampMatrix,durableUnicodeMatrix,provenanceCollision,previewDisplayMatrix,arbitrationRuntimeMatrix,normalZoomRuntime,networkWorkflow,saveSettlementRuntimeMatrix,mutationFenceRuntimeMatrix,multiSegmentRuntime,postCreateRuntimeMatrix,malformedRegistryRuntime,registryAliasInstabilityRuntime,physicalRootRuntime,collisionRuntimeMatrix,duplicateAnomaly,runtimeSchemaMatrix,positiveTopologyRuntime,hostileContentRuntime,forbiddenOnlyPersistence,reloadRegistryRuntime,rootChangeRuntime,performanceRuntime,dryRun:{plan:dryRunPlan,mutationDelta:dryRunMutationDelta},faultMatrix,nativeQualificationRuntime,beforeManifest,afterManifest,mutationTrace,privacy:{forbiddenMarkerVaultHits:scanFiles(forbiddenMarker),allowedMarkerVaultHits:scanFiles(allowedMarker),storageSnapshot,clipboard:{status:"instrumented-no-content-access",calls:clipboardCalls}},networkLayerA:layerA};
})()`;
const evaluation = await command("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
});
if (evaluation.result?.exceptionDetails)
  throw new Error(JSON.stringify(evaluation.result.exceptionDetails));
const result = evaluation.result?.result?.value;
const networkLayerB = protocolEvents
  .filter((event) => event.method === "Network.requestWillBeSent")
  .map((event) => ({
    method: event.params?.request?.method,
    url: event.params?.request?.url,
    initiatorType: event.params?.initiator?.type,
  }));
socket.close();
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      harness: {
        file: "apps/obsidian-plugin/scripts/m03-runtime-deep.mjs",
        sha256: createHash("sha256")
          .update(await readFile(new URL(import.meta.url)))
          .digest("hex"),
      },
      finalProductionArtifacts,
      result,
      networkLayerB,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(
  `${JSON.stringify({ identity: result.identity, loadOnlySettings: result.loadOnlySettings.map((row) => ({ name: row.name, byteIdentical: row.byteIdentical })), settingsMatrix: result.settingsMatrix.map((row) => ({ kind: row.kind, settlement: row.settlement, firstResult: row.firstResult.status, reentry: row.reentry.status, previewDuring: row.previewDuring?.status, saveDuring: row.saveDuring?.status })), rootStates: result.rootStates.map((row) => ({ configuredRoot: row.configuredRoot, status: row.snapshot.status, foldersToCreate: row.snapshot.foldersToCreate })), rootIngressMatrix: result.rootIngressMatrix.map((row) => ({ name: row.name, diagnostic: row.plan.diagnostics?.at(-1)?.code, callCount: row.calls.length })), timestampMatrix: result.timestampMatrix.map((row) => ({ name: row.fixture.name, disposition: row.plan.disposition, diagnostic: row.plan.diagnostics?.at(-1)?.code })), previewDisplayMatrix: result.previewDisplayMatrix.map((row) => ({ name: row.name, completeness: row.display.completeness, total: row.display.totalUtf16Units, displayed: row.display.displayedUtf16Units, savedUtf16: row.executorRequest.noteUtf16 })), networkWorkflow: { save: result.networkWorkflow.networkSave?.status, duplicate: result.networkWorkflow.networkDuplicate?.plan?.disposition, newVersion: result.networkWorkflow.networkVersionSave?.status }, faultMatrix: result.faultMatrix.map((row) => ({ name: row.name, diagnostic: row.plan.diagnostics?.at(-1)?.code, mutationCount: row.mutationDelta.length })), dryRunMutationCount: result.dryRun.mutationDelta.length, forbiddenMarkerVaultHits: result.privacy.forbiddenMarkerVaultHits, networkLayerACount: result.networkLayerA.length, networkLayerBCount: networkLayerB.length }, null, 2)}\n`,
);
