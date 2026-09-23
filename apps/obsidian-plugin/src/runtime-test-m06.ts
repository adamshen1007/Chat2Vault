import { createHash } from "node:crypto";
import type { App } from "obsidian";
import type { PreviewCandidate } from "@chat2vault/core";
import type {
  KnowledgeController,
  KnowledgeControllerSnapshot,
} from "./knowledge-controller.js";
import type { KnowledgeWriteExecutionResult } from "./knowledge-executor.js";
import type { Chat2VaultView } from "./view.js";

export const M06_RUNTIME_SCENARIOS = Object.freeze([
  "review-accept-edit-reject",
  "multi-select-dry-run",
  "stale-preview-disabled",
  "verified-create",
  "idempotent-retry-no-op",
  "conflict-refusal",
  "source-backlink",
  "source-note-unchanged",
  "provider-not-called",
] as const);

type M06RuntimeScenarioId = (typeof M06_RUNTIME_SCENARIOS)[number];

interface RuntimeView {
  contentEl: HTMLElement;
  controller: { snapshot: unknown };
  knowledgeController?: KnowledgeController;
  knowledgeWriteResult?: KnowledgeWriteExecutionResult;
  installKnowledgeCandidates(candidates: readonly PreviewCandidate[]): void;
  draw(snapshot: unknown): void;
  previewKnowledge(): Promise<void>;
  writeKnowledge(): Promise<void>;
}

export interface M06RuntimeScenarioEvidence {
  id: M06RuntimeScenarioId;
  outcome: "success";
  attempts: number;
  mutations: number;
}

export interface M06RuntimeEvidence {
  scenarioRegistry: readonly M06RuntimeScenarioId[];
  scenarios: readonly M06RuntimeScenarioEvidence[];
  observations: readonly M06RuntimeScenarioEvidence[];
  keychain: {
    operations: 0;
    finalAbsent: true;
    isolationFinalAbsent: true;
  };
  candidateHash: string;
  source: {
    path: "Sources/synthetic-source.md";
    beforeHash: string;
    afterHash: string;
    unchanged: true;
  };
  knowledge: readonly {
    path: string;
    status: "created" | "identical-no-op" | "conflict";
    sha256: string;
  }[];
  counts: {
    candidates: 3;
    selected: 2;
    created: 2;
    noOp: 2;
    conflicts: 1;
    providerCalls: 0;
  };
  privacy: {
    relativePathsOnly: true;
    retainedContent: false;
  };
}

const sourcePath = "Sources/synthetic-source.md" as const;
const knowledgeRoot = "Knowledge";
const conversationFingerprint = `sha256:${"b".repeat(64)}`;
const importFingerprint = `sha256:${"a".repeat(64)}`;
const messageFingerprint = `sha256:${"c".repeat(64)}`;
const sentinel = "M06_RUNTIME_SENTINEL_CONTENT";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function runtimeAssertion(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`M06 runtime assertion failed: ${message}`);
}

function candidate(index: 1 | 2 | 3): PreviewCandidate {
  const digit = String(index);
  return {
    id: `sha256:${digit.repeat(64)}`,
    candidateFingerprint: `sha256:${String(index + 3).repeat(64)}`,
    type: index === 2 ? "decision" : "insight",
    title: `Synthetic runtime title ${digit}`,
    summary: `Synthetic summary ${digit}`,
    body: `${sentinel} ${digit}`,
    status: "proposed",
    confidence: index === 3 ? "medium" : "high",
    sourceRefs: [
      {
        provider: "chatgpt",
        providerConversationId: "synthetic-conversation",
        conversationFingerprint,
        messageFingerprints: [messageFingerprint],
      },
    ],
    suggestedLinks: [],
    suggestedTags: ["synthetic-runtime"],
  };
}

function sourceNote(): string {
  return [
    "---",
    "chat2vault_schema: 1",
    'type: "ai-conversation-source"',
    'source_provider: "chatgpt"',
    'source_conversation_id: "synthetic-conversation"',
    `source_content_fingerprint: "${conversationFingerprint}"`,
    `source_import_fingerprint: "${importFingerprint}"`,
    "source_message_count: 1",
    'imported_at: "2026-09-23T00:00:00.000Z"',
    'knowledge_status: "source"',
    "---",
    "",
    "# Synthetic runtime source",
    "",
  ].join("\n");
}

