import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type {
  DistillationRequest,
  DistillationValidationResult,
  M05ProviderConfig,
} from "@chat2vault/core";
import {
  ProviderController,
  type ProviderControllerServices,
  type ProviderCurrent,
} from "../src/provider-controller.js";
import {
  createRuntimeNetworkDependencies,
  M05_RUNTIME_ADDRESS,
} from "../src/runtime-test-network-seam.js";

const repositoryRoot = join(import.meta.dirname, "../../..");
const pluginRoot = join(repositoryRoot, "apps/obsidian-plugin");

const config: M05ProviderConfig = {
  endpoint: "https://m05.invalid/v1/chat/completions",
  hostname: "m05.invalid",
  port: 443,
  model: "synthetic-m05-model",
  timeoutMs: 10_000,
  maxOutputTokens: 1_024,
};

const request: DistillationRequest = {
  schemaVersion: 1,
  contractVersion: "m04-manual-v1",
  provider: "unknown",
  conversationFingerprint: `sha256:${"1".repeat(64)}`,
  messages: [],
  topology: {
    current: null,
    selectedPath: [],
    alternativeLeaves: [],
    unrepresentedNodeCount: 0,
    entries: [],
  },
  requestId: `sha256:${"2".repeat(64)}`,
};

function readyCurrent(): ProviderCurrent {
  return {
    platformEligible: true,
    unsupportedFutureSettings: false,
    identityState: "authoritative",
    credentialState: "configured",
    credentialOperationInProgress: false,
    providerSettingsSaving: false,
    cloudDisclosureAccepted: true,
    pluginGeneration: 1,
    viewGeneration: 1,
    importGeneration: 1,
    selectionGeneration: 1,
    conversationFingerprint: request.conversationFingerprint,
    request,
    prompt: "synthetic runtime prompt",
    promptBytes: 24,
    providerSettingsGeneration: 1,
    providerSaveGeneration: 1,
    credentialGeneration: 1,
    config,
  };
}

