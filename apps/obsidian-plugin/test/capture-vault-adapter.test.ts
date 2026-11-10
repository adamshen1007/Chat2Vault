/* eslint-disable @typescript-eslint/require-await -- in-memory async adapters model Vault and native promise boundaries. */
import { describe, expect, test } from "vitest";
import {
  parseStagingCapture,
  renderCaptureSource,
  validateCapture,
  type CaptureDraft,
} from "@chat2vault/core";
import type { NativeContainmentAdapter } from "../src/containment.js";
import type { NativeVaultPublishResult } from "../src/native-observer.js";
import type {
  SourceVaultIO,
  VaultPathEntry,
} from "../src/source-vault-adapter.js";
import {
  createObsidianCaptureVaultIO,
  ObsidianCaptureVaultAdapter,
  type CapturePlanInput,
  type CaptureReconciliationService,
  type CaptureReconciliationStatus,
  type CaptureReconciliationToken,
  type CaptureVaultIO,
} from "../src/capture-vault-adapter.js";

const encoder = new TextEncoder();
const url = "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111";

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function staging(text = "Synthetic visible text"): Uint8Array {
  return encoder.encode(`---
chat2vault_capture: 1
capture_method: "obsidian-web-clipper"
capture_scope: "visible-page-unverified"
source_provider: "chatgpt"
source_url: "${url}"
capture_title: "Synthetic title"
---
${text}`);
}

function manualDraft(text = "Synthetic paste"): CaptureDraft {
  const result = validateCapture({ method: "manual-paste", text });
  if (!result.ok) throw new Error(result.code);
  return result.draft;
}

function stagingDraft(bytes: Uint8Array): CaptureDraft {
  const result = parseStagingCapture(bytes);
  if (!result.ok) throw new Error(result.code);
  return result.draft;
}

