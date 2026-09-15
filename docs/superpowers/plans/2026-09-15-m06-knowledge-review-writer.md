# M06 Knowledge Review and Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit review, exact dry-run, and create-only promotion of validated candidates into deterministic, source-linked Obsidian Markdown notes.

**Architecture:** Pure review validation, identity, paths, and rendering live in `@chat2vault/core`. The Obsidian app owns schema-v4 settings, source resolution, generation-fenced orchestration, a narrow create/read adapter, and accessible UI. Only an exact installed dry-run plan may reach sequential create-and-readback execution.

**Tech Stack:** TypeScript strict mode, Node.js 24 LTS, pnpm, Vitest, Obsidian API, existing macOS x64 native observer, ESLint, Prettier, esbuild.

## Global Constraints

- Authority: `docs/superpowers/specs/2026-09-15-m06-knowledge-review-writer-design.md`.
- Baseline: M05 merge `be0f5803ac39120e00e9994a936a8858a1cf3187`.
- Production eligibility remains macOS desktop x86_64.
- Settings schema becomes v4; exact v3 migrates with `knowledgeRoot: ""`; safe integer schemas `>= 5` remain unsupported-future.
- Source and knowledge roots may not equal, contain, or be contained by one another after normalized collision comparison.
- Only title, summary, body, and tags are editable. Type, confidence, ID, and provenance remain immutable.
- Review state, plans, candidates, and rendered notes are not persisted in settings or logs.
- One accepted/edited candidate maps to one note. Source notes remain immutable.
- No overwrite, modify, rename, delete, rollback, numeric collision suffix, merge, semantic deduplication, suggested related links, or M07 behavior.
- Provider code receives no writer, vault, registry, or filesystem capability.
- Tests and retained evidence use only synthetic non-sensitive data.
- Use TDD for every task and run the broad gate only at stabilized boundaries.
- Do not push, open/merge a PR, tag, deploy, release, submit to Community Plugins, or begin M07 without explicit authorization.

---

## File map

- `packages/core/src/knowledge-writer/contracts.ts` — limits, diagnostics, reviewed candidates, resolved sources, observations, plans.
- `packages/core/src/knowledge-writer/review.ts` — detached review creation, decisions, edits, selection.
- `packages/core/src/knowledge-writer/render.ts` — canonical fingerprint, filename, Markdown, preview.
- `packages/core/src/knowledge-writer/planner.ts` — root policy and immutable batch planning.
- `apps/obsidian-plugin/src/knowledge-vault-adapter.ts` — source resolution, observation, containment, create/read.
- `apps/obsidian-plugin/src/knowledge-executor.ts` — all-target preflight, sequential create, readback ledger.
- `apps/obsidian-plugin/src/knowledge-controller.ts` — in-memory state, mutexes, generation fences.
- Existing settings/main/view/styles files — v4 persistence and accessible integration.
- New core/plugin tests — focused contract, race, and boundary coverage.
- New M06 boundary/runtime scripts and reports — stabilized-candidate evidence.

---

### Task 1: Core review model

**Files:**

- Create: `packages/core/src/knowledge-writer/contracts.ts`
- Create: `packages/core/src/knowledge-writer/review.ts`
- Test: `packages/core/test/knowledge-review.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `PreviewCandidate`, `KnowledgeType`, `CandidateConfidence`, `SourceRef`.
- Produces: `ReviewedKnowledgeCandidate`, `createKnowledgeReview`, `setKnowledgeDecision`, `setKnowledgeSelected`, `editKnowledgeCandidate`, `m06Diagnostic`.

- [ ] **Step 1: Write the failing public tests**

```ts
const proposed = createKnowledgeReview(previewCandidate);
expect(proposed).toMatchObject({
  decision: "proposed",
  selected: false,
  title: previewCandidate.title,
});

