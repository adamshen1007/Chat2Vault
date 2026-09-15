import {
  parseChatGptExport,
  parseProviderResponse,
  validateDistillationResult,
  type DistillationRequest,
  type M05ProviderConfig,
} from "@chat2vault/core";
import { Agent } from "node:https";
import { createRequire } from "node:module";
import { Plugin } from "obsidian";
import ProductionPlugin from "./main.js";
import { ImportController } from "./controller.js";
import { VIEW_TYPE, Chat2VaultView } from "./view.js";
import { sendOpenAICompatibleRequest } from "./provider-transport.js";
import {
  ProviderController,
  type ProviderCurrent,
} from "./provider-controller.js";
import {
  DEFAULT_PROVIDER_SETTINGS,
  readSettings,
  SettingsController,
  type Chat2VaultSettingsV3,
  type ProviderSettings,
} from "./settings-model.js";
import { Chat2VaultSettingTab } from "./settings.js";
import {
  createRuntimeNetworkDependencies,
  M05_RUNTIME_HOST,
} from "./runtime-test-network-seam.js";
import { runRuntimeKeychainLifecycle } from "./runtime-test-keychain.js";

export interface M05RuntimeInput {
  port: number;
  mismatchAddress: string;
  nativePath: string;
  installationId: string;
  account: string;
  secret: string;
}

export interface M05RuntimeEvidence {
  scenarioRegistry: readonly string[];
  scenarios: readonly {
    id: string;
    outcome: string;
    attempts: number;
    mutations: number;
  }[];
  observations: readonly {
    id: string;
    outcome: string;
    attempts: number;
    mutations: number;
  }[];
  keychain: {
    accountHash: string;
    isolationAccountHash: string;
    operations: number;
    finalAbsent: boolean;
    isolationFinalAbsent: boolean;
  };
}

export const M05_RUNTIME_SCENARIO_IDS = Object.freeze([
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
] as const);

const runtimePort = Number(process.env.C2V_M05_RUNTIME_PORT ?? "0");
const runtimeSecret = "synthetic-m05-credential";
const runtimeRequire = createRequire(__filename);

export default class M05RuntimePlugin extends Plugin {
  /** Retains the complete production graph in the evidence bundle. */
  public static readonly productionComposition = ProductionPlugin;
  public readonly runtimeSettingTab = new Chat2VaultSettingTab(this.app, this);
  private controller = new ImportController((files) =>
    Promise.resolve(parseChatGptExport(files)),
  );
  private invalidator: ((reason: "selection-change") => void) | undefined;
  public override settings: Chat2VaultSettingsV3 = {
    schemaVersion: 3,
    installationId: "44444444-4444-4444-8444-444444444444",
    previewMessagesPerPage: 25,
    sourceRoot: "",
    provider: {
      endpoint: `https://${M05_RUNTIME_HOST}:${String(runtimePort)}/v1/chat/completions`,
      model: "synthetic-m05-model",
      timeoutMs: 10_000,
      maxOutputTokens: 1_024,
      cloudDisclosureAccepted: true,
    },
  };
  public identityState = "authoritative" as const;
  public credentialState = "configured" as const;
  public providerSettingsStatusCode: undefined;
  public providerDraft: ProviderSettings = { ...this.settings.provider };
  private readonly stateObservers = new Set<() => void>();

