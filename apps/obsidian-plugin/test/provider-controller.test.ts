import { EventEmitter } from "node:events";
import {
  buildProviderRequest,
  classifyPublicAddress,
  parseProviderResponse,
  type DistillationRequest,
  type DistillationValidationResult,
  type M05ProviderConfig,
  type PreviewCandidate,
} from "@chat2vault/core";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderController,
  type ProviderControllerServices,
  type ProviderCurrent,
  type ProviderFence,
  type ProviderInvalidationReason,
} from "../src/provider-controller.js";
import type { ProviderSettingsStatusCode } from "../src/settings-model.js";
import {
  sendOpenAICompatibleRequest,
  type ProviderTransportDependencies,
  type ProviderTransportRequestOptions,
} from "../src/provider-transport.js";

const config: M05ProviderConfig = {
  endpoint: "https://api.synthetic.invalid/v1/chat/completions",
  hostname: "api.synthetic.invalid",
  port: 443,
  model: "synthetic-model",
  timeoutMs: 10_000,
  maxOutputTokens: 4_096,
};

const request = {
  schemaVersion: 1,
  contractVersion: "m04-manual-v1",
  provider: "chatgpt",
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
} satisfies DistillationRequest;

const candidate: PreviewCandidate = {
  id: "candidate-1",
  candidateFingerprint: `sha256:${"3".repeat(64)}`,
  type: "insight",
  title: "Synthetic title",
  summary: "Synthetic summary",
  body: "Synthetic body",
  status: "proposed",
  confidence: "high",
  sourceRefs: [
    {
      provider: "chatgpt",
      conversationFingerprint: request.conversationFingerprint,
      messageFingerprints: [],
    },
  ],
  suggestedLinks: [],
  suggestedTags: [],
};

const validEnvelope = new TextEncoder().encode(
  JSON.stringify({ choices: [{ message: { content: "synthetic-result" } }] }),
);

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
    prompt: "exact synthetic prompt",
    promptBytes: 22,
    providerSettingsGeneration: 1,
    providerSaveGeneration: 1,
    credentialGeneration: 1,
    config,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class CompositionSocket extends EventEmitter {
  public remoteAddress = "8.8.8.8";
  public remoteFamily = "IPv4";
  public destroy(): this {
    return this;
  }
}

class CompositionResponse extends EventEmitter {
  public readonly statusCode = 200;
  public readonly headers = { "content-type": "application/json" };
  public readonly rawHeaders: string[] = [];
  public resume(): this {
    return this;
  }
  public destroy(): this {
    return this;
  }
}

class CompositionRequest extends EventEmitter {
  public reusedSocket = false;
  public end(): void {
    return undefined;
  }
  public destroy(): this {
    return this;
  }
}

function compositionTransport(
  bodies: readonly Uint8Array[],
): ProviderControllerServices["transport"] {
  let call = 0;
  const dependencies = {
    resolve4: () => Promise.resolve([{ address: "8.8.8.8", ttl: 300 }]),
    classifyAddress: classifyPublicAddress,
    request: (
      options: ProviderTransportRequestOptions,
      onResponse: (response: CompositionResponse) => void,
    ) => {
      const outgoing = new CompositionRequest();
      const body = bodies[call++];
      queueMicrotask(() => {
        options.lookup(options.hostname, { family: 0 }, () => undefined);
        const socket = new CompositionSocket();
        outgoing.emit("socket", socket);
        socket.emit("secureConnect");
        const response = new CompositionResponse();
        onResponse(response);
        if (body !== undefined) response.emit("data", body);
        response.emit("end");
      });
      return outgoing;
    },
  } satisfies ProviderTransportDependencies;
  return (input) => sendOpenAICompatibleRequest(input, dependencies);
}

type CurrentPatch = {
  [Key in keyof ProviderCurrent]?: ProviderCurrent[Key] | undefined;
};