const accepted = setKnowledgeDecision(proposed, "accepted");
expect(setKnowledgeSelected(accepted, true).selected).toBe(true);
expect(setKnowledgeSelected(proposed, true).selected).toBe(false);

const edited = editKnowledgeCandidate(accepted, {
  title: "Edited",
  summary: "Edited summary",
  body: "Edited body",
  tags: ["beta", "alpha"],
});
expect(edited).toMatchObject({
  ok: true,
  candidate: { decision: "edited", tags: ["alpha", "beta"] },
});
```

- [ ] **Step 2: Run `pnpm --filter @chat2vault/core exec vitest run test/knowledge-review.test.ts`**

Expected: FAIL because the M06 exports do not exist.

- [ ] **Step 3: Add exact contracts**

```ts
export type KnowledgeDecision = "proposed" | "accepted" | "edited" | "rejected";

export interface ReviewedKnowledgeCandidate {
  id: string;
  originalCandidateFingerprint: string;
  type: KnowledgeType;
  confidence: CandidateConfidence;
  sourceRefs: readonly SourceRef[];
  title: string;
  summary: string;
  body: string;
  tags: readonly string[];
  decision: KnowledgeDecision;
  selected: boolean;
}

export type M06DiagnosticCode =
  | "KNOWLEDGE_REVIEW_INVALID"
  | "KNOWLEDGE_TAG_INVALID"
  | "KNOWLEDGE_NO_SELECTION"
  | "KNOWLEDGE_ROOT_UNCONFIGURED"
  | "KNOWLEDGE_ROOT_INVALID"
  | "KNOWLEDGE_ROOT_OVERLAP"
  | "KNOWLEDGE_SOURCE_UNRESOLVED"
  | "KNOWLEDGE_SOURCE_AMBIGUOUS"
  | "KNOWLEDGE_SOURCE_STALE"
  | "KNOWLEDGE_PATH_UNSAFE"
  | "KNOWLEDGE_BATCH_TARGET_DUPLICATE"
  | "KNOWLEDGE_TARGET_CONFLICT"
  | "KNOWLEDGE_PREVIEW_IN_PROGRESS"
  | "KNOWLEDGE_WRITE_IN_PROGRESS"
  | "KNOWLEDGE_PLAN_STALE"
  | "KNOWLEDGE_CREATE_FAILED"
  | "KNOWLEDGE_VERIFICATION_FAILED";
```

Add one fixed content-free error message per code.

- [ ] **Step 4: Implement detached validation and transitions**

Reuse M04 title/summary/body/tag limits and `compareStableStrings`. Require own data keys, well-formed NFC strings, at most 32 unique tags, and no accessor/symbol/inherited authority. Editing changes decision to `edited` while preserving immutable fields. Rejecting clears selection.

- [ ] **Step 5: Add hostile cases and run `pnpm --filter @chat2vault/core test`**

Cover limit boundaries, non-NFC/unpaired-surrogate strings, duplicate tags, accessors, symbols, inherited fields, and mutation-after-call.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/knowledge-writer packages/core/test/knowledge-review.test.ts packages/core/src/index.ts
git commit -m "feat: add M06 knowledge review model"
```

### Task 2: Deterministic render and batch planner

**Files:**

- Create: `packages/core/src/knowledge-writer/render.ts`
- Create: `packages/core/src/knowledge-writer/planner.ts`
- Test: `packages/core/test/knowledge-render.test.ts`
- Test: `packages/core/test/knowledge-planner.test.ts`
- Modify: `packages/core/src/knowledge-writer/contracts.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: selected reviewed candidates, normalized roots, trusted source resolutions, target observations.
- Produces: `renderKnowledgeNote`, `safeKnowledgeFilename`, `planKnowledgeWrite`, `knowledgeWritePlanEqual`.

- [ ] **Step 1: Write failing golden tests**

```ts
expect(renderKnowledgeNote(reviewed, [resolvedSource])).toEqual({
  ok: true,
  candidateFingerprint: fixedCandidateFingerprint,
  filename: "Edited--" + fixedCandidateFingerprint.slice(7, 19) + ".md",
  noteContent: fixedGoldenMarkdown,
  noteContentFingerprint: fixedNoteFingerprint,
});

