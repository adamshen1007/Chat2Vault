import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_SETTINGS,
  readSettings,
  SettingsController,
} from "../src/settings-model.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const provider = {
  endpoint: "https://example.test/v1/chat/completions",
  model: "synthetic-model",
  timeoutMs: 60_000,
  maxOutputTokens: 4_096,
  cloudDisclosureAccepted: true,
} as const;

describe("M05 settings v3", () => {
  it("migrates each valid M03 family to one pending v3 identity", () => {
    for (const value of [
      undefined,
      { schemaVersion: 1, previewMessagesPerPage: 10 },
      {
        schemaVersion: 2,
        previewMessagesPerPage: 50,
        sourceRoot: "Sources/Cafe\u0301",
      },
    ]) {
      const loaded = readSettings(value, () => UUID);
      expect(loaded.settings).toMatchObject({
        schemaVersion: 3,
        installationId: UUID,
        provider: DEFAULT_PROVIDER_SETTINGS,
      });
      expect(loaded.identityState).toBe("pending");
    }
    expect(
      readSettings(
        {
          schemaVersion: 2,
          previewMessagesPerPage: 25,
          sourceRoot: "../escape",
        },
        () => UUID,
      ).diagnostics.map((item) => item.code),
    ).toEqual(["INVALID_PERSISTED_SOURCE_ROOT"]);
  });

  it("projects v3 field-by-field in exact diagnostic order", () => {
    const loaded = readSettings(
      {
        schemaVersion: 3,
        installationId: "bad",
        previewMessagesPerPage: 12,
        sourceRoot: "../escape",
        provider: { ...provider, extra: true },
        extra: true,
      },
      () => UUID,
    );
    expect(loaded.settings).toEqual({
      schemaVersion: 3,
      installationId: UUID,
      previewMessagesPerPage: 25,
      sourceRoot: "",
      provider: DEFAULT_PROVIDER_SETTINGS,
    });
    expect(loaded.diagnostics.map((item) => item.code)).toEqual([
      "INVALID_PERSISTED_SETTINGS",
      "INVALID_PERSISTED_SOURCE_ROOT",
      "PROVIDER_SETTINGS_INVALID",
    ]);
    expect(loaded.pendingProviderBasis).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });

  it("retains valid independent v3 authority and never creates another identity", () => {
    const loaded = readSettings({
      schemaVersion: 3,
      installationId: UUID,
      previewMessagesPerPage: 50,
      sourceRoot: "Sources",
      provider,
    });
    expect(loaded.identityState).toBe("authoritative");
    expect(loaded.settings).toEqual({
      schemaVersion: 3,
      installationId: UUID,
      previewMessagesPerPage: 50,
      sourceRoot: "Sources",
      provider,
    });
  });

  it("preserves every frozen M03 load category before v3 migration", () => {
    const cases: [unknown, string[]][] = [
      [undefined, []],
      [null, []],
      ["settings", ["INVALID_PERSISTED_SETTINGS"]],
      [{ schemaVersion: 0 }, ["INVALID_PERSISTED_SETTINGS"]],
      [
        { schemaVersion: 1, previewMessagesPerPage: 12 },
        ["INVALID_PERSISTED_SETTINGS"],
      ],
      [
        {
          schemaVersion: 1,
          previewMessagesPerPage: 25,
          sourceRoot: "Sources",
        },
        ["INVALID_PERSISTED_SETTINGS"],
      ],
      [
        { schemaVersion: 2, previewMessagesPerPage: 12, sourceRoot: "" },
        ["INVALID_PERSISTED_SETTINGS"],
      ],
      [
        { schemaVersion: 2, previewMessagesPerPage: 25, sourceRoot: 3 },
        ["INVALID_PERSISTED_SETTINGS"],
      ],
      [
        {
          schemaVersion: 2,
          previewMessagesPerPage: 25,
          sourceRoot: "Sources",
          extra: true,
        },
        ["INVALID_PERSISTED_SETTINGS"],
      ],
      [
        {
          schemaVersion: 2,
          previewMessagesPerPage: 25,
          sourceRoot: "../escape",
        },
        ["INVALID_PERSISTED_SOURCE_ROOT"],
      ],
    ];
    for (const [value, diagnostics] of cases) {
      const before = JSON.stringify(value);
      const loaded = readSettings(value, () => UUID);
      expect(loaded.settings).toMatchObject({
        schemaVersion: 3,
        installationId: UUID,
        provider: DEFAULT_PROVIDER_SETTINGS,
      });
      expect(loaded.diagnostics.map((item) => item.code)).toEqual(diagnostics);
      expect(JSON.stringify(value)).toBe(before);
    }
  });

  it("uses no UUID generation for authoritative v3 and handles missing/extra v3 keys independently", () => {
    let uuidCalls = 0;
    const loaded = readSettings(
      {
        schemaVersion: 3,
        installationId: UUID,
        previewMessagesPerPage: 12,
        sourceRoot: "Sources",
        provider,
        extra: true,
      },
      () => {
        uuidCalls += 1;
        return UUID;
      },
    );
    expect(uuidCalls).toBe(0);
    expect(loaded.identityState).toBe("authoritative");
    expect(loaded.settings).toMatchObject({
      installationId: UUID,
      previewMessagesPerPage: 25,
      sourceRoot: "Sources",
      provider,
    });
    expect(loaded.diagnostics.map((item) => item.code)).toEqual([
      "INVALID_PERSISTED_SETTINGS",
    ]);
  });

  it("fails closed for every unsafe object and future schema", async () => {
    const getter = {} as Record<string, unknown>;
    Object.defineProperty(getter, "schemaVersion", {
      enumerable: true,
      get: () => 3,
    });
    for (const unsafe of [[], Object.create({ schemaVersion: 3 }), getter]) {
      expect(readSettings(unsafe, () => UUID).identityState).toBe("pending");
    }
    const future = readSettings(
      { schemaVersion: 4, opaque: { preserve: true } },
      () => {
        throw new Error("no UUID");
      },
    );
    expect(future).toMatchObject({
      identityState: "unsupported-future",
      providerReadiness: {
        state: "unavailable",
        result: "unsupported-settings",
      },
    });
    const writes: unknown[] = [];
    const controller = new SettingsController(
      future,
      (value) => {
        writes.push(value);
        return Promise.resolve();
      },
      () => undefined,
    );
    await expect(controller.saveProviderSettings(provider)).resolves.toEqual({
      status: "unavailable",
      code: "UNSUPPORTED_SETTINGS_SCHEMA",
    });
    await expect(controller.savePreviewMessagesPerPage(50)).resolves.toEqual({
      status: "saved",
    });
    expect(writes).toEqual([
      { schemaVersion: 2, previewMessagesPerPage: 50, sourceRoot: "" },
    ]);
  });

  it("retains a failed pending UUID and provider basis, and Retry rebases M03 fields", async () => {
    let calls = 0;
    const writes: unknown[] = [];
    const controller = new SettingsController(
      readSettings(
        {
          schemaVersion: 3,
          installationId: "bad",
          previewMessagesPerPage: 25,
          sourceRoot: "Sources",
          provider,
        },
        () => UUID,
      ),
      (value) => {
        writes.push(structuredClone(value));
        return ++calls <= 2
          ? Promise.reject(new Error("ambiguous"))
          : Promise.resolve();
      },
      () => undefined,
    );
    await expect(controller.initializeIdentity()).resolves.toEqual({
      status: "failed",
      code: "PROVIDER_IDENTITY_SAVE_FAILED",
    });
    await controller.savePreviewMessagesPerPage(50);
    await expect(controller.retryProviderInitialization()).resolves.toEqual({
      status: "saved",
    });
    expect(writes.at(-1)).toEqual({
      schemaVersion: 3,
      installationId: UUID,
      previewMessagesPerPage: 25,
      sourceRoot: "Sources",
      provider,
    });
  });

  it("persists complete v3 M03 snapshots and holds every reentry behind one mutex", async () => {
    let release!: () => void;
    const writes: unknown[] = [];
    const controller = new SettingsController(
      readSettings({
        schemaVersion: 3,
        installationId: UUID,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider,
      }),
      async (value) => {
        writes.push(value);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      () => undefined,
    );
    const saving = controller.savePreviewMessagesPerPage(50);
    await expect(controller.saveSourceRoot("Sources")).resolves.toEqual({
      status: "in-progress",
      message: "A Chat2Vault setting is already being saved.",
    });
    await expect(controller.saveProviderSettings(provider)).resolves.toEqual({
      status: "in-progress",
      code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS",
    });
    release();
    await saving;
    expect(writes[0]).toEqual({
      schemaVersion: 3,
      installationId: UUID,
      previewMessagesPerPage: 50,
      sourceRoot: "",
      provider,
    });
  });

  it("uses the two provider generations and invalidates only accepted valid saves", async () => {
    const invalidations: string[] = [];
    const controller = new SettingsController(
      readSettings({
        schemaVersion: 3,
        installationId: UUID,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider,
      }),
      () => Promise.resolve(),
      () => undefined,
      { invalidateProviderOwnerAndAbort: () => invalidations.push("abort") },
    );
    await expect(
      controller.saveProviderSettings({
        ...provider,
        timeoutMs: 7,
      } as unknown as typeof provider),
    ).resolves.toEqual({
      status: "invalid",
      code: "PROVIDER_SETTINGS_INVALID",
    });
    expect(controller.captureProviderGenerations()).toEqual({
      providerSaveGeneration: 0,
      providerSettingsGeneration: 0,
    });
    await expect(controller.saveProviderSettings(provider)).resolves.toEqual({
      status: "saved",
    });
    expect(controller.captureProviderGenerations()).toEqual({
      providerSaveGeneration: 1,
      providerSettingsGeneration: 1,
    });
    expect(invalidations).toEqual(["abort"]);
  });

  it("publishes the accepted Provider save transaction before invalidation", async () => {
    let rejectSecond!: (reason?: unknown) => void;
    let persistCalls = 0;
    const observations: {
      persistence: SettingsController["providerSettingsPersistenceState"];
      status: SettingsController["providerSettingsStatusCode"];
      readiness: SettingsController["providerReadiness"];
      generations: ReturnType<SettingsController["captureProviderGenerations"]>;
    }[] = [];
    const controller = new SettingsController(
      readSettings({
        schemaVersion: 3,
        installationId: UUID,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider,
      }),
      () => {
        persistCalls += 1;
        if (persistCalls === 1) return Promise.resolve();
        return new Promise<void>((_resolve, reject) => {
          rejectSecond = reject;
        });
      },
      () => undefined,
      {
        invalidateProviderOwnerAndAbort: () => {
          observations.push({
            persistence: controller.providerSettingsPersistenceState,
            status: controller.providerSettingsStatusCode,
            readiness: controller.providerReadiness,
            generations: controller.captureProviderGenerations(),
          });
        },
      },
    );

    const beforeInvalid = {
      persistence: controller.providerSettingsPersistenceState,
      status: controller.providerSettingsStatusCode,
      readiness: controller.providerReadiness,
      generations: controller.captureProviderGenerations(),
    };
    await expect(
      controller.saveProviderSettings({
        ...provider,
        timeoutMs: 7,
      } as unknown as typeof provider),
    ).resolves.toEqual({
      status: "invalid",
      code: "PROVIDER_SETTINGS_INVALID",
    });
    expect(observations).toEqual([]);
    expect({
      persistence: controller.providerSettingsPersistenceState,
      status: controller.providerSettingsStatusCode,
      readiness: controller.providerReadiness,
      generations: controller.captureProviderGenerations(),
    }).toEqual(beforeInvalid);

    await expect(
      controller.saveProviderSettings({ ...provider, model: "saved" }),
    ).resolves.toEqual({ status: "saved" });
    expect(observations).toEqual([
      {
        persistence: { status: "saving", saveGeneration: 1 },
        status: "PROVIDER_SETTINGS_SAVING",
        readiness: { state: "unconfigured", result: "saving" },
        generations: {
          providerSaveGeneration: 1,
          providerSettingsGeneration: 0,
        },
      },
    ]);

    const failing = controller.saveProviderSettings({
      ...provider,
      model: "failed",
    });
    await expect(controller.saveProviderSettings(provider)).resolves.toEqual({
      status: "in-progress",
      code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS",
    });
    expect(observations).toEqual([
      {
        persistence: { status: "saving", saveGeneration: 1 },
        status: "PROVIDER_SETTINGS_SAVING",
        readiness: { state: "unconfigured", result: "saving" },
        generations: {
          providerSaveGeneration: 1,
          providerSettingsGeneration: 0,
        },
      },
      {
        persistence: { status: "saving", saveGeneration: 2 },
        status: "PROVIDER_SETTINGS_SAVING",
        readiness: { state: "unconfigured", result: "saving" },
        generations: {
          providerSaveGeneration: 2,
          providerSettingsGeneration: 1,
        },
      },
    ]);
    rejectSecond(new Error("synthetic rejection"));
    await expect(failing).resolves.toEqual({
      status: "failed",
      code: "PROVIDER_SETTINGS_SAVE_FAILED",
    });
    expect(controller.providerSettingsPersistenceState).toEqual({
      status: "failed",
      saveGeneration: 2,
    });
    expect(controller.providerSettingsStatusCode).toBe(
      "PROVIDER_SETTINGS_SAVE_FAILED",
    );
    expect(controller.providerReadiness).toEqual({
      state: "unconfigured",
      result: "settings-failed",
    });
    expect(controller.captureProviderGenerations()).toEqual({
      providerSaveGeneration: 2,
      providerSettingsGeneration: 1,
    });
  });

  it("keeps draft edits non-authoritative and revokes disclosure on endpoint change", () => {
    const controller = new SettingsController(
      readSettings({
        schemaVersion: 3,
        installationId: UUID,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider,
      }),
      () => Promise.resolve(),
      () => undefined,
    );
    controller.setProviderDraft({
      ...provider,
      endpoint: "https://other.test/v1/chat/completions",
    });
    expect(controller.providerDraft).toMatchObject({
      endpoint: "https://other.test/v1/chat/completions",
      cloudDisclosureAccepted: false,
    });
    expect(controller.settings.provider).toEqual(provider);
  });

  it("accepts only an exact default or fully configured persisted Provider subtree", () => {
    for (const invalidProvider of [
      { ...DEFAULT_PROVIDER_SETTINGS, cloudDisclosureAccepted: true },
      { ...DEFAULT_PROVIDER_SETTINGS, endpoint: provider.endpoint },
      { ...DEFAULT_PROVIDER_SETTINGS, model: provider.model },
    ]) {
      const loaded = readSettings({
        schemaVersion: 3,
        installationId: UUID,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider: invalidProvider,
      });
      expect(loaded.settings.provider).toEqual(DEFAULT_PROVIDER_SETTINGS);
      expect(loaded.diagnostics.map((item) => item.code)).toEqual([
        "PROVIDER_SETTINGS_INVALID",
      ]);
    }
  });

  it("projects safe nested arrays without reading indexed values and recovers v3 fields independently", () => {
    const arrayTarget = ["ignored"];
    const trapArray = new Proxy(arrayTarget, {
      get: () => {
        throw new Error("array element must not be read");
      },
    });
    const providerArray = readSettings({
      schemaVersion: 3,
      installationId: UUID,
      previewMessagesPerPage: 50,
      sourceRoot: "Sources",
      provider: trapArray,
    });
    expect(providerArray.settings).toMatchObject({
      installationId: UUID,
      previewMessagesPerPage: 50,
      sourceRoot: "Sources",
      provider: DEFAULT_PROVIDER_SETTINGS,
    });
    expect(providerArray.diagnostics.map((item) => item.code)).toEqual([
      "PROVIDER_SETTINGS_INVALID",
    ]);

    const extraArray = readSettings({
      schemaVersion: 3,
      installationId: UUID,
      previewMessagesPerPage: 50,
      sourceRoot: "Sources",
      provider,
      extra: trapArray,
    });
    expect(extraArray.settings).toMatchObject({
      installationId: UUID,
      previewMessagesPerPage: 50,
      sourceRoot: "Sources",
      provider,
    });
    expect(extraArray.diagnostics.map((item) => item.code)).toEqual([
      "INVALID_PERSISTED_SETTINGS",
    ]);
  });

  it("projects descriptor data before any imported property read or revocation", () => {
    const source = {
      schemaVersion: 3,
      installationId: UUID,
      previewMessagesPerPage: 25,
      sourceRoot: "Sources",
      provider,
    };
    const hostile = new Proxy(source, {
      get: () => {
        throw new Error("imported property must not be read");
      },
    });
    expect(readSettings(hostile).settings).toEqual(source);

    const revocable = Proxy.revocable(source, {});
    const loaded = readSettings(revocable.proxy);
    revocable.revoke();
    expect(loaded.settings).toEqual(source);
  });

  it("rejects every remaining unsafe object and nested-array category", () => {
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "schemaVersion", {
      enumerable: true,
      get: () => 3,
    });
    const withSymbol = { schemaVersion: 3 } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("unsafe")] = true;
    const cyclic = { schemaVersion: 3 } as Record<string, unknown>;
    cyclic.self = cyclic;
    const nonJson = { schemaVersion: 3, value: undefined };
    const revoked = Proxy.revocable({ schemaVersion: 3 }, {});
    revoked.revoke();
    for (const value of [
      [],
      Object.create({ schemaVersion: 3 }),
      accessor,
      withSymbol,
      cyclic,
      nonJson,
      revoked.proxy,
    ]) {
      const loaded = readSettings(value, () => UUID);
      expect(loaded.identityState).toBe("pending");
      expect(loaded.settings).toMatchObject({
        installationId: UUID,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider: DEFAULT_PROVIDER_SETTINGS,
      });
      expect(loaded.diagnostics.map((item) => item.code)).toEqual([
        "INVALID_PERSISTED_SETTINGS",
      ]);
    }

    const hole = new Array(1);
    const arrayAccessor: unknown[] = [];
    Object.defineProperty(arrayAccessor, "0", {
      enumerable: true,
      get: () => "unsafe",
    });
    const arraySymbol: unknown[] = [];
    (arraySymbol as unknown as Record<PropertyKey, unknown>)[Symbol("unsafe")] =
      true;
    const arrayCycle: unknown[] = [];
    arrayCycle.push(arrayCycle);
    for (const extra of [
      hole,
      arrayAccessor,
      arraySymbol,
      arrayCycle,
      [undefined],
    ]) {
      const loaded = readSettings(
        {
          schemaVersion: 3,
          installationId: UUID,
          previewMessagesPerPage: 25,
          sourceRoot: "",
          provider,
          extra,
        },
        () => UUID,
      );
      expect(loaded.identityState).toBe("pending");
      expect(loaded.diagnostics.map((item) => item.code)).toEqual([
        "INVALID_PERSISTED_SETTINGS",
      ]);
    }
  });

  it("publishes Provider saving synchronously, then settles failure with prior readiness", async () => {
    let reject!: (reason?: unknown) => void;
    const persistence = new Promise<void>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    const controller = new SettingsController(
      readSettings({
        schemaVersion: 3,
        installationId: UUID,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider,
      }),
      () => persistence,
      () => undefined,
    );
    const saving = controller.saveProviderSettings({
      ...provider,
      model: "next",
    });
    expect(controller.providerSettingsPersistenceState).toEqual({
      status: "saving",
      saveGeneration: 1,
    });
    expect(controller.providerSettingsStatusCode).toBe(
      "PROVIDER_SETTINGS_SAVING",
    );
    expect(controller.providerReadiness).toEqual({
      state: "unconfigured",
      result: "saving",
    });
    await expect(controller.saveProviderSettings(provider)).resolves.toEqual({
      status: "in-progress",
      code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS",
    });
    reject(new Error("synthetic rejection"));
    await expect(saving).resolves.toEqual({
      status: "failed",
      code: "PROVIDER_SETTINGS_SAVE_FAILED",
    });
    expect(controller.settings.provider).toEqual(provider);
    expect(controller.providerSettingsPersistenceState).toEqual({
      status: "failed",
      saveGeneration: 1,
    });
    expect(controller.providerSettingsStatusCode).toBe(
      "PROVIDER_SETTINGS_SAVE_FAILED",
    );
    expect(controller.providerReadiness).toEqual({
      state: "unconfigured",
      result: "settings-failed",
    });
  });

  it("settles a deferred Provider save atomically and advances only the settings generation", async () => {
    let fulfill!: () => void;
    const persistence = new Promise<void>((resolve) => {
      fulfill = resolve;
    });
    const controller = new SettingsController(
      readSettings({
        schemaVersion: 3,
        installationId: UUID,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider,
      }),
      () => persistence,
      () => undefined,
    );
    const next = { ...provider, model: "next" };
    const save = controller.saveProviderSettings(next);
    expect(controller.captureProviderGenerations()).toEqual({
      providerSaveGeneration: 1,
      providerSettingsGeneration: 0,
    });
    fulfill();
    await expect(save).resolves.toEqual({ status: "saved" });
    expect(controller.settings.provider).toEqual(next);
    expect(controller.providerSettingsPersistenceState).toEqual({
      status: "settled",
    });
    expect(controller.providerSettingsStatusCode).toBeUndefined();
    expect(controller.captureProviderGenerations()).toEqual({
      providerSaveGeneration: 1,
      providerSettingsGeneration: 1,
    });
  });

  it("keeps an explicitly reaccepted disclosure through Provider Save after endpoint draft edit", async () => {
    const writes: unknown[] = [];
    const controller = new SettingsController(
      readSettings({
        schemaVersion: 3,
        installationId: UUID,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider,
      }),
      (value) => {
        writes.push(structuredClone(value));
        return Promise.resolve();
      },
      () => undefined,
    );
    controller.setProviderDraft({
      ...provider,
      endpoint: "https://other.test/v1/chat/completions",
    });
    expect(controller.providerDraft.cloudDisclosureAccepted).toBe(false);
    controller.setProviderDraft({
      ...controller.providerDraft,
      cloudDisclosureAccepted: true,
    });
    await expect(
      controller.saveProviderSettings(controller.providerDraft),
    ).resolves.toEqual({ status: "saved" });
    expect((writes[0] as { provider: typeof provider }).provider).toEqual({
      ...provider,
      endpoint: "https://other.test/v1/chat/completions",
    });
  });

  it("retains then discards pending identity only in memory across failed initialization and restart", async () => {
    let generated = 0;
    const loaded = readSettings(undefined, () => {
      generated += 1;
      return UUID;
    });
    const controller = new SettingsController(
      loaded,
      () => Promise.reject(new Error("synthetic failure")),
      () => undefined,
    );
    await expect(controller.initializeIdentity()).resolves.toEqual({
      status: "failed",
      code: "PROVIDER_IDENTITY_SAVE_FAILED",
    });
    controller.discardUnpersistedIdentityOnUnload();
    expect(generated).toBe(1);
    const restarted = readSettings(undefined, () => {
      generated += 1;
      return "223e4567-e89b-42d3-a456-426614174000";
    });
    expect(restarted.settings.installationId).toBe(
      "223e4567-e89b-42d3-a456-426614174000",
    );
    expect(generated).toBe(2);
  });

  it("cancels pending identity authority on unload even when persistence fulfills later", async () => {
    let fulfill!: () => void;
    let keychainConfigurations = 0;
    const controller = new SettingsController(
      readSettings(undefined, () => UUID),
      () =>
        new Promise<void>((resolve) => {
          fulfill = resolve;
        }),
      () => undefined,
      {
        onIdentityAuthorized: () => {
          keychainConfigurations += 1;
        },
      },
    );
    const pending = controller.initializeIdentity();
    expect(controller.identityState).toBe("saving");

    controller.discardUnpersistedIdentityOnUnload();
    fulfill();

    await expect(pending).resolves.toEqual({
      status: "failed",
      code: "PROVIDER_IDENTITY_SAVE_FAILED",
    });
    expect(controller.identityState).toBe("failed");
    expect(controller.providerReadiness).toEqual({
      state: "unavailable",
      result: "initialization-failed",
    });
    expect(keychainConfigurations).toBe(0);
  });

  it("keeps valid v3 load-only, and preserves future-schema bytes through unload and rejected M03 saves", async () => {
    let uuidCalls = 0;
    const valid = readSettings(
      {
        schemaVersion: 3,
        installationId: UUID,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        provider,
      },
      () => {
        uuidCalls += 1;
        return UUID;
      },
    );
    const writes: unknown[] = [];
    const validController = new SettingsController(
      valid,
      (value) => {
        writes.push(value);
        return Promise.resolve();
      },
      () => undefined,
    );
    await expect(validController.initializeIdentity()).resolves.toEqual({
      status: "unchanged",
    });
    expect(uuidCalls).toBe(0);
    expect(writes).toEqual([]);

    const futureBytes = JSON.stringify({ schemaVersion: 4, opaque: [1, 2] });
    const futureValue = JSON.parse(futureBytes) as unknown;
    const future = readSettings(futureValue, () => {
      throw new Error("future must not generate UUID");
    });
    const rejected: unknown[] = [];
    const futureController = new SettingsController(
      future,
      (value) => {
        rejected.push(value);
        return Promise.reject(new Error("synthetic rejection"));
      },
      () => undefined,
    );
    futureController.discardUnpersistedIdentityOnUnload();
    await expect(
      futureController.savePreviewMessagesPerPage(50),
    ).resolves.toMatchObject({
      status: "failed",
    });
    await expect(
      futureController.saveSourceRoot("Sources"),
    ).resolves.toMatchObject({
      status: "failed",
    });
    expect(rejected).toEqual([
      { schemaVersion: 2, previewMessagesPerPage: 50, sourceRoot: "" },
      { schemaVersion: 2, previewMessagesPerPage: 25, sourceRoot: "Sources" },
    ]);
    expect(JSON.stringify(futureValue)).toBe(futureBytes);
    expect(futureController.identityState).toBe("unsupported-future");
  });

  it("applies all settings mutex cells without queuing", async () => {
    const owners = [
      (controller: SettingsController) =>
        controller.saveProviderSettings(provider),
      (controller: SettingsController) =>
        controller.savePreviewMessagesPerPage(50),
      (controller: SettingsController) => controller.saveSourceRoot("Sources"),
    ];
    for (const start of owners) {
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const controller = new SettingsController(
        readSettings({
          schemaVersion: 3,
          installationId: UUID,
          previewMessagesPerPage: 25,
          sourceRoot: "",
          provider,
        }),
        () => wait,
        () => undefined,
      );
      const inFlight = start(controller);
      await expect(controller.savePreviewMessagesPerPage(50)).resolves.toEqual({
        status: "in-progress",
        message: "A Chat2Vault setting is already being saved.",
      });
      await expect(controller.saveSourceRoot("Sources")).resolves.toEqual({
        status: "in-progress",
        message: "A Chat2Vault setting is already being saved.",
      });
      await expect(controller.saveProviderSettings(provider)).resolves.toEqual({
        status: "in-progress",
        code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS",
      });
      release();
      await inFlight;
    }
  });

  it("rejects all actions during initial and Retry identity mutex ownership", async () => {
    let stage: "initial" | "retry" = "initial";
    let release!: () => void;
    const controller = new SettingsController(
      readSettings(undefined, () => UUID),
      () => {
        if (stage === "initial") return Promise.reject(new Error("initial"));
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      () => undefined,
    );
    await controller.initializeIdentity();
    stage = "retry";
    const retry = controller.retryProviderInitialization();
    await expect(controller.retryProviderInitialization()).resolves.toEqual({
      status: "in-progress",
      code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS",
    });
    await expect(controller.saveProviderSettings(provider)).resolves.toEqual({
      status: "in-progress",
      code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS",
    });
    await expect(controller.savePreviewMessagesPerPage(50)).resolves.toEqual({
      status: "in-progress",
      message: "A Chat2Vault setting is already being saved.",
    });
    await expect(controller.saveSourceRoot("Sources")).resolves.toEqual({
      status: "in-progress",
      message: "A Chat2Vault setting is already being saved.",
    });
    release();
    await expect(retry).resolves.toEqual({ status: "saved" });
  });

  it("rejects every action during deferred initial identity persistence with zero effects", async () => {
    let release!: () => void;
    let persistCalls = 0;
    const invalidations: string[] = [];
    const controller = new SettingsController(
      readSettings(
        {
          schemaVersion: 3,
          installationId: "bad",
          previewMessagesPerPage: 25,
          sourceRoot: "Sources",
          provider,
        },
        () => UUID,
      ),
      async () => {
        persistCalls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      () => invalidations.push("source"),
    );
    const before = {
      settings: structuredClone(controller.settings),
      identityState: controller.identityState,
      providerReadiness: controller.providerReadiness,
      providerDraft: structuredClone(controller.providerDraft),
      providerSettingsPersistenceState:
        controller.providerSettingsPersistenceState,
      providerSettingsStatusCode: controller.providerSettingsStatusCode,
      generations: controller.captureProviderGenerations(),
      sourceWriteGeneration: controller.sourceWriteGeneration,
    };
    const initial = controller.initializeIdentity();
    await expect(controller.retryProviderInitialization()).resolves.toEqual({
      status: "in-progress",
      code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS",
    });
    await expect(controller.saveProviderSettings(provider)).resolves.toEqual({
      status: "in-progress",
      code: "PROVIDER_SETTINGS_OPERATION_IN_PROGRESS",
    });
    await expect(controller.savePreviewMessagesPerPage(50)).resolves.toEqual({
      status: "in-progress",
      message: "A Chat2Vault setting is already being saved.",
    });
    await expect(controller.saveSourceRoot("Other")).resolves.toEqual({
      status: "in-progress",
      message: "A Chat2Vault setting is already being saved.",
    });
    expect(persistCalls).toBe(1);
    expect(controller.settings).toEqual(before.settings);
    expect(controller.identityState).toBe("saving");
    expect(controller.providerReadiness).toEqual({
      state: "unavailable",
      result: "initializing",
    });
    expect(controller.providerDraft).toEqual(before.providerDraft);
    expect(controller.providerSettingsPersistenceState).toEqual(
      before.providerSettingsPersistenceState,
    );
    expect(controller.providerSettingsStatusCode).toBe(
      before.providerSettingsStatusCode,
    );
    expect(controller.captureProviderGenerations()).toEqual(before.generations);
    expect(controller.sourceWriteGeneration).toBe(before.sourceWriteGeneration);
    expect(invalidations).toEqual([]);
    release();
    await expect(initial).resolves.toEqual({ status: "saved" });
    expect(controller.isSaving).toBe(false);
    expect(controller.identityState).toBe("authoritative");
  });

  it("reuses a durably stored ambiguous initial v3 write on reload without UUID or rewrite", async () => {
    let stored: unknown;
    let writes = 0;
    const controller = new SettingsController(
      readSettings(
        {
          schemaVersion: 3,
          installationId: "bad",
          previewMessagesPerPage: 50,
          sourceRoot: "Sources",
          provider,
        },
        () => UUID,
      ),
      (value) => {
        writes += 1;
        stored = structuredClone(value);
        return Promise.reject(new Error("ambiguous durable outcome"));
      },
      () => undefined,
    );
    await expect(controller.initializeIdentity()).resolves.toEqual({
      status: "failed",
      code: "PROVIDER_IDENTITY_SAVE_FAILED",
    });
    controller.discardUnpersistedIdentityOnUnload();
    let uuidCalls = 0;
    const reloaded = readSettings(stored, () => {
      uuidCalls += 1;
      throw new Error("stored identity must be authoritative");
    });
    expect(reloaded.identityState).toBe("authoritative");
    expect(reloaded.settings).toEqual({
      schemaVersion: 3,
      installationId: UUID,
      previewMessagesPerPage: 50,
      sourceRoot: "Sources",
      provider,
    });
    expect(uuidCalls).toBe(0);
    expect(writes).toBe(1);
  });

  it.each(["fulfill", "reject", "throw", "ambiguous"] as const)(
    "preserves pending Provider basis across %s M03 settlement",
    async (outcome) => {
      const writes: unknown[] = [];
      let calls = 0;
      const controller = new SettingsController(
        readSettings(
          {
            schemaVersion: 3,
            installationId: "bad",
            previewMessagesPerPage: 25,
            sourceRoot: "Sources",
            provider,
          },
          () => UUID,
        ),
        (value) => {
          writes.push(structuredClone(value));
          calls += 1;
          if (calls === 1) return Promise.reject(new Error("initial"));
          if (outcome === "throw") throw new Error("thrown");
          if (outcome === "reject" || outcome === "ambiguous")
            return Promise.reject(new Error("non-fulfillment"));
          return Promise.resolve();
        },
        () => undefined,
      );
      await controller.initializeIdentity();
      const result = await controller.saveSourceRoot("Other");
      expect(result.status).toBe(outcome === "fulfill" ? "saved" : "failed");
      expect(writes).toHaveLength(2);
      for (const write of writes) {
        expect((write as { provider: unknown }).provider).toEqual(provider);
        expect((write as { installationId: unknown }).installationId).toBe(
          UUID,
        );
      }
      expect(controller.identityState).toBe(
        outcome === "fulfill" ? "authoritative" : "failed",
      );
    },
  );
});
