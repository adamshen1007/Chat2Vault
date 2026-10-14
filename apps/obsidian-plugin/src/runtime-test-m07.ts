import { createHash } from "node:crypto";
import {
  parseKnowledgeCatalogNote,
  renderKnowledgeNote,
  type PreviewCandidate,
  type ResolvedKnowledgeSource,
  type ReviewedKnowledgeCandidate,
} from "@chat2vault/core";
import type { App } from "obsidian";
import type { Chat2VaultView } from "./view.js";
import type { KnowledgeDedupController } from "./knowledge-dedup-controller.js";
import type {
  M07MutationLedger,
  M07MutationPhase,
} from "./runtime-test-m07-ledger.js";

export const M07_RUNTIME_SCENARIOS = Object.freeze([
  "exact-duplicate-blocked",
  "combined-preview-approved",
  "create-only-combined-note",
  "inputs-unchanged",
  "provider-not-called",
] as const);

type ScenarioId = (typeof M07_RUNTIME_SCENARIOS)[number];

export interface M07RuntimeEvidence {
  scenarioRegistry: readonly ScenarioId[];
  scenarios: readonly {
    id: ScenarioId;
    outcome: "success";
    mutations: number;
  }[];
  observations: readonly {
    id: ScenarioId;
    outcome: "success";
    mutations: number;
  }[];
  candidateHash: string;
  mutationAttempts: ReturnType<M07MutationLedger["entries"]>;
  inputs: readonly {
    path: string;
    beforeHash: string;
    afterHash: string;
    unchanged: true;
  }[];
  combined: {
    path: string;
    status: "created";
    sha256: string;
    schema: 2;
    combinedFrom: string;
  };
  provider: { beforeCalls: number; afterCalls: number };
  counts: {
    exactDuplicates: 1;
    combinedCreated: 1;
    providerCalls: number;
  };
  privacy: { relativePathsOnly: true; retainedContent: false };
}

interface RuntimeView {
  contentEl: HTMLElement;
  controller: { snapshot: unknown };
  knowledgeGate?: KnowledgeDedupController;
  installKnowledgeCandidates(candidates: readonly PreviewCandidate[]): void;
  draw(snapshot: unknown): void;
  previewKnowledge(): Promise<void>;
}

const existingSourcePath = "Sources/synthetic-existing.md";
const candidateSourcePath = "Sources/synthetic-candidate.md";
const existingConversationFingerprint = `sha256:${"a".repeat(64)}`;
const candidateConversationFingerprint = `sha256:${"b".repeat(64)}`;
const existingMessageFingerprint = `sha256:${"c".repeat(64)}`;
const candidateMessageFingerprint = `sha256:${"d".repeat(64)}`;
const sentinel = "M07_RUNTIME_SENTINEL_CONTENT";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertion(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`M07 runtime assertion failed: ${message}`);
}