expect(planKnowledgeWrite(validInput)).toMatchObject({
  status: "ready",
  entries: [
    {
      action: "create",
      targetPath:
        "Knowledge/Edited--" + fixedCandidateFingerprint.slice(7, 19) + ".md",
    },
  ],
});
```

The test must contain literal fixed hashes and complete literal Markdown before commit.

- [ ] **Step 2: Run both focused suites**

Run: `pnpm --filter @chat2vault/core exec vitest run test/knowledge-render.test.ts test/knowledge-planner.test.ts`

Expected: FAIL on missing exports.

- [ ] **Step 3: Define source, observation, and plan contracts**

```ts
export interface ResolvedKnowledgeSource {
  provider: SourceProvider;
  providerConversationId?: string;
  conversationFingerprint: string;
  messageFingerprints: readonly string[];
  sourceNotePath: string;
}

export type KnowledgeTargetObservation =
  | { status: "absent" }
  | { status: "regular-file"; bytes: Uint8Array }
  | { status: "obstructed" }
  | { status: "unsafe" };

export interface KnowledgePlanEntry {
  candidateId: string;
  candidateFingerprint: string;
  targetPath: string;
  noteContent: string;
  noteContentFingerprint: string;
  action: "create" | "identical-no-op" | "conflict";
}
```

`KnowledgeWritePlan` has `ready` and `blocked` variants, exact normalized roots, sorted detached entries, `planFingerprint`, and diagnostics.

- [ ] **Step 4: Implement canonical fingerprint and filename**

Hash stable JSON containing schema version, type, normalized edited title/summary/body, sorted unique tags, and canonical source refs. Sort source refs by provider, optional conversation ID, conversation fingerprint, and sorted unique message fingerprints. Exclude timestamps, UI order, paths, selection, and model candidate ID.

Sanitize title with M03 portable rules, fallback `Untitled knowledge`, append `--` plus the first 12 fingerprint hex characters and `.md`, and truncate on code-point boundaries to keep the full filename at most 240 UTF-8 bytes.

- [ ] **Step 5: Implement exact Markdown**

Use a fixed LF-only template with closed YAML fields: schema, type, accepted status, created-from value, candidate fingerprint, trusted source provider/fingerprint/backlink, and quoted tags. Then render fixed Title, Summary, Knowledge, and Source sections. Escape headings/wikilinks deterministically. Candidate text cannot add frontmatter keys. Multiple sources use deterministically ordered YAML lists and backlink lines.

- [ ] **Step 6: Implement fail-closed planning**

Validate both roots with the existing primitive. Using `pathCollisionKey` per segment, reject equality and ancestor/descendant overlap. Require at least one selected accepted/edited candidate, exact trusted source resolution, unique candidate IDs, and collision-distinct targets. Map observations to create, byte-identical no-op, or conflict. Sort entries by collision key then exact path and hash the complete plan.

- [ ] **Step 7: Complete edge matrices and run core tests**

Cover CRLF, YAML-looking text, separators, dot segments, reserved names, controls, emoji truncation, NFC/case collisions, root overlap, missing/ambiguous/stale sources, duplicate IDs/targets, identical bytes, different bytes, directories, unsafe observations, and mutated inputs.

Run: `pnpm --filter @chat2vault/core test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/knowledge-writer packages/core/test/knowledge-render.test.ts packages/core/test/knowledge-planner.test.ts packages/core/src/index.ts
git commit -m "feat: plan deterministic M06 knowledge notes"
```

### Task 3: Settings schema v4

**Files:**

- Modify: `apps/obsidian-plugin/src/settings-model.ts`
- Modify: `apps/obsidian-plugin/src/settings.ts`
- Test: `apps/obsidian-plugin/test/settings-model.test.ts`
- Test: `apps/obsidian-plugin/test/main.test.ts`

**Interfaces:**

- Produces: `Chat2VaultSettingsV4`, `knowledgeRoot`, `knowledgeWriteGeneration`, `knowledgeRootPersistenceState`, `saveKnowledgeRoot`.

- [ ] **Step 1: Write failing migration/persistence tests**

```ts
expect(readSettings(validV3).settings).toEqual({
  ...validV3,
  schemaVersion: 4,
  knowledgeRoot: "",
});