function harness() {
  const entries = new Map<string, VaultPathEntry>();
  const bytes = new Map<string, Uint8Array>();
  const identities = new Map<string, { device: string; inode: string }>();
  let nextInode = 1;
  let sourceRoot = "Sources";
  let knowledgeRoot = "Knowledge";
  let pending = false;
  let createCalls = 0;
  let exclusiveFailure = false;
  let publishResult: NativeVaultPublishResult | undefined;
  let postPublishIdentityPath: string | undefined;
  let corruptReadback = false;
  let unboundedReads = 0;
  let boundedReads = 0;
  let reconciliation: CaptureReconciliationStatus = { status: "clear" };
  let prepareFails = false;
  let updateFails = false;
  let clearFails = false;
  let preparing = false;
  let preparePause:
    | {
        started: ReturnType<typeof deferred<undefined>>;
        release: ReturnType<typeof deferred<undefined>>;
      }
    | undefined;
  const reconciliationCalls: string[] = [];
  const children = (parent: string) =>
    [...entries.values()].filter((entry) => {
      const index = entry.path.lastIndexOf("/");
      return (index < 0 ? "" : entry.path.slice(0, index)) === parent;
    });
  const assignIdentity = (path: string) =>
    identities.set(path, { device: "1", inode: String(nextInode++) });
  identities.set("", { device: "1", inode: String(nextInode++) });
  const addFolder = (path: string) => {
    entries.set(path, { path, kind: "folder" });
    assignIdentity(path);
  };
  const addFile = (path: string, value: Uint8Array) => {
    entries.set(path, { path, kind: "file" });
    bytes.set(path, value);
    assignIdentity(path);
  };
  addFolder("Sources");
  addFolder("Knowledge");
  addFolder("Staging");
  addFolder(".obsidian");
  addFile("Staging/capture.md", staging());

  const base: SourceVaultIO = {
    configDir: ".obsidian",
    basePath: "/vault",
    list: async (path) => children(path),
    lookup: async (path) => entries.get(path),
    readBinary: async (path) => {
      unboundedReads += 1;
      const value = bytes.get(path);
      if (value === undefined) throw new Error("missing");
      if (corruptReadback && path.startsWith("Sources/"))
        return encoder.encode("corrupt");
      return new Uint8Array(value);
    },
    readBinaryBounded: async (path, maxBytes) => {
      boundedReads += 1;
      const value = bytes.get(path);
      if (value === undefined) throw new Error("missing");
      if (corruptReadback && path.startsWith("Sources/"))
        return encoder.encode("corrupt");
      return value.slice(0, maxBytes + 1);
    },
    createFolder: async () => {
      throw new Error("capture adapter must not create folders");
    },
    create: async () => {
      throw new Error("capture adapter must not use non-exclusive create");
    },
  };
  const io: CaptureVaultIO = {
    ...base,
    observeIdentity: async (path) => identities.get(path),
    publishExclusive: async (request) => {
      reconciliationCalls.push("publish");
      createCalls += 1;
      const path = `${request.parentPath}/${request.targetName}`;
      if (publishResult !== undefined) return publishResult;
      if (exclusiveFailure) return { kind: "failed" };
      if (entries.has(path)) return { kind: "collision" };
      addFile(path, request.bytes);
      if (postPublishIdentityPath !== undefined)
        assignIdentity(postPublishIdentityPath);
      return { kind: "published" };
    },
  };
  const native: NativeContainmentAdapter = {
    platform: "darwin",
    separator: "/",
    aliasCapability: async () => ({
      kind: "available",
      capability: "macos-mount-point",
    }),
    lstat: async (path) => {
      if (path === "/vault")
        return { kind: "present", objectKind: "directory" };
      const relative = path.slice("/vault/".length);
      const entry = entries.get(relative);
      return entry === undefined
        ? { kind: "absent" }
        : {
            kind: "present",
            objectKind: entry.kind === "folder" ? "directory" : "regular-file",
          };
    },
    realpath: async (path) => ({ kind: "resolved", realPath: path }),
    observeWindowsReparsePoint: async () => ({ kind: "not-reparse-point" }),
    observeMacOSMountPoint: async () => ({ kind: "not-mount-point" }),
  };
  const reconciliationService: CaptureReconciliationService = {
    current: () => reconciliation,
    prepare: async (record) => {
      reconciliationCalls.push(`prepare:${record.targetPathDigest}`);
      if (reconciliation.status !== "clear" || preparing)
        return {
          status: "failed" as const,
          code: "CAPTURE_RECONCILIATION_REQUIRED" as const,
        };
      preparing = true;
      const pause = preparePause;
      if (pause !== undefined) {
        pause.started.resolve(undefined);
        await pause.release.promise;
        preparePause = undefined;
      }
      if (prepareFails) {
        preparing = false;
        return {
          status: "failed" as const,
          code: "CAPTURE_RECONCILIATION_PREPARE_FAILED" as const,
        };
      }
      const token =
        "223e4567-e89b-42d3-a456-426614174000" as CaptureReconciliationToken;
      reconciliation = {
        status: "unresolved",
        record: {
          version: 1,
          state: "prepared",
          transactionId: token,
          ...record,
        },
      };
      preparing = false;
      return { status: "prepared" as const, token };
    },
    markUncertain: async (token, effect, artifact) => {
      reconciliationCalls.push(`mark:${effect}`);
      if (updateFails)
        return {
          status: "failed" as const,
          code: "CAPTURE_RECONCILIATION_UPDATE_FAILED" as const,
        };
      const current = reconciliation;
      if (
        current.status !== "unresolved" ||
        current.record.transactionId !== token
      )
        throw new Error("missing prepared reconciliation");
      if (effect === "temporary" && artifact === undefined)
        throw new Error("missing temporary candidate");
      if (effect === "published")
        reconciliation = {
          status: "unresolved",
          record: { ...current.record, state: "published-uncertain" },
        };
      else {
        if (artifact === undefined) throw new Error("missing candidate");
        reconciliation = {
          status: "unresolved",
          record: {
            ...current.record,
            state: "temporary-uncertain",
            temporaryCandidate: artifact,
          },
        };
      }
      return { status: "updated" as const };
    },
    clearKnownOutcome: async (token) => {
      reconciliationCalls.push("clear-known");
      if (clearFails)
        return {
          status: "failed" as const,
          code: "CAPTURE_RECONCILIATION_CLEAR_FAILED" as const,
        };
      if (
        reconciliation.status !== "unresolved" ||
        reconciliation.record.transactionId !== token
      )
        return {
          status: "failed" as const,
          code: "CAPTURE_RECONCILIATION_CLEAR_FAILED" as const,
        };
      reconciliation = { status: "clear" };
      return { status: "cleared" as const };
    },
    acknowledge: async () => {
      reconciliationCalls.push("acknowledge");
      if (clearFails)
        return {
          status: "failed" as const,
          code: "CAPTURE_RECONCILIATION_CLEAR_FAILED" as const,
        };
      reconciliation = { status: "clear" };
      return { status: "cleared" as const };
    },
  };
  const adapter = () =>
    new ObsidianCaptureVaultAdapter(
      io,
      native,
      {
        sourceRoot: () => sourceRoot,
        knowledgeRoot: () => knowledgeRoot,
        settingsPending: () => pending,
        platform: "darwin",
        arch: "x64",
      },
      reconciliationService,
    );
  return {
    adapter,
    entries,
    bytes,
    native,
    addFolder,
    addFile,
    get createCalls() {
      return createCalls;
    },
    get unboundedReads() {
      return unboundedReads;
    },
    get boundedReads() {
      return boundedReads;
    },
    setSourceRoot(value: string) {
      sourceRoot = value;
    },
    setKnowledgeRoot(value: string) {
      knowledgeRoot = value;
    },
    setPending(value: boolean) {
      pending = value;
    },
    failExclusive() {
      exclusiveFailure = true;
    },
    setPublishResult(value: NativeVaultPublishResult) {
      publishResult = value;
    },
    replaceIdentity(path: string) {
      assignIdentity(path);
    },
    changeIdentityAfterPublish(path: string) {
      postPublishIdentityPath = path;
    },
    corruptReadback() {
      corruptReadback = true;
    },
    reconciliationCalls,
    setReconciliation(value: CaptureReconciliationStatus) {
      reconciliation = value;
    },
    failReconciliationPrepare() {
      prepareFails = true;
    },
    failReconciliationUpdate() {
      updateFails = true;
    },
    failReconciliationClear() {
      clearFails = true;
    },
    pauseReconciliationPrepare() {
      const started = deferred<undefined>();
      const release = deferred<undefined>();
      preparePause = { started, release };
      return {
        started: started.promise,
        release: () => release.resolve(undefined),
      };
    },
  };
}