  public override onload(): void {
    this.registerView(
      VIEW_TYPE,
      (leaf) =>
        new Chat2VaultView(
          leaf,
          this.controller,
          () => 25,
          undefined,
          { writeClipboard: () => Promise.resolve() },
          {
            current: () => ({
              platformEligible:
                process.platform === "darwin" && process.arch === "x64",
              unsupportedFutureSettings: false,
              identityState: "authoritative",
              credentialState: "configured",
              credentialOperationInProgress: false,
              providerSettingsSaving: false,
              cloudDisclosureAccepted: true,
              pluginGeneration: 1,
              providerSettingsGeneration: 1,
              providerSaveGeneration: 1,
              credentialGeneration: 1,
              config: config(runtimePort),
            }),
            readCredential: () => ({ ok: true, secret: runtimeSecret }),
            transport: (input) =>
              sendOpenAICompatibleRequest(
                input,
                createRuntimeNetworkDependencies(),
              ),
            observeCredentialOnViewOpen: () => ({
              ok: true,
              status: "configured",
            }),
            registerInvalidator: (invalidator) => {
              this.invalidator = invalidator;
              return () => {
                if (this.invalidator === invalidator)
                  this.invalidator = undefined;
              };
            },
          },
        ),
    );
    this.addCommand({
      id: "import-chatgpt-export",
      name: "Import ChatGPT export",
      callback: () => undefined,
    });
    this.addSettingTab(this.runtimeSettingTab);
  }

  public override onunload(): void {
    this.invalidator?.("selection-change");
    this.controller.close();
    this.stateObservers.clear();
  }

  public savePreviewMessagesPerPage(): Promise<{ status: "unchanged" }> {
    return Promise.resolve({ status: "unchanged" });
  }
  public saveSourceRoot(): Promise<{ status: "unchanged" }> {
    return Promise.resolve({ status: "unchanged" });
  }
  public setProviderDraft(draft: ProviderSettings): void {
    this.providerDraft = { ...draft };
  }
  public saveProviderSettings(): Promise<{ status: "saved" }> {
    this.settings = { ...this.settings, provider: { ...this.providerDraft } };
    for (const observer of this.stateObservers) observer();
    return Promise.resolve({ status: "saved" });
  }
  public retryProviderInitialization(): Promise<{ status: "unchanged" }> {
    return Promise.resolve({ status: "unchanged" });
  }
  public setProviderCredential(
    secret: unknown,
  ):
    | { ok: true; status: "configured" }
    | { ok: false; code: "KEYCHAIN_INPUT_INVALID" } {
    return typeof secret === "string" && secret.length > 0
      ? { ok: true, status: "configured" }
      : { ok: false, code: "KEYCHAIN_INPUT_INVALID" };
  }
  public deleteProviderCredential(): { ok: true; status: "missing" } {
    return { ok: true, status: "missing" };
  }
  public refreshProviderCredential(): { ok: true; status: "configured" } {
    return { ok: true, status: "configured" };
  }
  public registerStateObserver(observer: () => void): () => void {
    this.stateObservers.add(observer);
    return () => this.stateObservers.delete(observer);
  }

  public async importSynthetic(bytes: Uint8Array): Promise<void> {
    await this.controller.import([
      {
        name: "synthetic-runtime.json",
        size: bytes.byteLength,
        arrayBuffer: () =>
          Promise.resolve(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
          ),
      },
    ]);
  }

  public runM05RuntimeScenarios(
    input: M05RuntimeInput,
  ): Promise<M05RuntimeEvidence> {
    return runM05RuntimeScenarios(input);
  }
}

function config(port: number): M05ProviderConfig {
  return {
    endpoint: `https://${M05_RUNTIME_HOST}:${String(port)}/v1/chat/completions`,
    hostname: M05_RUNTIME_HOST,
    port,
    model: "synthetic-m05-model",
    timeoutMs: 10_000,
    maxOutputTokens: 1_024,
  };
}

async function transportScenario(
  id: string,
  input: M05RuntimeInput,
  options: Parameters<typeof createRuntimeNetworkDependencies>[0] = {},
): Promise<{
  id: string;
  outcome: string;
  attempts: number;
  mutations: number;
}> {
  const result = await sendOpenAICompatibleRequest(
    {
      config: config(input.port),
      secret: input.secret,
      body: JSON.stringify({ synthetic: id }),
      signal: new AbortController().signal,
      lifecycleFence: () => true,
    },
    createRuntimeNetworkDependencies(options),
  );
  return {
    id,
    outcome: result.ok ? "success" : result.code,
    attempts: options.unsafeDnsAddress === undefined ? 1 : 0,
    mutations: 0,
  };
}