describe("M05 capability boundary", () => {
  it.each([
    [
      "success",
      { ok: true, status: 200, body: new TextEncoder().encode("{}") },
    ],
    ["failure", { ok: false, code: "PROVIDER_NETWORK_FAILED" }],
  ] as const)(
    "permits one explicit transport and zero forbidden side effects for %s",
    async (_name, transportResult) => {
      const forbidden = vi.fn(() => {
        throw new Error("forbidden M05 side effect");
      });
      const transport = vi.fn(() => Promise.resolve(transportResult));
      const services: ProviderControllerServices = {
        current: readyCurrent,
        readCredential: () => ({ ok: true, secret: "synthetic-credential" }),
        buildRequest: () => ({ ok: true, body: "{}", utf8Bytes: 2 }),
        transport,
        parseResponse: () => ({
          ok: true,
          content: "{}",
        }),
        validateResult: (): DistillationValidationResult => ({
          ok: false,
          diagnostics: [],
        }),
      };
      Object.assign(services, {
        vaultCreate: forbidden,
        vaultModify: forbidden,
        vaultDelete: forbidden,
        saveData: forbidden,
        clipboardRead: forbidden,
        backgroundTimer: forbidden,
        retryTransport: forbidden,
        secondaryTransport: forbidden,
      });
      const result = await new ProviderController(services).distill();
      expect(["invalid", "failed"]).toContain(result.status);
      expect(transport).toHaveBeenCalledOnce();
      expect(forbidden).not.toHaveBeenCalled();
    },
  );

  it("settles cancellation and stale invalidation without retry or a second transport", async () => {
    let settle!: (value: { ok: false; code: "PROVIDER_CANCELLED" }) => void;
    const transport = vi.fn(
      () =>
        new Promise<{ ok: false; code: "PROVIDER_CANCELLED" }>((resolve) => {
          settle = resolve;
        }),
    );
    const controller = new ProviderController({
      current: readyCurrent,
      readCredential: () => ({ ok: true, secret: "synthetic-credential" }),
      buildRequest: () => ({ ok: true, body: "{}", utf8Bytes: 2 }),
      transport,
    });
    const pending = controller.distill();
    expect(controller.cancel().status).toBe("cancelled");
    settle({ ok: false, code: "PROVIDER_CANCELLED" });
    expect((await pending).status).toBe("cancelled");
    expect(transport).toHaveBeenCalledOnce();

    const second = controller.distill();
    controller.invalidate("selection-change");
    settle({ ok: false, code: "PROVIDER_CANCELLED" });
    expect((await second).status).toBe("stale");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("keeps runtime-only seams absent from the production composition graph", () => {
    const main = readFileSync(join(pluginRoot, "src/main.ts"), "utf8");
    const runtime = readFileSync(
      join(pluginRoot, "src/runtime-test-entry.ts"),
      "utf8",
    );
    expect(main).not.toMatch(
      /runtime-test|alternateAccount|socketDestination|mismatchPeerAddress/u,
    );
    expect(runtime).toContain("runM05RuntimeScenarios");
    expect(
      runtime.match(/new Chat2VaultSettingTab\(this\.app, this\)/gu),
    ).toHaveLength(1);
    expect(runtime).toContain(
      "public readonly runtimeSettingTab = new Chat2VaultSettingTab(this.app, this)",
    );
    expect(runtime).toContain("this.addSettingTab(this.runtimeSettingTab)");
  });

  it("pins DNS to loopback while allowing only the supplied host-local mismatch destination", async () => {
    const mismatchAddress = "192.0.2.44";
    const dependencies = createRuntimeNetworkDependencies({
      mismatchPeer: true,
      mismatchPeerAddress: mismatchAddress,
    });
    await expect(
      dependencies.resolve4("m05.invalid", { ttl: true }),
    ).resolves.toEqual([{ address: M05_RUNTIME_ADDRESS, ttl: 60 }]);
    expect(dependencies.classifyAddress(M05_RUNTIME_ADDRESS)).toEqual({
      ok: true,
      family: 4,
      address: M05_RUNTIME_ADDRESS,
    });
    expect(dependencies.classifyAddress(mismatchAddress)).toEqual({
      ok: true,
      family: 4,
      address: mismatchAddress,
    });
    expect(dependencies.classifyAddress("192.0.2.45")).toEqual({
      ok: false,
    });
    expect(() =>
      createRuntimeNetworkDependencies({ mismatchPeer: true }),
    ).toThrow("runtime mismatch destination unavailable");
  });

  it("uses one complete runtime scenario registry for emission and validation", () => {
    const runtime = readFileSync(
      join(pluginRoot, "src/runtime-test-entry.ts"),
      "utf8",
    );
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m05-runtime.mjs"),
      "utf8",
    );
    const registryBody =
      /export const M05_RUNTIME_SCENARIO_IDS = Object\.freeze\(\[([\s\S]*?)\] as const\);/u.exec(
        runtime,
      )?.[1] ?? "";
    const ids = [...registryBody.matchAll(/"([a-z0-9-]+)"/gu)].map(
      (match) => match[1],
    );
    expect(ids).toEqual([
      "settings-v3-recovery-mutex-identity",
      "keychain-default-secondary-collision-cleanup",
      "readiness-and-credential-transitions",
      "transport-success",
      "redirect-auth-rate-limit-size-metadata",
      "unsafe-dns",
      "pinned-peer-mismatch",
      "tls-hostname-proxy-agent-socket",
      "controller-arbitration-cancel-timeout-stale",
      "response-envelope-depth-validation",
      "manual-fallback-zero-mutation-persistence-retry",
      "settings-focus-live-region",
      "candidate-focus-live-region",
      "host-zoom-geometry-screenshot",
    ]);
    expect(runtime).toContain("M05_RUNTIME_SCENARIO_IDS.map");
    expect(runner).toContain("row.scenarioRegistry");
    expect(runner).not.toContain("REQUIRED_SCENARIO_IDS");
  });

  it("configures the reserved provider before native focus traversal and promotes focus groups independently", () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m05-runtime.mjs"),
      "utf8",
    );
    const configuredSetup = runner.indexOf(
      "endpoint.value=${JSON.stringify(runtimeEndpoint)}",
    );
    const boundedControlPoll = runner.indexOf(
      "const controlsDeadline=Date.now()+5000",
    );
    const firstTraversal = runner.indexOf(
      "await dispatchTab(",
      configuredSetup,
    );
    expect(configuredSetup).toBeGreaterThan(-1);
    expect(boundedControlPoll).toBeGreaterThan(-1);
    expect(configuredSetup).toBeGreaterThan(boundedControlPoll);
    expect(firstTraversal).toBeGreaterThan(configuredSetup);
    expect(runner).toContain("while(Date.now()<controlsDeadline)");
    expect(runner).toContain('document.querySelector(".modal-container")');
    expect(runner).toContain("const restricted=buttons.length===2?buttons[0]");
    expect(runner).toContain('"Input.dispatchMouseEvent"');
    expect(runner).toContain('"mousePressed"');
    expect(runner).toContain('"candidate-settings-close"');
    expect(runner).toContain('"restricted-mode-settings-close"');
    expect(runner).toContain("await dismissRestrictedMode(rendererCommand)");
    expect(runner).toContain("code=MODAL_REMAINED count=");
    expect(runner).not.toContain("Trust author and enable plugins");
    expect(runner).not.toContain("view?.draw?.(view.controller.snapshot)");
    expect(runner).toContain(
      "Prepare manual prompt|Copy prompt|Paste strict JSON|Distill with provider|Candidates per page",
    );
    expect(runner).toContain('candidateReverse === "Distill with provider"');
    expect(runner).toContain('server.on("connection"');
    expect(runner).toContain('mismatchServer.on("connection"');
    expect(runner).not.toContain('.on("secureConnection"');
    expect(runner).toContain(
      "const pollLayout=(stage)=>Promise.race([boundedLayout(stage).catch(()=>undefined),new Promise((resolve)=>setTimeout(resolve,50))])",
    );
    expect(runner).toContain('await pollLayout("settings-open-before")');
    expect(runner).toContain(
      'const settingsRoot=app.setting?.pluginTabs?.find?.((candidate)=>candidate?.id==="chat-to-vault")?.containerEl',
    );
    expect(runner).toContain(
      "const settingsCommand = settingsDevtools?.command ?? rendererCommand",
    );
    expect(runner).toContain("attempt < 16");
    expect(runner).toContain("previousWidth === clientWidth");
    expect(runner).toContain("Math.sign(cssDelta) * 96");
    expect(runner).toContain('surface.style.width="360px"');
    expect(runner).toContain('surface.style.maxWidth="360px"');
    expect(runner).not.toContain("surface.style.zoom");
    expect(runner).toContain('markProbeStage("ui-screenshot-window-restore")');
    expect(runner).toContain(
      "window.setContentBounds(${JSON.stringify(identity?.bounds)})",
    );
    expect(runner).toContain(
      'candidate.type === "page" && candidate.id !== workspaceTargetId',
    );
    expect(runner).toContain(
      "surface=settingsRoot?.querySelector('.c2v-provider-settings')",
    );
    expect(runner).toContain('await pollLayout("provider-save-settle")');
    expect(runner).toContain('markProbeStage("ui-settings-final-width")');
    expect(runner).toContain('"settings-refocus-after-width"');
    expect(runner).not.toContain('await boundedLayout("settings-open-before")');
    expect(runner).not.toContain('await boundedLayout("provider-save-settle")');
    expect(runner).toContain(
      "surface.contains(endpoint)&&surface.contains(model)&&surface.contains(disclosure)",
    );
    expect(runner).toContain(
      "settingsRoot?.querySelector('[aria-label=\"Provider endpoint\"]')",
    );
    expect(runner).toContain(
      "settingsRoot?.querySelector('[aria-label=\"Provider model\"]')",
    );
    expect(runner).toContain(
      "settingsRoot?.querySelector('[aria-label=\"Accept cloud data disclosure\"]')",
    );
    expect(runner).toContain(
      'const openResult=app.setting.openTabById("chat-to-vault")',
    );
    expect(runner).toContain("if(openPromiseLike)await openResult");
    expect(runner).toContain(
      "if(!controlsReady||!endpoint||!model||!disclosure)",
    );
    const diagnosticBlock =
      /if\(!controlsReady\|\|!endpoint\|\|!model\|\|!disclosure\)\{([\s\S]*?)\}window\.__c2vM05SettingsStatus/u.exec(
        runner,
      )?.[1] ?? "";
    for (const field of [
      "setting=",
      "open=",
      "tabsArray=",
      "tabsObjects=",
      "tabCount=",
      "pluginTabsArray=",
      "pluginTabCount=",
      "pluginExactTab=",
      "exactTab=",
      "tabSurface=",
      "ownedTab=",
      "ownedTabIdPresent=",
      "ownedTabIdExact=",
      "ownedTabContainer=",
      "refPresent=",
      "directIdentity=",
      "tabIdentity=",
      "settingTabIdentity=",
      "instanceIdentity=",
      "settingIdentity=",
      "containerIdentity=",
      "matchedIdPresent=",
      "matchedIdExact=",
      "surface=",
      "surfaceVisible=",
      "endpoint=",
      "endpointVisible=",
      "model=",
      "modelVisible=",
      "disclosure=",
      "disclosureVisible=",
      "activeExact=",
      "promiseLike=",
    ])
      expect(diagnosticBlock).toContain(field);
    expect(diagnosticBlock).toContain(
      'pluginTabs.find((tab)=>tab?.id==="chat-to-vault")',
    );
    expect(diagnosticBlock).toContain(
      'combinedTabs.find((tab)=>tab?.id==="chat-to-vault")',
    );
    expect(diagnosticBlock).toContain(
      "pluginTabs.find((tab)=>tab?.plugin===plugin)",
    );
    expect(diagnosticBlock).toContain(
      'typeof ownedTab?.id==="string"&&ownedTab.id.length>0',
    );
    for (const identity of [
      "entry===ref",
      "entry?.tab===ref",
      "entry?.settingTab===ref",
      "entry?.instance===ref",
      "entry?.setting===ref",
      "entry?.containerEl===ref.containerEl",
    ])
      expect(diagnosticBlock).toContain(identity);
    expect(diagnosticBlock).toContain(
      'typeof matchedEntry?.id==="string"&&matchedEntry.id.length>0',
    );
    expect(diagnosticBlock).not.toMatch(
      /innerHTML|outerHTML|textContent|\.value|\.url|\.path|(?:tabs|pluginTabs)\.map|Object\.keys|Reflect\.ownKeys|JSON\.stringify\((?:tabs|pluginTabs)/u,
    );
    expect(runner).toContain(
      'stage === "settings-configure-focus" && settingsStart >= 0',
    );
    expect(runner).toContain(
      "/^M05_SETTINGS_SURFACE_UNAVAILABLE(?: [A-Za-z]+=(?:true|false|[0-9]+)){33}/u",
    );
    expect(runner).toContain('.replace(" ownedTab=", " ownedTabExists=")');
    expect(runner).toContain(
      '.replace(" ownedTabContainer=", " ownedTabContainerPresent=")',
    );
    const settingsEvaluation =
      /markProbeStage\("ui-settings-open-config-save-settle"\);([\s\S]*?)markProbeStage\("ui-settings-focus-traversal"\)/u.exec(
        runner,
      )?.[1] ?? "";
    expect(settingsEvaluation).toContain('"settings-configure-focus"');
    expect(settingsEvaluation).toContain("15_000");
    expect(runner).toContain("commandTimeoutMs = 5_000");
    expect(runner).toContain('"scenario-evaluation",\n            60_000');
    expect(runner).toContain("endpoint.dispatchEvent(new Event('input'");
    expect(runner).toContain("endpoint.dispatchEvent(new Event('change'");
    expect(runner).toContain("disclosure.checked=true");
    expect(runner).toContain("providerSaveState?.settled ===");
    const externalGroups =
      /const externalGroups = \{([\s\S]*?)\n {4}\};/u.exec(runner)?.[1] ?? "";
    expect(externalGroups).toContain(
      "completedRow.accessibility?.settingsFocusPassed === true",
    );
    expect(externalGroups).toContain(
      "completedRow.accessibility?.candidateFocusPassed === true",
    );
    expect(externalGroups).not.toContain("accessibility?.passed");
  });

  it("uses the M03-compatible mandatory main-process probe without a silent fallback", () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m05-runtime.mjs"),
      "utf8",
    );
    expect(runner).toContain('process.mainModule.require("electron")');
    expect(runner).not.toContain('const electron=require("electron")');
    expect(runner).toContain("function mainEvaluate");
    expect(runner).toContain("M05_CDP_EVALUATION_FAILED");
    expect(runner).toContain(
      "connectDevtools(mainInspectorPort, () => true, 80)",
    );
    expect(runner).toMatch(
      /connectDevtools\(\s*inspectorPort,[\s\S]*?\n\s*160,\s*\)/u,
    );
    const mainProbe =
      /markStage\("main-inspector-connect"\)([\s\S]*?)markStage\("complete"\)/u.exec(
        runner,
      )?.[1] ?? "";
    expect(mainProbe).toContain('markStage("main-inspector-trust")');
    expect(mainProbe).toContain('markStage("main-inspector-exercise")');
    expect(mainProbe).not.toMatch(/catch\s*\{\s*\}/u);
    expect(mainProbe).not.toContain("main-inspector-unavailable");
    expect(runner).toContain("Number.isSafeInteger(zoomStart?.webContentsId)");
    expect(runner).toContain("restorationFailure");
    const screenshotProbe =
      /markProbeStage\("ui-screenshot"\);([\s\S]*?)if \(!Number\.isSafeInteger/u.exec(
        runner,
      )?.[1] ?? "";
    expect(screenshotProbe).toContain("contents.capturePage()");
    expect(screenshotProbe).toContain("image.toPNG()");
    expect(screenshotProbe).toContain("fs.writeFileSync");
    expect(screenshotProbe).toMatch(/"screenshot-capture",\s*true,\s*30_000/u);
    expect(runner).not.toContain('"Page.captureScreenshot"');
    expect(runner).toContain("completedRow.zoom?.screenshot?.bytes > 0");
  });

  it("continues DevTools polling after an initial targetless JSON array", async () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m05-runtime.mjs"),
      "utf8",
    );
    const source =
      /(async function connectDevtools[\s\S]*?)\n\nfunction sanitizedProbeError/u.exec(
        runner,
      )?.[1];
    expect(source).toBeDefined();
    let fetchCount = 0;
    class SyntheticWebSocket {
      public readonly listeners = new Map<
        string,
        (event: { data: string }) => void
      >();
      public constructor(public readonly url: string) {}
      public addEventListener(
        name: string,
        listener: (event: { data: string }) => void,
      ): void {
        this.listeners.set(name, listener);
      }
      public send(raw: string): void {
        const requestMessage = JSON.parse(raw) as { id: number };
        this.listeners.get("message")?.({
          data: JSON.stringify({ id: requestMessage.id, result: {} }),
        });
      }
    }
    const responses = [
      [],
      [
        {
          type: "page",
          url: "app://obsidian.md/synthetic",
          webSocketDebuggerUrl: "ws://127.0.0.1/synthetic",
        },
      ],
    ];
    const connect = runInNewContext(`(${source ?? ""})`, {
      clearTimeout: () => undefined,
      fetch: () => {
        const value = responses[fetchCount] ?? responses.at(-1);
        fetchCount += 1;
        return Promise.resolve({ json: () => Promise.resolve(value) });
      },
      once: () => Promise.resolve([]),
      setTimeout: (resolve: () => void) => {
        resolve();
        return 0;
      },
      WebSocket: SyntheticWebSocket,
    }) as (
      port: number,
      predicate: (candidate: { type?: string }) => boolean,
      attempts?: number,
    ) => Promise<{ socket: SyntheticWebSocket }>;
    const connected = await connect(
      19_001,
      (candidate) => candidate.type === "page",
      3,
    );
    expect(fetchCount).toBe(2);
    expect(connected.socket.url).toBe("ws://127.0.0.1/synthetic");
    expect(runner).not.toContain("if (Array.isArray(targets)) break");
  });

  it("keeps generic CDP commands short while granting only scenario evaluation a longer budget", async () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m05-runtime.mjs"),
      "utf8",
    );
    const source =
      /(async function connectDevtools[\s\S]*?)\n\nfunction sanitizedProbeError/u.exec(
        runner,
      )?.[1];
    class StalledWebSocket {
      private messageListener?: (event: { data: string }) => void;

      public addEventListener(
        type: string,
        listener: (event: { data: string }) => void,
      ): void {
        if (type === "message") this.messageListener = listener;
      }

      public send(payload: string): void {
        const request = JSON.parse(payload) as { id: number; method: string };
        if (request.method === "Runtime.enable")
          this.messageListener?.({
            data: JSON.stringify({ id: request.id, result: {} }),
          });
      }
    }
    const connect = runInNewContext(`(${source ?? ""})`, {
      clearTimeout,
      fetch: () =>
        Promise.resolve({
          json: () =>
            Promise.resolve([
              {
                type: "page",
                webSocketDebuggerUrl: "ws://127.0.0.1/stalled",
              },
            ]),
        }),
      once: () => Promise.resolve([]),
      setTimeout,
      WebSocket: StalledWebSocket,
    }) as (
      port: number,
      predicate: (candidate: { type?: string }) => boolean,
      attempts: number,
      commandTimeoutMs: number,
    ) => Promise<{
      command: (
        method: string,
        params?: Record<string, unknown>,
        stage?: string,
        timeoutMs?: number,
      ) => Promise<unknown>;
    }>;
    const connected = await connect(
      19_002,
      (candidate) => candidate.type === "page",
      1,
      5,
    );
    const started = Date.now();
    await expect(connected.command("Runtime.evaluate")).rejects.toThrow(
      "M05_CDP_COMMAND_TIMEOUT stage=Runtime.evaluate",
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(runner).toContain("commandTimeoutMs = 5_000");
    const scenarioCall =
      /markStage\("scenario-evaluation"\);[\s\S]*?const response = await command\(([\s\S]*?)\);\s+if \(response\.result/u.exec(
        runner,
      )?.[1];
    expect(scenarioCall).toContain('"scenario-evaluation"');
    expect(scenarioCall).toContain("60_000");
  });

  it("rejects a stalled renderer animation frame through the bounded layout race", async () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m05-runtime.mjs"),
      "utf8",
    );
    const expression =
      /const boundedLayout=(\(stage\)=>Promise\.race\(\[[\s\S]*?\]\));const pollLayout/u.exec(
        runner,
      )?.[1];
    expect(expression).toBeDefined();
    const boundedLayout = runInNewContext(`(${expression ?? ""})`, {
      requestAnimationFrame: () => 1,
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
    }) as (stage: string) => Promise<void>;
    await expect(boundedLayout("synthetic-stall")).rejects.toThrow(
      "bounded layout timeout synthetic-stall",
    );
    const pollExpression =
      /const pollLayout=(\(stage\)=>Promise\.race\(\[[\s\S]*?\]\));await pollLayout/u.exec(
        runner,
      )?.[1];
    expect(pollExpression).toBeDefined();
    const pollLayout = runInNewContext(`(${pollExpression ?? ""})`, {
      boundedLayout: () => Promise.reject(new Error("stalled compositor")),
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
    }) as (stage: string) => Promise<void>;
    await expect(pollLayout("synthetic-stall")).resolves.toBeUndefined();
    expect(runner).toContain("const saveDeadline=Date.now()+5000");
    expect(runner).not.toContain(
      "await new Promise((resolve)=>requestAnimationFrame(resolve))",
    );
  });

  it("tracks child launch lifecycle with bounded classified stderr and no raw disclosure", () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m05-runtime.mjs"),
      "utf8",
    );
    const source =
      /(function classifyLaunchStderr[\s\S]*?)\n\nfunction launchProbeFailure/u.exec(
        runner,
      )?.[1];
    expect(source).toBeDefined();
    const lifecycleHelpers = runInNewContext(
      `(()=>{${source ?? ""};return{observeChildLifecycle}})()`,
      { Buffer },
    ) as {
      observeChildLifecycle(
        child: EventEmitter & {
          stderr: EventEmitter;
          exitCode: number | null;
          signalCode: string | null;
        },
        cap: number,
      ): {
        snapshot(): Record<string, unknown>;
      };
    };
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      exitCode: null as number | null,
      signalCode: null as string | null,
    });
    const observed = lifecycleHelpers.observeChildLifecycle(child, 32);
    expect(observed.snapshot()).toMatchObject({ alive: true, exited: false });
    child.stderr.emit(
      "data",
      Buffer.from("SIGABRT crash /private/sensitive secret-value"),
    );
    const spawnError = Object.assign(new Error("sensitive spawn failure"), {
      code: "EACCES",
    });
    child.emit("error", spawnError);
    child.emit("exit", 134, "SIGABRT");
    const snapshot = observed.snapshot();
    expect(snapshot).toMatchObject({
      alive: false,
      exited: true,
      exitCode: 134,
      signal: "SIGABRT",
      spawnErrorClass: "Error",
      spawnErrorCode: "EACCES",
      stderrCategory: "crash",
      stderrBytes: 32,
      stderrTruncated: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("sensitive");
    expect(JSON.stringify(snapshot)).not.toContain("secret-value");
    expect(runner).toContain('stdio: ["ignore", "ignore", "pipe"]');
    expect(runner).toContain('launchProbeFailure("renderer-connect"');
  });

  it("tears down only the observed direct child with bounded escalation and drain", async () => {
    const runner = readFileSync(
      join(pluginRoot, "scripts/check-m05-runtime.mjs"),
      "utf8",
    );
    const source =
      /(function classifyLaunchStderr[\s\S]*?)\n\nfunction launchProbeFailure/u.exec(
        runner,
      )?.[1];
    expect(source).toBeDefined();
    const helpers = runInNewContext(
      `(()=>{${source ?? ""};return{observeChildLifecycle,stopDirectChild}})()`,
      { Buffer, clearTimeout, setTimeout },
    ) as {
      observeChildLifecycle(child: EventEmitter & DirectChild): {
        snapshot(): { alive: boolean; exited: boolean };
        waitForExit(timeoutMs: number): Promise<boolean>;
      };
      stopDirectChild(
        child: EventEmitter & DirectChild,
        lifecycle: {
          snapshot(): { alive: boolean; exited: boolean };
          waitForExit(timeoutMs: number): Promise<boolean>;
        },
        options: {
          termWaitMs: number;
          killWaitMs: number;
          drainMs: number;
        },
      ): Promise<void>;
    };
    const signals: string[] = [];
    interface DirectChild {
      stderr: EventEmitter;
      exitCode: number | null;
      signalCode: string | null;
      kill(signal: string): boolean;
    }
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill(signal: string) {
        signals.push(signal);
        if (signal === "SIGKILL") {
          this.signalCode = signal;
          (this as EventEmitter & DirectChild).emit("exit", null, signal);
        }
        return true;
      },
    });
    const lifecycle = helpers.observeChildLifecycle(child);
    await helpers.stopDirectChild(child, lifecycle, {
      termWaitMs: 1,
      killWaitMs: 20,
      drainMs: 1,
    });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(lifecycle.snapshot()).toMatchObject({ alive: false, exited: true });
    expect(runner).not.toMatch(/pkill|killall/u);

    const stubborn = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: () => true,
    });
    const stubbornLifecycle = helpers.observeChildLifecycle(stubborn);
    await expect(
      helpers.stopDirectChild(stubborn, stubbornLifecycle, {
        termWaitMs: 1,
        killWaitMs: 1,
        drainMs: 1,
      }),
    ).rejects.toThrow("M05_RUNTIME_CLEANUP_FAILED directChildAlive=true");
  });
});
