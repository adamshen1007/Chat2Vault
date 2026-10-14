# M07 Deduplication and Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent exact duplicate Chat2Vault knowledge notes, show local related-note suggestions, and let a user create a reviewed combined note without changing any existing note.

**Architecture:** Pure parsing, identity, matching, and v2 rendering live in `@chat2vault/core`. The Obsidian adapter supplies a bounded, physically contained read-only catalog; a generation-fenced plugin controller owns preview and calls the existing create-only writer path only after revalidation. The UI distinguishes duplicate authority from advisory suggestions and requires a separate exact preview for combining.

**Tech Stack:** TypeScript strict mode, Node.js 24 LTS, pnpm 11, Vitest, Obsidian API, existing macOS x86_64 native containment observer, ESLint, Prettier, esbuild.

## Global Constraints

- Authority: `docs/superpowers/specs/2026-10-12-m07-deduplication-linking-design.md`; baseline: M06 closure `f180eb9945f0ecdd4bcfc0946cdd6fb2b6f0e685`.
- The written spec is approved, but M07 implementation is **not** authorized by spec approval alone. Do not execute these tasks until separately authorized.
- Production eligibility remains macOS desktop x86_64; do not add Windows, Linux, mobile, or non-x86_64 packaging.
- Catalog only direct-child `.md` files below the configured knowledge root; maximum 10,000 files and 128 KiB per eligible note. An incomplete catalog blocks M07 preview/write.
- Exact content excludes provenance; same-source and similarity are separately labeled. Related suggestions use local title/tag/2,048-code-point teaser weighted Jaccard, threshold 0.25, top five.
- Combined flow accepts one reviewed unsaved candidate and one eligible existing note. It creates a new schema-v2 note after explicit review; existing notes and source notes remain byte-identical.
- No provider, embeddings, network request, persistent index, generic vault scan, modify, rename, delete, overwrite, or hidden merge capability is introduced.
- Use synthetic fixtures only. Do not print note content or sensitive paths in diagnostics or evidence.
- Follow red/green/refactor test cycles. Run focused tests per task and broad gates on a stable candidate.
- Commit, push, PR, merge, tag, deployment, release, Community submission, or provider spend require their own explicit authorization. If authorized later, commit only reviewed task boundaries; otherwise leave changes unstaged and report them.

---

## File map

- `packages/core/src/knowledge-catalog/contracts.ts` — v1/v2 catalog record and closed M07 diagnostic types.
- `packages/core/src/knowledge-catalog/parse.ts` — strict bounded Markdown/frontmatter parser and source-independent content fingerprint.
- `packages/core/src/knowledge-catalog/match.ts` — exact, same-source, and deterministic local related-note classification.
- `packages/core/src/knowledge-catalog/combine.ts` — bounded combined draft validation and deterministic schema-v2 note rendering.
- `packages/core/src/index.ts` — public core exports needed by the plugin.
- `apps/obsidian-plugin/src/knowledge-catalog-adapter.ts` — bounded discovery and immutable catalog snapshot assembly; no write capability.
- `apps/obsidian-plugin/src/knowledge-vault-adapter.ts` — small physically contained catalog-enumeration entry point, reusing existing target observation.
- `apps/obsidian-plugin/src/knowledge-dedup-controller.ts` — preview state, generation fences, duplicate gate, combined draft/plan, and pre-create catalog recheck.
- `apps/obsidian-plugin/src/knowledge-controller.ts` — expose a narrow read-only authority token if the composing M07 controller cannot otherwise observe M06 candidate generation.
- `apps/obsidian-plugin/src/knowledge-dedup-view.ts` — accessible match groups, existing-note open action, combined draft and exact preview UI.
- `apps/obsidian-plugin/src/view.ts` and `apps/obsidian-plugin/src/main.ts` — narrow service wiring; retain M06 review and source-resolution behavior.
- `apps/obsidian-plugin/src/knowledge-executor.ts` — reuse existing create/readback ledger; only minimal extension if combined source-note preflight cannot be expressed by its current input.
- Matching `packages/core/test/knowledge-catalog-*.test.ts` and `apps/obsidian-plugin/test/knowledge-*.test.ts` — synthetic contract, race, UI, and regression tests.
- `apps/obsidian-plugin/scripts/check-m07-boundaries.mjs`, package scripts, runtime acceptance tests, and completion reports — candidate qualification.