function runtimeAssertion(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition)
    throw new Error(`runtime matrix assertion failed: ${message}`);
}

async function settingsRecoveryMutexIdentityScenario(): Promise<{
  id: string;
  outcome: string;
  attempts: number;
  mutations: number;
}> {
  const identity = "11111111-1111-4111-8111-111111111111";
  const provider = {
    endpoint: "https://m05.invalid/v1/chat/completions",
    model: "synthetic-m05-model",
    timeoutMs: 10_000 as const,
    maxOutputTokens: 1_024,
    cloudDisclosureAccepted: true,
  };
  const authoritative = readSettings({
    schemaVersion: 3,
    installationId: identity,
    previewMessagesPerPage: 25,
    sourceRoot: "",
    provider,
  });
  runtimeAssertion(
    authoritative.identityState === "authoritative" &&
      authoritative.diagnostics.length === 0 &&
      authoritative.settings.provider.endpoint === provider.endpoint,
    "authoritative v3 preservation",
  );
  const recovered = readSettings({
    schemaVersion: 3,
    installationId: identity,
    previewMessagesPerPage: 999,
    sourceRoot: "../unsafe",
    provider: { ...provider, endpoint: "http://m05.invalid" },
  });
  runtimeAssertion(
    recovered.identityState === "authoritative" &&
      recovered.settings.previewMessagesPerPage === 25 &&
      recovered.settings.sourceRoot === "" &&
      recovered.settings.provider.endpoint ===
        DEFAULT_PROVIDER_SETTINGS.endpoint &&
      recovered.diagnostics.map(({ code }) => code).join(",") ===
        "INVALID_PERSISTED_SETTINGS,INVALID_PERSISTED_SOURCE_ROOT,PROVIDER_SETTINGS_INVALID",
    "ordered field recovery diagnostics",
  );
  const pending = readSettings(
    { schemaVersion: 2, previewMessagesPerPage: 50, sourceRoot: "Sources" },
    () => identity,
  );
  runtimeAssertion(
    pending.identityState === "pending" &&
      pending.settings.installationId === identity,
    "v2 identity migration",
  );
  let fulfill!: () => void;
  const persisted: unknown[] = [];
  const controller = new SettingsController(
    pending,
    (settings) =>
      new Promise<void>((resolve) => {
        persisted.push(structuredClone(settings));
        fulfill = resolve;
      }),
    () => undefined,
  );
  const initialization = controller.initializeIdentity();
  await Promise.resolve();
  const rejectedOverlap = await controller.saveProviderSettings(provider);
  runtimeAssertion(
    rejectedOverlap.status === "in-progress" && persisted.length === 1,
    "binary non-queuing settings mutex",
  );
  fulfill();
  runtimeAssertion(
    (await initialization).status === "saved" &&
      controller.identityState === "authoritative" &&
      controller.settings.installationId === identity,
    "identity persistence fulfillment",
  );
  const future = readSettings({
    schemaVersion: 4,
    previewMessagesPerPage: 10,
    sourceRoot: "Future",
  });
  runtimeAssertion(
    future.identityState === "unsupported-future" &&
      future.providerReadiness.result === "unsupported-settings",
    "future schema remains unavailable",
  );
  const invalidIdentity = readSettings(
    {
      schemaVersion: 3,
      installationId: "invalid",
      previewMessagesPerPage: 10,
      sourceRoot: "Sources",
      provider,
    },
    () => identity,
  );
  runtimeAssertion(
    invalidIdentity.identityState === "pending" &&
      invalidIdentity.settings.installationId === identity &&
      JSON.stringify(invalidIdentity.pendingProviderBasis) ===
        JSON.stringify(provider),
    "invalid identity recovers the Provider subtree byte-for-byte",
  );
  const retainedIdentity = "22222222-2222-4222-8222-222222222222";
  const failedLoad = readSettings(
    { schemaVersion: 2, previewMessagesPerPage: 10, sourceRoot: "Before" },
    () => retainedIdentity,
  );
  let persistAttempt = 0;
  const identityAuthorizations: string[] = [];
  const failedController = new SettingsController(
    failedLoad,
    (settings) => {
      persistAttempt += 1;
      if (persistAttempt < 3)
        return Promise.reject(new Error("synthetic persistence failure"));
      persisted.push(structuredClone(settings));
      return Promise.resolve();
    },
    () => undefined,
    { onIdentityAuthorized: (value) => identityAuthorizations.push(value) },
  );
  const authorizationCount = (): number => identityAuthorizations.length;
  const currentInstallationId = (): string =>
    failedController.settings.installationId;
  const currentSourceRoot = (): string => failedController.settings.sourceRoot;
  runtimeAssertion(
    (await failedController.initializeIdentity()).status === "failed" &&
      failedController.identityState === "failed" &&
      authorizationCount() === 0,
    "identity failure grants zero authority",
  );
  runtimeAssertion(
    (await failedController.saveSourceRoot("After")).status === "failed" &&
      currentInstallationId() === retainedIdentity &&
      currentSourceRoot() === "Before" &&
      authorizationCount() === 0,
    "failed pending M03 rebase preserves identity and grants zero authority",
  );
  runtimeAssertion(
    (await failedController.retryProviderInitialization()).status === "saved" &&
      currentInstallationId() === retainedIdentity &&
      currentSourceRoot() === "Before" &&
      identityAuthorizations.join(",") === retainedIdentity,
    "same pending identity retry fulfills once",
  );
  const abandoned = new SettingsController(
    readSettings(
      { schemaVersion: 1, previewMessagesPerPage: 25 },
      () => identity,
    ),
    () => Promise.reject(new Error("synthetic ambiguous persistence")),
    () => undefined,
    { onIdentityAuthorized: (value) => identityAuthorizations.push(value) },
  );
  const abandonedAttempt = abandoned.initializeIdentity();
  abandoned.discardUnpersistedIdentityOnUnload();
  runtimeAssertion(
    (await abandonedAttempt).status === "failed" &&
      abandoned.identityState === "failed" &&
      identityAuthorizations.includes(retainedIdentity),
    "unload discards unpersisted identity without authority",
  );
  const rebaseIdentity = "55555555-5555-4555-8555-555555555555";
  const rebaseProvider = { ...provider, model: "synthetic-recovered-model" };
  const rebaseLoad = readSettings(
    {
      schemaVersion: 3,
      installationId: "invalid",
      previewMessagesPerPage: 10,
      sourceRoot: "Before",
      provider: rebaseProvider,
    },
    () => rebaseIdentity,
  );
  let rebaseAttempt = 0;
  const rebasedWrites: unknown[] = [];
  const rebasedAuthorizations: string[] = [];
  const rebased = new SettingsController(
    rebaseLoad,
    (settings) => {
      rebaseAttempt += 1;
      if (rebaseAttempt === 1)
        return Promise.reject(new Error("synthetic identity failure"));
      rebasedWrites.push(structuredClone(settings));
      return Promise.resolve();
    },
    () => undefined,
    { onIdentityAuthorized: (value) => rebasedAuthorizations.push(value) },
  );
  await rebased.initializeIdentity();
  runtimeAssertion(
    (await rebased.savePreviewMessagesPerPage(50)).status === "saved" &&
      rebased.settings.installationId === rebaseIdentity &&
      rebased.settings.previewMessagesPerPage === 50 &&
      JSON.stringify(rebased.settings.provider) ===
        JSON.stringify(rebaseProvider) &&
      rebasedAuthorizations.join(",") === rebaseIdentity,
    "fulfilled M03 edit rebases complete v3 and authorizes the same identity",
  );
  let ambiguousWrite: unknown;
  const ambiguousIdentity = "66666666-6666-4666-8666-666666666666";
  const ambiguousAuthorizations: string[] = [];
  const ambiguous = new SettingsController(
    readSettings(
      { schemaVersion: 2, previewMessagesPerPage: 25, sourceRoot: "" },
      () => ambiguousIdentity,
    ),
    (settings) => {
      ambiguousWrite = structuredClone(settings);
      return Promise.reject(new Error("synthetic ambiguous outcome"));
    },
    () => undefined,
    { onIdentityAuthorized: (value) => ambiguousAuthorizations.push(value) },
  );
  runtimeAssertion(
    (await ambiguous.initializeIdentity()).status === "failed" &&
      ambiguousAuthorizations.length === 0 &&
      readSettings(ambiguousWrite).identityState === "authoritative" &&
      readSettings(ambiguousWrite).settings.installationId ===
        ambiguousIdentity,
    "ambiguous write grants zero current authority and next load reuses durable UUID",
  );
  const futureWrites: unknown[] = [];
  const futureController = new SettingsController(
    future,
    (settings) => {
      futureWrites.push(structuredClone(settings));
      return Promise.resolve();
    },
    () => undefined,
  );
  runtimeAssertion(
    (await futureController.savePreviewMessagesPerPage(50)).status ===
      "saved" &&
      (futureWrites[0] as { schemaVersion?: unknown }).schemaVersion === 2 &&
      futureController.identityState === "unsupported-future",
    "future schema permits only explicit frozen-M03 v2 write",
  );
  const providerGenerations = rebased.captureProviderGenerations();
  const invalidProvider = await rebased.saveProviderSettings({
    ...rebaseProvider,
    endpoint: "http://m05.invalid",
  });
  runtimeAssertion(
    invalidProvider.status === "invalid" &&
      JSON.stringify(rebased.captureProviderGenerations()) ===
        JSON.stringify(providerGenerations),
    "invalid Provider draft has zero generation or persistence effect",
  );
  return {
    id: "settings-v3-recovery-mutex-identity",
    outcome: "success",
    attempts: 0,
    mutations: 0,
  };
}