expect(readSettings({ ...validV4, schemaVersion: 5 })).toMatchObject({
  identityState: "unsupported-future",
});

expect(await controller.saveKnowledgeRoot("Knowledge")).toEqual({
  status: "saved",
});
expect(savedValue).toEqual({ ...validV4, knowledgeRoot: "Knowledge" });
```

Also assert every existing save preserves `knowledgeRoot` and uses the same binary non-queuing mutex.

- [ ] **Step 2: Run `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/settings-model.test.ts test/main.test.ts`**

Expected: FAIL on v4 and the missing method.

- [ ] **Step 3: Implement exact v4 recovery**

```ts
export interface Chat2VaultSettingsV4 {
  schemaVersion: 4;
  installationId: string;
  previewMessagesPerPage: PreviewMessagesPerPage;
  sourceRoot: string;
  knowledgeRoot: string;
  provider: ProviderSettings;
}
```

Project unsafe objects before reading. Exact v3 migrates in memory to empty knowledge root. Valid v4 loads without an implicit write. Invalid knowledge root becomes empty with `INVALID_PERSISTED_KNOWLEDGE_ROOT`. Preserve independent source/provider recovery. Shift unsupported-future to safe integers `>= 5`.

- [ ] **Step 4: Extend the existing settings transaction**

Add `saveKnowledgeRoot` after acquiring the existing mutex. Validate with the strict root primitive, persist a complete v4 snapshot, expose pending previous/proposed values, invalidate knowledge state at accepted-save start, and increment `knowledgeWriteGeneration` only when new authority settles. All preview/source/provider saves preserve `knowledgeRoot`.

- [ ] **Step 5: Add the settings UI**

Add “Knowledge folder” and the copy “Accepted knowledge notes are created only after an exact dry-run and an explicit Write action.” Render invalid, failed, and in-progress results with fixed messages.

- [ ] **Step 6: Run settings and plugin tests**

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/settings-model.test.ts test/main.test.ts
pnpm --filter @chat2vault/obsidian-plugin test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/obsidian-plugin/src/settings-model.ts apps/obsidian-plugin/src/settings.ts apps/obsidian-plugin/test/settings-model.test.ts apps/obsidian-plugin/test/main.test.ts
git commit -m "feat: add M06 knowledge root settings"
```

### Task 4: Safe source resolution and vault adapter

**Files:**

- Create: `apps/obsidian-plugin/src/knowledge-vault-adapter.ts`
- Test: `apps/obsidian-plugin/test/knowledge-vault-adapter.test.ts`
- Modify only for reusable exports: `apps/obsidian-plugin/src/source-vault-adapter.ts`

**Interfaces:**

- Consumes: `parseSourceRegistryEntry`, vault list/read APIs, native observer, containment helpers, settled roots.
- Produces:

```ts
export interface KnowledgeVaultAdapter {
  resolveKnowledgeSources(
    candidate: ReviewedKnowledgeCandidate,
  ): Promise<KnowledgeSourceResolution>;
  observeKnowledgeTarget(path: string): Promise<KnowledgeTargetObservation>;
  checkpointKnowledgeTarget(path: string): Promise<KnowledgeTargetCheckpoint>;
  createKnowledgeNote(resolvedPath: string, content: string): Promise<void>;
  readKnowledgeNote(path: string): Promise<Uint8Array>;
}

export type KnowledgeSourceResolution =
  | { ok: true; sources: readonly ResolvedKnowledgeSource[] }
  | { ok: false; diagnostics: readonly M06Diagnostic[] };

export type KnowledgeTargetCheckpoint =
  | { status: "absent-safe"; resolvedPath: string }
  | { status: "changed" }
  | { status: "unsafe" };
```