## Task 1: Parse bounded v1/v2 knowledge notes and compute exact content identity

**Files:** Create `packages/core/src/knowledge-catalog/contracts.ts`, `packages/core/src/knowledge-catalog/parse.ts`, `packages/core/test/knowledge-catalog-parse.test.ts`; modify `packages/core/src/index.ts`.

**Interfaces:** Produce `CatalogSourceNote`, `CatalogKnowledgeNote`, `CatalogParseResult`, `parseKnowledgeCatalogNote(path, bytes)`, and `knowledgeContentFingerprint(type, payload, tags)`. The parser has no Obsidian dependency and never manufactures v1 message fingerprints.

- [ ] **Step 1: Write failing synthetic tests for valid v1, valid v2, edited payload, and malformed Chat2Vault-like notes.** Use the existing M06 renderer for a canonical v1 fixture, then vary only the source links to prove content identity is independent of provenance. Include a body containing `## Summary`, `## Knowledge`, and `## Source` headings so parsing cannot rely on splitting arbitrary body text.

```ts
const first = parseKnowledgeCatalogNote(v1Fixture.path, v1Fixture.bytes);
const second = parseKnowledgeCatalogNote(
  otherSourceFixture.path,
  otherSourceFixture.bytes,
);
expect(first.status).toBe("eligible");
expect(second.status).toBe("eligible");
if (first.status === "eligible" && second.status === "eligible") {
  expect(first.note.contentFingerprint).toBe(second.note.contentFingerprint);
  expect(first.note.sourceNotes).not.toEqual(second.note.sourceNotes);
}
expect(
  parseKnowledgeCatalogNote(malformedFixture.path, malformedFixture.bytes)
    .status,
).toBe("malformed");
```

- [ ] **Step 2: Run `pnpm --filter @chat2vault/core exec vitest run test/knowledge-catalog-parse.test.ts`.** Expected: FAIL because the catalog API is absent.
- [ ] **Step 3: Add closed types and a strict parser.** Reject unsupported schemas and duplicate/unknown identity keys, validate the SHA-256 field and 12-hex filename suffix, accept only M06's scalar-or-array source field grammar, verify the exact terminal Source footer against frontmatter links, and retain the preceding rendered payload verbatim. Return `ignored` for unrelated notes and `malformed` for Chat2Vault-like invalid notes. v2 additionally validates `combined_from`, recomputes its candidate and content fingerprints, and rejects mismatch.

```ts
export type CatalogParseResult =
  | { status: "eligible"; note: CatalogKnowledgeNote }
  | { status: "ignored" }
  | { status: "malformed"; code: "M07_CATALOG_MALFORMED" };

export function knowledgeContentFingerprint(
  type: KnowledgeType,
  payload: string,
  tags: readonly string[],
): string {
  return fingerprint({
    version: 1,
    type,
    payload,
    tags: [...new Set(tags)].sort(compareStableStrings),
  });
}
```

- [ ] **Step 4: Run the focused parser test and `pnpm --filter @chat2vault/core typecheck`.** Expected: PASS. Add malformed UTF-8, oversized input, wrong footer, mismatched filename, unknown schema, ambiguous source arrays, and fingerprint tampering before declaring green.
- [ ] **Step 5: Review the parser diff.** Confirm it treats note text as data, does not use a general YAML interpreter, does not log content, and does not alter M06 rendering.

## Task 2: Classify exact, same-source, and related notes deterministically

**Files:** Create `packages/core/src/knowledge-catalog/match.ts`, `packages/core/test/knowledge-catalog-match.test.ts`; modify `packages/core/src/knowledge-catalog/contracts.ts` and `packages/core/src/index.ts`.

**Interfaces:** Consume `CatalogKnowledgeNote[]`, the reviewed candidate's rendered payload/tags, and source identities resolved by the app. Produce `KnowledgeMatchResult` with separate `exact`, `sameSource`, and `related` arrays. The matcher is pure and never decides to merge.

- [ ] **Step 1: Write failing table tests.** Include identical content from two different conversations, same provider/conversation ID with changed content fingerprint, same content with different candidate fingerprint, unrelated content, a 0.25 score boundary, Unicode tokenization, stable score ties, and a maximum of five suggestions.