async function proxyAndGlobalAgentScenario(input: M05RuntimeInput): Promise<{
  id: string;
  outcome: string;
  attempts: number;
  mutations: number;
}> {
  const priorHttpsProxy = process.env.HTTPS_PROXY;
  const priorHttpProxy = process.env.HTTP_PROXY;
  const moduleRecord = runtimeRequire("node:https") as { globalAgent: Agent };
  const priorGlobalAgent = moduleRecord.globalAgent;
  try {
    process.env.HTTPS_PROXY = "http://127.0.0.3:1";
    process.env.HTTP_PROXY = "http://127.0.0.3:1";
    moduleRecord.globalAgent = new Agent({ keepAlive: true });
    const result = await transportScenario("proxy-global-agent", input);
    runtimeAssertion(
      result.outcome === "success",
      "proxy environment and replaced global Agent are ignored",
    );
    return {
      id: "tls-hostname-proxy-agent-socket",
      outcome: result.outcome,
      attempts: result.attempts,
      mutations: 0,
    };
  } finally {
    moduleRecord.globalAgent = priorGlobalAgent;
    if (priorHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = priorHttpsProxy;
    if (priorHttpProxy === undefined) delete process.env.HTTP_PROXY;
    else process.env.HTTP_PROXY = priorHttpProxy;
  }
}

function providerCurrent(port: number): ProviderCurrent {
  const request: DistillationRequest = {
    schemaVersion: 1,
    contractVersion: "m04-manual-v1",
    provider: "unknown",
    conversationFingerprint: `sha256:${"3".repeat(64)}`,
    messages: [],
    topology: {
      current: null,
      selectedPath: [],
      alternativeLeaves: [],
      unrepresentedNodeCount: 0,
      entries: [],
    },
    requestId: `sha256:${"4".repeat(64)}`,
  };
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
    config: config(port),
  };
}