- [ ] **Step 1: Write failing resolver/containment tests**

Assert one exact synthetic registry match resolves; zero matches returns unresolved; two matches returns ambiguous; malformed/changed/aliased registry candidates fail closed; every blocked case records zero mutation.

- [ ] **Step 2: Run `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/knowledge-vault-adapter.test.ts`**

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement source resolution**

Enumerate only under the settled source root. Parse bounded frontmatter with `parseSourceRegistryEntry`. Match provider, optional conversation ID, and conversation fingerprint exactly. Re-observe physical containment and return only trusted vault-relative `.md` paths. Never search the entire vault or mutate a source note.

- [ ] **Step 4: Implement target capabilities**

Reuse M03 native observation/containment logic for each knowledge-root component and final target. Only an absent physically contained target may produce a resolved checkpoint. Read existing/created files as bytes. Expose no modify, rename, delete, provider, or source-create method.

- [ ] **Step 5: Add race/error coverage and run**

Cover NFC/case collisions, config-dir paths, alias/mount results, obstructing objects, invalid external Unicode, list/read throws, target changes, and outside-root calls.

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/knowledge-vault-adapter.test.ts test/source-vault-adapter.test.ts test/native-observer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/obsidian-plugin/src/knowledge-vault-adapter.ts apps/obsidian-plugin/test/knowledge-vault-adapter.test.ts apps/obsidian-plugin/src/source-vault-adapter.ts
git commit -m "feat: add safe M06 vault adapter"
```

### Task 5: Batch executor and generation-fenced controller

**Files:**

- Create: `apps/obsidian-plugin/src/knowledge-executor.ts`
- Create: `apps/obsidian-plugin/src/knowledge-controller.ts`
- Test: `apps/obsidian-plugin/test/knowledge-executor.test.ts`
- Test: `apps/obsidian-plugin/test/knowledge-controller.test.ts`
- Modify: `apps/obsidian-plugin/src/distillation-controller.ts`
- Modify: `apps/obsidian-plugin/src/provider-controller.ts`

**Interfaces:**

- `executeKnowledgeWrite(plan, current, adapter)` returns a per-path ledger.
- `KnowledgeController` exposes `installCandidates`, `decide`, `edit`, `select`, `selectAllEligible`, `preview`, `write`, `invalidate`, and immutable `snapshot`.

```ts
export type KnowledgeLedgerStatus =
  | "created"
  | "identical-no-op"
  | "not-attempted"
  | "conflict"
  | "create-failed"
  | "verification-failed"
  | "stale";

export interface KnowledgeWriteExecutionResult {
  status: "saved" | "partial" | "conflict" | "stale" | "failed";
  ledger: readonly {
    targetPath: string;
    status: KnowledgeLedgerStatus;
  }[];
  diagnostics: readonly M06Diagnostic[];
}
```

- [ ] **Step 1: Write failing executor tests**

```ts
expect(
  await executeKnowledgeWrite(twoEntryPlan, current, conflictAdapter),
).toMatchObject({ status: "conflict" });
expect(conflictAdapter.created).toEqual([]);

expect(firstAttempt.ledger.map((entry) => entry.status)).toEqual([
  "created",
  "create-failed",
  "not-attempted",
]);
expect(retry.ledger.map((entry) => entry.status)).toEqual([
  "identical-no-op",
  "created",
  "created",
]);
```

- [ ] **Step 2: Write failing controller tests**

Assert decision/edit/selection changes remove the installed plan; a second preview/write never queues; stale async settlements never install; only a current ready dry-run enables write.

- [ ] **Step 3: Run both focused suites**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/knowledge-executor.test.ts test/knowledge-controller.test.ts`

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement the closed ledger**