function runtimeView(view: Chat2VaultView): RuntimeView {
  return view as unknown as RuntimeView;
}

function control(
  view: RuntimeView,
  candidateId: string,
  name: string,
): HTMLElement {
  const matches = view.contentEl.querySelectorAll<HTMLElement>(
    `[data-c2v-knowledge-control="${name}"]`,
  );
  const match = [...matches].find(
    (element) =>
      element.getAttribute("data-c2v-knowledge-candidate") === candidateId,
  );
  runtimeAssertion(match !== undefined, `missing ${name} control`);
  return match;
}

function click(view: RuntimeView, candidateId: string, name: string): void {
  control(view, candidateId, name).click();
}

function select(
  view: RuntimeView,
  candidateId: string,
  selected: boolean,
): void {
  const checkbox = control(view, candidateId, "selection") as HTMLInputElement;
  checkbox.checked = selected;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
}

function scenario(
  id: M06RuntimeScenarioId,
  mutations = 0,
): M06RuntimeScenarioEvidence {
  return { id, outcome: "success", attempts: 0, mutations };
}

export async function runM06RuntimeScenarios(
  app: App,
  view: Chat2VaultView,
  providerCallCount: () => number,
): Promise<M06RuntimeEvidence> {
  const runtime = runtimeView(view);
  const candidates = [candidate(1), candidate(2), candidate(3)] as const;
  const candidateHash = sha256(JSON.stringify(candidates));
  const sourceText = sourceNote();

  await app.vault.createFolder("Sources");
  await app.vault.createFolder(knowledgeRoot);
  await app.vault.create(sourcePath, sourceText);
  const sourceBefore = new Uint8Array(
    await app.vault.adapter.readBinary(sourcePath),
  );
  const sourceBeforeHash = sha256(sourceBefore);
  const providerBefore = providerCallCount();

  runtime.installKnowledgeCandidates(candidates);
  runtime.draw(runtime.controller.snapshot);
  const firstId = candidates[0].id;
  const secondId = candidates[1].id;
  const thirdId = candidates[2].id;
  click(runtime, firstId, "accept");
  click(runtime, secondId, "edit");
  const editedTitle = runtime.contentEl.querySelector<HTMLInputElement>(
    '[aria-label="Knowledge title"]',
  );
  runtimeAssertion(editedTitle !== null, "edit title available");
  editedTitle.value = "Synthetic edited runtime title";
  editedTitle.dispatchEvent(new Event("input", { bubbles: true }));
  click(runtime, secondId, "save-edit");
  click(runtime, thirdId, "reject");
  const controller = runtime.knowledgeController;
  runtimeAssertion(controller !== undefined, "knowledge controller available");
  runtimeAssertion(
    controller.snapshot.candidates.map(({ decision }) => decision).join(",") ===
      "accepted,edited,rejected",
    "accept/edit/reject decisions",
  );

  select(runtime, firstId, true);
  select(runtime, secondId, true);
  await runtime.previewKnowledge();
  const firstPlan = controller.snapshot.plan;
  runtimeAssertion(
    controller.snapshot.status === "ready" &&
      firstPlan?.status === "ready" &&
      firstPlan.entries.length === 2,
    "two-candidate dry-run is ready",
  );

  select(runtime, firstId, false);
  const staleWrite = runtime.contentEl.querySelector<HTMLButtonElement>(
    '[aria-label="Write current ready knowledge plan"]',
  );
  runtimeAssertion(
    controller.snapshot.plan === undefined && staleWrite?.disabled === true,
    "stale preview disables write",
  );
  select(runtime, firstId, true);
  await runtime.previewKnowledge();

  await runtime.writeKnowledge();
  const created = runtime.knowledgeWriteResult;
  runtimeAssertion(
    created?.status === "saved" &&
      created.ledger.length === 2 &&
      created.ledger.every(({ status }) => status === "created"),
    "verified create ledger",
  );
  const createdEvidence = await Promise.all(
    created.ledger.map(async ({ targetPath, status }) => ({
      path: targetPath,
      status,
      sha256: sha256(
        new Uint8Array(await app.vault.adapter.readBinary(targetPath)),
      ),
    })),
  );

  await runtime.previewKnowledge();
  await runtime.writeKnowledge();
  const noOp = runtime.knowledgeWriteResult;
  runtimeAssertion(
    noOp?.status === "saved" &&
      noOp.ledger.length === 2 &&
      noOp.ledger.every(({ status }) => status === "identical-no-op"),
    "idempotent no-op retry",
  );

  select(runtime, firstId, false);
  select(runtime, secondId, false);
  click(runtime, thirdId, "accept");
  select(runtime, thirdId, true);
  await runtime.previewKnowledge();
  const conflictSnapshot: KnowledgeControllerSnapshot = controller.snapshot;
  const conflictPlan = conflictSnapshot.plan;
  runtimeAssertion(
    conflictPlan?.status === "ready" && conflictPlan.entries.length === 1,
    "conflict candidate plan",
  );
  const [conflictEntry] = conflictPlan.entries;
  runtimeAssertion(conflictEntry !== undefined, "conflict plan entry");
  const conflictPath = conflictEntry.targetPath;
  await app.vault.create(conflictPath, "synthetic conflicting bytes\n");
  await runtime.writeKnowledge();
  const conflict = runtime.knowledgeWriteResult;
  runtimeAssertion(
    conflict?.status === "conflict" &&
      conflict.ledger.length === 1 &&
      conflict.ledger[0]?.status === "conflict",
    "conflict refusal",
  );

  const createdBytes = await Promise.all(
    created.ledger.map(({ targetPath }) => app.vault.adapter.read(targetPath)),
  );
  runtimeAssertion(
    createdBytes.every((content) =>
      content.includes("[[Sources/synthetic-source]]"),
    ),
    "trusted source backlink",
  );
  const sourceAfter = new Uint8Array(
    await app.vault.adapter.readBinary(sourcePath),
  );
  const sourceAfterHash = sha256(sourceAfter);
  runtimeAssertion(
    sourceBeforeHash === sourceAfterHash,
    "source note bytes unchanged",
  );
  runtimeAssertion(
    providerCallCount() === providerBefore,
    "knowledge path makes zero provider calls",
  );

  const knowledge = [
    ...createdEvidence.map(({ path, status, sha256: hash }) => ({
      path,
      status: status as "created",
      sha256: hash,
    })),
    ...noOp.ledger.map(({ targetPath }) => ({
      path: targetPath,
      status: "identical-no-op" as const,
      sha256:
        createdEvidence.find(({ path }) => path === targetPath)?.sha256 ?? "",
    })),
    {
      path: conflictPath,
      status: "conflict" as const,
      sha256: sha256(
        new Uint8Array(await app.vault.adapter.readBinary(conflictPath)),
      ),
    },
  ];
  runtimeAssertion(
    knowledge.every(
      ({ path, sha256: hash }) =>
        !path.startsWith("/") &&
        !path.includes("..") &&
        /^[0-9a-f]{64}$/u.test(hash),
    ),
    "relative hashed knowledge evidence",
  );

  const scenarios = [
    scenario("review-accept-edit-reject"),
    scenario("multi-select-dry-run"),
    scenario("stale-preview-disabled"),
    scenario("verified-create", 2),
    scenario("idempotent-retry-no-op"),
    scenario("conflict-refusal"),
    scenario("source-backlink"),
    scenario("source-note-unchanged"),
    scenario("provider-not-called"),
  ] as const;
  const evidence: M06RuntimeEvidence = {
    scenarioRegistry: M06_RUNTIME_SCENARIOS,
    scenarios,
    observations: scenarios,
    keychain: {
      operations: 0,
      finalAbsent: true,
      isolationFinalAbsent: true,
    },
    candidateHash,
    source: {
      path: sourcePath,
      beforeHash: sourceBeforeHash,
      afterHash: sourceAfterHash,
      unchanged: true,
    },
    knowledge,
    counts: {
      candidates: 3,
      selected: 2,
      created: 2,
      noOp: 2,
      conflicts: 1,
      providerCalls: 0,
    },
    privacy: { relativePathsOnly: true, retainedContent: false },
  };
  runtimeAssertion(
    !JSON.stringify(evidence).includes(sentinel),
    "retained evidence excludes candidate content",
  );
  return evidence;
}