async function controllerArbitrationScenario(input: M05RuntimeInput): Promise<{
  id: string;
  outcome: string;
  attempts: number;
  mutations: number;
}> {
  let current = providerCurrent(input.port);
  const pending: ((value: { ok: false; code: "PROVIDER_STALE" }) => void)[] =
    [];
  const controller = new ProviderController({
    current: () => current,
    readCredential: (operationCurrent) =>
      operationCurrent()
        ? { ok: true, secret: input.secret }
        : { ok: false, code: "KEYCHAIN_OPERATION_STALE" },
    transport: ({ signal }) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => resolve({ ok: false, code: "PROVIDER_STALE" }),
          { once: true },
        );
        pending.push(resolve);
      }),
  });
  const first = controller.distill();
  await Promise.resolve();
  runtimeAssertion(
    controller.snapshot.status === "sending" &&
      (await controller.distill()).diagnostic?.code ===
        "PROVIDER_OPERATION_IN_PROGRESS" &&
      !controller.guardManualOperation("Prepare").ok,
    "provider/manual arbitration while sending",
  );
  runtimeAssertion(
    controller.cancel().status === "cancelled",
    "cancel wins exactly once",
  );
  runtimeAssertion(
    (await first).status === "cancelled",
    "cancel settles operation",
  );
  const second = controller.distill();
  await Promise.resolve();
  const staleSending = controller.snapshot;
  current = { ...current, selectionGeneration: 2 };
  pending.at(-1)?.({ ok: false, code: "PROVIDER_STALE" });
  const staleResult = await second;
  runtimeAssertion(
    staleResult.status === "stale" &&
      staleSending.status === "sending" &&
      controller.snapshot === staleSending,
    "generation mismatch returns stale without rewriting the sending snapshot",
  );
  const released = controller.preflight();
  runtimeAssertion(
    released.status === "ready" && released.ownerToken === undefined,
    "stale settlement releases internal ownership for immediate fresh entry",
  );
  current = {
    ...current,
    selectionGeneration: 3,
    config: { ...config(input.port), timeoutMs: 10_000 },
  };
  const timeout = await controller.distill();
  runtimeAssertion(timeout.status === "timeout", "timeout ordering");
  current = { ...current, selectionGeneration: 4, config: config(input.port) };
  const fresh = controller.distill();
  await Promise.resolve();
  controller.invalidate("manual-input");
  runtimeAssertion(
    (await fresh).status === "stale",
    "manual textarea invalidation",
  );
  return {
    id: "controller-arbitration-cancel-timeout-stale",
    outcome: "success",
    attempts: 0,
    mutations: 0,
  };
}