Statuses are `created`, `identical-no-op`, `not-attempted`, `conflict`, `create-failed`, `verification-failed`, and `stale`. Re-observe every target before the first create. Any conflict/unsafe/error aborts with zero mutation. Then sequentially checkpoint, create, read back, and compare exact bytes. Stop on first failure; never roll back.

- [ ] **Step 5: Implement controller state and tokens**

Install only current successful M04/M05 candidates as detached reviews. Token state binds lifecycle, import, selection, distillation, knowledge-settings generations, roots, candidate fingerprints, resolved source identities/paths, and plan fingerprint. Every authoritative input change invalidates the plan.

Use separate binary preview/write mutexes with atomic cross-checks. Preview resolves sources, observes targets, calls the pure planner, and installs only if current. Write consumes and clears only the exact ready plan before awaiting the executor.

- [ ] **Step 6: Add await-boundary/race tables**

Cover throws and staleness before/after observation, source resolution, planning, checkpoint, create, and readback; all-no-op and mixed batches; target appearance between preflight/checkpoint; new manual/provider candidate sets; settings/import/selection/unload invalidation; duplicate clicks; and post-create staleness.

- [ ] **Step 7: Run focused and regression tests**

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/knowledge-executor.test.ts test/knowledge-controller.test.ts test/distillation-controller.test.ts test/provider-controller.test.ts
pnpm --filter @chat2vault/obsidian-plugin test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/obsidian-plugin/src/knowledge-executor.ts apps/obsidian-plugin/src/knowledge-controller.ts apps/obsidian-plugin/test/knowledge-executor.test.ts apps/obsidian-plugin/test/knowledge-controller.test.ts apps/obsidian-plugin/src/distillation-controller.ts apps/obsidian-plugin/src/provider-controller.ts
git commit -m "feat: execute verified M06 knowledge batches"
```

### Task 6: Main wiring and accessible UI

**Files:**

- Modify: `apps/obsidian-plugin/src/main.ts`
- Modify: `apps/obsidian-plugin/src/view.ts`
- Modify: `apps/obsidian-plugin/styles.css`
- Test: `apps/obsidian-plugin/test/main.test.ts`
- Test: `apps/obsidian-plugin/test/view.test.ts`
- Test: `apps/obsidian-plugin/test/styles.test.ts`

**Interfaces:**

- Consumes: `KnowledgeController` and existing validated-candidate presentation.
- Produces: Accept/Edit/Reject, multi-select, dry-run, exact preview, Write, and ledger UI.

- [ ] **Step 1: Write failing UI tests**

Assert labeled decision controls, disabled selection for proposed/rejected candidates, disabled dry-run without eligible selection/root, disabled Write before a current ready plan, complete path/action/Markdown preview, conflict blocking, ledger rendering, keyboard focus, and no `innerHTML` use with untrusted values.

- [ ] **Step 2: Run `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/main.test.ts test/view.test.ts test/styles.test.ts`**

Expected: FAIL on missing M06 UI/wiring.

- [ ] **Step 3: Wire narrow capabilities in `main.ts`**

Create one adapter/controller per view with getter-only roots/generations. Register invalidators for settings, import, selection, candidate replacement, view close, and unload. Leave provider service keys unchanged and pass no knowledge capability to provider code.

- [ ] **Step 4: Render review and edit controls**

Use Obsidian `text`/DOM `textContent` for untrusted strings. Each card gets an accessible decision group, eligible checkbox, and inline labeled title/summary/body/tags editor with Save/Cancel. Type, confidence, and provenance stay read-only. Add Select all eligible.

- [ ] **Step 5: Render dry-run and execution**

Display exact selected count, target path, action, and complete Markdown in scrollable `pre > code`. Enable Write only for the current ready plan. After execution, show every ledger target/status without candidate content in diagnostics.

- [ ] **Step 6: Add scoped CSS**

Require visible `:focus-visible`, 44px minimum controls, narrow-window stacking, readable code overflow, and status labels independent of color. Do not restyle unrelated panels.

- [ ] **Step 7: Run UI, plugin, and build gates**

```bash
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/main.test.ts test/view.test.ts test/styles.test.ts
pnpm --filter @chat2vault/obsidian-plugin test
pnpm --filter @chat2vault/obsidian-plugin build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/obsidian-plugin/src/main.ts apps/obsidian-plugin/src/view.ts apps/obsidian-plugin/styles.css apps/obsidian-plugin/test/main.test.ts apps/obsidian-plugin/test/view.test.ts apps/obsidian-plugin/test/styles.test.ts
git commit -m "feat: add M06 knowledge review UI"
```

### Task 7: Safety gates and two-row runtime evidence

**Files:**

- Create: `apps/obsidian-plugin/scripts/check-m06-boundaries.mjs`
- Create: `apps/obsidian-plugin/test/m06-boundaries.test.ts`
- Create: `apps/obsidian-plugin/scripts/check-m06-runtime.mjs`
- Modify narrowly: `apps/obsidian-plugin/src/runtime-test-entry.ts` and runtime-only seams
- Modify: `package.json`
- Create: `docs/21_M06_RUNTIME_GATE_REPORT.md`

**Interfaces:**

- Produces: `check:m06`, `check:m06:runtime`, exact scenario evidence.

- [ ] **Step 1: Write failing capability tripwires**

Require provider service keys to remain exactly their M05 allowlist. Require knowledge adapter keys to be exactly resolve, observe, checkpoint, create, and read. Assert dry-run/conflict paths perform zero mutation, writer paths perform zero provider/network call, source bytes remain unchanged, and sentinel candidate content never enters diagnostics/settings/logs.

- [ ] **Step 2: Run the boundary test**

Run: `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/m06-boundaries.test.ts`

Expected: FAIL because the M06 gate is absent.

- [ ] **Step 3: Implement static boundary checks**

Parse production imports/calls and fixed allowlists. Fail if provider files import knowledge modules; knowledge files import network modules; adapter exposes modify/rename/delete; M06 reaches source-note mutation; candidate/rendered content is logged/persisted; or runtime seams enter production. Avoid comment-only substring matching.

- [ ] **Step 4: Define runtime scenarios**

```ts
export const M06_RUNTIME_SCENARIOS = [
  "review-accept-edit-reject",
  "multi-select-dry-run",
  "stale-preview-disabled",
  "verified-create",
  "idempotent-retry-no-op",
  "conflict-refusal",
  "source-backlink",
  "source-note-unchanged",
  "provider-not-called",
] as const;
```

- [ ] **Step 5: Implement the synthetic runtime sequence**

Drive the unchanged production UI/controller/adapter path in a temporary vault with one synthetic source note and three synthetic candidates. Hash the source before/after. Retain only scenario IDs, exact Obsidian/version hashes, synthetic relative paths, closed statuses, counts, and hashes—never content, absolute paths, usernames, vault names, or credentials.

- [ ] **Step 6: Wire and run gates**

Add `check:m06` and `check:m06:runtime` and append the boundary gate to `check:plugin`.

Run the existing harness first with Obsidian 1.7.4, then with the exact current supported version resolved at execution time:

```bash
pnpm check:m06
pnpm check:m06:runtime -- --row minimum
pnpm check:m06:runtime -- --row stable
```

Expected: all nine scenarios PASS in both rows against identical candidate/bundle identity.

- [ ] **Step 7: Write the runtime report**

Record host/architecture, Node/pnpm, exact Obsidian versions, commit/tree/bundle hashes, commands, scenario table, source pre/post hashes, artifact hashes, synthetic-data statement, failures/remediations, and truthful decision. A blocked row remains unproven.

- [ ] **Step 8: Commit**

```bash
git add apps/obsidian-plugin/scripts/check-m06-boundaries.mjs apps/obsidian-plugin/scripts/check-m06-runtime.mjs apps/obsidian-plugin/test/m06-boundaries.test.ts apps/obsidian-plugin/src/runtime-test-entry.ts apps/obsidian-plugin/src/runtime-test-*.ts package.json docs/21_M06_RUNTIME_GATE_REPORT.md
git commit -m "test: qualify M06 writer boundaries"
```

### Task 8: Documentation, full gate, and exact-candidate review

**Files:**

- Create: `docs/20_M06_IMPLEMENTATION_NOTES.md`
- Modify: `docs/00_DOCUMENT_INDEX.md`
- Modify: `README.md`
- Modify with final evidence only: `docs/21_M06_RUNTIME_GATE_REPORT.md`

- [ ] **Step 1: Update user documentation**

Document knowledge-root configuration, review/edit/reject, selection, dry-run, create-only behavior, conflicts, partial retry, macOS scope, and M07-M10 non-goals. Do not claim Community Plugin availability.

- [ ] **Step 2: Write implementation notes**

Map every approved design section to files, symbols, and tests. Include branch/HEAD/base/upstream/worktree, full file inventory, v4 migration, privacy/security bounds, known limitations, and explicit confirmation that M07 was not implemented.

- [ ] **Step 3: Run targeted suites**

```bash
pnpm --filter @chat2vault/core exec vitest run test/knowledge-review.test.ts test/knowledge-render.test.ts test/knowledge-planner.test.ts
pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/knowledge-vault-adapter.test.ts test/knowledge-executor.test.ts test/knowledge-controller.test.ts test/m06-boundaries.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the full stabilized gate**

