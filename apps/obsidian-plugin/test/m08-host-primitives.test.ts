import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface HostPrimitives {
  assertFreshLaunchIdentity: (
    previous: { pid: number; targetId: string; sessionId: string },
    current: {
      pid: number;
      executable: string;
      targetId: string;
      sessionId: string;
      listenerPids: number[];
    },
  ) => void;
  makeHostFailureRecord: (
    value: Record<string, unknown>,
  ) => Record<string, unknown>;
  makeReadinessDiagnostic: (
    value: Record<string, unknown>,
  ) => Record<string, unknown>;
  hostFailureStage: (error: unknown, fallback: string) => string;
  selectFreshTarget: (
    targets: unknown[],
    predicate: (value: Record<string, unknown>) => boolean,
    staleTargetIds: ReadonlySet<string>,
  ) => Record<string, unknown> | undefined;
}

const load = async () =>
  (await import(
    pathToFileURL(
      join(import.meta.dirname, "../scripts/m08-host-primitives.mjs"),
    ).href
  )) as HostPrimitives;

describe("M08 host primitives", () => {
  it("uses a dedicated M08 driver without textual M05 harness patching", async () => {
    const runtime = await readFile(
      join(import.meta.dirname, "../scripts/check-m08-runtime.mjs"),
      "utf8",
    );
    const driver = await readFile(
      join(import.meta.dirname, "../scripts/check-m08-host.mjs"),
      "utf8",
    );

    expect(runtime).toContain('"./check-m08-host.mjs"');
    expect(runtime).not.toMatch(
      /legacyHarness|buildDriver|replaceOnce|removeInheritedM05ProviderExercise/u,
    );
    expect(driver).toContain('from "./m08-host-primitives.mjs"');
    expect(driver).not.toMatch(/check-m05-runtime|\.replace\(/u);
  });

  it("rejects a stale CDP endpoint and selects only a fresh matching target", async () => {
    const { selectFreshTarget } = await load();
    const stale = {
      id: "old-target",
      type: "page",
      url: "app://obsidian.md/index.html",
      webSocketDebuggerUrl: "ws://127.0.0.1/old-target",
    };
    const fresh = {
      id: "new-target",
      type: "page",
      url: "app://obsidian.md/index.html",
      webSocketDebuggerUrl: "ws://127.0.0.1/new-target",
    };

    expect(
      selectFreshTarget(
        [stale],
        (candidate) => candidate.type === "page",
        new Set(["old-target"]),
      ),
    ).toBeUndefined();
    expect(
      selectFreshTarget(
        [stale, fresh],
        (candidate) => candidate.type === "page",
        new Set(["old-target"]),
      )?.id,
    ).toBe("new-target");
  });

  it("requires a new host, listener owner, target, and renderer session after SIGKILL", async () => {
    const { assertFreshLaunchIdentity } = await load();
    const previous = { pid: 101, targetId: "target-a", sessionId: "session-a" };
    const current = {
      pid: 202,
      executable: "Obsidian",
      targetId: "target-b",
      sessionId: "session-b",
      listenerPids: [202],
    };

    expect(() => assertFreshLaunchIdentity(previous, current)).not.toThrow();
    for (const changed of [
      { ...current, pid: 101, listenerPids: [101] },
      { ...current, listenerPids: [999] },
      { ...current, targetId: "target-a" },
      { ...current, sessionId: "session-a" },
    ])
      expect(() => assertFreshLaunchIdentity(previous, changed)).toThrow(
        /fresh host identity/u,
      );
  });

  it("emits a closed content-free failure record", async () => {
    const { hostFailureStage, makeHostFailureRecord } = await load();
    expect(
      hostFailureStage(
        new Error("M08_CDP_COMMAND_TIMEOUT stage=m08-plugin-ready"),
        "outer-stage",
      ),
    ).toBe("m08-plugin-ready");
    expect(hostFailureStage(new Error("other"), "outer-stage")).toBe(
      "outer-stage",
    );
    const record = makeHostFailureRecord({
      row: "minimum",
      stage: "m08-crash-published-ready",
      commandId: 7,
      targetId: "target-b",
      sessionId: "session-b",
      pid: 202,
      executable: "/private/tmp/secret-profile/Obsidian",
      port: 22345,
      listenerPids: [202],
      processState: {
        alive: true,
        exited: false,
        exitCode: null,
        signal: null,
      },
      startedAt: "2026-10-20T00:00:00.000Z",
      failedAt: "2026-10-20T00:00:05.000Z",
      stderr: "capture title at /Users/example/private-vault",
      error: new Error("Runtime.evaluate timed out for private content"),
    });

    expect(record).toEqual({
      schemaVersion: 1,
      row: "minimum",
      stage: "m08-crash-published-ready",
      commandId: 7,
      targetId: "target-b",
      sessionId: "session-b",
      pid: 202,
      executable: "Obsidian",
      port: 22345,
      listenerPids: [202],
      processState: {
        alive: true,
        exited: false,
        exitCode: null,
        signal: null,
      },
      startedAt: "2026-10-20T00:00:00.000Z",
      failedAt: "2026-10-20T00:00:05.000Z",
      stderrSummary: {
        category: "unclassified",
        bytes: 45,
        truncated: false,
      },
      errorClass: "Error",
      errorCode: "UNCLASSIFIED",
    });
    expect(JSON.stringify(record)).not.toMatch(/private|capture title|Users/u);
    expect(() =>
      makeHostFailureRecord({ ...record, capturedText: "forbidden" }),
    ).toThrow(/failure record input/u);
  });

  it("emits a closed content-free readiness diagnostic without process arguments", async () => {
    const { makeReadinessDiagnostic } = await load();
    const diagnostic = makeReadinessDiagnostic({
      row: "minimum",
      stage: "m08-application-ready",
      commandId: 8,
      host: { pid: 202, alive: true, state: "S", elapsed: "00:19" },
      renderer: { pid: 303, alive: true, state: "R", elapsed: "00:18" },
      listenerPids: [202],
      target: { id: "target-b", type: "page", urlScheme: "app" },
      sessionId: "session-b",
      capturedAt: "2026-10-20T00:00:19.000Z",
    });

    expect(diagnostic).toEqual({
      schemaVersion: 1,
      row: "minimum",
      stage: "m08-application-ready",
      commandId: 8,
      host: { pid: 202, alive: true, state: "S", elapsed: "00:19" },
      renderer: { pid: 303, alive: true, state: "R", elapsed: "00:18" },
      listenerPids: [202],
      target: { id: "target-b", type: "page", urlScheme: "app" },
      sessionId: "session-b",
      capturedAt: "2026-10-20T00:00:19.000Z",
      stackSample: "skipped-privacy",
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/private|Users|args|vault/u);
    expect(() =>
      makeReadinessDiagnostic({
        ...diagnostic,
        processArguments: ["--user-data-dir=/private/path"],
      }),
    ).toThrow(/readiness diagnostic input/u);
  });
});