async function responseEnvelopeDepthScenario(input: M05RuntimeInput): Promise<{
  id: string;
  outcome: string;
  attempts: number;
  mutations: number;
}> {
  const encode = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value));
  const valid = parseProviderResponse(
    encode({
      choices: [
        {
          message: { content: "{}", refusal: "ignored", tool_calls: [] },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }),
  );
  runtimeAssertion(
    valid.ok && valid.content === "{}",
    "ignored envelope extras",
  );
  let depth: unknown = "leaf";
  for (let index = 0; index < 31; index += 1) depth = [depth];
  runtimeAssertion(
    parseProviderResponse(
      encode({ choices: [{ message: { content: "{}" } }], extra: depth }),
    ).ok,
    "envelope depth boundary accepted",
  );
  depth = [depth];
  runtimeAssertion(
    !parseProviderResponse(
      encode({ choices: [{ message: { content: "{}" } }], extra: depth }),
    ).ok && !parseProviderResponse(encode({ choices: [] })).ok,
    "excess depth and malformed envelope rejected",
  );
  const current = providerCurrent(input.port);
  const controller = new ProviderController({
    current: () => current,
    readCredential: () => ({ ok: true, secret: input.secret }),
    transport: () =>
      Promise.resolve({ ok: true, status: 200, body: encode({ choices: [] }) }),
  });
  runtimeAssertion(
    (await controller.distill()).diagnostic?.code ===
      "PROVIDER_ENVELOPE_INVALID",
    "controller routes malformed envelope through production parser",
  );
  return {
    id: "response-envelope-depth-validation",
    outcome: "success",
    attempts: 0,
    mutations: 0,
  };
}

async function manualFallbackPersistenceScenario(): Promise<{
  id: string;
  outcome: string;
  attempts: number;
  mutations: number;
}> {
  const request = providerCurrent(443).request;
  runtimeAssertion(request !== undefined, "manual request fixture exists");
  const invalid = validateDistillationResult("{}", request);
  runtimeAssertion(
    !invalid.ok,
    "strict M04 manual invalid result remains available",
  );
  let persistenceAttempts = 0;
  const loaded = readSettings(
    { schemaVersion: 2, previewMessagesPerPage: 25, sourceRoot: "" },
    () => "33333333-3333-4333-8333-333333333333",
  );
  const controller = new SettingsController(
    loaded,
    () => {
      persistenceAttempts += 1;
      return persistenceAttempts === 1
        ? Promise.reject(new Error("synthetic failure"))
        : Promise.resolve();
    },
    () => undefined,
  );
  runtimeAssertion(
    (await controller.initializeIdentity()).status === "failed" &&
      (await controller.retryProviderInitialization()).status === "saved" &&
      persistenceAttempts === 2,
    "manual fallback coexists with persistence retry",
  );
  return {
    id: "manual-fallback-zero-mutation-persistence-retry",
    outcome: "success",
    attempts: 0,
    mutations: 0,
  };
}

function readinessAndCredentialScenario(keychain: {
  operations: number;
  finalAbsent: boolean;
  isolationFinalAbsent: boolean;
}): { id: string; outcome: string; attempts: number; mutations: number } {
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
  const current: ProviderCurrent = {
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
    config: config(443),
  };
  const controller = new ProviderController({
    current: () => current,
    readCredential: () => ({ ok: false, code: "KEYCHAIN_MISSING" }),
    transport: () =>
      Promise.resolve({ ok: false, code: "PROVIDER_NETWORK_FAILED" }),
  });
  const cases: readonly [Record<string, unknown>, string | undefined][] = [
    [{ platformEligible: false }, "PROVIDER_UNSUPPORTED_PLATFORM"],
    [{ unsupportedFutureSettings: true }, undefined],
    [{ identityState: "saving" }, "PROVIDER_IDENTITY_SAVING"],
    [{ identityState: "failed" }, "PROVIDER_IDENTITY_SAVE_FAILED"],
    [{ credentialState: "unavailable" }, "KEYCHAIN_UNAVAILABLE"],
    [{ credentialState: "unknown" }, "KEYCHAIN_STATUS_UNKNOWN"],
    [{ credentialOperationInProgress: true }, "KEYCHAIN_STATUS_UNKNOWN"],
    [{ providerSettingsSaving: true }, "PROVIDER_SETTINGS_SAVING"],
    [
      { providerSettingsStatusCode: "PROVIDER_SETTINGS_SAVE_FAILED" },
      "PROVIDER_SETTINGS_SAVE_FAILED",
    ],
    [{ config: undefined }, "PROVIDER_SETTINGS_INVALID"],
    [{ cloudDisclosureAccepted: false }, "PROVIDER_DISCLOSURE_REQUIRED"],
    [{ credentialState: "missing" }, "KEYCHAIN_MISSING"],
    [{ request: undefined }, "PROVIDER_NO_ACTIVE_REQUEST"],
  ];
  for (const [patch, expected] of cases) {
    Object.assign(current, {
      platformEligible: true,
      unsupportedFutureSettings: false,
      identityState: "authoritative",
      credentialState: "configured",
      credentialOperationInProgress: false,
      providerSettingsSaving: false,
      providerSettingsStatusCode: undefined,
      cloudDisclosureAccepted: true,
      request,
      config: config(443),
      ...patch,
    });
    const snapshot = controller.preflight();
    runtimeAssertion(
      snapshot.diagnostic?.code === expected &&
        (expected !== undefined || snapshot.result === "unsupported-settings"),
      `readiness precedence ${expected ?? "unsupported-settings"}`,
    );
  }
  Object.assign(current, {
    request,
    config: config(443),
    credentialState: "configured",
  });
  runtimeAssertion(
    controller.preflight().result === "ready" &&
      keychain.operations >= 12 &&
      keychain.finalAbsent &&
      keychain.isolationFinalAbsent,
    "ready state and credential lifecycle",
  );
  return {
    id: "readiness-and-credential-transitions",
    outcome: "success",
    attempts: 0,
    mutations: 0,
  };
}

export async function runM05RuntimeScenarios(
  input: M05RuntimeInput,
): Promise<M05RuntimeEvidence> {
  const keychain = runRuntimeKeychainLifecycle(input);
  const observations = [
    await settingsRecoveryMutexIdentityScenario(),
    readinessAndCredentialScenario(keychain),
    await proxyAndGlobalAgentScenario(input),
    await controllerArbitrationScenario(input),
    await responseEnvelopeDepthScenario(input),
    await manualFallbackPersistenceScenario(),
    await transportScenario("transport-success", input),
    await transportScenario("pinned-peer-mismatch", input, {
      mismatchPeer: true,
      mismatchPeerAddress: input.mismatchAddress,
    }),
    await transportScenario("unsafe-dns", input, {
      unsafeDnsAddress: "127.0.0.3",
    }),
    await transportScenario("redirect", input),
    await transportScenario("authentication", input),
    await transportScenario("rate-limit", input),
    await transportScenario("oversized-response", input),
    await transportScenario("malformed-metadata", input),
  ];
  const observed = new Map(observations.map((item) => [item.id, item]));
  const groupedTransport = [
    ["redirect", "PROVIDER_REDIRECT_REJECTED"],
    ["authentication", "PROVIDER_AUTH_REJECTED"],
    ["rate-limit", "PROVIDER_RATE_LIMITED"],
    ["oversized-response", "PROVIDER_RESPONSE_TOO_LARGE"],
    ["malformed-metadata", "PROVIDER_RESPONSE_METADATA_INVALID"],
  ] as const;
  const completed = new Map<
    string,
    { id: string; outcome: string; attempts: number; mutations: number }
  >();
  for (const [id, outcome] of [
    ["transport-success", "success"],
    ["unsafe-dns", "PROVIDER_DNS_UNSAFE"],
    ["pinned-peer-mismatch", "PROVIDER_DNS_UNSAFE"],
  ] as const) {
    const observation = observed.get(id);
    if (observation?.outcome === outcome)
      completed.set(id, { ...observation, outcome: "success" });
  }
  if (
    groupedTransport.every(
      ([id, outcome]) => observed.get(id)?.outcome === outcome,
    )
  )
    completed.set("redirect-auth-rate-limit-size-metadata", {
      id: "redirect-auth-rate-limit-size-metadata",
      outcome: "success",
      attempts: groupedTransport.reduce(
        (total, [id]) => total + (observed.get(id)?.attempts ?? 0),
        0,
      ),
      mutations: 0,
    });
  const readiness = observed.get("readiness-and-credential-transitions");
  if (readiness?.outcome === "success") completed.set(readiness.id, readiness);
  for (const id of [
    "settings-v3-recovery-mutex-identity",
    "tls-hostname-proxy-agent-socket",
    "controller-arbitration-cancel-timeout-stale",
    "response-envelope-depth-validation",
    "manual-fallback-zero-mutation-persistence-retry",
  ] as const) {
    const observation = observed.get(id);
    if (observation?.outcome === "success") completed.set(id, observation);
  }
  const scenarios = M05_RUNTIME_SCENARIO_IDS.map(
    (id) =>
      completed.get(id) ?? {
        id,
        outcome: "not-implemented",
        attempts: 0,
        mutations: 0,
      },
  );
  return {
    scenarioRegistry: M05_RUNTIME_SCENARIO_IDS,
    scenarios,
    observations,
    keychain,
  };
}