function harness(overrides: Partial<ProviderControllerServices> = {}) {
  let current = readyCurrent();
  const fences: ProviderFence[] = [];
  const services: ProviderControllerServices = {
    current: () => current,
    readCredential: (operationCurrent) =>
      operationCurrent()
        ? { ok: true, secret: "synthetic-credential" }
        : { ok: false, code: "KEYCHAIN_OPERATION_STALE" },
    buildRequest: buildProviderRequest,
    transport: (input) => {
      fences.push(input.lifecycleFence);
      return Promise.resolve({ ok: true, status: 200, body: validEnvelope });
    },
    parseResponse: parseProviderResponse,
    validateResult: (): DistillationValidationResult => ({
      ok: true,
      candidates: [candidate],
    }),
    ...overrides,
  };
  const controller = new ProviderController(services);
  return {
    controller,
    services,
    fences,
    current: () => current,
    mutate: (patch: CurrentPatch) => {
      Object.assign(current, patch);
      current = { ...current };
    },
  };
}

describe("M05 ProviderController readiness", () => {
  it("returns an immutable ready preflight with no secret field", () => {
    const { controller } = harness();
    const snapshot = controller.preflight();
    expect(snapshot).toMatchObject({
      status: "ready",
      host: "api.synthetic.invalid",
      model: "synthetic-model",
      promptBytes: 22,
      maxOutputTokens: 4_096,
      credentialState: "configured",
      disclosureAccepted: true,
      diagnostic: { code: "PROVIDER_READY" },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("synthetic-credential");
  });

  it.each([
    [{ platformEligible: false }, "PROVIDER_UNSUPPORTED_PLATFORM"],
    [{ identityState: "saving" }, "PROVIDER_IDENTITY_SAVING"],
    [{ identityState: "failed" }, "PROVIDER_IDENTITY_SAVE_FAILED"],
    [{ credentialState: "unavailable" }, "KEYCHAIN_UNAVAILABLE"],
    [{ credentialState: "unknown" }, "KEYCHAIN_STATUS_UNKNOWN"],
    [{ providerSettingsSaving: true }, "PROVIDER_SETTINGS_SAVING"],
    [
      {
        providerSettingsStatusCode: "PROVIDER_SETTINGS_SAVING",
        config: undefined,
      },
      "PROVIDER_SETTINGS_SAVING",
    ],
    [
      {
        providerSettingsStatusCode: "PROVIDER_SETTINGS_SAVE_FAILED",
        config: undefined,
      },
      "PROVIDER_SETTINGS_SAVE_FAILED",
    ],
    [{ config: undefined }, "PROVIDER_SETTINGS_INVALID"],
    [{ cloudDisclosureAccepted: false }, "PROVIDER_DISCLOSURE_REQUIRED"],
    [{ credentialState: "missing" }, "KEYCHAIN_MISSING"],
    [{ request: undefined }, "PROVIDER_NO_ACTIVE_REQUEST"],
  ] as const)("applies readiness precedence for %s", (patch, code) => {
    const { controller, mutate } = harness();
    mutate(patch);
    expect(controller.preflight().diagnostic?.code).toBe(code);
  });

  it("keeps future-schema warning external to M05 diagnostics", () => {
    const { controller, mutate } = harness();
    mutate({ unsupportedFutureSettings: true });
    expect(controller.preflight()).toMatchObject({
      status: "unavailable",
      result: "unsupported-settings",
      diagnostic: undefined,
    });
  });

  it("does not leak previously configured host/model when settings become invalid", () => {
    const { controller, mutate } = harness();
    controller.preflight();
    mutate({ config: undefined });
    expect(controller.preflight()).toMatchObject({
      host: undefined,
      model: undefined,
      maxOutputTokens: undefined,
    });
  });

  it("fails closed when the credential mutex is owned", () => {
    const { controller, mutate } = harness();
    mutate({ credentialOperationInProgress: true });
    expect(controller.preflight().diagnostic?.code).toBe(
      "KEYCHAIN_STATUS_UNKNOWN",
    );
  });

  it("preserves the preview and canonical preflight across settings saving, failure, and later success", async () => {
    const { controller, mutate } = harness();
    expect((await controller.distill()).status).toBe("valid");
    const previousCandidates = controller.snapshot.candidates;

    const savingStatus = "PROVIDER_SETTINGS_SAVING" satisfies Exclude<
      ProviderSettingsStatusCode,
      undefined
    >;
    mutate({
      providerSettingsSaving: true,
      providerSettingsStatusCode: savingStatus,
    });
    expect(controller.preflight()).toMatchObject({
      status: "unconfigured",
      result: "saving",
      host: "api.synthetic.invalid",
      model: "synthetic-model",
      promptBytes: 22,
      maxOutputTokens: 4_096,
      candidates: previousCandidates,
      diagnostic: {
        code: "PROVIDER_SETTINGS_SAVING",
        message: "Provider settings are being saved.",
      },
    });

    const failureStatus = "PROVIDER_SETTINGS_SAVE_FAILED" satisfies Exclude<
      ProviderSettingsStatusCode,
      undefined
    >;
    mutate({
      providerSettingsSaving: false,
      providerSettingsStatusCode: failureStatus,
    });
    expect(controller.preflight()).toMatchObject({
      status: "unconfigured",
      result: "settings-failed",
      host: "api.synthetic.invalid",
      model: "synthetic-model",
      promptBytes: 22,
      maxOutputTokens: 4_096,
      candidates: previousCandidates,
      diagnostic: {
        code: "PROVIDER_SETTINGS_SAVE_FAILED",
        message: "Provider settings could not be saved.",
      },
    });

    mutate({
      providerSettingsStatusCode: undefined,
      providerSaveGeneration: 3,
      providerSettingsGeneration: 2,
      config: { ...config, model: "synthetic-model-v2" },
    });
    expect(controller.preflight()).toMatchObject({
      status: "ready",
      result: "ready",
      host: "api.synthetic.invalid",
      model: "synthetic-model-v2",
      promptBytes: 22,
      maxOutputTokens: 4_096,
      candidates: previousCandidates,
      diagnostic: { code: "PROVIDER_READY" },
    });
  });
});

describe("M05 ProviderController execution", () => {
  it("installs a valid result and replaces the preview", async () => {
    const { controller } = harness();
    expect((await controller.distill()).status).toBe("valid");
    expect(controller.snapshot).toMatchObject({
      status: "valid",
      candidates: [candidate],
      diagnostic: { code: "PROVIDER_VALID" },
    });
  });

  it("preserves a previous valid preview across failed, invalid, and cancelled runs", async () => {
    const queue = [
      { ok: true as const, status: 200 as const, body: validEnvelope },
      { ok: false as const, code: "PROVIDER_NETWORK_FAILED" as const },
      {
        ok: true as const,
        status: 200 as const,
        body: new TextEncoder().encode("{}"),
      },
    ];
    const pending = deferred<never>();
    const transport = vi.fn(async () => queue.shift() ?? pending.promise);
    const { controller } = harness({ transport });
    await controller.distill();
    const previous = controller.snapshot.candidates;
    expect((await controller.distill()).status).toBe("failed");
    expect(controller.snapshot.candidates).toEqual(previous);
    expect((await controller.distill()).status).toBe("invalid");
    expect(controller.snapshot.candidates).toEqual(previous);
    const running = controller.distill();
    expect(controller.cancel()).toMatchObject({ status: "cancelled" });
    expect((await running).status).toBe("cancelled");
    expect(controller.snapshot.candidates).toEqual(previous);
  });

  it("clears the mutable transport input immediately after synchronous handoff", async () => {
    let inputSeen:
      Parameters<ProviderControllerServices["transport"]>[0] | undefined;
    let synchronousSecret: string | undefined;
    const { controller } = harness({
      transport: (input) => {
        inputSeen = input;
        synchronousSecret = input.secret;
        return Promise.resolve({ ok: true, status: 200, body: validEnvelope });
      },
    });
    await controller.distill();
    expect(synchronousSecret).toBe("synthetic-credential");
    expect(inputSeen?.secret).toBeUndefined();
    expect(JSON.stringify(controller.snapshot)).not.toContain(
      "synthetic-credential",
    );
  });

  it("clears the transport input before a hanging request settles", async () => {
    const pending = deferred<never>();
    let inputSeen:
      Parameters<ProviderControllerServices["transport"]>[0] | undefined;
    const { controller } = harness({
      transport: (input) => {
        inputSeen = input;
        expect(input.secret).toBe("synthetic-credential");
        return pending.promise;
      },
    });
    const running = controller.distill();
    expect(inputSeen?.secret).toBeUndefined();
    controller.cancel();
    await running;
  });

  it("clears the transport input when transport throws synchronously", async () => {
    let inputSeen:
      Parameters<ProviderControllerServices["transport"]>[0] | undefined;
    const { controller } = harness({
      transport: (input) => {
        inputSeen = input;
        expect(input.secret).toBe("synthetic-credential");
        throw new Error("synthetic sync failure");
      },
    });
    expect((await controller.distill()).status).toBe("failed");
    expect(inputSeen?.secret).toBeUndefined();
  });

  it("builds the exact body from the captured prompt, model, and output cap", async () => {
    let body = "";
    const { controller } = harness({
      transport: (input) => {
        body = input.body;
        return Promise.resolve({ ok: true, status: 200, body: validEnvelope });
      },
    });
    await controller.distill();
    expect(body).toBe(
      JSON.stringify({
        model: "synthetic-model",
        messages: [{ role: "user", content: "exact synthetic prompt" }],
        response_format: { type: "json_object" },
        max_tokens: 4_096,
        stream: false,
      }),
    );
  });

  it.each([
    "pluginGeneration",
    "viewGeneration",
    "importGeneration",
    "selectionGeneration",
    "providerSettingsGeneration",
    "providerSaveGeneration",
    "credentialGeneration",
  ] as const)(
    "returns stale when %s changes at a transport fence",
    async (key) => {
      const h = harness({
        transport: (input) => {
          h.mutate({ [key]: h.current()[key] + 1 });
          expect(input.lifecycleFence("dns")).toBe(false);
          return Promise.resolve({
            ok: true,
            status: 200,
            body: validEnvelope,
          });
        },
      });
      expect((await h.controller.distill()).status).toBe("stale");
      expect(h.controller.snapshot.status).toBe("sending");
      expect(h.controller.preflight()).toMatchObject({
        status: "ready",
        ownerToken: undefined,
      });
    },
  );

  it.each([
    "keychain",
    "dns",
    "pre-connect",
    "headers",
    "chunk",
    "envelope",
    "validation",
    "publish",
  ] as const)("provides a current fence at %s", async (stage) => {
    const observed: string[] = [];
    const { controller } = harness({
      transport: (input) => {
        observed.push(stage);
        expect(input.lifecycleFence(stage)).toBe(true);
        return Promise.resolve({ ok: true, status: 200, body: validEnvelope });
      },
    });
    expect((await controller.distill()).status).toBe("valid");
    expect(observed).toEqual([stage]);
  });

  it.each([
    "keychain",
    "dns",
    "pre-connect",
    "headers",
    "chunk",
    "envelope",
    "validation",
    "publish",
  ] as const)(
    "aborts and cannot publish when the %s fence is stale",
    async (stage) => {
      const h = harness({
        transport: (input) => {
          h.mutate({ selectionGeneration: 2 });
          expect(input.lifecycleFence(stage)).toBe(false);
          expect(input.signal.aborted).toBe(true);
          return Promise.resolve({
            ok: true,
            status: 200,
            body: validEnvelope,
          });
        },
      });
      expect((await h.controller.distill()).status).toBe("stale");
      expect(h.controller.snapshot.candidates).toEqual([]);
    },
  );

  it("treats a changed authoritative Keychain observation as stale before DNS", async () => {
    const transport = vi.fn();
    const h = harness({
      readCredential: () => {
        h.mutate({ credentialGeneration: 2, credentialState: "missing" });
        h.controller.invalidate("credential-change");
        return { ok: false, code: "KEYCHAIN_MISSING" };
      },
      transport,
    });
    expect((await h.controller.distill()).status).toBe("stale");
    expect(transport).not.toHaveBeenCalled();
    expect(h.controller.snapshot.status).toBe("unconfigured");
  });

  it("maps request, transport, envelope, and M04 validation failures", async () => {
    const requestFailure = harness({
      buildRequest: () => ({
        ok: false,
        code: "PROVIDER_REQUEST_TOO_LARGE",
      }),
    });
    expect((await requestFailure.controller.distill()).status).toBe("failed");
    expect(requestFailure.controller.snapshot.diagnostic?.code).toBe(
      "PROVIDER_REQUEST_TOO_LARGE",
    );

    const transportThrow = harness({
      transport: () => Promise.reject(new Error("synthetic")),
    });
    expect((await transportThrow.controller.distill()).status).toBe("failed");
    expect(transportThrow.controller.snapshot.diagnostic?.code).toBe(
      "PROVIDER_NETWORK_FAILED",
    );

    const invalid = harness({
      validateResult: () => ({ ok: false, diagnostics: [] }),
    });
    expect((await invalid.controller.distill()).status).toBe("invalid");
    expect(invalid.controller.snapshot.diagnostic?.code).toBe(
      "PROVIDER_RESULT_INVALID",
    );
  });

  it("settles a real transport envelope failure as invalid and preserves the previous preview", async () => {
    const transport = compositionTransport([
      validEnvelope,
      Uint8Array.from([0xc3]),
    ]);
    const { controller } = harness({ transport });
    expect((await controller.distill()).status).toBe("valid");
    const previous = controller.snapshot.candidates;
    expect((await controller.distill()).status).toBe("invalid");
    expect(controller.snapshot).toMatchObject({
      status: "invalid",
      result: "invalid",
      ownerToken: undefined,
      candidates: previous,
      diagnostic: {
        severity: "error",
        code: "PROVIDER_ENVELOPE_INVALID",
        message:
          "The provider response is not a valid Chat2Vault provider envelope.",
      },
    });
  });

  it("treats a transported stale result as return-only and never renders it as failed", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: validEnvelope })
      .mockResolvedValueOnce({ ok: false, code: "PROVIDER_STALE" });
    const { controller } = harness({ transport });
    await controller.distill();
    const previous = controller.snapshot.candidates;
    const running = controller.distill();
    const sending = controller.snapshot;
    expect((await running).status).toBe("stale");
    expect(controller.snapshot).toBe(sending);
    expect(controller.snapshot).toEqual(sending);
    expect(controller.snapshot).toMatchObject({
      status: "sending",
      candidates: previous,
      diagnostic: { code: "PROVIDER_SENDING" },
    });
    const released = controller.preflight();
    expect(released).not.toBe(sending);
    expect(released).toMatchObject({
      status: "ready",
      ownerToken: undefined,
      candidates: previous,
    });
  });

  it.each(["getter", "proxy"] as const)(
    "makes a hostile current %s total at a transport fence",
    async (kind) => {
      let hostile = false;
      const baseline = readyCurrent();
      const current = () => {
        if (!hostile) return baseline;
        if (kind === "getter") {
          return {
            ...baseline,
            get selectionGeneration(): number {
              throw new Error("hostile getter");
            },
          };
        }
        return new Proxy(baseline, {
          get(target, key, receiver): unknown {
            if (key === "selectionGeneration") throw new Error("hostile proxy");
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
      };
      const { controller } = harness({
        current,
        transport: (input) => {
          hostile = true;
          expect(input.lifecycleFence("dns")).toBe(false);
          expect(input.signal.aborted).toBe(true);
          return Promise.resolve({ ok: false, code: "PROVIDER_STALE" });
        },
      });
      const running = controller.distill();
      const sending = controller.snapshot;
      expect((await running).status).toBe("stale");
      expect(controller.snapshot).toEqual(sending);
      expect(controller.snapshot.diagnostic?.code).toBe("PROVIDER_SENDING");
      expect(controller.snapshot.ownerToken).toBe(sending.ownerToken);
      expect(controller.cancel().status).toBe("stale");
    },
  );

  it("treats a rejected M04 validator as invalid without exposing its error", async () => {
    const { controller } = harness({
      validateResult: () => Promise.reject(new Error("sensitive synthetic")),
    });
    expect((await controller.distill()).status).toBe("invalid");
    expect(JSON.stringify(controller.snapshot)).not.toContain("sensitive");
  });

  it("fails closed when the current observation throws", async () => {
    const { controller } = harness({
      current: () => {
        throw new Error("synthetic");
      },
    });
    expect(controller.preflight().diagnostic?.code).toBe(
      "PROVIDER_UNSUPPORTED_PLATFORM",
    );
    expect((await controller.distill()).status).toBe("not-ready");
  });
});

describe("M05 cross-controller ownership and winning events", () => {
  it("rejects Provider entry while an M04 owner exists", async () => {
    const transport = vi.fn();
    const { controller, mutate } = harness({ transport });
    mutate({ manualOwner: { kind: "Copy", token: 4 } });
    expect(await controller.distill()).toMatchObject({ status: "busy" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ["Prepare", "DISTILLATION_PREPARE_IN_PROGRESS"],
    ["Copy", "DISTILLATION_COPY_IN_PROGRESS"],
    ["Validate", "DISTILLATION_VALIDATE_IN_PROGRESS"],
  ] as const)("rejects M04 %s while Provider owns", async (kind, code) => {
    const pending = deferred<never>();
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: validEnvelope })
      .mockImplementationOnce(() => pending.promise);
    const { controller } = harness({ transport });
    await controller.distill();
    const previous = controller.snapshot.candidates;
    const running = controller.distill();
    expect(controller.guardManualOperation(kind)).toMatchObject({
      ok: false,
      diagnostic: { code },
    });
    controller.manualOperationAccepted(kind);
    expect(controller.snapshot.candidates).toEqual(previous);
    controller.cancel();
    await running;
  });

  it("delegates every M04 action when no Provider owner exists", () => {
    const { controller } = harness();
    expect(controller.guardManualOperation("Prepare")).toEqual({ ok: true });
    expect(controller.guardManualOperation("Copy")).toEqual({ ok: true });
    expect(controller.guardManualOperation("Validate")).toEqual({ ok: true });
  });

  it.each(["Prepare", "Validate"] as const)(
    "clears a valid Provider preview on accepted M04 %s entry",
    async (kind) => {
      const { controller } = harness();
      await controller.distill();
      expect(controller.guardManualOperation(kind)).toEqual({ ok: true });
      controller.manualOperationAccepted(kind);
      expect(controller.snapshot).toMatchObject({
        status: "ready",
        ownerToken: undefined,
        candidates: [],
      });
    },
  );

  it("preserves a valid Provider preview on accepted M04 Copy entry", async () => {
    const { controller } = harness();
    await controller.distill();
    const previous = controller.snapshot.candidates;
    expect(controller.guardManualOperation("Copy")).toEqual({ ok: true });
    controller.manualOperationAccepted("Copy");
    expect(controller.snapshot).toMatchObject({
      ownerToken: undefined,
      candidates: previous,
    });
  });

  it.each([
    ["selection-change", { selectionGeneration: 2 }, "ready"],
    ["import-replacement", { importGeneration: 2 }, "ready"],
    [
      "import-clear",
      { importGeneration: 2, request: undefined },
      "unconfigured",
    ],
    [
      "m04-request-replacement",
      {
        request: {
          ...request,
          requestId: `sha256:${"4".repeat(64)}`,
        },
      },
      "ready",
    ],
  ] as const)(
    "clears a valid Provider preview on %s without crossing request authority",
    async (reason, patch, status) => {
      const h = harness();
      await h.controller.distill();
      h.mutate(patch);
      h.controller.invalidate(reason);
      expect(h.controller.snapshot).toMatchObject({
        status,
        ownerToken: undefined,
        candidates: [],
      });
    },
  );

  it.each([
    ["provider-settings-save", { config: undefined }, "unconfigured"],
    ["credential-change", { credentialState: "missing" }, "unconfigured"],
  ] satisfies readonly [
    ProviderInvalidationReason,
    CurrentPatch,
    "unconfigured",
  ][])(
    "preserves a valid Provider preview and recomputes readiness on %s invalidation",
    async (reason, patch, status) => {
      const h = harness();
      await h.controller.distill();
      const previous = h.controller.snapshot.candidates;
      h.mutate(patch);
      h.controller.invalidate(reason);
      expect(h.controller.snapshot).toMatchObject({
        status,
        ownerToken: undefined,
        candidates: previous,
      });
    },
  );

  it.each(["view-close", "plugin-unload"] as const)(
    "removes Provider state and preview on %s",
    async (reason) => {
      const { controller } = harness();
      await controller.distill();
      controller.invalidate(reason);
      expect(controller.snapshot).toMatchObject({
        status: "unavailable",
        result: "not-ready",
        ownerToken: undefined,
        host: undefined,
        model: undefined,
        promptBytes: undefined,
        maxOutputTokens: undefined,
        candidates: [],
        diagnostic: undefined,
      });
    },
  );

  it("manual input invalidates Provider before delegating exactly once", async () => {
    const pending = deferred<never>();
    const apply = vi.fn();
    const { controller } = harness({ transport: () => pending.promise });
    const running = controller.distill();
    controller.manualInput(apply);
    expect(apply).toHaveBeenCalledOnce();
    expect((await running).status).toBe("stale");
  });

  it("manual input clears a settled valid Provider preview and returns to readiness", async () => {
    const apply = vi.fn();
    const { controller } = harness();
    await controller.distill();
    controller.manualInput(apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(controller.snapshot).toMatchObject({
      status: "ready",
      ownerToken: undefined,
      candidates: [],
    });
  });

  it("cancel is synchronous, aborts once, releases once, and is idempotent", async () => {
    let aborts = 0;
    const { controller } = harness({
      transport: (_input) =>
        new Promise(() => {
          _input.signal.addEventListener("abort", () => (aborts += 1));
        }),
    });
    const running = controller.distill();
    expect(controller.cancel().status).toBe("cancelled");
    expect(controller.cancel().status).toBe("stale");
    expect(aborts).toBe(1);
    expect((await running).status).toBe("cancelled");
    expect(controller.snapshot.status).toBe("cancelled");
  });

  it("external invalidation makes late completion stale and permits immediate fresh entry", async () => {
    const first = deferred<{
      ok: true;
      status: 200;
      body: Uint8Array;
    }>();
    const transport = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ok: true, status: 200, body: validEnvelope });
    const h = harness({ transport });
    const old = h.controller.distill();
    h.mutate({ selectionGeneration: 2 });
    h.controller.invalidate("selection-change");
    expect(h.controller.snapshot).toMatchObject({
      status: "ready",
      ownerToken: undefined,
      candidates: [],
    });
    expect((await old).status).toBe("stale");
    h.mutate({ selectionGeneration: 1 });
    expect((await h.controller.distill()).status).toBe("valid");
    first.resolve({ ok: true, status: 200, body: validEnvelope });
    await Promise.resolve();
    expect(h.controller.snapshot.status).toBe("valid");
  });

  it("lets a controller timeout win once and makes later transport settlement inert", async () => {
    vi.useFakeTimers();
    try {
      const late = deferred<{
        ok: true;
        status: 200;
        body: Uint8Array;
      }>();
      const { controller } = harness({ transport: () => late.promise });
      const running = controller.distill();
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await running).status).toBe("timeout");
      expect(controller.snapshot).toMatchObject({
        status: "failed",
        diagnostic: { code: "PROVIDER_TIMEOUT" },
      });
      late.resolve({ ok: true, status: 200, body: validEnvelope });
      await Promise.resolve();
      expect(controller.snapshot.diagnostic?.code).toBe("PROVIDER_TIMEOUT");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets transport settlement win before a later cancel", async () => {
    const { controller } = harness();
    expect((await controller.distill()).status).toBe("valid");
    expect(controller.cancel().status).toBe("stale");
    expect(controller.snapshot.status).toBe("valid");
  });
});