```ts
const matches = matchKnowledgeCandidate({ candidate, payload, notes });
expect(matches.exact.map(({ path }) => path)).toEqual(["Knowledge/Exact.md"]);
expect(matches.sameSource.map(({ path }) => path)).toEqual([
  "Knowledge/NewVersion.md",
]);
expect(matches.related).toHaveLength(5);
expect(
  matches.related.filter(({ score }) => score === 0.5).map(({ path }) => path),
).toEqual(["Knowledge/A.md", "Knowledge/B.md"]);
```

- [ ] **Step 2: Run `pnpm --filter @chat2vault/core exec vitest run test/knowledge-catalog-match.test.ts`.** Expected: FAIL because `matchKnowledgeCandidate` is absent.
- [ ] **Step 3: Implement precedence and ranking.** Compare exact content fingerprints first; compare provider plus stable conversation ID when present, otherwise provider plus conversation fingerprint; tokenize NFC title/tags/first 2,048 payload code points into Unicode letter/number runs of 2–64 code points; lowercase without locale; use maximum field weight per token and weighted Jaccard; filter scores below 0.25; sort descending score then normalized path; take five.

```ts
export interface KnowledgeMatchResult {
  exact: readonly CatalogKnowledgeNote[];
  sameSource: readonly CatalogKnowledgeNote[];
  related: readonly { path: string; score: number }[];
}
export function matchKnowledgeCandidate(
  input: MatchInput,
): KnowledgeMatchResult;
```

- [ ] **Step 4: Run the focused matcher test and core typecheck.** Expected: PASS with deterministic results regardless of input order.
- [ ] **Step 5: Review the match diff.** Verify similarity cannot be interpreted as duplicate authority and that no provider/network import exists.

## Task 3: Observe a complete, physically contained catalog

**Files:** Create `apps/obsidian-plugin/src/knowledge-catalog-adapter.ts`, `apps/obsidian-plugin/test/knowledge-catalog-adapter.test.ts`; modify `apps/obsidian-plugin/src/knowledge-vault-adapter.ts` only for a safe enumeration entry point.

**Interfaces:** Produce `readKnowledgeCatalog(): Promise<KnowledgeCatalogReadResult>` returning an immutable sorted catalog and fingerprint or a closed failure code. Reuse `SourceVaultIO.list`, existing root verification, and `observeKnowledgeTarget` / `readKnowledgeNote`; add no create capability to the catalog module.

- [ ] **Step 1: Write failing adapter tests.** A synthetic vault should include a valid direct child, unrelated Markdown, malformed Chat2Vault-like child, nested child, symlink-like obstruction, 10,001 direct children, and a 128-KiB-plus eligible file. Assert incomplete scans never return a partial catalog.

```ts
const result = await adapter.readKnowledgeCatalog();
expect(result).toMatchObject({
  status: "ready",
  notes: [{ path: "Knowledge/Valid--aaaaaaaaaaaa.md" }],
});
io.list = async () => {
  throw new Error("unavailable");
};
expect(await adapter.readKnowledgeCatalog()).toMatchObject({
  status: "blocked",
  code: "M07_CATALOG_UNAVAILABLE",
});
```

- [ ] **Step 2: Run `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/knowledge-catalog-adapter.test.ts`.** Expected: FAIL because catalog reading is absent.
- [ ] **Step 3: Implement bounded enumeration.** Verify knowledge-root physical containment before listing, require direct-child regular Markdown paths, compare normalized path collision keys, observe each candidate with the existing safe target observer, parse bounded bytes, reject malformed Chat2Vault-like records and duplicate/ambiguous identities, and hash sorted path/byte-digest pairs plus the full direct-child listing. Resolve every catalog source-note link against the existing source registry to validate provider/fingerprint/path and enrich stable conversation ID when available; never infer missing message fingerprints. Repeatable snapshots must have the same fingerprint.

```ts
export type KnowledgeCatalogReadResult =
  | {
      status: "ready";
      notes: readonly CatalogKnowledgeNote[];
      fingerprint: string;
    }
  | {
      status: "blocked";
      code:
        | "M07_CATALOG_UNAVAILABLE"
        | "M07_CATALOG_UNSAFE"
        | "M07_CATALOG_INCOMPLETE";
    };
```