async function stagedInput(
  adapter: ObsidianCaptureVaultAdapter,
  path = "Staging/capture.md",
): Promise<CapturePlanInput> {
  const observed = await adapter.readActiveStaging(path);
  if ("code" in observed) throw new Error(observed.code);
  return {
    draft: stagingDraft(observed.bytes),
    source: { kind: "staging", path, digest: observed.digest },
  };
}

describe("M08 capture vault adapter", () => {
  test("allows only one of two views that passed the precheck to publish", async () => {
    const state = harness();
    const first = state.adapter();
    const second = state.adapter();
    const draft = manualDraft("two-view synthetic");
    const input: CapturePlanInput = {
      draft,
      source: { kind: "manual", fingerprint: draft.fingerprint },
    };
    const firstPlan = await first.plan(input);
    const secondPlan = await second.plan(input);
    const pause = state.pauseReconciliationPrepare();
    const firstSave = first.save(firstPlan, input);
    await pause.started;
    await expect(second.save(secondPlan, input)).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_RECONCILIATION_REQUIRED",
    });
    expect(state.createCalls).toBe(0);
    pause.release();
    await expect(firstSave).resolves.toMatchObject({ status: "saved" });
    expect(state.createCalls).toBe(1);
  });

  test("prepares a durable record before publish and blocks a crash-window retry", async () => {
    const state = harness();
    const adapter = state.adapter();
    const draft = manualDraft("write-ahead synthetic");
    const input: CapturePlanInput = {
      draft,
      source: { kind: "manual", fingerprint: draft.fingerprint },
    };
    const plan = await adapter.plan(input);
    const pending = adapter.save(plan, input);
    await pending;
    expect(state.reconciliationCalls[0]).toMatch(
      /^prepare:sha256:[0-9a-f]{64}$/u,
    );
    expect(state.reconciliationCalls.slice(0, 2)).toEqual([
      expect.stringMatching(/^prepare:sha256:[0-9a-f]{64}$/u),
      "publish",
    ]);
    expect(state.reconciliationCalls.at(-1)).toBe("clear-known");

    const crash = harness();
    crash.setReconciliation({
      status: "unresolved",
      record: {
        version: 1,
        state: "prepared",
        transactionId: "223e4567-e89b-42d3-a456-426614174000",
        targetPathDigest: `sha256:${"a".repeat(64)}`,
        targetLocator: "0123456789ab",
        sourceRootPathDigest: `sha256:${"b".repeat(64)}`,
        sourceRootIdentity: { device: "1", inode: "2" },
      },
    });
    const crashAdapter = crash.adapter();
    const crashPlan = await crashAdapter.plan(input);
    await expect(crashAdapter.save(crashPlan, input)).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_RECONCILIATION_REQUIRED",
    });
    expect(crash.createCalls).toBe(0);
  });

  test("fails closed before publish and retains the block after update or clear persistence failure", async () => {
    const prepare = harness();
    const prepareAdapter = prepare.adapter();
    const draft = manualDraft("persistence synthetic");
    const input: CapturePlanInput = {
      draft,
      source: { kind: "manual", fingerprint: draft.fingerprint },
    };
    const preparePlan = await prepareAdapter.plan(input);
    prepare.failReconciliationPrepare();
    await expect(prepareAdapter.save(preparePlan, input)).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_RECONCILIATION_PREPARE_FAILED",
    });
    expect(prepare.createCalls).toBe(0);

    const update = harness();
    const updateAdapter = update.adapter();
    const updatePlan = await updateAdapter.plan(input);
    update.setPublishResult({ kind: "uncertain", effect: "published" });
    update.failReconciliationUpdate();
    await expect(updateAdapter.save(updatePlan, input)).resolves.toMatchObject({
      status: "blocked",
      effect: "published",
    });
    expect(update.reconciliationCalls).toEqual([
      expect.stringMatching(/^prepare:/u),
      "publish",
      "mark:published",
    ]);
    await expect(updateAdapter.save(updatePlan, input)).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_RECONCILIATION_REQUIRED",
    });

    const clear = harness();
    const clearAdapter = clear.adapter();
    const clearPlan = await clearAdapter.plan(input);
    clear.failReconciliationClear();
    await expect(clearAdapter.save(clearPlan, input)).resolves.toMatchObject({
      status: "blocked",
      code: "CAPTURE_RECONCILIATION_CLEAR_FAILED",
      effect: "published",
    });
    await expect(clearAdapter.save(clearPlan, input)).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_RECONCILIATION_REQUIRED",
    });
  });
  test("runtime I/O factory exposes only capture-specific capabilities", () => {
    const io = createObsidianCaptureVaultIO({
      vault: {
        configDir: ".obsidian",
        adapter: {
          list: async () => ({ files: [], folders: [] }),
          stat: async () => null,
          readBinary: async () => new ArrayBuffer(0),
        },
        create: async () => {
          throw new Error("must not be exposed");
        },
        createFolder: async () => {
          throw new Error("must not be exposed");
        },
      },
    } as never);

    expect(Object.keys(io).sort()).toEqual([
      "basePath",
      "configDir",
      "list",
      "lookup",
      "observeIdentity",
      "publishExclusive",
      "readBinaryBounded",
    ]);
    expect(io).not.toHaveProperty("create");
    expect(io).not.toHaveProperty("createFolder");
    expect(io).not.toHaveProperty("delete");
    expect(io).not.toHaveProperty("rename");
    expect(io).not.toHaveProperty("write");
  });

  test("rejects a forged manual draft instead of trusting its fingerprint", async () => {
    const state = harness();
    const valid = manualDraft();
    const forged: CaptureDraft = {
      ...valid,
      text: "forged text",
    };
    await expect(
      state.adapter().plan({
        draft: forged,
        source: { kind: "manual", fingerprint: valid.fingerprint },
      }),
    ).resolves.toMatchObject({
      disposition: "blocked",
      code: "CAPTURE_INPUT_INVALID",
    });
  });

  test("rejects a staging draft whose title differs from the parsed bytes", async () => {
    const state = harness();
    const adapter = state.adapter();
    const input = await stagedInput(adapter);
    input.draft = { ...input.draft, title: "Forged title" };
    await expect(adapter.plan(input)).resolves.toMatchObject({
      disposition: "blocked",
      code: "CAPTURE_INPUT_INVALID",
    });
  });
  test("reads one safe active Markdown note and performs no mutation before explicit save", async () => {
    const state = harness();
    const adapter = state.adapter();
    const input = await stagedInput(adapter);
    const plan = await adapter.plan(input);
    if (input.source.kind !== "staging")
      throw new Error("expected staging input");

    expect(plan).toMatchObject({
      disposition: "create",
      sourceInputFingerprint: input.source.digest,
      sourceRoot: { logicalPath: "Sources", realPath: "/vault/Sources" },
    });
    if (plan.disposition !== "create") throw new Error("expected create plan");
    expect(plan.markdown).toBe(renderCaptureSource(input.draft));
    expect(plan.targetPath).toMatch(
      /^Sources\/Synthetic title - [0-9a-f]{12}\.md$/u,
    );
    expect(state.createCalls).toBe(0);
    expect(state.entries.has("Staging/capture.md")).toBe(true);
  });

  test.each([
    "Sources/staged.md",
    "Knowledge/staged.md",
    ".obsidian/staged.md",
  ])("rejects staging inside protected root: %s", async (path) => {
    const state = harness();
    state.addFile(path, staging());
    await expect(
      state.adapter().readActiveStaging(path),
    ).resolves.toMatchObject({
      code: "CAPTURE_STAGING_PATH_UNSAFE",
    });
  });

  test.each([
    ["Sources", "sources/Knowledge"],
    ["Sources/Knowledge", "SOURCES"],
  ])(
    "blocks bidirectional normalized/case-folded root overlap",
    async (sourceRoot, knowledgeRoot) => {
      const state = harness();
      state.setSourceRoot(sourceRoot);
      state.setKnowledgeRoot(knowledgeRoot);
      const plan = await state.adapter().plan({
        draft: manualDraft(),
        source: { kind: "manual", fingerprint: manualDraft().fingerprint },
      });
      expect(plan).toMatchObject({
        disposition: "blocked",
        code: "CAPTURE_ROOTS_UNSAFE",
      });
    },
  );

  test("blocks physical root aliasing", async () => {
    const state = harness();
    state.native.realpath = async (path) => ({
      kind: "resolved",
      realPath: path === "/vault/Knowledge" ? "/vault/Sources" : path,
    });
    const plan = await state.adapter().plan({
      draft: manualDraft(),
      source: { kind: "manual", fingerprint: manualDraft().fingerprint },
    });
    expect(plan).toMatchObject({
      disposition: "blocked",
      code: "CAPTURE_ROOTS_UNSAFE",
    });
  });

  test("blocks save when staging bytes change after planning", async () => {
    const state = harness();
    const adapter = state.adapter();
    const input = await stagedInput(adapter);
    const plan = await adapter.plan(input);
    state.addFile("Staging/capture.md", staging("Changed text"));

    await expect(adapter.save(plan, input)).resolves.toMatchObject({
      status: "blocked",
      code: "CAPTURE_REPLAN_REQUIRED",
    });
    expect(state.createCalls).toBe(0);
  });

  test("binds the selected staging path even when another note has identical bytes", async () => {
    const state = harness();
    state.addFile("Staging/other.md", staging());
    const adapter = state.adapter();
    const approved = await stagedInput(adapter);
    const plan = await adapter.plan(approved);
    const switched = await stagedInput(adapter, "Staging/other.md");

    await expect(adapter.save(plan, switched)).resolves.toMatchObject({
      status: "blocked",
      code: "CAPTURE_REPLAN_REQUIRED",
    });
    expect(state.createCalls).toBe(0);
  });

  test("returns existing-identical for the same validated capture fingerprint", async () => {
    const state = harness();
    const draft = manualDraft();
    state.addFile(
      `Sources/Existing - ${draft.fingerprint.slice(7, 19)}.md`,
      encoder.encode(renderCaptureSource(draft)),
    );
    const plan = await state.adapter().plan({
      draft,
      source: { kind: "manual", fingerprint: draft.fingerprint },
    });
    expect(plan).toMatchObject({
      disposition: "existing-identical",
      existingPath: `Sources/Existing - ${draft.fingerprint.slice(7, 19)}.md`,
    });
    expect(state.createCalls).toBe(0);
    expect(state.unboundedReads).toBe(0);
    expect(state.boundedReads).toBeGreaterThan(0);
  });

  test("fails closed when the preferred target contains different content", async () => {
    const state = harness();
    const draft = manualDraft();
    const preferred = `Sources/ChatGPT capture - ${draft.fingerprint.slice(7, 19)}.md`;
    state.addFile(preferred, encoder.encode("ordinary note"));
    const plan = await state.adapter().plan({
      draft,
      source: { kind: "manual", fingerprint: draft.fingerprint },
    });
    expect(plan).toMatchObject({
      disposition: "blocked",
      code: "CAPTURE_TARGET_COLLISION",
    });
    expect(state.createCalls).toBe(0);
  });

  test("exclusive create fails closed on a concurrent target collision", async () => {
    const state = harness();
    const adapter = state.adapter();
    const input = {
      draft: manualDraft(),
      source: {
        kind: "manual",
        fingerprint: manualDraft().fingerprint,
      } as const,
    };
    const plan = await adapter.plan(input);
    if (plan.disposition !== "create") throw new Error("expected create plan");
    const original = state.entries.get(plan.targetPath);
    expect(original).toBeUndefined();
    state.failExclusive();

    await expect(adapter.save(plan, input)).resolves.toMatchObject({
      status: "blocked",
      code: "CAPTURE_CREATE_FAILED",
    });
    expect(state.createCalls).toBe(1);
  });

  test("binds previewed vault, source-parent, and config physical identities", async () => {
    const state = harness();
    const adapter = state.adapter();
    const draft = manualDraft("identity-bound");
    const input: CapturePlanInput = {
      draft,
      source: { kind: "manual", fingerprint: draft.fingerprint },
    };
    const plan = await adapter.plan(input);
    if (plan.disposition !== "create") throw new Error("expected create plan");
    state.replaceIdentity("Sources");

    await expect(adapter.save(plan, input)).resolves.toMatchObject({
      status: "blocked",
      code: "CAPTURE_REPLAN_REQUIRED",
    });
    expect(state.createCalls).toBe(0);
  });

  test("distinguishes publication collision and uncertain native effects", async () => {
    const collision = harness();
    const collisionAdapter = collision.adapter();
    const draft = manualDraft("collision");
    const input: CapturePlanInput = {
      draft,
      source: { kind: "manual", fingerprint: draft.fingerprint },
    };
    const collisionPlan = await collisionAdapter.plan(input);
    collision.setPublishResult({ kind: "collision" });
    await expect(
      collisionAdapter.save(collisionPlan, input),
    ).resolves.toMatchObject({
      status: "blocked",
      code: "CAPTURE_REPLAN_REQUIRED",
    });

    const uncertain = harness();
    const uncertainAdapter = uncertain.adapter();
    const uncertainPlan = await uncertainAdapter.plan(input);
    uncertain.setPublishResult({
      kind: "uncertain",
      effect: "temporary",
      temporaryArtifact: {
        path: "Sources/.chat2vault-private-123",
        ownership: "unverified",
        identity: { device: "1", inode: "77" },
      },
    } as unknown as NativeVaultPublishResult);
    await expect(uncertainAdapter.save(uncertainPlan, input)).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_EFFECT_UNCERTAIN",
      effect: "temporary",
      temporaryArtifact: {
        path: "Sources/.chat2vault-private-123",
        ownership: "unverified",
        identity: { device: "1", inode: "77" },
      },
    });
    await expect(uncertainAdapter.acknowledgeReconciliation()).resolves.toEqual(
      { status: "cleared" },
    );
    uncertain.setPublishResult({
      kind: "uncertain",
      effect: "temporary",
      temporaryArtifact: {
        path: "Sources/.chat2vault-private-456",
        ownership: "unverified",
      },
    });
    await expect(uncertainAdapter.save(uncertainPlan, input)).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_EFFECT_UNCERTAIN",
      effect: "temporary",
      temporaryArtifact: {
        path: "Sources/.chat2vault-private-456",
        ownership: "unverified",
      },
    });
  });

  test.each(["short native write", "native fsync failure"])(
    "fails closed on injected %s without a visible target",
    async () => {
      const state = harness();
      const adapter = state.adapter();
      const draft = manualDraft("native failure");
      const input: CapturePlanInput = {
        draft,
        source: { kind: "manual", fingerprint: draft.fingerprint },
      };
      const plan = await adapter.plan(input);
      if (plan.disposition !== "create")
        throw new Error("expected create plan");
      state.setPublishResult({ kind: "failed" });
      await expect(adapter.save(plan, input)).resolves.toEqual({
        status: "blocked",
        code: "CAPTURE_CREATE_FAILED",
      });
      expect(state.entries.has(plan.targetPath)).toBe(false);
    },
  );

  test("returns reconciliation-required after a post-publish root identity change", async () => {
    const state = harness();
    const adapter = state.adapter();
    const draft = manualDraft("post-publish identity");
    const input: CapturePlanInput = {
      draft,
      source: { kind: "manual", fingerprint: draft.fingerprint },
    };
    const plan = await adapter.plan(input);
    state.changeIdentityAfterPublish("Sources");
    await expect(adapter.save(plan, input)).resolves.toEqual({
      status: "blocked",
      code: "CAPTURE_EFFECT_UNCERTAIN",
      effect: "published",
    });
    if (plan.disposition !== "create") throw new Error("expected create plan");
    expect(state.entries.has(plan.targetPath)).toBe(true);
  });

  test("bounds each registry read and the aggregate registry snapshot", async () => {
    const perFile = harness();
    perFile.addFile("Sources/oversized.md", new Uint8Array(1_064_961).fill(97));
    const draft = manualDraft("bounded registry");
    await expect(
      perFile.adapter().plan({
        draft,
        source: { kind: "manual", fingerprint: draft.fingerprint },
      }),
    ).resolves.toMatchObject({
      disposition: "blocked",
      code: "CAPTURE_REGISTRY_UNSAFE",
    });
    expect(perFile.unboundedReads).toBe(0);

    const aggregate = harness();
    for (let index = 0; index < 18; index += 1)
      aggregate.addFile(
        `Sources/ordinary-${String(index)}.md`,
        new Uint8Array(1_000_000).fill(97),
      );
    await expect(
      aggregate.adapter().plan({
        draft,
        source: { kind: "manual", fingerprint: draft.fingerprint },
      }),
    ).resolves.toMatchObject({
      disposition: "blocked",
      code: "CAPTURE_REGISTRY_UNSAFE",
    });
    expect(aggregate.unboundedReads).toBe(0);
  });

  test("rejects an unbounded source-root listing before registry reads", async () => {
    const state = harness();
    for (let index = 0; index < 10_001; index += 1)
      state.addFile(`Sources/ordinary-${String(index)}.txt`, new Uint8Array());
    const draft = manualDraft("bounded listing");
    await expect(
      state.adapter().plan({
        draft,
        source: { kind: "manual", fingerprint: draft.fingerprint },
      }),
    ).resolves.toMatchObject({
      disposition: "blocked",
      code: "CAPTURE_REGISTRY_UNSAFE",
    });
  });

  test.each(["missing", "pending"])(
    "blocks a %s source-root state",
    async (kind) => {
      const state = harness();
      if (kind === "missing") {
        state.setSourceRoot("Missing");
      } else {
        state.setPending(true);
      }
      const draft = manualDraft();
      await expect(
        state.adapter().plan({
          draft,
          source: { kind: "manual", fingerprint: draft.fingerprint },
        }),
      ).resolves.toMatchObject({ disposition: "blocked" });
      expect(state.createCalls).toBe(0);
    },
  );

  test("reports failed exclusive create and failed exact-byte readback", async () => {
    const failedCreate = harness();
    const firstAdapter = failedCreate.adapter();
    const firstDraft = manualDraft("first");
    const firstInput: CapturePlanInput = {
      draft: firstDraft,
      source: { kind: "manual", fingerprint: firstDraft.fingerprint },
    };
    const firstPlan = await firstAdapter.plan(firstInput);
    failedCreate.failExclusive();
    await expect(
      firstAdapter.save(firstPlan, firstInput),
    ).resolves.toMatchObject({
      status: "blocked",
      code: "CAPTURE_CREATE_FAILED",
    });

    const failedReadback = harness();
    const secondAdapter = failedReadback.adapter();
    const secondDraft = manualDraft("second");
    const secondInput: CapturePlanInput = {
      draft: secondDraft,
      source: { kind: "manual", fingerprint: secondDraft.fingerprint },
    };
    const secondPlan = await secondAdapter.plan(secondInput);
    failedReadback.corruptReadback();
    await expect(
      secondAdapter.save(secondPlan, secondInput),
    ).resolves.toMatchObject({
      status: "blocked",
      code: "CAPTURE_EFFECT_UNCERTAIN",
      effect: "published",
    });
    expect(failedReadback.createCalls).toBe(1);
  });

  test("saves exact bytes once while leaving staging untouched", async () => {
    const state = harness();
    const adapter = state.adapter();
    const input = await stagedInput(adapter);
    const plan = await adapter.plan(input);
    const stagingBefore = state.bytes.get("Staging/capture.md");
    const result = await adapter.save(plan, input);

    expect(result).toMatchObject({ status: "saved" });
    expect(state.createCalls).toBe(1);
    expect(state.bytes.get("Staging/capture.md")).toEqual(stagingBefore);
    if (plan.disposition !== "create") throw new Error("expected create plan");
    expect(state.bytes.get(plan.targetPath)).toEqual(
      encoder.encode(plan.markdown),
    );
  });
});