function sourceNote(
  title: string,
  conversationId: string,
  contentFingerprint: string,
  importDigit: string,
): string {
  return [
    "---",
    "chat2vault_schema: 1",
    'type: "ai-conversation-source"',
    'source_provider: "chatgpt"',
    `source_conversation_id: ${JSON.stringify(conversationId)}`,
    `source_content_fingerprint: ${JSON.stringify(contentFingerprint)}`,
    `source_import_fingerprint: "sha256:${importDigit.repeat(64)}"`,
    "source_message_count: 1",
    'imported_at: "2026-10-12T00:00:00.000Z"',
    'knowledge_status: "source"',
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
}

function existingReviewed(): ReviewedKnowledgeCandidate {
  return {
    id: `sha256:${"1".repeat(64)}`,
    originalCandidateFingerprint: `sha256:${"2".repeat(64)}`,
    type: "insight",
    confidence: "high",
    sourceRefs: [
      {
        provider: "chatgpt",
        providerConversationId: "synthetic-existing",
        conversationFingerprint: existingConversationFingerprint,
        messageFingerprints: [existingMessageFingerprint],
      },
    ],
    title: "Synthetic runtime knowledge",
    summary: "Synthetic runtime summary",
    body: `${sentinel} shared body`,
    tags: ["synthetic-runtime"],
    decision: "accepted",
    selected: false,
  };
}

function candidate(): PreviewCandidate {
  return {
    id: `sha256:${"3".repeat(64)}`,
    candidateFingerprint: `sha256:${"4".repeat(64)}`,
    type: "insight",
    title: "Synthetic runtime knowledge",
    summary: "Synthetic runtime summary",
    body: `${sentinel} shared body`,
    status: "proposed",
    confidence: "high",
    sourceRefs: [
      {
        provider: "chatgpt",
        providerConversationId: "synthetic-candidate",
        conversationFingerprint: candidateConversationFingerprint,
        messageFingerprints: [candidateMessageFingerprint],
      },
    ],
    suggestedLinks: [],
    suggestedTags: ["synthetic-runtime"],
  };
}

const existingSource: ResolvedKnowledgeSource = {
  provider: "chatgpt",
  providerConversationId: "synthetic-existing",
  conversationFingerprint: existingConversationFingerprint,
  messageFingerprints: [existingMessageFingerprint],
  sourceNotePath: existingSourcePath,
};
const existingRendered = renderKnowledgeNote(existingReviewed(), [
  existingSource,
]);
if (!existingRendered.ok)
  throw new Error("M07 runtime fixture rendering failed");
const existingNoteContent = existingRendered.noteContent;
export const M07_RUNTIME_EXISTING_PATH =
  `Knowledge/${existingRendered.filename}` as const;
export const M07_RUNTIME_PROTECTED_PATHS = Object.freeze([
  existingSourcePath,
  candidateSourcePath,
  M07_RUNTIME_EXISTING_PATH,
]);

export async function prepareM07RuntimeVault(app: App): Promise<void> {
  await app.vault.createFolder("Sources");
  await app.vault.createFolder("Knowledge");
  await app.vault.create(
    existingSourcePath,
    sourceNote(
      "Synthetic existing source",
      "synthetic-existing",
      existingConversationFingerprint,
      "e",
    ),
  );
  await app.vault.create(
    candidateSourcePath,
    sourceNote(
      "Synthetic candidate source",
      "synthetic-candidate",
      candidateConversationFingerprint,
      "f",
    ),
  );
  await app.vault.create(M07_RUNTIME_EXISTING_PATH, existingNoteContent);
}

async function waitFor(
  condition: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() >= deadline)
      throw new Error(`M07 runtime assertion failed: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
  const value = root.querySelector<HTMLButtonElement>(
    `[aria-label=${JSON.stringify(label)}]`,
  );
  assertion(value !== null, `missing ${label}`);
  return value;
}

function scenario(id: ScenarioId, mutations = 0) {
  return { id, outcome: "success" as const, mutations };
}

export async function runM07RuntimeScenarios(
  app: App,
  view: Chat2VaultView,
  providerCallCount: () => number,
  ledger: M07MutationLedger,
): Promise<M07RuntimeEvidence> {
  const runtime = view as unknown as RuntimeView;
  const runtimeCandidate = candidate();
  const candidateHash = sha256(JSON.stringify([runtimeCandidate]));
  const providerBefore = providerCallCount();
  assertion(
    providerBefore === 0,
    "provider call count is zero before M07 scenarios",
  );
  const before = await Promise.all(
    M07_RUNTIME_PROTECTED_PATHS.map(async (path) => ({
      path,
      hash: sha256(new Uint8Array(await app.vault.adapter.readBinary(path))),
    })),
  );
  const inPhase = async <T>(
    phase: M07MutationPhase,
    operation: () => T | Promise<T>,
  ): Promise<T> => {
    ledger.setPhase(phase);
    try {
      return await operation();
    } finally {
      ledger.setPhase("inactive");
    }
  };

  try {
    await inPhase("exact-duplicate-blocked", async () => {
      runtime.installKnowledgeCandidates([runtimeCandidate]);
      runtime.draw(runtime.controller.snapshot);
      const accept = runtime.contentEl.querySelector<HTMLButtonElement>(
        '[data-c2v-knowledge-control="accept"]',
      );
      assertion(accept !== null, "candidate accept available");
      accept.click();
      const selection = runtime.contentEl.querySelector<HTMLInputElement>(
        '[data-c2v-knowledge-control="selection"]',
      );
      assertion(selection !== null, "candidate selection available");
      selection.checked = true;
      selection.dispatchEvent(new Event("change", { bubbles: true }));
      await runtime.previewKnowledge();
    });
    const gate = runtime.knowledgeGate;
    assertion(gate !== undefined, "deduplication gate available");
    const match = gate.snapshot.matches[0];
    assertion(
      gate.snapshot.status === "blocked" &&
        !gate.snapshot.canWrite &&
        match?.result.exact.length === 1 &&
        match.result.exact[0]?.path === M07_RUNTIME_EXISTING_PATH,
      "exact duplicate blocked with existing-note identity",
    );
    assertion(
      button(runtime.contentEl, "Write current ready knowledge plan").disabled,
      "ordinary duplicate create disabled",
    );

    await inPhase("combined-preview-approved", async () => {
      button(
        runtime.contentEl,
        `Select existing note ${M07_RUNTIME_EXISTING_PATH}`,
      ).click();
      await waitFor(
        () =>
          runtime.contentEl.querySelector('[aria-label="Combined body"]') !==
            null &&
          runtime.contentEl
            .querySelector(
              '[aria-label="Selected existing note, read only"] pre',
            )
            ?.textContent.includes("Synthetic runtime summary") === true,
        "combined draft and selected-note revision available",
      );
      const body = runtime.contentEl.querySelector<HTMLTextAreaElement>(
        '[aria-label="Combined body"]',
      );
      assertion(body !== null, "combined body available");
      body.value = `${body.value}\n\nExplicitly reviewed combined addition.`;
      body.dispatchEvent(new Event("input", { bubbles: true }));
      const confirmation = runtime.contentEl.querySelector<HTMLInputElement>(
        '[aria-label="Confirm combined draft"]',
      );
      assertion(confirmation !== null, "combined confirmation available");
      confirmation.checked = true;
      confirmation.dispatchEvent(new Event("change", { bubbles: true }));
      button(runtime.contentEl, "Preview combined note").click();
      await waitFor(
        () =>
          runtime.contentEl.querySelector(
            '[aria-label="Exact combined-note dry-run"]',
          ) !== null &&
          !button(runtime.contentEl, "Create combined note").disabled,
        "approved exact combined preview",
      );
    });

    await inPhase("create-only-combined-note", async () => {
      button(runtime.contentEl, "Create combined note").click();
      await waitFor(
        () => runtime.contentEl.textContent.includes("Combined note created:"),
        "combined note created and verified",
      );
    });

    const knowledgePaths = app.vault
      .getMarkdownFiles()
      .map(({ path }) => path)
      .filter((path) => path.startsWith("Knowledge/"));
    const combinedPath = knowledgePaths.find(
      (path) => path !== M07_RUNTIME_EXISTING_PATH,
    );
    assertion(
      knowledgePaths.length === 2 && combinedPath !== undefined,
      "one create-only combined note",
    );
    const combinedBytes = new Uint8Array(
      await app.vault.adapter.readBinary(combinedPath),
    );
    const combinedParsed = parseKnowledgeCatalogNote(
      combinedPath,
      combinedBytes,
    );
    assertion(
      combinedParsed.status === "eligible" &&
        combinedParsed.note.schemaVersion === 2 &&
        combinedParsed.note.combinedFrom === M07_RUNTIME_EXISTING_PATH,
      "combined schema and selected-note provenance",
    );

    const inputs = await inPhase("inputs-unchanged", async () =>
      Promise.all(
        before.map(async ({ path, hash }) => {
          const afterHash = sha256(
            new Uint8Array(await app.vault.adapter.readBinary(path)),
          );
          assertion(hash === afterHash, `${path} unchanged`);
          return {
            path,
            beforeHash: hash,
            afterHash,
            unchanged: true as const,
          };
        }),
      ),
    );
    const providerAfter = await inPhase("provider-not-called", () => {
      const measured = providerCallCount();
      assertion(measured === 0, "provider call count remains absolutely zero");
      return measured;
    });
    const scenarios = [
      scenario("exact-duplicate-blocked"),
      scenario("combined-preview-approved"),
      scenario("create-only-combined-note", 1),
      scenario("inputs-unchanged"),
      scenario("provider-not-called"),
    ] as const;
    const evidence: M07RuntimeEvidence = {
      scenarioRegistry: M07_RUNTIME_SCENARIOS,
      scenarios,
      observations: scenarios,
      candidateHash,
      mutationAttempts: ledger.entries(),
      inputs,
      combined: {
        path: combinedPath,
        status: "created",
        sha256: sha256(combinedBytes),
        schema: 2,
        combinedFrom: M07_RUNTIME_EXISTING_PATH,
      },
      provider: { beforeCalls: providerBefore, afterCalls: providerAfter },
      counts: {
        exactDuplicates: 1,
        combinedCreated: 1,
        providerCalls: providerAfter,
      },
      privacy: { relativePathsOnly: true, retainedContent: false },
    };
    assertion(
      !JSON.stringify(evidence).includes(sentinel),
      "retained evidence excludes content",
    );
    return evidence;
  } finally {
    ledger.setPhase("inactive");
  }
}