- [ ] **Step 4: Run the focused adapter test plus `test/knowledge-vault-adapter.test.ts`.** Expected: PASS; existing M06 source resolution and target containment remain unchanged.
- [ ] **Step 5: Review the adapter diff.** The catalog cannot read outside the configured root, silently truncate a scan, expose content in errors, or call the existing `create` method.

## Task 4: Gate ordinary knowledge writes on the catalog

**Files:** Create `apps/obsidian-plugin/src/knowledge-dedup-controller.ts`, `apps/obsidian-plugin/test/knowledge-dedup-controller.test.ts`; modify `apps/obsidian-plugin/src/view.ts` and `apps/obsidian-plugin/src/main.ts` to route M07 preview/write through the new gate, and `apps/obsidian-plugin/src/knowledge-controller.ts` only for a read-only authority-token accessor if needed.

**Interfaces:** The new controller composes the existing `KnowledgeController` instead of duplicating its source-resolution and M06 plan logic. `previewOrdinary()` calls the M06 preview, observes a complete catalog, classifies selected candidates, and installs an M07 token only when all selected ordinary creates have no exact match. `writeOrdinary()` re-observes catalog/source/target authority immediately before calling the existing M06 writer. It returns closed M07 diagnostics and does not expose the raw M06 write action to UI code.

- [ ] **Step 1: Write failing controller tests.** Cover exact duplicate across sources blocked, same-source warning without block, suggestion without block, incomplete catalog, candidate edit invalidation, settings/root generation change, catalog change between preview and write, and double-click non-queuing behavior.

```ts
await gate.previewOrdinary();
expect(gate.snapshot.matches.exact).toHaveLength(1);
expect(gate.snapshot.canWrite).toBe(false);
expect(base.write).not.toHaveBeenCalled();
catalog.fingerprint = "changed";
expect(await gate.writeOrdinary()).toMatchObject({ status: "stale" });
```

- [ ] **Step 2: Run `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/knowledge-dedup-controller.test.ts`.** Expected: FAIL because the gate is absent.
- [ ] **Step 3: Implement the composing controller.** Freeze the M06 plan fingerprint, candidate generation, source/knowledge roots, settings generations, and catalog fingerprint. Use a narrow read-only accessor on the M06 controller if its private generation is otherwise unavailable; do not duplicate M06 state. Clear the installed token on any edit/invalidation. If any selected candidate is an exact duplicate, block the whole M06 batch and identify the candidates to deselect; never silently drop an entry. At write, reacquire a complete catalog, compare fingerprints, reclassify exact duplicates, then consume the token before first await on the underlying writer. Keep the existing M06 mutex and write ledger.

```ts
interface OrdinaryGateToken {
  basePlanFingerprint: string;
  catalogFingerprint: string;
  candidateGeneration: number;
  knowledgeSettingsGeneration: number;
  sourceSettingsGeneration: number;
}
```

- [ ] **Step 4: Run focused controller tests, `test/knowledge-controller.test.ts`, and `test/knowledge-executor.test.ts`.** Expected: PASS. Test a catalog change that occurs while write preflight is pending and assert no create begins.
- [ ] **Step 5: Review the write call graph.** There must be no UI path to an unchecked M06 `write()` after M07 is enabled. Record that external vault mutation between final catalog recheck and create is not atomic; target containment and create-only conflict checks still apply.

## Task 5: Render a bounded create-only combined note

**Files:** Create `packages/core/src/knowledge-catalog/combine.ts`, `packages/core/test/knowledge-catalog-combine.test.ts`; modify `packages/core/src/index.ts`.

**Interfaces:** Produce `validateCombinedDraft`, `renderCombinedKnowledgeNote`, and `CombinedKnowledgePlanEntry`. Inputs are one reviewed candidate, one parsed existing note, validated source-note triples, a complete catalog's content fingerprints, and user-edited draft fields. Output is exact schema-v2 Markdown, content fingerprint, candidate fingerprint, safe target path, or closed diagnostics.