```bash
node --version
pnpm --version
pnpm verify
```

Expected: Node 24 LTS, repository pnpm version, and all format/lint/typecheck/test/build/plugin gates PASS.

- [ ] **Step 5: Verify scope, identity, and sensitive-data absence**

```bash
git diff --check be0f5803ac39120e00e9994a936a8858a1cf3187...HEAD
git diff --name-status be0f5803ac39120e00e9994a936a8858a1cf3187...HEAD
git ls-files --others --exclude-standard
git grep -nE 'sk-[A-Za-z0-9_-]{16,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' -- . ':!pnpm-lock.yaml'
git status --short --branch
git rev-parse HEAD^{tree}
```

Expected: clean diff checks, only M06 scope, complete candidate inventory, no credential match, exact tree recorded.

- [ ] **Step 6: Self-review and stabilize**

Trace v4 migration, immutable candidate authority, source resolution, every async invalidation edge, vault capabilities, persisted/logged fields, and runtime evidence. Remediate verified findings, rerun affected tests, then run `pnpm verify` once more at the stabilized boundary.

- [ ] **Step 7: Obtain one independent R2 exact-candidate review**

Provide design hash, base/head/tree, tracked and untracked inventory, full-gate output, runtime hashes, and sanitized evidence. Require file/line findings and only this token when no material issue remains:

```text
GO — M06 COMMIT READY
```

Any other result remains not commit-ready.

- [ ] **Step 8: Finalize the completion report**

Include Decision (`GO`, `CONDITIONAL GO`, or `NO-GO`), objective, non-goals, repository state, implementation, files, acceptance mapping, exact verification table, review/remediation ledger, risks, manual actions, and separate commit/push/PR/merge/deploy/release states.

- [ ] **Step 9: Create the final implementation commit when authorized**

```bash
git add README.md docs packages/core apps/obsidian-plugin package.json
git diff --cached --check
git commit -m "feat: complete milestone 06 knowledge writer"
```

Do not push or begin M07 in this task.
