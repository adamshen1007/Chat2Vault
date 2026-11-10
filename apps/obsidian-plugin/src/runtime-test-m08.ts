import { createHash } from "node:crypto";
import { parseCaptureSource } from "@chat2vault/core";
import type { App } from "obsidian";
import type { CaptureController } from "./capture-controller.js";
import type {
  CapturePlanInput,
  CaptureWritePlan,
} from "./capture-vault-adapter.js";
import type { Chat2VaultView } from "./view.js";

export const M08_RUNTIME_SCENARIOS = Object.freeze([
  "staging-created",
  "manual-created",
  "duplicate-no-op",
  "changed-content-versioned",
  "stale-preview-blocked",
  "prepared-crash-reload-blocked",
  "published-crash-reload-blocked",
  "clear-failure-reload-blocked",
  "protected-notes-unchanged",
  "provider-not-called",
] as const);

type ScenarioId = (typeof M08_RUNTIME_SCENARIOS)[number];

export interface M08RuntimeEvidence {
  scenarioRegistry: readonly ScenarioId[];
  scenarios: readonly { id: ScenarioId; outcome: "success" }[];
  created: readonly { path: string; sha256: string }[];
  duplicate: { status: "existing-identical"; mutationDelta: 0 };
  stale: { status: "stale"; mutationDelta: 0 };
  protected: readonly {
    path: string;
    beforeHash: string;
    afterHash: string;
    unchanged: true;
  }[];
  stagingFixture: {
    writer: "runtime-harness";
    qualification: "synthetic-staging-contract";
  };
  provider: { beforeCalls: 0; afterCalls: 0 };
  reconciliation: {
    preparedBeforePublish: {
      targetPresent: false;
      reloadBlocked: true;
      blockedWriteDelta: 0;
    };
    publishedBeforeClear: {
      targetPresent: true;
      reloadBlocked: true;
      blockedWriteDelta: 0;
    };
    clearPersistenceFailure: {
      targetPresent: true;
      saveEffect: "published";
      reloadBlocked: true;
      blockedWriteDelta: 0;
    };
  };
  counts: {
    created: 5;
    providerCalls: 0;
    reconciliationPersistenceAttempts: 13;
    reconciliationWrites: 12;
    reconciliationFailures: 1;
  };
  privacy: { relativePathsOnly: true; retainedContent: false };
}

type ReadyPlan = Exclude<CaptureWritePlan, { disposition: "blocked" }>;

export interface M08RuntimeReconciliationHarness {
  prepareOnly(plan: ReadyPlan, input: CapturePlanInput): Promise<void>;
  publishOnly(plan: ReadyPlan): Promise<void>;
  reloadSettings(): Promise<void>;
  failNextClearPersistence(): void;
  persistenceCounts(): {
    attempts: number;
    successful: number;
    failed: number;
  };
}

interface RuntimeView {
  captureController?: CaptureController;
}

const stagingPath = "Staging/synthetic-chatgpt-capture.md";
const protectedPaths = ["Sources/existing.md", "Knowledge/existing.md"];
const url = "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111";
function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertion(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`M08 runtime assertion failed: ${message}`);
}

function scenario(id: ScenarioId) {
  return { id, outcome: "success" as const };
}

export async function prepareM08RuntimeVault(app: App): Promise<void> {
  await app.vault.createFolder("Sources");
  await app.vault.createFolder("Knowledge");
  await app.vault.createFolder("Staging");
  await app.vault.create("Sources/existing.md", "Synthetic existing source\n");
  await app.vault.create(
    "Knowledge/existing.md",
    "Synthetic existing knowledge\n",
  );
  await app.vault.create(
    stagingPath,
    [
      "---",
      "chat2vault_capture: 1",
      'capture_method: "obsidian-web-clipper"',
      'capture_scope: "visible-page-unverified"',
      'source_provider: "chatgpt"',
      `source_url: ${JSON.stringify(url)}`,
      'capture_title: "Synthetic staged capture"',
      "---",
      "Synthetic staged capture text.",
    ].join("\n"),
  );
  await app.workspace.openLinkText(stagingPath, "", false);
}

async function sourceCaptureFiles(app: App): Promise<string[]> {
  const paths = (await app.vault.adapter.list("Sources")).files
    .filter((path) => path.startsWith("Sources/"))
    .filter((path) => path.endsWith(".md"))
    .filter((path) => path !== "Sources/existing.md")
    .sort();
  for (const path of paths) {
    const parsed = parseCaptureSource(
      new Uint8Array(await app.vault.adapter.readBinary(path)),
      path,
    );
    assertion(parsed.ok, `created source parses: ${path}`);
  }
  return paths;
}

