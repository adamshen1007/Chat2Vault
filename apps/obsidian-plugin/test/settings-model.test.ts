import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  readSettings,
  SettingsController,
} from "../src/settings-model.js";

describe("M03 settings", () => {
  it("classifies every persisted schema family without mutating load-only input", () => {
    const cases: {
      value: unknown;
      code?:
        | "INVALID_PERSISTED_SOURCE_ROOT"
        | "INVALID_PERSISTED_SETTINGS"
        | "UNSUPPORTED_SETTINGS_SCHEMA";
    }[] = [
      { value: undefined },
      { value: null },
      { value: [], code: "INVALID_PERSISTED_SETTINGS" },
      { value: "settings", code: "INVALID_PERSISTED_SETTINGS" },
      { value: { schemaVersion: 0 }, code: "INVALID_PERSISTED_SETTINGS" },
      { value: { schemaVersion: 3 }, code: "UNSUPPORTED_SETTINGS_SCHEMA" },
      { value: { schemaVersion: 99 }, code: "UNSUPPORTED_SETTINGS_SCHEMA" },
      {
        value: { schemaVersion: 1, previewMessagesPerPage: 12 },
        code: "INVALID_PERSISTED_SETTINGS",
      },
      {
        value: {
          schemaVersion: 1,
          previewMessagesPerPage: 25,
          sourceRoot: "Sources",
        },
        code: "INVALID_PERSISTED_SETTINGS",
      },
      {
        value: {
          schemaVersion: 2,
          previewMessagesPerPage: 25,
          sourceRoot: 7,
        },
        code: "INVALID_PERSISTED_SETTINGS",
      },
      {
        value: {
          schemaVersion: 2,
          previewMessagesPerPage: 25,
          sourceRoot: "../escape",
        },
        code: "INVALID_PERSISTED_SOURCE_ROOT",
      },
      {
        value: {
          schemaVersion: 2,
          previewMessagesPerPage: 25,
          sourceRoot: "Sources",
          extra: true,
        },
        code: "INVALID_PERSISTED_SETTINGS",
      },
    ];
    for (const fixture of cases) {
      const before = JSON.stringify(fixture.value);
      const result = readSettings(fixture.value);
      expect(result.diagnostics[0]?.code).toBe(fixture.code);
      expect(JSON.stringify(fixture.value)).toBe(before);
    }
    const inherited = Object.create({ schemaVersion: 2 }) as Record<
      string,
      unknown
    >;
    inherited.previewMessagesPerPage = 25;
    inherited.sourceRoot = "Sources";
    expect(readSettings(inherited).diagnostics[0]?.code).toBe(
      "INVALID_PERSISTED_SETTINGS",
    );
  });

  it("loads exact v1/v2 shapes without persistence and reports closed diagnostics", () => {
    expect(readSettings(undefined)).toEqual({
      settings: DEFAULT_SETTINGS,
      diagnostics: [],
    });
    expect(
      readSettings({ schemaVersion: 1, previewMessagesPerPage: 10 }),
    ).toEqual({
      settings: {
        schemaVersion: 2,
        previewMessagesPerPage: 10,
        sourceRoot: "",
      },
      diagnostics: [],
    });
    expect(
      readSettings({
        schemaVersion: 2,
        previewMessagesPerPage: 50,
        sourceRoot: "Sources/Cafe\u0301",
      }),
    ).toEqual({
      settings: {
        schemaVersion: 2,
        previewMessagesPerPage: 50,
        sourceRoot: "Sources/Café",
      },
      diagnostics: [],
    });
    expect(
      readSettings({
        schemaVersion: 2,
        previewMessagesPerPage: 25,
        sourceRoot: "../escape",
      }),
    ).toEqual({
      settings: DEFAULT_SETTINGS,
      diagnostics: [
        {
          code: "INVALID_PERSISTED_SOURCE_ROOT",
          severity: "warning",
          message:
            "The saved source folder is invalid and was disabled in memory.",
        },
      ],
    });
    expect(readSettings({ schemaVersion: 3 })).toMatchObject({
      settings: DEFAULT_SETTINGS,
      diagnostics: [{ code: "UNSUPPORTED_SETTINGS_SCHEMA" }],
    });
    expect(
      readSettings({
        schemaVersion: 2,
        previewMessagesPerPage: 25,
        sourceRoot: "",
        extra: true,
      }),
    ).toMatchObject({
      settings: DEFAULT_SETTINGS,
      diagnostics: [{ code: "INVALID_PERSISTED_SETTINGS" }],
    });
  });

  it("serializes settings saves and stages a source root until persistence settles", async () => {
    let release!: () => void;
    const persisted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: unknown[] = [];
    let invalidations = 0;
    const controller = new SettingsController(
      DEFAULT_SETTINGS,
      async (value) => {
        writes.push(value);
        await persisted;
      },
      () => {
        invalidations += 1;
      },
    );

    const saving = controller.saveSourceRoot("Sources");
    expect(controller.settings.sourceRoot).toBe("");
    expect(controller.sourceRootPersistenceState).toEqual({
      status: "pending",
      previousRoot: "",
      proposedRoot: "Sources",
    });
    await expect(controller.savePreviewMessagesPerPage(50)).resolves.toEqual({
      status: "in-progress",
      message: "A Chat2Vault setting is already being saved.",
    });
    release();
    await expect(saving).resolves.toEqual({ status: "saved" });
    expect(controller.settings.sourceRoot).toBe("Sources");
    expect(controller.sourceWriteGeneration).toBe(1);
    expect(invalidations).toBe(1);
    expect(writes).toEqual([
      { schemaVersion: 2, previewMessagesPerPage: 25, sourceRoot: "Sources" },
    ]);
  });

  it("rolls back page settings and keeps root generation advanced on rejected root persistence", async () => {
    let fail = false;
    const controller = new SettingsController(
      { schemaVersion: 2, previewMessagesPerPage: 25, sourceRoot: "Sources" },
      () => (fail ? Promise.reject(new Error("no")) : Promise.resolve()),
      () => undefined,
    );
    expect(await controller.savePreviewMessagesPerPage(50)).toEqual({
      status: "saved",
    });
    expect(controller.settings.previewMessagesPerPage).toBe(50);
    fail = true;
    expect(await controller.savePreviewMessagesPerPage(10)).toEqual({
      status: "failed",
      message: "The preview setting could not be saved.",
    });
    expect(controller.settings.previewMessagesPerPage).toBe(50);
    expect(await controller.saveSourceRoot("Other")).toEqual({
      status: "failed",
      message: "The source folder setting could not be saved.",
    });
    expect(controller.settings.sourceRoot).toBe("Sources");
    expect(controller.sourceWriteGeneration).toBe(1);
    expect(controller.sourceRootPersistenceState).toEqual({
      status: "settled",
    });
  });

  it("applies exact validation, equality, and non-queuing mutex precedence", async () => {
    let settle!: (value?: void | PromiseLike<void>) => void;
    let reject!: (reason?: unknown) => void;
    let inFlight = 0;
    let maximumInFlight = 0;
    const pending = new Promise<void>((resolve, rejectPromise) => {
      settle = resolve;
      reject = rejectPromise;
    });
    const controller = new SettingsController(
      DEFAULT_SETTINGS,
      async () => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        try {
          await pending;
        } finally {
          inFlight -= 1;
        }
      },
      () => undefined,
    );
    await expect(controller.savePreviewMessagesPerPage(12)).resolves.toEqual({
      status: "invalid",
      message: "The preview setting is invalid.",
    });
    await expect(controller.saveSourceRoot("../escape")).resolves.toEqual({
      status: "invalid",
      message: "The source folder is invalid.",
    });
    await expect(controller.savePreviewMessagesPerPage(25)).resolves.toEqual({
      status: "unchanged",
    });
    await expect(controller.saveSourceRoot("")).resolves.toEqual({
      status: "unchanged",
    });
    const first = controller.savePreviewMessagesPerPage(50);
    for (const reentry of [
      controller.savePreviewMessagesPerPage(50),
      controller.savePreviewMessagesPerPage(10),
      controller.saveSourceRoot(""),
      controller.saveSourceRoot("Sources"),
    ]) {
      await expect(reentry).resolves.toMatchObject({ status: "in-progress" });
    }
    reject(new Error("persistence rejected"));
    await expect(first).resolves.toMatchObject({ status: "failed" });
    expect(controller.settings).toEqual(DEFAULT_SETTINGS);
    expect(maximumInFlight).toBe(1);
    settle();
  });

  it.each(["fulfill", "reject"] as const)(
    "serializes every root-pending same/different page/root reentry when the first save will %s",
    async (settlement) => {
      let resolve!: () => void;
      let reject!: (reason?: unknown) => void;
      let inFlight = 0;
      let maximumInFlight = 0;
      const pending = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      let invalidations = 0;
      const controller = new SettingsController(
        {
          schemaVersion: 2,
          previewMessagesPerPage: 25,
          sourceRoot: "Sources",
        },
        async () => {
          inFlight += 1;
          maximumInFlight = Math.max(maximumInFlight, inFlight);
          try {
            await pending;
          } finally {
            inFlight -= 1;
          }
        },
        () => {
          invalidations += 1;
        },
      );
      const first = controller.saveSourceRoot("Other");
      expect(controller.settings.sourceRoot).toBe("Sources");
      expect(controller.sourceRootPersistenceState).toEqual({
        status: "pending",
        previousRoot: "Sources",
        proposedRoot: "Other",
      });
      for (const reentry of [
        controller.saveSourceRoot("Sources"),
        controller.saveSourceRoot("Other"),
        controller.savePreviewMessagesPerPage(25),
        controller.savePreviewMessagesPerPage(50),
      ])
        await expect(reentry).resolves.toMatchObject({ status: "in-progress" });
      if (settlement === "fulfill") resolve();
      else reject(new Error("expected rejection"));
      await expect(first).resolves.toMatchObject({
        status: settlement === "fulfill" ? "saved" : "failed",
      });
      expect(controller.settings.sourceRoot).toBe(
        settlement === "fulfill" ? "Other" : "Sources",
      );
      expect(controller.sourceRootPersistenceState).toEqual({
        status: "settled",
      });
      expect(controller.sourceWriteGeneration).toBe(1);
      expect(invalidations).toBe(1);
      expect(maximumInFlight).toBe(1);
    },
  );

  it.each(["fulfill", "reject"] as const)(
    "serializes every page-pending same/different page/root reentry when the first save will %s",
    async (settlement) => {
      let resolve!: () => void;
      let reject!: (reason?: unknown) => void;
      const pending = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      let inFlight = 0;
      let maximumInFlight = 0;
      const controller = new SettingsController(
        {
          schemaVersion: 2,
          previewMessagesPerPage: 25,
          sourceRoot: "Sources",
        },
        async () => {
          inFlight += 1;
          maximumInFlight = Math.max(maximumInFlight, inFlight);
          try {
            await pending;
          } finally {
            inFlight -= 1;
          }
        },
        () => undefined,
      );
      const first = controller.savePreviewMessagesPerPage(50);
      for (const reentry of [
        controller.savePreviewMessagesPerPage(25),
        controller.savePreviewMessagesPerPage(50),
        controller.saveSourceRoot("Sources"),
        controller.saveSourceRoot("Other"),
      ])
        await expect(reentry).resolves.toMatchObject({ status: "in-progress" });
      if (settlement === "fulfill") resolve();
      else reject(new Error("expected rejection"));
      await expect(first).resolves.toMatchObject({
        status: settlement === "fulfill" ? "saved" : "failed",
      });
      expect(controller.settings).toEqual({
        schemaVersion: 2,
        previewMessagesPerPage: settlement === "fulfill" ? 50 : 25,
        sourceRoot: "Sources",
      });
      expect(controller.sourceWriteGeneration).toBe(0);
      expect(controller.sourceRootPersistenceState).toEqual({
        status: "settled",
      });
      expect(maximumInFlight).toBe(1);
    },
  );

  it.each([
    ["page→page", ["page-50", "page-10"]],
    ["page→root", ["page-50", "root-Other"]],
    ["root→page", ["root-Other", "page-50"]],
    ["root→root", ["root-Other", "root-Sources"]],
  ] as const)(
    "persists fulfilled sequential %s ordering with one canonical v2 write at a time",
    async (_name, operations) => {
      const writes: unknown[] = [];
      let inFlight = 0;
      let maximumInFlight = 0;
      const controller = new SettingsController(
        {
          schemaVersion: 2,
          previewMessagesPerPage: 25,
          sourceRoot: "Sources",
        },
        async (value) => {
          inFlight += 1;
          maximumInFlight = Math.max(maximumInFlight, inFlight);
          await Promise.resolve();
          writes.push(structuredClone(value));
          inFlight -= 1;
        },
        () => undefined,
      );
      for (const operation of operations) {
        const result = operation.startsWith("page-")
          ? await controller.savePreviewMessagesPerPage(
              Number(operation.slice("page-".length)),
            )
          : await controller.saveSourceRoot(operation.slice("root-".length));
        expect(result).toEqual({ status: "saved" });
      }
      expect(writes).toHaveLength(2);
      expect(
        writes.every(
          (value) =>
            JSON.stringify(Object.keys(value as object)) ===
            JSON.stringify([
              "schemaVersion",
              "previewMessagesPerPage",
              "sourceRoot",
            ]),
        ),
      ).toBe(true);
      expect(maximumInFlight).toBe(1);
      expect(controller.sourceRootPersistenceState).toEqual({
        status: "settled",
      });
    },
  );
});