- [ ] **Step 1: Write failing render tests.** Assert v2 metadata and source links, `combined_from` only for the existing note, no fabricated unsaved-note link or message fingerprints, canonical source union, stable filename, excessive text/tag rejection, exact-content duplicate rejection, and no byte truncation.

```ts
const rendered = renderCombinedKnowledgeNote({
  candidate,
  selectedNote,
  draft,
  sourceNotes,
  existingContentFingerprints,
  knowledgeRoot: "Knowledge",
});
expect(rendered.ok).toBe(true);
if (rendered.ok) {
  expect(rendered.noteContent).toContain("chat2vault_schema: 2");
  expect(rendered.noteContent).toContain(
    'combined_from: "[[Knowledge/Existing--aaaaaaaaaaaa]]"',
  );
  expect(rendered.noteContent).not.toContain("unsaved-candidate.md");
}
```

- [ ] **Step 2: Run `pnpm --filter @chat2vault/core exec vitest run test/knowledge-catalog-combine.test.ts`.** Expected: FAIL because the v2 renderer is absent.
- [ ] **Step 3: Implement the v2 renderer.** Reuse M06 field validation, escaping, canonical source ordering, root validation, and `safeKnowledgeFilename`; add a recoverable schema-v2 fingerprint over version, exact rendered payload, rendered tags, source-note triples, and normalized selected-note path. Reject a rendered note over 128 KiB and any content fingerprint already in the complete catalog. Return the exact byte content and expected path as an immutable single-entry plan.

```ts
export type CombinedRenderResult =
  | {
      ok: true;
      targetPath: string;
      noteContent: string;
      candidateFingerprint: string;
      contentFingerprint: string;
    }
  | {
      ok: false;
      code:
        | "M07_DRAFT_INVALID"
        | "M07_EXACT_DUPLICATE"
        | "M07_NOTE_TOO_LARGE"
        | "M07_PATH_UNSAFE";
    };
```

- [ ] **Step 4: Run focused combine, M06 render/planner, and core typecheck tests.** Expected: PASS with M06 v1 output byte-identical to baseline fixtures.
- [ ] **Step 5: Review the render diff.** Verify no existing-note mutation, no unvalidated user/path text in frontmatter or wikilinks, and no implicit provider call.

## Task 6: Freeze, revalidate, and execute the combined-note plan

**Files:** Extend `apps/obsidian-plugin/src/knowledge-dedup-controller.ts` and its tests; modify `apps/obsidian-plugin/src/knowledge-executor.ts` only if needed to reuse its create/readback ledger without duplicating writer logic.

**Interfaces:** `previewCombined(candidateId, selectedPath, draft)` produces a frozen exact plan only after catalog and source-note resolution. `createCombined()` rechecks catalog, selected-note bytes, roots/settings generations, source registry, and target; then uses the existing adapter's absent-only create and readback verification. The result uses the existing per-file ledger statuses.

- [ ] **Step 1: Write failing execution tests.** Cover successful one-file create, byte-identical no-op, changed selected note, changed source registry, changed catalog, target obstruction, create failure, readback failure, and repeated create click. For each failure, assert the selected existing note's bytes and all source-note bytes are unchanged.

```ts
const preview = await gate.previewCombined(
  "candidate-1",
  "Knowledge/Existing--aaaaaaaaaaaa.md",
  draft,
);
expect(preview.status).toBe("ready");
selectedBytes = new TextEncoder().encode("changed after preview");
expect(await gate.createCombined()).toMatchObject({ status: "stale" });
expect(io.create).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/knowledge-dedup-controller.test.ts test/knowledge-executor.test.ts`.** Expected: FAIL on the new combined cases.
- [ ] **Step 3: Implement combined-plan execution.** Use a separate non-queuing preview/create token, consume it before the first write await, compare a fresh complete catalog snapshot, re-resolve source-note triples, observe/checkpoint the target, create only when absent, read back bytes, and return an exact ledger. If M06 executor needs a shared create-only helper, extract it under tests and keep the existing exported M06 behavior unchanged.

```ts
interface CombinedGateToken {
  candidateId: string;
  selectedPath: string;
  selectedByteDigest: string;
  catalogFingerprint: string;
  planFingerprint: string;
}
```