export async function runM08RuntimeScenarios(
  app: App,
  view: Chat2VaultView,
  providerCallCount: () => number,
  reconciliationWriteCount: () => number,
  reconciliationHarness: M08RuntimeReconciliationHarness,
): Promise<M08RuntimeEvidence> {
  const controller = (view as unknown as RuntimeView).captureController;
  assertion(controller !== undefined, "capture controller available");
  const active = app.workspace.getActiveFile();
  assertion(active?.path === stagingPath, "synthetic staging note is active");
  const authority = {
    path: active.path,
    identity: `${active.path}:${String(active.stat.mtime)}:${String(active.stat.size)}`,
  };
  const providerBefore = providerCallCount();
  const reconciliationBefore = reconciliationWriteCount();
  assertion(providerBefore === 0, "provider starts at absolute zero");
  assertion(
    reconciliationBefore === 0,
    "reconciliation persistence starts at zero",
  );
  const before = await Promise.all(
    protectedPaths.map(async (path) => ({
      path,
      hash: sha256(new Uint8Array(await app.vault.adapter.readBinary(path))),
    })),
  );

  const stagedPreview = await controller.previewStaging(stagingPath, authority);
  assertion(
    stagedPreview.status === "ready",
    `staging preview ready (${stagedPreview.status}${"code" in stagedPreview ? `/${stagedPreview.code}` : ""})`,
  );
  const stagedSave = await controller.save();
  assertion(stagedSave.status === "saved", "staging capture saved");

  const manualText = "Synthetic manual capture text alpha.";
  const manualPreview = await controller.previewPaste(manualText, url);
  assertion(manualPreview.status === "ready", "manual preview ready");
  const manualSave = await controller.save();
  assertion(manualSave.status === "saved", "manual capture saved");

  const beforeDuplicate = (await sourceCaptureFiles(app)).length;
  const duplicatePreview = await controller.previewPaste(manualText, url);
  assertion(duplicatePreview.status === "ready", "duplicate preview ready");
  const duplicate = await controller.save();
  const afterDuplicate = (await sourceCaptureFiles(app)).length;
  assertion(
    duplicate.status === "existing-identical" &&
      afterDuplicate === beforeDuplicate,
    "duplicate is an exact no-op",
  );

  const changedPreview = await controller.previewPaste(
    "Synthetic manual capture text beta.",
    url,
  );
  assertion(changedPreview.status === "ready", "changed preview ready");
  const changedSave = await controller.save();
  assertion(changedSave.status === "saved", "changed content creates version");

  const beforeStale = (await sourceCaptureFiles(app)).length;
  const pendingStale = controller.previewStaging(stagingPath, authority);
  controller.invalidate("active-file-edit");
  const stale = await pendingStale;
  const afterStale = (await sourceCaptureFiles(app)).length;
  assertion(
    stale.status === "stale" && afterStale === beforeStale,
    "stale preview has no write",
  );

  const preparedPreview = await controller.previewPaste(
    "Synthetic prepared crash capture.",
    url,
  );
  assertion(preparedPreview.status === "ready", "prepared crash preview ready");
  const beforePreparedCrash = (await sourceCaptureFiles(app)).length;
  await reconciliationHarness.prepareOnly(preparedPreview.plan, {
    draft: preparedPreview.draft,
    source: {
      kind: "manual",
      fingerprint: preparedPreview.draft.fingerprint,
    },
  });
  await reconciliationHarness.reloadSettings();
  controller.invalidate("view-close");
  const preparedBlocked = await controller.previewPaste(
    "Synthetic blocked prepared retry.",
    url,
  );
  const afterPreparedCrash = (await sourceCaptureFiles(app)).length;
  assertion(
    preparedBlocked.status === "blocked" &&
      preparedBlocked.code === "CAPTURE_RECONCILIATION_REQUIRED" &&
      afterPreparedCrash === beforePreparedCrash &&
      !(await app.vault.adapter.exists(preparedPreview.plan.targetPath)),
    "prepared-before-publish survives settings reconstruction and blocks writes",
  );
  assertion(
    (await controller.acknowledgeReconciliation()).status === "cleared",
    "prepared-before-publish acknowledgment clears durable block",
  );

  const publishedPreview = await controller.previewPaste(
    "Synthetic published crash capture.",
    url,
  );
  assertion(
    publishedPreview.status === "ready",
    "published crash preview ready",
  );
  const beforePublishedCrash = (await sourceCaptureFiles(app)).length;
  await reconciliationHarness.prepareOnly(publishedPreview.plan, {
    draft: publishedPreview.draft,
    source: {
      kind: "manual",
      fingerprint: publishedPreview.draft.fingerprint,
    },
  });
  await reconciliationHarness.publishOnly(publishedPreview.plan);
  await reconciliationHarness.reloadSettings();
  controller.invalidate("view-close");
  const publishedBlocked = await controller.previewPaste(
    "Synthetic blocked published retry.",
    url,
  );
  const afterPublishedCrash = (await sourceCaptureFiles(app)).length;
  assertion(
    publishedBlocked.status === "blocked" &&
      publishedBlocked.code === "CAPTURE_RECONCILIATION_REQUIRED" &&
      afterPublishedCrash === beforePublishedCrash + 1 &&
      (await app.vault.adapter.exists(publishedPreview.plan.targetPath)),
    "publish-before-clear survives settings reconstruction and blocks writes",
  );
  assertion(
    (await controller.acknowledgeReconciliation()).status === "cleared",
    "publish-before-clear acknowledgment clears durable block",
  );

  const clearFailurePreview = await controller.previewPaste(
    "Synthetic clear persistence failure capture.",
    url,
  );
  assertion(
    clearFailurePreview.status === "ready",
    "clear failure preview ready",
  );
  const beforeClearFailure = (await sourceCaptureFiles(app)).length;
  reconciliationHarness.failNextClearPersistence();
  const clearFailureSave = await controller.save();
  assertion(
    clearFailureSave.status === "blocked" &&
      "effect" in clearFailureSave &&
      clearFailureSave.effect === "published",
    "clear persistence failure preserves published uncertainty",
  );
  await reconciliationHarness.reloadSettings();
  controller.invalidate("view-close");
  const clearFailureBlocked = await controller.previewPaste(
    "Synthetic blocked clear failure retry.",
    url,
  );
  const afterClearFailure = (await sourceCaptureFiles(app)).length;
  assertion(
    clearFailureBlocked.status === "blocked" &&
      clearFailureBlocked.code === "CAPTURE_RECONCILIATION_REQUIRED" &&
      afterClearFailure === beforeClearFailure + 1 &&
      (await app.vault.adapter.exists(clearFailurePreview.plan.targetPath)),
    "clear persistence failure survives settings reconstruction and blocks writes",
  );
  assertion(
    (await controller.acknowledgeReconciliation()).status === "cleared",
    "clear persistence failure acknowledgment clears durable block",
  );

  const createdPaths = await sourceCaptureFiles(app);
  assertion(createdPaths.length === 5, "exactly five capture sources created");
  const created = await Promise.all(
    createdPaths.map(async (path) => ({
      path,
      sha256: sha256(new Uint8Array(await app.vault.adapter.readBinary(path))),
    })),
  );
  const protectedNotes = await Promise.all(
    before.map(async ({ path, hash }) => {
      const afterHash = sha256(
        new Uint8Array(await app.vault.adapter.readBinary(path)),
      );
      assertion(afterHash === hash, `${path} unchanged`);
      return {
        path,
        beforeHash: hash,
        afterHash,
        unchanged: true as const,
      };
    }),
  );
  const providerAfter = providerCallCount();
  const reconciliationAfter = reconciliationWriteCount();
  const persistenceCounts = reconciliationHarness.persistenceCounts();
  assertion(providerAfter === 0, "capture makes no provider call");
  assertion(
    reconciliationAfter === 12 &&
      persistenceCounts.attempts === 13 &&
      persistenceCounts.successful === 12 &&
      persistenceCounts.failed === 1,
    "capture and crash cases preserve exact reconciliation persistence outcomes",
  );
  const scenarios = M08_RUNTIME_SCENARIOS.map(scenario);
  const evidence: M08RuntimeEvidence = {
    scenarioRegistry: M08_RUNTIME_SCENARIOS,
    scenarios,
    created,
    duplicate: { status: "existing-identical", mutationDelta: 0 },
    stale: { status: "stale", mutationDelta: 0 },
    protected: protectedNotes,
    stagingFixture: {
      writer: "runtime-harness",
      qualification: "synthetic-staging-contract",
    },
    provider: { beforeCalls: 0, afterCalls: 0 },
    reconciliation: {
      preparedBeforePublish: {
        targetPresent: false,
        reloadBlocked: true,
        blockedWriteDelta: 0,
      },
      publishedBeforeClear: {
        targetPresent: true,
        reloadBlocked: true,
        blockedWriteDelta: 0,
      },
      clearPersistenceFailure: {
        targetPresent: true,
        saveEffect: "published",
        reloadBlocked: true,
        blockedWriteDelta: 0,
      },
    },
    counts: {
      created: 5,
      providerCalls: 0,
      reconciliationWrites: reconciliationAfter,
      reconciliationPersistenceAttempts: persistenceCounts.attempts,
      reconciliationFailures: persistenceCounts.failed,
    },
    privacy: { relativePathsOnly: true, retainedContent: false },
  };
  assertion(
    !JSON.stringify(evidence).includes("Synthetic manual capture"),
    "retained evidence excludes captured text",
  );
  return evidence;
}