- [ ] **Step 4: Run focused combined and M06 writer/executor tests.** Expected: PASS; failures before create return no created entry, and readback failure retains the truthful partial ledger.
- [ ] **Step 5: Review the mutation surface.** Only `createKnowledgeNote` may be called; no modify, rename, delete, rollback, or overwrite method may be added or invoked.

## Task 7: Accessible UI, boundary gates, runtime evidence, and documentation

**Files:** Create `apps/obsidian-plugin/src/knowledge-dedup-view.ts`, `apps/obsidian-plugin/scripts/check-m07-boundaries.mjs`, `apps/obsidian-plugin/test/knowledge-dedup-view.test.ts`, `apps/obsidian-plugin/test/m07-boundaries.test.ts`, `apps/obsidian-plugin/test/m07-runtime-acceptance.test.ts`; modify `apps/obsidian-plugin/src/view.ts`, `apps/obsidian-plugin/src/main.ts`, `package.json`, `README.md`, `docs/00_DOCUMENT_INDEX.md`; create M07 implementation/runtime reports only after actual evidence exists.

**Interfaces:** UI consumes only immutable M07 snapshots and invokes the new gate's `previewOrdinary`, `writeOrdinary`, `previewCombined`, and `createCombined`. Boundary scripts inspect source and shipped bundle for forbidden provider/remote calls and non-create vault mutations. Reports cite actual commands, hashes, host rows, and limitations.

- [ ] **Step 1: Write failing UI and boundary tests.** Assert separate exact/same-source/related headings, existing-note open action, no Create button on exact duplicate, editable combined draft, full exact preview, disabled Create until preview, stale invalidation, accessible labels, and content-free diagnostics. Assert boundary script rejects fixture code attempting `vault.modify`, `vault.delete`, provider calls from matching, or a direct unchecked M06 write action.

```ts
expect(
  panel.querySelector('[aria-label="Exact duplicate notes"]'),
).not.toBeNull();
expect(
  panel
    .querySelector('[aria-label="Create combined note"]')
    ?.hasAttribute("disabled"),
).toBe(true);
expect(checkM07BoundarySource("vault.modify(existing, text)")).toMatchObject({
  ok: false,
});
```

- [ ] **Step 2: Run `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/knowledge-dedup-view.test.ts test/m07-boundaries.test.ts`.** Expected: FAIL on the absent M07 UI/gate.
- [ ] **Step 3: Add the focused UI module and narrow wiring.** Render suggestions as unselected links; require a separate existing-note choice and explicit combined-draft confirmation; show the exact path and Markdown bytes before enabling Create. Keep all user text assigned through `textContent`/Obsidian safe text APIs, not HTML parsing. Export the boundary script's pure `checkM07BoundarySource(source: string)` helper for fixture tests. Add `check:m07`, include the M07 artifact/boundary gate in `check:plugin` so `pnpm verify` covers it, and preserve earlier M03–M06 gates.

```json
{
  "check:m07": "node apps/obsidian-plugin/scripts/check-m07-boundaries.mjs && pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/m07-boundaries.test.ts"
}
```

- [ ] **Step 4: Run focused UI/boundary tests, `pnpm verify`, and `pnpm check:m07`.** Expected: PASS. Then run the M07 disposable-vault minimum/stable macOS x86_64 runtime rows on the exact built artifact; record real output/hashes. If host focus, native observer, or runtime acquisition blocks a row, record a truthful blocker rather than claiming GO.
- [ ] **Step 5: Self-review and independent gate.** Compare the whole branch with the M06 merge baseline; verify no future milestone, provider spend, release, or real conversation fixture. Update README/index and create implementation/runtime reports from measured results only. Request a fresh read-only R2 review of the exact candidate after all gates stabilize; its findings are evidence to verify, not automatic authority.

## Final handoff

The implementation objective is achieved only when the exact candidate meets the spec acceptance ledger, the full relevant gates and two runtime rows pass, and the independent review finds no unresolved R2 blocker. Report `GO`, `CONDITIONAL GO`, or `NO-GO` with exact branch/HEAD, changed files, commands/results, limitations, and separate commit/push/PR/merge/release states. Do not start M08 or publish without separate authorization.

This plan is documentation only. The Product Owner must separately authorize M07 implementation and select subagent-driven or inline execution before Task 1 begins.
